export interface ReadingPosition { top: number; left: number; column?: number }
export interface ReadingHeading { slug: string; githubSlug: string }

/** Normalize only the parser input; the tab retains its original byte snapshot. */
export function readingRenderMarkdown(markdown: string): string { return markdown.replace(/\r\n?/g,'\n') }

export function readingHeadingElements(root: ParentNode): HTMLElement[] {
  const page = root.querySelector<HTMLElement>('.mu-container')
  return page ? [...page.children].filter((element): element is HTMLElement => element.matches('.mu-atx-heading, .mu-setext-heading')) : []
}

export function readingCopyText(selection: Pick<Selection, 'isCollapsed' | 'toString'> | null, wholeDocument: string): string {
  return selection && !selection.isCollapsed ? selection.toString() : wholeDocument
}

export function readingLinkTarget(href: string, documentPath: string | null): { kind: 'fragment'; href: string } | { kind: 'external'; href: string } | { kind: 'document'; path: string; fragment: string } | null {
  if (href.startsWith('#')) return { kind: 'fragment', href }
  if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', href }
  if (!documentPath && !/^file:/i.test(href)) return null
  try {
    const base = documentPath ? 'file:///' + documentPath.replace(/\\/g,'/').split('/').map((part,index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/') : undefined
    const url = new URL(href,base)
    if (url.protocol !== 'file:') return null
    const file = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i,'$1')
    if (!/\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i.test(file)) return null
    return { kind: 'document', path: url.hostname ? `//${url.hostname}${file}` : file, fragment: url.hash }
  } catch { return null }
}

/** A single gate for menu, command-palette and accelerator mutations. */
export function readingCommandAllowed(id: string): boolean {
  if (/^(format|paragraph):/.test(id)) return false
  return !id.startsWith('edit:') || /^(copy(?:Markdown|Html)?|selectAll|find|findInFolder)$/.test(id.slice(5))
}

/** Stopping propagation keeps Muya's direct listeners out of native selection. */
export function guardReadingEvent(event: Event): void {
  if (['beforeinput', 'input', 'paste', 'cut', 'drop', 'dragover'].includes(event.type)) event.preventDefault()
  event.stopImmediatePropagation()
}

export class ReadingHistory {
  constructor(private entries: ReadingPosition[]) {}
  get length(): number { return this.entries.length }
  record(from: ReadingPosition, to: ReadingPosition): boolean {
    if (Math.abs(from.top - to.top) < 1 && Math.abs(from.left - to.left) < 1) return false
    this.entries.push({ ...from })
    if (this.entries.length > 100) this.entries.shift()
    return true
  }
  pop(): ReadingPosition | undefined { return this.entries.pop() }
}

export function readingHeadingAliases(headings: ReadingHeading[]): Map<string, number> {
  const result = new Map<string, number>(), used = new Set<string>()
  headings.forEach((item, index) => {
    const base = item.githubSlug || 'heading'
    let slug = base, suffix = 0
    while (used.has(slug)) slug = `${base}-${++suffix}`
    used.add(slug)
    if (!result.has(slug)) result.set(slug, index)
    if (item.slug && !result.has(item.slug)) result.set(item.slug, index)
  })
  return result
}

/** Binary search only cached coordinates; no DOM measurements on scrolling. */
export function readingChapterAt(headings: { x: number; y: number }[], position: ReadingPosition, columns: boolean, atEnd = false): number {
  if (atEnd) return headings.length - 1
  let lo = 0, hi = headings.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1, h = headings[mid]
    const before = columns ? h.x < position.left + 40 || (h.x <= position.left + 52 && h.y <= position.top + 60) : h.y <= position.top + 60
    if (before) lo = mid + 1
    else hi = mid
  }
  return headings.length ? Math.max(0, lo - 1) : -1
}

interface ReadingOptions {
  active: () => boolean
  headings: () => ReadingHeading[]
  pages: () => { step: number; last: number } | null
  history: ReadingPosition[]
  changed: (heading: number, canBack: boolean) => void
  shortcut: (event: KeyboardEvent) => void
  external: (href: string) => void
  restore?: (position: ReadingPosition) => void
}

/** Reuses the existing rendered tree; this class never reads or writes Markdown. */
export class ReadingDocument {
  private history: ReadingHistory
  private headings: { element: HTMLElement; x: number; y: number }[] = []
  private aliases = new Map<string, number>()
  private dirty = true
  private frame: number | null = null
  private disposed = false
  private maxTop = 0
  private mutations: MutationObserver
  private resize: ResizeObserver | null = null
  private removers: (() => void)[] = []

  constructor(private root: HTMLElement, private scroller: HTMLElement, private options: ReadingOptions) {
    this.history = new ReadingHistory(options.history)
    // 构造时按当前态同步只读；不再无条件加锁，
    // 否则编辑器一创建就失去编辑能力。
    this.syncReadOnly(options.active())
    root.classList.add('is-reading-document')
    root.tabIndex = 0
    const on = (target: EventTarget, name: string, listener: EventListener, capture = false): void => {
      target.addEventListener(name, listener, capture)
      this.removers.push(() => target.removeEventListener(name, listener, capture))
    }
    for (const name of ['mousedown','mouseup','mousemove','pointerdown','pointerup','dblclick','beforeinput','input','paste','cut','drop','dragover']) {
      on(root, name, event => { if (options.active()) guardReadingEvent(event) }, true)
    }
    on(root, 'keydown', event => {
      if (!options.active()) return
      // Native arrows, copy, browser selection and scrolling keep their defaults.
      guardReadingEvent(event)
      options.shortcut(event as KeyboardEvent)
    }, true)
    on(root, 'click', event => {
      if (!options.active()) return
      const target = event.target instanceof Element ? event.target : null
      const reference = target?.closest<HTMLElement>('sup.mu-inline-footnote-identifier')
      const backlink = target?.closest<HTMLElement>('.mu-footnote-backlink')
      if (reference || backlink) {
        event.preventDefault()
        if (reference) this.fragment('#footnote-' + reference.id.replace(/^noteref-/,''))
        else {
          const identifier = backlink!.closest('.mu-footnote')?.querySelector('.mu-footnote-input')?.textContent
          if (identifier) this.fragment('#noteref-' + identifier)
        }
        guardReadingEvent(event)
        return
      }
      const link = target?.closest<HTMLElement & { href?: string }>('a[href], .mu-link')
      if (link && root.contains(link)) {
        event.preventDefault()
        const href = link.getAttribute('href') || link.href || ''
        if (href.startsWith('#')) this.fragment(href)
        else options.external(href)
      } else if (target?.closest('input,button,textarea,select,[role="checkbox"]')) event.preventDefault()
      guardReadingEvent(event)
    }, true)
    on(root.ownerDocument, 'copy', event => {
      if (!options.active()) return
      const selection = root.ownerDocument.getSelection()
      if (!selection?.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return
      const clipboard = (event as ClipboardEvent).clipboardData
      if (!clipboard) return
      clipboard.setData('text/plain', selection.toString())
      event.preventDefault()
      event.stopImmediatePropagation()
    }, true)
    on(scroller, 'scroll', () => this.queue(), false)
    on(root, 'load', () => this.invalidate(), true)
    on(root.ownerDocument.fonts, 'loadingdone', () => this.invalidate())
    this.mutations = new MutationObserver(records => {
      let layout = false
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) if (node instanceof HTMLElement) this.lock(node)
        } else if (record.attributeName === 'contenteditable' && record.target instanceof HTMLElement) this.lock(record.target)
        const element = record.target instanceof Element ? record.target : record.target.parentElement
        if (!element?.closest('.mu-line-numbers-rows') && record.attributeName !== 'contenteditable' && record.attributeName !== 'disabled') layout = true
      }
      if (layout) this.invalidate()
    })
    this.mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class','style','open','width','height','src','contenteditable','disabled'] })
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.invalidate())
      this.resize.observe(scroller)
      this.resize.observe(root)
    }
    this.queue()
  }

  /** 被锁成只读的元素及其原始 contenteditable 值，退出阅读时还原。 */
  private lockedEditable = new Map<HTMLElement, string | null>()
  /** 被禁用的表单控件，退出阅读时还原。 */
  private lockedDisabled: HTMLElement[] = []

  private lock(element: HTMLElement): void {
    // 只在阅读态锁定。非阅读态下不能动 contenteditable，
    // 否则编辑器会永久失去输入能力（所见即所得变得不可编辑）。
    if (!this.options.active()) return
    const nodes = [element, ...element.querySelectorAll<HTMLElement>('[contenteditable],input,textarea,select,button')]
    for (const node of nodes) {
      if ((node === this.root || node.hasAttribute('contenteditable')) && node.getAttribute('contenteditable') !== 'false') {
        if (!this.lockedEditable.has(node)) this.lockedEditable.set(node, node.getAttribute('contenteditable'))
        node.setAttribute('contenteditable', 'false')
      }
      if (node.matches('input,textarea,select,button') && !node.hasAttribute('disabled')) {
        this.lockedDisabled.push(node)
        node.setAttribute('disabled', '')
      }
    }
    for (const note of [element,...element.querySelectorAll<HTMLElement>('.mu-footnote')]) {
      if (!note.matches('.mu-footnote') || note.id) continue
      const identifier = note.querySelector('.mu-footnote-input')?.textContent
      if (identifier) note.id = 'footnote-' + identifier
    }
  }

  /**
   * 解除只读，把 contenteditable 与 disabled 还原成锁定前的值。
   *
   * 退出阅读模式时必须调用，否则内核的内容块仍带 contenteditable="false"，
   * 表现就是「切回编辑了却打不了字」。
   */
  unlock(): void {
    for (const [node, original] of this.lockedEditable) {
      if (!node.isConnected) continue
      if (original === null) node.removeAttribute('contenteditable')
      else node.setAttribute('contenteditable', original)
    }
    this.lockedEditable.clear()
    for (const node of this.lockedDisabled) {
      if (node.isConnected) node.removeAttribute('disabled')
    }
    this.lockedDisabled = []
  }

  /** 同步只读状态：进入阅读锁定，退出阅读解锁。 */
  syncReadOnly(reading: boolean): void {
    if (reading) {
      this.lock(this.root)
      this.root.classList.add('is-reading-document')
      // 文档可能刚被 setContent 重建，MutationObserver 的回调还没跑；
      // 这里再锁一次，确保新建的内容块也是 contenteditable=false。
      queueMicrotask(() => {
        if (!this.disposed && this.options.active()) this.lock(this.root)
      })
    } else {
      this.unlock()
      this.root.classList.remove('is-reading-document')
    }
  }

  invalidate(): void { this.dirty = true; this.queue() }
  activate(): void { this.invalidate() }
  private queue(): void {
    if (this.disposed || this.frame !== null || !this.options.active()) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      if (this.disposed || !this.options.active()) return
      this.measure()
      const position = this.position(), pages = this.options.pages()
      const atEnd = pages ? pages.last > 1 && (position.column ?? 0) >= pages.last - 1 : this.maxTop > 0 && position.top >= this.maxTop - 1
      this.options.changed(readingChapterAt(this.headings, position, !!pages, atEnd), this.history.length > 0)
    })
  }
  private measure(): void {
    if (!this.dirty) return
    this.dirty = false
    const bounds = this.scroller.getBoundingClientRect()
    this.maxTop = Math.max(0,this.scroller.scrollHeight - this.scroller.clientHeight)
    this.headings = readingHeadingElements(this.root).map(element => {
      const rect = element.getBoundingClientRect()
      return { element, x: rect.left - bounds.left + this.scroller.scrollLeft, y: rect.top - bounds.top + this.scroller.scrollTop }
    })
    this.aliases = readingHeadingAliases(this.options.headings())
    this.headings.forEach((h, index) => { if (h.element.id && !this.aliases.has(h.element.id)) this.aliases.set(h.element.id,index) })
  }
  position(): ReadingPosition {
    const pages = this.options.pages()
    return { top: this.scroller.scrollTop, left: this.scroller.scrollLeft, ...(pages?.step ? { column: Math.round(this.scroller.scrollLeft / pages.step) } : {}) }
  }
  private move(position: ReadingPosition): void {
    if (this.options.restore) this.options.restore(position)
    else {
      const pages = this.options.pages()
      this.scroller.scrollTop = position.top
      this.scroller.scrollLeft = pages && position.column !== undefined ? Math.min(pages.last - 1, Math.max(0,position.column)) * pages.step : position.left
    }
    this.queue()
  }
  go(index: number): boolean {
    if (!this.options.active()) return false
    this.measure()
    const heading = this.headings[index]
    if (!heading) return false
    const pages = this.options.pages(), from = this.position()
    const position: ReadingPosition = { top: pages ? 0 : Math.max(0,heading.y - 30), left: 0 }
    if (pages?.step) {
      const origin = this.root.getBoundingClientRect().left - this.scroller.getBoundingClientRect().left + this.scroller.scrollLeft
      position.column = Math.min(pages.last - 1,Math.max(0,Math.floor((heading.x - origin + 1) / pages.step)))
      position.left = position.column * pages.step
    }
    this.history.record(from,position)
    this.move(position)
    return true
  }
  fragment(value: string): boolean {
    this.measure()
    let id: string
    try { id = decodeURIComponent(value.replace(/^#/,'')) } catch { return false }
    const heading = this.aliases.get(id)
    if (heading !== undefined) return this.go(heading)
    const target = [...this.root.querySelectorAll<HTMLElement>('[id]')].find(element => element.id === id)
    if (!target) return false
    const rect = target.getBoundingClientRect(), bounds = this.scroller.getBoundingClientRect(), from = this.position(), pages = this.options.pages()
    const position: ReadingPosition = { top: Math.max(0,from.top + rect.top - bounds.top - 30), left: from.left }
    if (pages?.step) { position.top = 0; position.column = Math.min(pages.last - 1,Math.max(0,Math.floor((from.left + rect.left - bounds.left - 44) / pages.step))); position.left = position.column * pages.step }
    this.history.record(from,position); this.move(position); return true
  }
  back(): boolean {
    if (!this.options.active()) return false
    const position = this.history.pop()
    if (!position) return false
    this.move(position)
    return true
  }
  selectAll(): void {
    const selection = this.root.ownerDocument.getSelection(), range = this.root.ownerDocument.createRange()
    range.selectNodeContents(this.root)
    selection?.removeAllRanges(); selection?.addRange(range)
  }
  private selection(): Selection | null {
    const selection = this.root.ownerDocument.getSelection()
    return selection?.anchorNode && selection.focusNode && this.root.contains(selection.anchorNode) && this.root.contains(selection.focusNode) ? selection : null
  }
  selectedText(): string { return this.selection()?.toString() ?? '' }
  copyMarkdown(wholeDocument: string): string { return readingCopyText(this.selection(),wholeDocument) }
  copyHtml(wholeDocument: () => string): string {
    const selection = this.selection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return wholeDocument()
    const container = this.root.ownerDocument.createElement('div')
    container.appendChild(selection.getRangeAt(0).cloneContents())
    for (const element of container.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,.mu-remove,.mu-language-input,.mu-code-copy,.mu-copy-header-link,.mu-fold-toggle,.mu-line-numbers-rows,.mu-math-container,.mu-diagram-container,.mu-html-container')) element.remove()
    for (const element of container.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim().replace(/[\u0000-\u0020]/g,'')
      if (name.startsWith('on') || ['srcdoc','contenteditable','tabindex','draggable','style'].includes(name) || ['href','src','xlink:href'].includes(name) && /^(javascript:|vbscript:|data:)/i.test(value)) element.removeAttribute(attribute.name)
    }
    return container.innerHTML
  }
  dispose(): void {
    this.disposed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.mutations.disconnect(); this.resize?.disconnect()
    for (const remove of this.removers) remove()
  }
}
