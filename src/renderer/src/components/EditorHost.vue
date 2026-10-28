<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch, nextTick } from 'vue'
import { Muya, registerMuyaPlugins, buildMuyaOptions, setDocPathForImages } from '../editor/muyaSetup'
import { generateGithubSlug, type IPublicCursorInput } from '@muyajs/core'
import { registerCommands, registerGlobalCommands, executeCommand, hasCommand, listCommandIds, dispatchReadingShortcut } from '../composables/useCommands'
import { exportHtml, exportPdf, exportDocxFile, buildHtmlForCheck, renderPreviewHtml, printDocument } from '../composables/useExport'
import { useI18n } from '../composables/useI18n'
import BlockOrb from './BlockOrb.vue'
import { TextHistory, editSource, replaceRange, textMatches, replaceTextMatch, lineOffsets, offsetIndex, type TextSnapshot } from '../editor/sourceEditing'
import { patchPreview, previewBlockOffsets } from '../editor/previewBlocks'
import { PreviewDiagrams, preparePreviewDiagrams } from '../editor/previewDiagrams'
import { DeferredDiagrams } from '../editor/deferredDiagrams'
import { ReadingDocument, readingLinkTarget, readingRenderMarkdown, type ReadingPosition } from '../editor/reading'
import { buildSearchResults } from '../editor/searchResults'
import { resolveExportImageSrc } from '@muyajs/core/utils/fileUrl'

// 供主进程端到端自检调用
;(window as unknown as Record<string, unknown>).__inkdownExport = { buildHtmlForCheck }
import { getActiveTab, isDirty, state, settings, type Tab } from '../store'
import { baseName } from '../composables/useFile'

const editorScrollRef = ref<HTMLElement | null>(null)
/** 编辑器根节点，用于判断右键是否发生在编辑区内。 */
const hostRef = ref<HTMLElement | null>(null)
const sourceRef = ref<HTMLTextAreaElement | null>(null)
const sourceHistories = new Map<string, TextHistory>()
const previewDiagrams = new PreviewDiagrams()

function sourceSnapshot(): TextSnapshot {
  const ta = sourceRef.value
  return { text: state.sourceContent, start: ta?.selectionStart ?? 0, end: ta?.selectionEnd ?? 0 }
}

function sourceHistory(): TextHistory | undefined {
  const tab = activeTab.value
  if (!tab) return
  if (!sourceHistories.has(tab.id)) sourceHistories.set(tab.id, new TextHistory({ text: tab.content, start: 0, end: 0 }))
  return sourceHistories.get(tab.id)
}

function applySourceEdit(snapshot: TextSnapshot): void {
  const ta = sourceRef.value
  if (!ta) return
  sourceHistory()?.record(sourceSnapshot())
  sourceHistory()?.record(snapshot)
  ta.value = snapshot.text
  state.sourceContent = snapshot.text
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(snapshot.start, snapshot.end)
    onSourceCaretMove()
    resizeSourceEditor()
  })
}
const { t, locale } = useI18n()
let muya: Muya | null = null
let suppress = false
/** 源码模式的等宽字体回退栈（通过 CSS 变量传给样式，避免 v-bind 依赖构建插件） */
const CODE_FONT_FALLBACK =
  "'Cascadia Code', 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
/** 各标签页的光标与滚动位置，切回时恢复。 */
interface EditorSession {
  id: string
  instance: Muya
  diagrams: DeferredDiagrams
  reading: ReadingDocument | null
  content: string
  markdown: string
  cursor: IPublicCursorInput | null
  scrollTop: number
  scrollLeft: number
  columnStart: number
  suspended: boolean
}
const editorSessions = new Map<string, EditorSession>()
let currentSession: EditorSession | null = null
let cursorTimer: number | null = null
/**
 * 字数统计与大纲刷新的防抖计时器。
 *
 * 每次击键（json-change）都会触发全量统计与大纲重建，
 * 长文档下是纯浪费——打字过程中没人需要实时看大纲。
 * 只对「输入触发的更新」防抖；切标签、载入、命令执行等
 * 低频路径仍走立即更新（见 flushCountsAndOutline）。
 */
let countsTimer: number | null = null
/** 待刷新的 markdown 快照，防抖到期时使用。 */
let pendingCountsMarkdown = ''
let settingsGeneration = 0
const sessionSettings = new WeakMap<Muya, number>()
const columnsPage = ref(1)
const columnsPages = ref(1)
const columnsWide = ref(true)
const columnsActive = computed(() => state.wysiwygColumns && state.viewMode === 'wysiwyg' && columnsWide.value)
let columnsObserver: ResizeObserver | null = null
let columnsFrame: number | null = null
// Scrolling uses cached geometry; only document/viewport changes invalidate it.
let columnLayoutDirty = true
// Distance between adjacent pages, half of a two-page viewport plus its gutter.
const columnStride = ref(0)
const columnsLastStart = computed(() => Math.max(1, columnsPages.value - 1))
const columnsRange = computed(() => {
  const end = Math.min(columnsPages.value, columnsPage.value + 1)
  return end === columnsPage.value ? String(end) : `${columnsPage.value}–${end}`
})
let columnWheelDelta = 0
let columnWheelAt = 0
let columnRestorePending: { session: EditorSession; start: number } | null = null
const columnsEnd = ref(0)
let columnRevealPending = false
let columnContentObserver: MutationObserver | null = null

function destroySession(session: EditorSession): void {
  session.reading?.dispose()
  session.diagrams.dispose()
  session.instance.destroy()
}

function sessionEvents(session: EditorSession, active: boolean): void {
  // This Muya tree is display-only; source and split editing use the textarea.
  active = false
  if (session.suspended === !active) return
  session.suspended = !active
  for (const { target, event, listener, capture } of session.instance.eventCenter.events) {
    if (active) target.addEventListener(event, listener, capture)
    else target.removeEventListener(event, listener, capture)
  }
}

function captureNativeCursor(): IPublicCursorInput | null {
  const selection = muya?.editor.selection.getSelection()
  if (!selection || selection.anchor.block.muya !== muya) return null
  return {
    anchorPath: [...selection.anchor.block.path], anchor: { offset: selection.anchor.offset },
    focusPath: [...selection.focus.block.path], focus: { offset: selection.focus.offset }
  }
}

function updateColumnPosition(): void {
  const scroller = editorScrollRef.value
  if (scroller && columnStride.value > 0) {
    columnsPage.value = Math.min(columnsLastStart.value, Math.max(1, Math.round(scroller.scrollLeft / columnStride.value) + 1))
  }
}

function updateColumnPages(): void {
  const scroller = editorScrollRef.value
  if (!scroller || !muya) return
  columnLayoutDirty = false
  const viewportWidth = scroller.clientWidth
  columnsWide.value = viewportWidth >= 760
  if (!columnsActive.value) { columnsPage.value = columnsPages.value = 1; columnStride.value = 0; return }
  const owner = currentSession
  const previousStride = columnStride.value
  const restore = columnRestorePending?.session === owner ? columnRestorePending : null
  const start = restore?.start ?? (previousStride > 0 ? Math.round(scroller.scrollLeft / previousStride) : 0)
  const height = `${scroller.clientHeight - 76}px`
  if (scroller.style.getPropertyValue('--column-content-height') !== height) {
    scroller.style.setProperty('--column-content-height', height)
  }
  columnStride.value = (muya.domNode.clientWidth + 64) / 2
  let last = muya.editor.scrollPage?.domNode?.lastElementChild
  while (last && !last.getClientRects().length) last = last.previousElementSibling
  const firstLeft = muya.domNode.getBoundingClientRect().left
  const lastRight = last?.getBoundingClientRect().right ?? firstLeft
  columnsPages.value = Math.max(1, Math.ceil((lastRight - firstLeft + 64 - 1) / columnStride.value))
  columnsEnd.value = (columnsLastStart.value - 1) * columnStride.value + viewportWidth - 1
  const page = Math.min(columnsLastStart.value - 1, Math.max(0, start))
  columnsPage.value = page + 1
  // Apply the new extent/snap markers before positioning a newly added page.
  nextTick(() => {
    if (!columnsActive.value || editorScrollRef.value !== scroller || currentSession !== owner) return
    scroller.scrollLeft = (columnsPage.value - 1) * columnStride.value
    if (columnRestorePending === restore) columnRestorePending = null
  })
}

function observeColumnContent(): void {
  columnContentObserver?.disconnect()
  if (muya) columnContentObserver?.observe(muya.domNode, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'width', 'height', 'src']
  })
  scheduleColumnLayout()
}

function revealColumnCaret(): void {
  const scroller = editorScrollRef.value
  const selection = document.getSelection()
  if (!columnsActive.value || !scroller || !muya || !selection?.focusNode || !muya.domNode.contains(selection.focusNode)) return
  const range = document.createRange()
  range.setStart(selection.focusNode, selection.focusOffset)
  range.collapse(true)
  const caret = range.getBoundingClientRect()
  const bounds = scroller.getBoundingClientRect()
  if (caret.left >= bounds.left + 40 && caret.right <= bounds.right - 40) return
  const relativeX = caret.left - muya.domNode.getBoundingClientRect().left
  const caretPage = Math.floor(relativeX / columnStride.value)
  // Crossing the right edge reveals the new page on the right, preserving
  // the previous right page on the left: 1–2 becomes 2–3, including keyboard use.
  const start = caretPage - (caret.left >= bounds.right - 40 ? 1 : 0)
  const page = Math.max(0, Math.min(columnsLastStart.value - 1, start))
  scroller.scrollLeft = page * columnStride.value
  columnsPage.value = page + 1
}

function queueColumnFrame(): void {
  if (columnsFrame != null) return
  columnsFrame = requestAnimationFrame(() => {
    columnsFrame = null
    if (columnLayoutDirty) updateColumnPages()
    else updateColumnPosition()
    if (columnRevealPending) {
      columnRevealPending = false
      const owner = currentSession
      nextTick(() => { if (currentSession === owner) revealColumnCaret() })
    }
  })
}

function scheduleColumnLayout(): void {
  columnLayoutDirty = true
  queueColumnFrame()
}

function onColumnScroll(): void {
  if (columnsActive.value) queueColumnFrame()
}

function turnColumns(direction: number): void {
  const scroller = editorScrollRef.value
  if (!scroller || !columnsActive.value || !columnStride.value) return
  // The scroll event can arrive next frame after a native or restored scroll.
  // Always navigate from the actual visible page, rather than its delayed label.
  const current = Math.round(scroller.scrollLeft / columnStride.value) + 1
  const page = Math.max(1, Math.min(columnsLastStart.value, current + direction))
  columnWheelDelta = 0
  scroller.scrollLeft = (page - 1) * columnStride.value
  columnsPage.value = page
}

function onColumnsWheel(event: WheelEvent): void {
  if (!columnsActive.value || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return
  const scroller = editorScrollRef.value
  if (!scroller) return
  // Let genuinely overflowing code, tables and diagrams scroll internally.
  // At their boundary the same wheel gesture continues through the document.
  let target = event.target instanceof Element ? event.target : null
  while (target && target !== scroller) {
    if (target.matches('pre, .mu-code-block, .mu-diagram-preview, .mu-table')) {
      const max = target.scrollHeight - target.clientHeight
      if (max > 1 && (event.deltaY > 0 ? target.scrollTop < max - 1 : target.scrollTop > 0)) return
    }
    target = target.parentElement
  }
  event.preventDefault()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1)
  const now = performance.now()
  if (now - columnWheelAt > 180 || Math.sign(columnWheelDelta) !== Math.sign(delta)) columnWheelDelta = 0
  columnWheelAt = now
  columnWheelDelta += delta
  // One normal wheel notch advances one page; small touchpad packets accumulate.
  // Large deltas still advance only one page, never skip a page.
  if (Math.abs(columnWheelDelta) >= 48) turnColumns(Math.sign(columnWheelDelta))
}

watch(columnsActive, active => {
  columnWheelDelta = 0
  if (!active) columnRestorePending = null
  const scroller = editorScrollRef.value
  if (scroller) {
    // A cancelable wheel listener forces even single-column scrolling to wait
    // for the renderer. Install it only while horizontal column flow needs it.
    scroller.removeEventListener('wheel', onColumnsWheel)
    if (active) scroller.addEventListener('wheel', onColumnsWheel, { passive: false })
    scroller.scrollLeft = 0
  }
  nextTick(scheduleColumnLayout)
})

const activeTab = computed(() => getActiveTab())
/**
 * 是否处于只读阅读态。
 *
 * 注意：由独立的 state.readingMode 决定，**不再**等同于 viewMode === 'wysiwyg'。
 * 早期实现把两者绑定，导致所见即所得永久只读、无法编辑。
 */
const isReading = computed(() => state.viewMode === 'wysiwyg' && state.readingMode)
/** 所见即所得视图（可编辑或阅读，取决于 readingMode）。 */
const isWysiwyg = computed(() => state.viewMode === 'wysiwyg')
const isSource = computed(() => state.viewMode === 'source')
/** 源码预览：左侧源码编辑，右侧静态预览。 */
const isSplit = computed(() => state.viewMode === 'split')
/** 右侧预览容器。 */
const previewRef = ref<HTMLElement | null>(null)
/** 源码预览左侧源码的当前行号，用于页头信息。 */
const sourceLine = ref(1)
const sourceLineStarts = computed(() => lineOffsets(state.sourceContent))
const sourceLines = computed(() => sourceLineStarts.value.length)
let previewStarts: number[] = []
let caretFrame: number | null = null
let sourceResizeObserver: ResizeObserver | null = null
let sourceResizeFrame: number | null = null
let previewFrame: number | null = null
let previewTimer: number | null = null
let previewDirtySince = 0

/**
 * Let input paint first; merge bursts of edits and refresh at least every
 * 240ms during continuous typing instead of parsing the whole file per key.
 */
function schedulePreviewRefresh(): void {
  if (!previewDirtySince) previewDirtySince = performance.now()
  if (previewTimer != null) window.clearTimeout(previewTimer)
  if (previewFrame != null) return
  previewTimer = window.setTimeout(() => {
    previewTimer = null
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null
      previewDirtySince = 0
      refreshPreview()
    })
  }, Math.min(70, Math.max(0, 240 - (performance.now() - previewDirtySince))))
}

function cancelPreviewRefresh(): void {
  if (previewFrame != null) cancelAnimationFrame(previewFrame)
  if (previewTimer != null) window.clearTimeout(previewTimer)
  previewFrame = null
  previewTimer = null
  previewDirtySince = 0
}

/**
 * 让 textarea 随内容长高，由外层 .source-scroll 统一滚动。
 *
 * textarea 自己出现滚动条时，源码和预览会各自维护一套滚动状态；
 * 这里把高度撑开，由外层容器统一滚动，光标定位也更稳定。
 */
function resizeSourceEditorNow(): void {
  const ta = sourceRef.value
  if (!ta) return
  ta.style.height = 'auto'
  // Read and write once; every assignment to scrollHeight forces layout.
  ta.style.height = `${ta.scrollHeight}px`
}

/** Coalesce resize requests into one layout pass per frame. */
function resizeSourceEditor(): void {
  if (sourceResizeFrame != null) return
  sourceResizeFrame = requestAnimationFrame(() => {
    sourceResizeFrame = null
    resizeSourceEditorNow()
  })
}

/** 刷新分栏预览区的内容。 */
function refreshPreview(): void {
  cancelPreviewRefresh()
  if (!isSplit.value) return
  const el = previewRef.value
  if (!el) return
  const tab = activeTab.value
  if (!tab) {
    el.innerHTML = ''
    return
  }
  // The split preview follows the textarea, not the delayed WYSIWYG tab
  // content. Reading tab.content here made the preview lag one update behind
  // while typing and forced an extra full Markdown conversion per keystroke.
  markedPreviewEl?.classList.remove('split-cursor-block')
  markedPreviewEl = null
  patchPreview(el, renderPreviewHtml(state.sourceContent), (root) => {
    preparePreviewDiagrams(root, { mermaidTheme: settings.mermaidTheme, vegaTheme: settings.vegaTheme, plantumlServer: settings.plantumlServer, sequenceTheme: settings.sequenceTheme })
    injectPreviewHeadingIds(root)
    for (const image of root.querySelectorAll('img')) image.setAttribute('src', resolveExportImageSrc(image.getAttribute('src') ?? ''))
  })
  previewStarts = previewBlockOffsets(state.sourceContent, settings)
  previewDiagrams.update(el)
  injectPreviewHeadingIds(el)
  // 预览重建后高亮框会失效，重新定位一次
  nextTick(() => syncPreviewToCursor())
}

/** 切标签时先让标题与 textarea 完成首帧，再解析 Markdown。 */
function queuePreviewRefresh(): void {
  cancelPreviewRefresh()
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null
    refreshPreview()
  })
}

/* ------------------------- 源码预览：光标 ↔ 预览联动 ------------------------- */

/**
 * 把源码光标所在位置映射到预览里的对应元素。
 *
 * 做法：按「块」对齐。
 *   源码侧：由 Markdown 解析器计算块偏移，并合并 HTML 容器中的嵌套块；
 *   预览侧：取预览容器的顶层子元素（h1/p/ul/pre/table…），
 *           与源码块一一对应（两者都是同一份 Markdown 的块序列）。
 * 这种按序对齐简单可靠，不需要在渲染器里埋标记。
 */

/** 根据光标偏移算出它属于第几个块。 */
function blockIndexAtOffset(starts: number[], offset: number): number {
  if (!starts.length) return -1
  return offsetIndex(starts, offset)
}

/** 源码 textarea 中光标的绝对偏移。 */
function sourceCursorOffset(): number {
  const ta = sourceRef.value
  if (!ta) return -1
  return ta.selectionStart
}

/** 光标移动（点击 / 按键 / 输入）时同步预览。 */
function onSourceCaretMove(): void {
  const snapshot = sourceSnapshot()
  const history = sourceHistory()
  if (history?.current.text === snapshot.text) history.record(snapshot)
  updateSourceLine()
  if (!isSplit.value) return
  if (caretFrame != null) return
  caretFrame = requestAnimationFrame(() => { caretFrame = null; syncPreviewToCursor() })
}

function onSourceInput(): void {
  sourceHistory()?.record(sourceSnapshot(), true)
  onSourceCaretMove()
}

/** 由 textarea 的光标偏移计算当前行号。 */
function updateSourceLine(): void {
  const ta = sourceRef.value
  if (!ta) return
  const offsets = sourceLineStarts.value
  const toPos = (offset: number): { line: number; ch: number } => {
    const line = offsetIndex(offsets, offset)
    return { line, ch: offset - offsets[line] }
  }
  const anchor = toPos(ta.selectionStart)
  sourceLine.value = anchor.line + 1

  // 状态栏也读取 tab.cursor；源码/分栏模式下同步它，避免行号停留在旧位置。
  const tab = activeTab.value
  if (!tab) return
  tab.cursor = { anchor, focus: toPos(ta.selectionEnd) }
}

/** 预览容器里与源码块对应的顶层元素（跳过脚注等非正文节点）。 */
function previewBlocks(): HTMLElement[] {
  const el = previewRef.value
  if (!el) return []
  return [...el.children].filter(
    (c) => c instanceof HTMLElement && !c.classList.contains('footnotes')
  ) as HTMLElement[]
}

/** 当前应被标出的预览元素。 */
function activePreviewBlock(): HTMLElement | null {
  const md = state.sourceContent
  if (!md) return null
  const starts = previewStarts
  const offset = sourceCursorOffset()
  if (offset < 0) return null
  const idx = blockIndexAtOffset(starts, offset)
  const blocks = previewBlocks()
  if (idx < 0 || idx >= blocks.length) return null
  return blocks[idx] ?? null
}

/** 上一次标出的元素，便于清除样式。 */
let markedPreviewEl: HTMLElement | null = null

function onPreviewClick(event: MouseEvent): void {
  const root = previewRef.value
  const ta = sourceRef.value
  if (!isSplit.value || !root || !ta || !(event.target instanceof Element)) return
  if (event.target.closest('a, button, input, select, textarea, summary')) return
  // Do not steal the selection when the user is copying preview text.
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && root.contains(selection.anchorNode)) return
  let block: Element | null = event.target
  while (block && block.parentElement !== root) block = block.parentElement
  const index = previewBlocks().indexOf(block as HTMLElement)
  const offset = previewStarts[index]
  if (offset == null) return
  if (caretFrame != null) cancelAnimationFrame(caretFrame)
  caretFrame = null
  markedPreviewEl?.classList.remove('split-cursor-block')
  markedPreviewEl = null
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(offset, offset)
  updateSourceLine()
  scrollSourceToOffset(offset)
}

/** 标出光标所在块 + 按需滚动。两个行为分别受设置控制。 */
function syncPreviewToCursor(): void {
  if (!isSplit.value) return
  const target = settings.splitHighlightBlock ? activePreviewBlock() : null

  // 清除上一次的虚线框
  if (markedPreviewEl && markedPreviewEl !== target) {
    markedPreviewEl.classList.remove('split-cursor-block')
    markedPreviewEl = null
  }
  if (target) {
    target.classList.add('split-cursor-block')
    markedPreviewEl = target
  }

  if (!settings.splitSyncScroll) return
  const scrollTarget = target ?? activePreviewBlock()
  if (!scrollTarget) return
  // 真正滚动的是预览内容区本身（.split-preview-body 设了 overflow-y:auto），
  // 不是它的父元素 —— 取父元素会滚到不动的外层容器，表现为「完全没跟随」。
  const scroller = previewRef.value
  if (!scroller) return
  // 让对应块落在预览窗口垂直中心。
  // 用 auto 而非 smooth：smooth 在长文档里可能滚很久，
  // 而且程序化读取位置时还没到位，观感也不如立即跟随。
  const r = scrollTarget.getBoundingClientRect()
  const sr = scroller.getBoundingClientRect()
  const top = scroller.scrollTop + (r.top - sr.top) - sr.height / 2 + r.height / 2
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
}

function updateCounts(markdown: string): void {
  state.wordCount = (markdown.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_'-]+/g) || []).length
  state.charCount = markdown.length
}

// File reloads and application commands can replace the tab without input
// events. Synchronize the textarea once; its watcher schedules the preview.
watch(
  () => activeTab.value?.content,
  (content) => {
    if ((isSource.value || isSplit.value) && content != null && content !== state.sourceContent) {
      sourceHistories.delete(activeTab.value!.id)
      state.sourceContent = content
    }
  }
)

watch(() => activeTab.value?.filePath, (path) => {
  setDocPathForImages(path ?? null)
  if (isSplit.value) nextTick(refreshPreview)
}, { immediate: true })

/** Flush the outgoing document before changing instances; cached tabs retain their tree and history. */
function stashViewState(force = false): void {
  const session = currentSession
  if (!session || (!force && (isSource.value || isSplit.value))) return
  session.instance.flush()
  session.cursor = captureNativeCursor() ?? session.cursor
  const scroller = editorScrollRef.value
  session.scrollTop = scroller?.scrollTop ?? 0
  session.scrollLeft = scroller?.scrollLeft ?? 0
  if (columnsActive.value && columnStride.value > 0) {
    // A quick switch can leave before the incoming restore frame has run.
    // Preserve its intended page instead of replacing it with the old viewport.
    session.columnStart = columnRestorePending?.session === session
      ? columnRestorePending.start
      : Math.round(session.scrollLeft / columnStride.value)
  }
}

function applyViewState(tab: Tab): void {
  const session = currentSession
  if (!muya || session?.id !== tab.id) return
  if (session.cursor && !isReading.value) {
    try { muya.setCursor(session.cursor) } catch { session.cursor = null }
  }
  const scroller = editorScrollRef.value
  if (scroller) {
    scroller.scrollTop = session.scrollTop
    // The outgoing tab's snap targets must not clamp the incoming position.
    // Restore the logical page only after its own extent and targets render.
    if (columnsActive.value) columnRestorePending = { session, start: session.columnStart }
    else scroller.scrollLeft = session.scrollLeft
  }
  columnRevealPending = false
  scheduleColumnLayout()
  session.reading?.activate()
}

function refreshOutline(): void {
  if (!muya) return
  // muya 的 getTOC 返回 { content, contentHtml, lvl, slug, githubSlug }，
  // 这里统一映射成界面使用的字段名
  state.outline = muya.getTOC().map((item) => ({
    level: item.lvl,
    text: item.content,
    html: item.contentHtml,
    slug: item.slug,
    githubSlug: item.githubSlug
  }))
  currentSession?.reading?.invalidate()
}

/** 输入触发的字数/大纲更新：防抖合并，避免每次击键都全量重算。 */
function scheduleCountsAndOutline(markdown: string): void {
  pendingCountsMarkdown = markdown
  if (countsTimer != null) window.clearTimeout(countsTimer)
  countsTimer = window.setTimeout(() => {
    countsTimer = null
    updateCounts(pendingCountsMarkdown)
    // 分栏/源码模式下大纲不随输入更新（与原先的调用条件保持一致）
    if (!isSource.value && !isSplit.value) refreshOutline()
  }, 200)
}

/**
 * 立即执行待处理的字数/大纲更新。
 * 切标签、关闭标签、卸载等场景必须调用：否则界面会停留在上一份文档的
 * 字数与大纲上（防抖还没到期）。
 */
function flushCountsAndOutline(): void {
  if (countsTimer == null) return
  window.clearTimeout(countsTimer)
  countsTimer = null
  updateCounts(pendingCountsMarkdown)
  if (!isSource.value && !isSplit.value) refreshOutline()
}

/** 定位编辑器滚动容器。
 *  注意：muya 在 init() 时会替换掉传入的容器元素，因此不能依赖 containerRef，
 *  改为优先用 muya 自己的 domNode 向上查找，再退回文档查询。 */
function getScroller(): HTMLElement | null {
  const fromMuya = muya?.domNode?.closest?.('.editor-scroll') as HTMLElement | null
  if (fromMuya) return fromMuya
  if (editorScrollRef.value) return editorScrollRef.value
  return document.querySelector('.editor-scroll')
}

/** 打字机模式：让光标所在块保持在视口垂直中心附近。 */
function keepCursorCentered(): void {
  const scroller = getScroller()
  if (!scroller) {
    typewriterDiag.reason = 'no scroller'
    return
  }
  const sel = document.getSelection()
  if (!sel || !sel.rangeCount) {
    typewriterDiag.reason = 'no selection range'
    return
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (!rect.height && !rect.top) {
    typewriterDiag.reason = 'empty rect'
    return
  }
  const scrollerRect = scroller.getBoundingClientRect()
  const target = scroller.scrollTop + (rect.top - scrollerRect.top) - scrollerRect.height / 2
  typewriterDiag.reason = 'ok'
  typewriterDiag.lastRectTop = rect.top
  typewriterDiag.lastTarget = target
  typewriterDiag.lastScrollHeight = scroller.scrollHeight
  typewriterDiag.lastClientHeight = scroller.clientHeight
  scroller.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
}

/** 打字机模式的诊断信息（供端到端自检读取，定位为何未滚动）。 */
const typewriterDiag: Record<string, unknown> = { reason: 'not-called' }
;(window as unknown as Record<string, unknown>).__inkdownTypewriterDiag = typewriterDiag

function createEditorSession(tab: Tab | undefined): EditorSession | null {
  const mount = editorScrollRef.value
  if (!mount) return null
  registerMuyaPlugins()
  setDocPathForImages(tab?.filePath ?? null)
  const el = document.createElement('div')
  el.className = 'muya-container'
  mount.appendChild(el)
  let diagrams: DeferredDiagrams
  const instance = new Muya(el, {
    ...buildMuyaOptions({ markdown: readingRenderMarkdown(tab?.content ?? '') }),
    scheduleDiagramRender: (target, render) => diagrams.schedule(target, render)
  })
  diagrams = new DeferredDiagrams(instance.domNode)
  const session: EditorSession = { id: tab?.id ?? '', instance, diagrams, reading: null, content: tab?.content ?? '', markdown: '', cursor: null, scrollTop: 0, scrollLeft: 0, columnStart: 0, suspended: false }
  instance.init({ focus: false })
  sessionEvents(session, false)
  instance.hideAllFloatTools()
  const history = tab ? (tab.readingHistory ??= []) : []
  session.reading = new ReadingDocument(instance.domNode, mount, {
    active: () => currentSession === session && isReading.value,
    headings: () => instance.getTOC().map(item => ({ slug: item.slug, githubSlug: item.githubSlug })),
    pages: () => columnsActive.value && columnStride.value > 0 ? { step: columnStride.value, last: columnsLastStart.value } : null,
    history,
    changed: (heading, canBack) => { if (currentSession === session && isReading.value) { state.readingHeadingIndex = heading; state.readingCanGoBack = canBack } },
    shortcut: dispatchReadingShortcut,
    external: href => { void openReadingLink(session, href) },
    restore: position => restoreReadingPosition(session, position)
  })
  session.markdown = instance.getMarkdown()
  sessionSettings.set(instance, settingsGeneration)
  instance.on('json-change', () => {
    if (suppress) return
    const owner = state.tabs.find(tab => tab.id === session.id)
    if (!owner) return
    const markdown = instance.getMarkdown()
    if (markdown === session.markdown) return
    // A late paste/upload belongs to its original tab. Source edits that have
    // superseded that tree remain authoritative rather than being overwritten.
    if (owner.content !== session.content) return
    session.markdown = markdown
    session.content = markdown
    owner.content = markdown
    if (currentSession === session && !isSource.value && !isSplit.value) {
      // 击键是高频路径：字数与大纲防抖合并，长文档下不再每次全量重算
      scheduleCountsAndOutline(markdown)
      scheduleColumnLayout()
    }
  })
  instance.on('selection-change', () => {
    if (currentSession !== session || suppress || isReading.value || isSource.value || isSplit.value) return
    session.cursor = captureNativeCursor() ?? session.cursor
    if (cursorTimer != null) window.clearTimeout(cursorTimer)
    // Source-coordinate serialization is useful for the status bar, not on every mousemove.
    cursorTimer = window.setTimeout(() => {
      cursorTimer = null
      if (currentSession !== session || isSource.value || isSplit.value) return
      const owner = state.tabs.find(tab => tab.id === session.id)
      const cursor = instance.getCursorOffset()
      if (owner && cursor) owner.cursor = cursor
    }, 100)
    if (state.typewriterMode && !columnsActive.value) keepCursorCentered()
    if (columnsActive.value) { columnRevealPending = true; queueColumnFrame() }
  })
  instance.on('search-refreshed', () => { if (currentSession === session) restoreSearchIfNeeded() })
  if (session.id) editorSessions.set(session.id, session)
  return session
}

function mountEditor(): void {
  currentSession = createEditorSession(activeTab.value)
  muya = currentSession?.instance ?? null
  currentSession?.reading?.activate()
  ;(window as unknown as Record<string, unknown>).__inkdownMuya = muya
  updateCounts(activeTab.value?.content ?? '')
  refreshOutline()
  observeColumnContent()
  ;(window as unknown as Record<string, unknown>).__inkdownLoad = (markdown: string) => {
    const tab = activeTab.value
    if (!tab || !muya || !currentSession) return false
    if (!isSource.value && !isSplit.value) {
      suppress = true
      muya.setContent(readingRenderMarkdown(markdown), false)
      suppress = false
      currentSession.content = markdown
      currentSession.markdown = muya.getMarkdown()
      currentSession.cursor = null
      // setContent 会重建整棵内容树，新建的节点不带只读属性；
      // 若当前处于阅读态，必须重新锁定，否则会变成可编辑。
      if (isReading.value) currentSession.reading?.syncReadOnly(true)
    }
    tab.content = markdown
    updateCounts(markdown)
    if (!isSource.value && !isSplit.value) refreshOutline()
    scheduleColumnLayout()
    return true
  }
}

function activateEditor(tab: Tab): void {
  if (!editorScrollRef.value) return
  if (cursorTimer != null) window.clearTimeout(cursorTimer)
  cursorTimer = null
  if (currentSession?.id === '' && !editorSessions.size) {
    currentSession.id = tab.id
    editorSessions.set(tab.id, currentSession)
  }
  let next = editorSessions.get(tab.id)
  if (next !== currentSession) {
    // 切走之前把待处理的字数/大纲刷新落定。
    // 否则防抖回调会在切换之后触发，用上一份文档的数据覆盖新标签的统计。
    flushCountsAndOutline()
    if (currentSession) {
      currentSession.instance.hideAllFloatTools()
      sessionEvents(currentSession, false)
      currentSession.instance.domNode.remove()
    }
    next ??= createEditorSession(tab) ?? undefined
    if (!next) return
    editorScrollRef.value.appendChild(next.instance.domNode)
    sessionEvents(next, true)
    currentSession = next
    muya = next.instance
    ;(window as unknown as Record<string, unknown>).__inkdownMuya = muya
  }
  if (!next) return
  if (!next.instance.domNode.isConnected) editorScrollRef.value.appendChild(next.instance.domNode)
  sessionEvents(next, true)
  next.instance.setFocusMode(false)
  state.readingHeadingIndex = -1
  state.readingCanGoBack = !!tab.readingHistory?.length
  next.reading?.activate()
  observeColumnContent()
  // Map order is an LRU; keep a bounded number of live trees.
  editorSessions.delete(tab.id)
  editorSessions.set(tab.id, next)
  while (editorSessions.size > 3) {
    const [id, expired] = editorSessions.entries().next().value!
    destroySession(expired)
    editorSessions.delete(id)
  }
  if (sessionSettings.get(next.instance) !== settingsGeneration) {
    suppress = true
    next.instance.setOptions(buildMuyaOptions(), true)
    suppress = false
    next.markdown = next.instance.getMarkdown()
    sessionSettings.set(next.instance, settingsGeneration)
  }
}

/** 把某个标签的内容载入编辑器。 */
function loadTab(tab: Tab): void {
  setDocPathForImages(tab.filePath)
  // 源码预览与源码模式都用 textarea 承载内容，不走 muya。
  if (isSource.value || isSplit.value) {
    if (state.sourceContent !== tab.content) state.sourceContent = tab.content
    if (isSplit.value) queuePreviewRefresh()
    return
  }
  activateEditor(tab)
  if (!muya || !currentSession) return
  if (currentSession.content !== tab.content) {
    suppress = true
    muya.setContent(readingRenderMarkdown(tab.content), false)
    suppress = false
    currentSession.content = tab.content
    currentSession.markdown = muya.getMarkdown()
    currentSession.cursor = null
    // 内容树被重建，阅读态下需要重新锁定
    if (isReading.value) currentSession.reading?.syncReadOnly(true)
  }
  updateCounts(tab.content)
  refreshOutline()
  // setContent 会清掉内核的搜索状态，切回来需要重新搜索
  restoreSearchIfNeeded()
}

watch(
  () => state.activeId,
  () => {
    stashViewState()
    const tab = activeTab.value
    if (!tab) {
      if (currentSession) {
        destroySession(currentSession)
        editorSessions.delete(currentSession.id)
        currentSession = null
        muya = null
        ;(window as unknown as Record<string, unknown>).__inkdownMuya = null
      }
      return
    }
    if (isSource.value || isSplit.value) {
      state.sourceContent = tab.content
      sourceHistory()
      if (isSplit.value) queuePreviewRefresh()
    } else {
      loadTab(tab)
      nextTick(() => applyViewState(tab))
    }
  },
  { flush: 'sync' }
)

watch(
  () => state.viewMode,
  (mode, prev) => {
    cancelPreviewRefresh()
    if (mode !== 'split') previewDiagrams.dispose()
    muya?.hideAllFloatTools()
    const tab = activeTab.value
    if (!tab) return

    // 离开「有源码编辑」的模式（source / split）时，把 textarea 里的改动同步回标签。
    // 这两种模式共用同一个 textarea，所以进入时都要把内容灌进去。
    const hadSource = prev === 'source' || prev === 'split'
    if (hadSource && state.sourceContent !== tab.content) {
      tab.content = state.sourceContent
      updateCounts(tab.content)
    }

    if (mode === 'source' || mode === 'split') {
      if (prev === 'wysiwyg') stashViewState(true)
      if (currentSession) sessionEvents(currentSession, false)
      state.sourceContent = tab.content
      const history = sourceHistory()
      if (history && history.current.text !== tab.content) sourceHistories.delete(tab.id)
      sourceHistory()
      nextTick(() => {
        if (mode === 'split') {
          refreshPreview()
          updateSourceLine()
        }
        sourceRef.value?.focus()
        resizeSourceEditor()
      })
      return
    }

    // 回到所见即所得：让 muya 渲染最新内容
    nextTick(() => {
      loadTab(tab)
      currentSession?.reading?.activate()
      focus()
    })
  }
)

      // 源码预览模式下编辑内容实时同步到标签，并刷新预览。
watch(
  () => state.sourceContent,
  (val) => {
    if (!isSource.value && !isSplit.value) return
    const tab = activeTab.value
    if (!tab) return
    sourceHistory()?.record({ ...sourceSnapshot(), text: val })
    tab.content = val
    updateCounts(val)
    updateSourceLine()
    nextTick(resizeSourceEditor)
    if (isSplit.value) schedulePreviewRefresh()
    if (state.findVisible && state.findKeyword) nextTick(restoreSearchIfNeeded)
  }
)

watch(() => state.tabs.map((tab) => tab.id), (ids) => {
  for (const id of sourceHistories.keys()) if (!ids.includes(id)) sourceHistories.delete(id)
  for (const [id, session] of editorSessions) {
    if (!ids.includes(id) && session !== currentSession) { destroySession(session); editorSessions.delete(id) }
  }
})

// 专注模式：给编辑器根节点加类，由 CSS 淡化非当前段落
watch(
  () => [state.focusMode, state.typewriterMode],
  () => {
    document.body.classList.toggle('focus-mode', state.focusMode)
    document.body.classList.toggle('typewriter-mode', state.typewriterMode)
    if (muya) muya.setFocusMode(false)
  }
)

function focus(): void {
  if (isSource.value || isSplit.value) sourceRef.value?.focus()
  else muya?.domNode.focus({ preventScroll: true })
}

/**
 * 段落与格式命令的取值直接对齐内核的块类型词汇表
 * （packages/desktop/src/main/menu/actions/*），确保内核能识别。
 */
/** 正文右键菜单的状态与条目。 */
const editorMenu = reactive({
  visible: false,
  x: 0,
  y: 0
})

/**
 * 正文右键菜单条目。
 *
 * 全部复用已有命令，不再单独实现逻辑 —— 菜单只是给这些命令
 * 增加一个更顺手的入口（和 Typora 一致的操作习惯）。
 */
const editorMenuItems = computed<Array<{ label: string; command: string } | { separator: true }>>(
  () => isReading.value ? [
    { label: t('reading.copy'), command: 'edit:copy' },
    { label: t('reading.selectAll'), command: 'edit:selectAll' },
    { label: t('reading.back'), command: 'reading:back' }
  ] : [
    { label: t('ctx.copyMarkdown'), command: 'edit:copyMarkdown' },
    { label: t('ctx.copyHtml'), command: 'edit:copyHtml' },
    { label: t('ctx.pastePlain'), command: 'edit:pastePlain' },
    { separator: true },
    { label: t('ctx.insertImage'), command: 'format:image' },
    { label: t('ctx.insertTable'), command: 'paragraph:table' },
    { label: t('ctx.insertMath'), command: 'paragraph:math' },
    { label: t('ctx.insertCode'), command: 'paragraph:code' },
    { separator: true },
    { label: t('ctx.duplicate'), command: 'edit:duplicate' },
    { label: t('ctx.deleteParagraph'), command: 'edit:deleteParagraph' },
    { separator: true },
    { label: t('ctx.find'), command: 'edit:find' }
  ]
)

/** 打开正文右键菜单。 */
function onEditorContextMenu(e: MouseEvent): void {
  // 源码/分栏模式用浏览器原生菜单即可（textarea 的复制粘贴足够）
  if (isSource.value || isSplit.value) return
  // 只处理编辑器区域内的右键
  const host = hostRef.value
  if (!host) return
  const target = e.target
  // e.target 在 window 级监听里可能是 window / document，不是 Node，
  // 直接传给 contains 会抛 TypeError。这里先做类型判断。
  if (!(target instanceof Node) || !host.contains(target)) return
  // 表格拖拽条等浮层自己处理右键
  if ((target as HTMLElement).closest?.('.mu-float-container')) return

  e.preventDefault()
  // 阻止冒泡：否则本次事件会继续传到 window，
  // 立刻触发下面注册的 close，菜单刚显示就被关掉。
  e.stopPropagation()
  editorMenu.visible = true
  editorMenu.x = e.clientX
  editorMenu.y = e.clientY

  const close = (): void => {
    editorMenu.visible = false
    window.removeEventListener('pointerdown', close, true)
    window.removeEventListener('contextmenu', close, true)
    window.removeEventListener('keydown', onEsc)
  }
  const onEsc = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close()
  }
  // 用 setTimeout 而不是 nextTick：要等当前事件完全走完再挂监听，
  // 否则仍可能被同一个事件立刻关掉。
  setTimeout(() => {
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('contextmenu', close, true)
    window.addEventListener('keydown', onEsc)
  }, 0)
}

/** 执行右键菜单里的命令。 */
function runEditorMenuCommand(command: string): void {
  editorMenu.visible = false
  void executeCommand(command)
}

/* ------------------------------ 悬浮球：Markdown 片段 ------------------------------ */

interface Snippet {
  text: string
  /** 插入后要选中的相对区间，便于直接替换占位文字。 */
  selectFrom?: number
  selectTo?: number
  /** 块级片段自动补空行，行内片段不补。 */
  block?: boolean
}

function tableMarkdown(rows: number, columns: number): string {
  const cols = Math.max(1, columns)
  const head = `| ${Array.from({ length: cols }, (_, i) => `列 ${i + 1}`).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const body = Array.from(
    { length: Math.max(1, rows - 2) },
    () => `| ${Array.from({ length: cols }, () => '').join(' | ')} |`
  )
  return [head, sep, ...body].join('\n')
}

function todayText(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function dateText(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function weekdayText(): string {
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: 'long' }).format(new Date())
  } catch {
    return ''
  }
}

interface HeadingEntry {
  level: number
  text: string
  slug: string
}

/** 生成与导出 HTML 一致的 GitHub 标题锚点，避免同名标题撞号。 */
function headingSlug(text: string, seen: Set<string>): string {
  const base = generateGithubSlug(text) || 'heading'
  let slug = base
  let n = 1
  while (seen.has(slug)) slug = `${base}-${n++}`
  seen.add(slug)
  return slug
}

/**
 * 从渲染结果提取目录标题。
 *
 * 直接复用分栏预览的渲染器，复杂标题里的链接、HTML、公式和 emoji
 * 会先变成最终文本，再生成锚点，保证目录链接与预览 id 完全一致。
 */
function headingsFromMarkdown(markdown: string): HeadingEntry[] {
  const container = document.createElement('div')
  container.innerHTML = renderPreviewHtml(markdown)
  injectPreviewHeadingIds(container)
  return [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
    .map((heading) => {
      const text = (heading.textContent ?? '').trim()
      return {
        level: Number(heading.tagName.slice(1)),
        text,
        slug: heading.id
      }
    })
    .filter((heading) => heading.text && heading.slug)
}

function tableOfContentsMarkdown(): string {
  const tab = activeTab.value
  if (!tab) return ''
  const markdown = isSource.value || isSplit.value ? state.sourceContent : tab.content
  const headings = headingsFromMarkdown(markdown)
  if (!headings.length) return `- ${t('orb.tocEmpty')}`

  return headings
    .map(({ level, text, slug }) => `${'  '.repeat(level - 1)}- [${text}](#${slug})`)
    .join('\n')
}

/** 给静态分栏预览的标题补上与目录一致的 id，让目录链接可以跳转。 */
function injectPreviewHeadingIds(container: ParentNode): void {
  const headings = [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
  const seen = new Set<string>()
  for (const heading of headings) {
    if (heading.id) seen.add(heading.id)
  }
  for (const heading of headings) {
    if (heading.id) continue
    heading.id = headingSlug(heading.textContent ?? '', seen)
  }
}

/** 媒体片段：选中 src 中的路径，而不是固定写死的偏移量。 */
function mediaSnippet(tag: 'video' | 'audio', path: string): Snippet {
  const text = `<${tag} controls src="${path}"></${tag}>`
  const selectFrom = text.indexOf(path)
  return { text, selectFrom, selectTo: selectFrom + path.length, block: true }
}

function snippetFor(id: string): Snippet | null {
  if (id === 'toc') return { text: tableOfContentsMarkdown(), block: true }
  const tableMatch = id.match(/^table-(\d+)x(\d+)$/)
  if (tableMatch) {
    return { text: tableMarkdown(Number(tableMatch[1]), Number(tableMatch[2])), block: true }
  }

  // 行内标记按 UTF-16 下标选中占位文字；块片段把光标放到内容行。
  const map: Record<string, Snippet> = {
    strong: { text: '**加粗文字**', selectFrom: 2, selectTo: 6 },
    emphasis: { text: '*斜体文字*', selectFrom: 1, selectTo: 5 },
    strike: { text: '~~删除文字~~', selectFrom: 2, selectTo: 6 },
    inlineCode: { text: '`代码`', selectFrom: 1, selectTo: 3 },
    highlight: { text: '==高亮文字==', selectFrom: 2, selectTo: 6 },
    inlineMath: { text: '$公式$', selectFrom: 1, selectTo: 3 },
    superscript: { text: '<sup>上标</sup>', selectFrom: 5, selectTo: 7 },
    subscript: { text: '<sub>下标</sub>', selectFrom: 5, selectTo: 7 },
    link: { text: '[链接文字](https://)', selectFrom: 1, selectTo: 5 },
    refLink: { text: '[链接文字][ref]\n\n[ref]: https://', selectFrom: 1, selectTo: 5, block: true },
    inlineDiffAdd: { text: '{+新增内容+}', selectFrom: 2, selectTo: 6 },
    inlineDiffDel: { text: '{-删除内容-}', selectFrom: 2, selectTo: 6 },
    underline: { text: '<u>下划线</u>', selectFrom: 3, selectTo: 6 },
    kbd: { text: '<kbd>Ctrl</kbd>', selectFrom: 5, selectTo: 9 },
    code: { text: '```\n\n```', selectFrom: 4, selectTo: 4, block: true },
    codeJs: { text: '```js\n\n```', selectFrom: 6, selectTo: 6, block: true },
    codePy: { text: '```python\n\n```', selectFrom: 10, selectTo: 10, block: true },
    mermaid: {
      text: '```mermaid\ngraph LR\n  A[开始] --> B[结束]\n```',
      selectFrom: 22,
      selectTo: 22,
      block: true
    },
    plantuml: {
      text: '```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```',
      selectFrom: 22,
      selectTo: 22,
      block: true
    },
    math: { text: '$$\n\n$$', selectFrom: 3, selectTo: 3, block: true },
    quote: { text: '> 引用内容', block: true },
    nestedList: { text: '- 一级项目\n  - 二级项目\n    - 三级项目', block: true },
    callout: {
      text: '> [!NOTE]\n> 在这里写提示内容。',
      selectFrom: 12,
      selectTo: 21,
      block: true
    },
    details: {
      text: '<details>\n<summary>点击展开</summary>\n\n折叠内容\n\n</details>',
      selectFrom: 35,
      selectTo: 39,
      block: true
    },
    footnote: {
      text: '正文[^1]\n\n[^1]: 脚注内容',
      selectFrom: 14,
      selectTo: 18,
      block: true
    },
    hr: { text: '---', block: true },
    htmlBlock: { text: '<div>\n\n</div>', selectFrom: 5, selectTo: 5, block: true },
    video: mediaSnippet('video', 'media/video.mp4'),
    audio: mediaSnippet('audio', 'media/audio.mp3'),
    frontmatter: {
      text: '---\ntitle: 文档标题\ntags: []\n---\n\n',
      block: false
    },
    datetime: { text: todayText(), block: false },
    date: { text: dateText(), block: false },
    weekday: { text: weekdayText(), block: false }
  }
  return map[id] ?? null
}

/** 在源码 textarea 的光标处插入片段，并选中占位文字。 */
function insertSourceSnippet(snippet: Snippet): void {
  const ta = sourceRef.value
  if (!ta) return

  const start = ta.selectionStart
  const end = ta.selectionEnd
  const before = ta.value.slice(0, start)
  const after = ta.value.slice(end)
  const prefix = snippet.block
    ? before === '' || before.endsWith('\n\n')
      ? ''
      : before.endsWith('\n')
        ? '\n'
        : '\n\n'
    : ''
  const suffix = snippet.block
    ? after === '' || after.startsWith('\n\n')
      ? ''
      : after.startsWith('\n')
        ? '\n'
        : '\n\n'
    : ''
  const text = `${prefix}${snippet.text}${suffix}`
  const selectionBase = start + prefix.length
  applySourceEdit({ text: before + text + after,
    start: selectionBase + (snippet.selectFrom ?? snippet.text.length),
    end: selectionBase + (snippet.selectTo ?? snippet.text.length) })

  // 插入点若在文档末尾，主动滚到选区，避免新增内容在视口下方。
  if (start === before.length && after === '') {
    nextTick(() => {
      const scroller = ta.closest('.source-scroll') as HTMLElement | null
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    })
  }

}

/** 在当前行首插入标记（标题、列表）。 */
function insertSourceLinePrefix(prefix: string): void {
  const ta = sourceRef.value
  if (!ta) return
  const start = ta.selectionStart
  const lineStart = start === 0 ? 0 : ta.value.lastIndexOf('\n', start - 1) + 1
  const cursor = start + prefix.length
  applySourceEdit({ text: ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart), start: cursor, end: cursor })
}

/** 所见即所得模式：把片段粘贴到当前光标处。 */
async function insertSnippetInEditor(snippet: Snippet): Promise<void> {
  if (!muya) return
  if (!snippet.block) {
    await window.inkdown.writeClipboardText(snippet.text)
    focus()
    await muya.pasteAsPlainText()
    return
  }

  // 块级结构先建空段落再粘贴，避免把整段 Markdown 混进当前段落。
  muya.insertParagraph('after')
  muya.focus()
  await window.inkdown.writeClipboardText(snippet.text)
  await muya.pasteAsPlainText()
}

/** 选择图片后复制到文档 assets 并插入相对路径。 */
async function insertImageSnippet(): Promise<void> {
  const tab = activeTab.value
  if (!tab) return
  const src = await window.inkdown.openImageDialog()
  if (!src || activeTab.value?.id !== tab.id) return
  const docPath = tab.filePath
  const finalSrc = await window.inkdown.copyImage(docPath, src)
  if (activeTab.value?.id !== tab.id) return

  if (isSource.value || isSplit.value) {
    const alt = baseName(src).replace(/\.[^.]+$/, '').replace(/[\[\]\\]/g, '\\$&')
    const destination = finalSrc.replace(/\\/g, '/').replace(/[<>]/g, (char: string) => encodeURIComponent(char))
    insertSourceSnippet({ text: `![${alt}](<${destination}>)`, selectFrom: 2, selectTo: 2 + alt.length })
    return
  }
  muya?.insertImage({ src: finalSrc, alt: baseName(src) })
}

/**
 * 悬浮球插入：源码/分栏直接写 Markdown，所见即所得继续走内核命令。
 * 这样分栏里插入的表格、代码块和提示块会出现在右侧源码，而不是隐藏的编辑器。
 */
async function onOrbInsert(id: string): Promise<void> {
  if (id === 'image') {
    await insertImageSnippet()
    return
  }

  if (isSource.value || isSplit.value) {
    if (id === 'frontmatter') {
      const ta = sourceRef.value
      if (!ta) return
      if (/^---\n/.test(ta.value)) {
        state.notice = { text: t('orb.frontmatterExists') }
        return
      }
      const text = `---\ntitle: 文档标题\ntags: []\n---\n\n${ta.value}`
      const start = text.indexOf('文档标题')
      applySourceEdit({ text, start, end: start + 4 })
      return
    }

    const heading = id.match(/^h([1-6])$/)
    if (heading) {
      insertSourceLinePrefix(`${'#'.repeat(Number(heading[1]))} `)
      return
    }
    if (id === 'ul') return insertSourceLinePrefix('- ')
    if (id === 'ol') return insertSourceLinePrefix('1. ')
    if (id === 'task') return insertSourceLinePrefix('- [ ] ')

    const snippet = snippetFor(id)
    if (snippet) insertSourceSnippet(snippet)
    return
  }

  // 所见即所得：段落/格式命令优先，内核能正确处理块类型与撤销栈。
  const commandMap: Record<string, string> = {
    h1: 'paragraph:h1',
    h2: 'paragraph:h2',
    h3: 'paragraph:h3',
    h4: 'paragraph:h4',
    h5: 'paragraph:h5',
    h6: 'paragraph:h6',
    ul: 'paragraph:ul',
    ol: 'paragraph:ol',
    task: 'paragraph:task',
    quote: 'paragraph:quote',
    math: 'paragraph:math',
    hr: 'paragraph:hr',
    strong: 'format:strong',
    emphasis: 'format:emphasis',
    strike: 'format:strike',
    inlineCode: 'format:inlineCode',
    highlight: 'format:highlight',
    inlineMath: 'format:inlineMath',
    superscript: 'format:superscript',
    subscript: 'format:subscript',
    underline: 'format:underline',
    link: 'format:link'
  }
  const command = commandMap[id]
  if (command) {
    // 点击悬浮球会把焦点移到按钮上，执行段落命令前要把内核焦点还回去。
    muya?.focus()
    await executeCommand(command)
    return
  }

  const tableMatch = id.match(/^table-(\d+)x(\d+)$/)
  if (tableMatch) {
    muya?.focus()
    muya?.createTable({ rows: Number(tableMatch[1]), columns: Number(tableMatch[2]) })
    return
  }

  const snippet = snippetFor(id)
  if (snippet) await insertSnippetInEditor(snippet)
}

async function runSourceCommand(id: string): Promise<void> {
  const ta = sourceRef.value
  if (!ta || !activeTab.value) return
  const snapshot = sourceSnapshot()
  const history = sourceHistory()
  history?.record(snapshot)
  if (id === 'edit:undo' || id === 'edit:redo') {
    const result = id === 'edit:undo' ? history?.undo() : history?.redo()
    if (result) {
      // Do not record undo itself as a new edit, which would discard redo.
      ta.value = result.text
      state.sourceContent = result.text
      nextTick(() => { ta.focus(); ta.setSelectionRange(result.start, result.end); onSourceCaretMove() })
    }
    return
  }
  if (id === 'edit:copyMarkdown' || id === 'edit:copyHtml') {
    const text = snapshot.text.slice(snapshot.start, snapshot.end) || snapshot.text
    await window.inkdown.writeClipboardText(id === 'edit:copyHtml' ? renderPreviewHtml(text) : text)
    return
  }
  if (id === 'edit:pastePlain') {
    const tabId = activeTab.value.id
    const text = await window.inkdown.readClipboardText()
    if (activeTab.value?.id === tabId && (isSource.value || isSplit.value)) applySourceEdit(replaceRange(snapshot, text))
    return
  }
  if (id === 'format:image') return insertImageSnippet()
  const edited = editSource(snapshot, id)
  if (edited) { applySourceEdit(edited); return }
  const blocks: Record<string, string> = {
    'paragraph:code': 'code', 'paragraph:math': 'math', 'paragraph:table': 'table-3x3',
    'paragraph:hr': 'hr', 'paragraph:frontMatter': 'frontmatter'
  }
  if (blocks[id]) await onOrbInsert(blocks[id])
}

function registerEditorCommands(): void {
  const paragraphMap: Record<string, string> = {
    'paragraph:h1': 'heading 1',
    'paragraph:h2': 'heading 2',
    'paragraph:h3': 'heading 3',
    'paragraph:h4': 'heading 4',
    'paragraph:h5': 'heading 5',
    'paragraph:h6': 'heading 6',
    'paragraph:p': 'paragraph',
    'paragraph:ul': 'ul-bullet',
    'paragraph:ol': 'ol-order',
    'paragraph:task': 'ul-task',
    'paragraph:quote': 'blockquote',
    'paragraph:code': 'pre',
    'paragraph:math': 'mathblock',
    'paragraph:table': 'table',
    'paragraph:hr': 'hr',
    'paragraph:frontMatter': 'front-matter'
  }
  const formatMap: Record<string, string> = {
    'format:strong': 'strong',
    'format:emphasis': 'em',
    'format:underline': 'u',
    'format:strike': 'del',
    'format:inlineCode': 'inline_code',
    'format:highlight': 'mark',
    'format:inlineMath': 'inline_math',
    'format:superscript': 'sup',
    'format:subscript': 'sub',
    'format:link': 'link',
    'format:image': 'image',
    'format:clear': 'clear'
  }

  const commands: Record<string, () => void | Promise<void>> = {
    'reading:back': () => { currentSession?.reading?.back() },
    'edit:copy': () => { const text = currentSession?.reading?.selectedText() ?? ''; if (text) void window.inkdown.writeClipboardText(text) },
    'edit:selectAll': () => { currentSession?.reading?.selectAll() },
    'edit:undo': () => muya?.undo(),
    'edit:redo': () => muya?.redo(),
    'edit:copyMarkdown': () => isReading.value ? window.inkdown.writeClipboardText(currentSession?.reading?.copyMarkdown(activeTab.value?.content ?? '') ?? '') : muya?.copyAsMarkdown(),
    'edit:copyHtml': () => isReading.value ? window.inkdown.writeClipboardText(currentSession?.reading?.copyHtml(() => renderPreviewHtml(activeTab.value?.content ?? '')) ?? '') : muya?.copyAsHtml(),
    'edit:pastePlain': () => void muya?.pasteAsPlainText(),
    'view:focusEditor': () => focus(),
    'file:exportHtml': () => void exportHtml(),
    'file:exportPdf': () => void exportPdf(),
    'file:exportDocx': () => void exportDocxFile(),
    // 打印：走系统打印对话框；用户取消不提示
    'file:print': () => {
      void printDocument()
    },
    // 段落操作
    'edit:duplicate': () => muya?.duplicate(),
    'edit:insertParagraph': () => muya?.insertParagraph('after'),
    'edit:deleteParagraph': () => muya?.deleteParagraph()
  }

  for (const [id, type] of Object.entries(paragraphMap)) {
    commands[id] = () => muya?.updateParagraph(type)
  }
  for (const [id, type] of Object.entries(formatMap)) {
    // image 走本地文件选择流程，其余交给内核
    if (id === 'format:image') {
      commands[id] = () => void insertImage()
      continue
    }
    commands[id] = () => muya?.format(type)
  }
  for (const [id, handler] of Object.entries(commands)) {
    if (/^(edit|paragraph|format):/.test(id) && !['edit:copy','edit:selectAll'].includes(id)) {
      commands[id] = () => (isSource.value || isSplit.value) ? runSourceCommand(id) : handler()
    }
  }
  registerCommands(commands)
}

async function insertImage(): Promise<void> {
  await insertImageSnippet()
}

function onSourceKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  // 源码模式支持 Tab 缩进，避免焦点跳走
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = e.target as HTMLTextAreaElement
    const start = el.selectionStart
    const end = el.selectionEnd
    const value = el.value
    const indent = ' '.repeat(settings.tabSize)
    applySourceEdit(replaceRange({ text: value, start, end }, indent))
  }
}

/** 查找/替换：FindBar 通过自定义事件把参数送进来，这里调用 muya 的搜索 API。 */
let sourceFind: { tabId: string; keyword: string; options: string; text: string; matches: RegExpExecArray[]; index: number } | null = null

function findInSource(d: { action: string; targetIndex?: number; keyword: string; replacement: string; isRegexp: boolean; isCaseSensitive: boolean; isWholeWord: boolean }): void {
  const tab = activeTab.value
  const ta = sourceRef.value
  if (!tab || !ta) return
  const options = JSON.stringify([d.isRegexp, d.isCaseSensitive, d.isWholeWord])
  const text = state.sourceContent
  if (!sourceFind || sourceFind.tabId !== tab.id || sourceFind.keyword !== d.keyword || sourceFind.options !== options || sourceFind.text !== text) {
    sourceFind = { tabId: tab.id, keyword: d.keyword, options, text, matches: textMatches(text, d.keyword, d), index: 0 }
  }
  const count = sourceFind.matches.length
  if (count && (d.action === 'next' || d.action === 'previous')) {
    sourceFind.index = (sourceFind.index + (d.action === 'next' ? 1 : -1) + count) % count
  }
  // 从结果列表直接跳到第 n 个命中
  if (count && d.action === 'goto' && typeof d.targetIndex === 'number') {
    sourceFind.index = Math.max(0, Math.min(count - 1, d.targetIndex))
  }
  if (count && (d.action === 'replace' || d.action === 'replaceAll')) {
    const result = replaceTextMatch(text, d.keyword, d.replacement, d, d.action === 'replace' ? sourceFind.index : undefined)
    const start = sourceFind.matches[sourceFind.index].index!
    applySourceEdit({ text: result, start: Math.min(start, result.length), end: Math.min(start, result.length) })
    sourceFind.text = result
    sourceFind.matches = textMatches(result, d.keyword, d)
    sourceFind.index = Math.min(sourceFind.index, Math.max(0, sourceFind.matches.length - 1))
  }
  const match = sourceFind.matches[sourceFind.index]
  if (match && d.action !== 'search') {
    nextTick(() => {
      ta.setSelectionRange(match.index!, match.index! + match[0].length)
      scrollSourceToOffset(match.index!)
      restoreFindFocus()
    })
  }
  window.dispatchEvent(new CustomEvent('inkdown:find-result', {
    detail: { count: sourceFind.matches.length, index: sourceFind.matches.length ? sourceFind.index + 1 : 0 }
  }))
}

function scrollSourceToOffset(offset: number): void {
  const ta = sourceRef.value
  const scroller = ta?.closest('.source-scroll') as HTMLElement | null
  if (!ta || !scroller) return
  const style = getComputedStyle(ta)
  const mirror = document.createElement('div')
  for (const name of ['width', 'box-sizing', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'padding', 'border']) {
    mirror.style.setProperty(name, style.getPropertyValue(name))
  }
  Object.assign(mirror.style, { position: 'fixed', left: '-100000px', top: '0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', visibility: 'hidden' })
  mirror.textContent = ta.value.slice(0, offset)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  marker.style.display = 'inline-block'
  marker.style.height = style.lineHeight
  marker.style.verticalAlign = 'top'
  mirror.append(marker)
  document.body.append(mirror)
  const lineHeight = parseFloat(style.lineHeight) || 24
  const caretTop = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top
  mirror.remove()
  const top = scroller.scrollTop + ta.getBoundingClientRect().top - scroller.getBoundingClientRect().top + caretTop + lineHeight / 2 - scroller.clientHeight / 2
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
}

function onFind(e: Event): void {
  if (!muya) return
  const d = (e as CustomEvent).detail as {
    action: 'search' | 'next' | 'previous' | 'replace' | 'replaceAll' | 'goto'
    targetIndex?: number
    keyword: string
    replacement: string
    isRegexp: boolean
    isCaseSensitive: boolean
    isWholeWord: boolean
  }
  if (isReading.value && (d.action === 'replace' || d.action === 'replaceAll')) { state.notice = { text: t('reading.notice') }; return }
  const opts = {
    isRegexp: d.isRegexp,
    isCaseSensitive: d.isCaseSensitive,
    isWholeWord: d.isWholeWord,
    // 关键：搜索时不要 selectHighlight。
    // 内核的 selectHighlight 会调用 block.setCursor() 把光标移进正文，
    // 焦点随之离开查找输入框 —— 表现为「打字打到一半光标跳到正文」。
    // 只有用户主动跳转（next / previous）时才移动光标。
    selectHighlight: false
  }
  // 记住关键词与选项：切标签后要按它重搜（内核会清掉搜索状态）
  state.findKeyword = d.keyword
  state.findOptions = {
    isRegexp: d.isRegexp,
    isCaseSensitive: d.isCaseSensitive,
    isWholeWord: d.isWholeWord
  }
  if (isSource.value || isSplit.value) {
    findInSource(d)
    return
  }
  switch (d.action) {
    case 'search':
      searchResult = muya.search(d.keyword, opts)
      break
    case 'next':
    case 'previous':
      // 跳转需要把光标移到匹配处，这会让焦点离开查找框；
      // 跳完立即把焦点还回去，用户才能继续输入。
      searchResult = muya.find(d.action)
      // 内核的 find() 只切换高亮、不滚动视口，需要应用层补上
      scrollToActiveMatch()
      restoreFindFocus()
      break
    case 'goto': {
      // 内核只支持 next/previous，没有「直接跳到第 n 个」。
      // 这里先重搜拿到当前序号，再朝目标方向逐步 find。
      // 命中数通常不大（几十个），逐步跳转的代价可接受且不依赖内核私有状态。
      const target = typeof d.targetIndex === 'number' ? d.targetIndex : 0
      searchResult = muya.search(d.keyword, opts)
      const total = searchResult?.matches.length ?? 0
      if (total > 0) {
        const safeTarget = Math.max(0, Math.min(total - 1, target))
        let current = searchResult?.index ?? 0
        // 计算最短方向，避免绕一整圈
        let forward = (safeTarget - current + total) % total
        if (forward > total / 2) forward -= total
        const step = forward >= 0 ? 'next' : 'previous'
        for (let i = 0; i < Math.abs(forward); i++) {
          searchResult = muya.find(step)
        }
        scrollToActiveMatch()
      }
      restoreFindFocus()
      break
    }
    case 'replace':
      searchResult = muya.replace(d.replacement, { isSingle: true, isRegexp: d.isRegexp })
      scrollToActiveMatch()
      restoreFindFocus()
      break
    case 'replaceAll':
      searchResult = muya.replace(d.replacement, { isSingle: false, isRegexp: d.isRegexp })
      restoreFindFocus()
      break
  }
  reportMatches()
}

/**
 * 把当前匹配（span.mu-highlight）滚动到视口内。
 *
 * 内核的 find() 只更新高亮样式，不会滚动 —— 表现为「计数跳到了 2/3，
 * 但视口还停在第 1 处」。这里按需滚动，且只在目标不在可视区时才动，
 * 避免每次跳转都抖动。
 */
function scrollToActiveMatch(): void {
  requestAnimationFrame(() => {
    const scroller = getScroller()
    if (!scroller) return
    const el = document.querySelector<HTMLElement>('.muya-container span.mu-highlight')
    if (!el) return
    const r = el.getBoundingClientRect()
    const sr = scroller.getBoundingClientRect()
    // 已在视口内（留一点边距）就不滚
    if (r.top >= sr.top + 8 && r.bottom <= sr.bottom - 8) return
    // 滚到视口垂直居中附近，便于看清上下文
    const target = scroller.scrollTop + (r.top - sr.top) - sr.height / 2 + r.height / 2
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  })
}

/**
 * 把焦点还给查找框。
 *
 * 内核跳转匹配时会 setCursor，焦点随之进入正文。
 * 查找框仍开着时，用户的本意是继续在框里输入/按键，因此要还回去。
 */
function restoreFindFocus(): void {
  if (!state.findVisible) return
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.find-input')
    if (input && document.activeElement !== input) {
      input.focus()
      // 光标放到末尾，便于继续输入
      const len = input.value.length
      try {
        input.setSelectionRange(len, len)
      } catch {
        /* 忽略 */
      }
    }
  })
}

/**
 * 切标签 / 内容重载后恢复搜索。
 *
 * 内核在 setContent 时会 reset 搜索状态（matches 清空），
 * 导致「切到别的文件再回来，搜索结果就没了、回车也没反应」。
 * 这里在文档重建后按记住的关键词重新搜一次。
 */
function restoreSearchIfNeeded(): void {
  if (!muya || !state.findVisible || !state.findKeyword) return
  if (isSource.value || isSplit.value) {
    findInSource({ action: 'search', keyword: state.findKeyword, replacement: '', ...state.findOptions })
    return
  }
  const { findKeyword, findOptions } = state
  requestAnimationFrame(() => {
    const m = muya
    if (!m || isSource.value || isSplit.value) return
    try {
      searchResult = m.search(findKeyword, { ...findOptions, selectHighlight: false })
      reportMatches()
    } catch {
      /* 忽略 */
    }
  })
}

/**
 * 最近一次搜索的结果对象。
 * muya 的 search/find/replace 都返回同一个 Search 实例，
 * 匹配数据在它的 matches / index 上——不是 muya.searchMatches（该属性不存在）。
 */
let searchResult: { matches: unknown[]; index: number } | null = null

/** 把匹配数量、当前序号与结果列表回传给 FindBar 显示。 */
function reportMatches(): void {
  // 内核的 IMatch 结构；这里显式标注，避免 searchResult 为空数组时被推断成 unknown[]
  type KernelMatch = { start: number; end: number; match: string; block?: unknown }
  const matches = (searchResult?.matches ?? []) as KernelMatch[]
  const index = searchResult?.index ?? -1

  // 文档全文（用于把「块内偏移」换算成「文档绝对偏移」）。
  // 阅读态下用标签内容，其余情况用编辑器实际内容。
  const docText = (isReading.value ? activeTab.value?.content : muya?.getMarkdown()) ?? ''

  /** 取匹配所在块的纯文本。 */
  const blockTextOf = (m: KernelMatch): string | undefined => {
    try {
      const block = m.block as { text?: unknown; domNode?: HTMLElement } | undefined
      if (!block) return undefined
      // 首选内核的 text（就是搜索比对用的那份文本，偏移天然自洽）
      const t = block.text
      if (typeof t === 'string' && t.length) return t
      // 退路：从 DOM 取。注意 contenteditable 下的 .textContent 会带零宽字符，
      // 这里清掉再返回，避免偏移错位。
      const dom = block.domNode?.textContent
      if (typeof dom === 'string') return dom.replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * 把块内偏移换算成文档绝对偏移。
   *
   * 做法：用块文本在文档中查找（从上一个块之后开始找），
   * 命中位置 + 块内偏移即为绝对偏移。
   * 找不到时返回 undefined，调用方会退回块内行号。
   */
  let searchFrom = 0
  const docOffsetOf = (m: KernelMatch): number | undefined => {
    const text = blockTextOf(m)
    if (!text || !docText) return undefined
    const at = docText.indexOf(text, searchFrom)
    if (at < 0) {
      // 块文本可能在文档里出现多次或与源码形式有差异，退回从头找
      const again = docText.indexOf(text)
      if (again < 0) return undefined
      return again + (m.start > 0 ? m.start : 0)
    }
    searchFrom = at + text.length
    return at + (m.start > 0 ? m.start : 0)
  }

  // 结果列表需要「行号 + 上下文」；行号按文档绝对偏移算，才是用户看到的行。
  // 注意：必须把原始 match 传进去（含 block），
  // 否则 blockTextOf / docOffsetOf 拿不到块对象，行号只能退回块内第 1 行。
  const items = buildSearchResults(
    matches as unknown as Array<{ start: number; end: number; match: string }>,
    (m) => blockTextOf(m as unknown as KernelMatch),
    (m) => docOffsetOf(m as unknown as KernelMatch),
    docText
  )
  window.dispatchEvent(
    new CustomEvent('inkdown:find-result', {
      detail: { count: matches.length, index: index >= 0 ? index + 1 : 0, items }
    })
  )
}

function onFindClose(): void {
  muya?.hideAllFloatTools()
  if (isReading.value || isSource.value || isSplit.value) return
  muya?.flush()
  const tab = activeTab.value
  if (tab) tab.content = muya?.getMarkdown() ?? tab.content
}

/** 外部文件变更后重新载入编辑器内容。 */
function reloadFromTab(): void {
  const tab = activeTab.value
  if (!tab) return
  // 源码与分栏都靠 textarea 显示内容
  if (isSource.value || isSplit.value) {
    state.sourceContent = tab.content
    if (isSplit.value) nextTick(() => refreshPreview())
    return
  }
  if (!muya) return
  suppress = true
  muya.setContent(readingRenderMarkdown(tab.content), false)
  suppress = false
  if (currentSession) { currentSession.content = tab.content; currentSession.markdown = muya.getMarkdown(); currentSession.cursor = null }
  // 内容树被重建，阅读态下需要重新锁定
  if (isReading.value) currentSession?.reading?.syncReadOnly(true)
  updateCounts(tab.content)
  refreshOutline()
  scheduleColumnLayout()
}

function onSettingsChanged(): void {
  settingsGeneration++
  if (muya && !isSource.value && !isSplit.value) {
    setDocPathForImages(activeTab.value?.filePath ?? null)
    suppress = true
    muya.setOptions(buildMuyaOptions(), true)
    sessionSettings.set(muya, settingsGeneration)
    if (currentSession) currentSession.markdown = muya.getMarkdown()
    suppress = false
    scheduleColumnLayout()
  }
  if (isSplit.value) nextTick(refreshPreview)
}

/**
 * 在光标处插入文本（用于「插入当前时间」）。
 * 内核没有公开的「插入文本」API，这里通过剪贴板粘贴路径实现：
 * 写入剪贴板 → 触发 pasteAsPlainText，光标处即出现该文本。
 */
async function onInsertText(e: Event): Promise<void> {
  if (isReading.value) { state.notice = { text: t('reading.notice') }; return }
  const text = (e as CustomEvent).detail?.text
  if (typeof text !== 'string' || !text) return
  if (isSource.value || isSplit.value) {
    insertSourceSnippet({ text })
    return
  }
  if (!muya) return
  await window.inkdown.writeClipboardText(text)
  focus()
  await muya.pasteAsPlainText()
}

/* ------------------------------ 拖入打开 ------------------------------ */

/** 拖拽状态：用于显示投放提示层。 */
const dragging = ref(false)

/** 可接受的 Markdown 扩展名。 */
const MD_RE = /\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i

function onDragOver(e: DragEvent): void {
  if (isReading.value) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; return }
  // 必须 preventDefault 才允许投放
  e.preventDefault()
  dragging.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(e: DragEvent): void {
  // 只在真正离开容器时隐藏提示层（子元素切换会连续触发）
  const related = e.relatedTarget as Node | null
  if (related && hostRef.value?.contains(related)) return
  dragging.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  dragging.value = false
  if (isReading.value) return
  const files = e.dataTransfer?.files
  if (!files || !files.length) return
  await openDroppedFiles([...files])
}

/**
 * 路径解析钩子。默认走 preload 的 getPathForFile；
 * 端到端自检可临时替换它（contextBridge 暴露的对象是只读代理，无法直接改写）。
 */
let pathForFileHook: ((file: File) => string) | null = null

/** 供自检注入：覆盖拖入时的路径解析。 */
function setPathForFileHook(fn: ((file: File) => string) | null): void {
  pathForFileHook = fn
}

/**
 * 打开拖入的文件列表。
 * 独立成函数便于端到端自检直接调用（合成 DragEvent 的 dataTransfer.files
 * 在无头环境不可用，但真实拖拽走的是同一条逻辑）。
 */
async function openDroppedFiles(files: File[]): Promise<number> {
  const { useFile } = await import('../composables/useFile')
  const { openPath } = useFile()
  let opened = 0
  for (const file of files) {
    const p = pathForFileHook ? pathForFileHook(file) : window.inkdown.getPathForFile(file)
    if (!p) continue
    // 只接受 Markdown 文档，其它类型忽略
    if (!MD_RE.test(p)) continue
    await openPath(p)
    opened += 1
  }
  if (!opened) {
    state.notice = { text: t('notice.onlyMarkdown') }
  }
  return opened
}

/**
 * 跳到指定行（供全库搜索结果点击后定位）。
 * 用 setCursorByOffset 把光标放到目标行首，再滚动到可见区域。
 */
function onGotoLine(e: Event): void {
  const d = (e as CustomEvent).detail as { filePath?: string; line?: number }
  if (!muya || !d?.line) return
  if (d.filePath && activeTab.value?.filePath !== d.filePath) return
  if (isSource.value || isSplit.value) {
    const lines = state.sourceContent.split('\n')
    const offset = lines.slice(0, Math.max(0, d.line - 1)).reduce((sum, line) => sum + line.length + 1, 0)
    const ta = sourceRef.value
    ta?.focus()
    ta?.setSelectionRange(offset, offset)
    scrollSourceToOffset(offset)
    onSourceCaretMove()
    return
  }
  const line = Math.max(0, d.line - 1)
  requestAnimationFrame(() => {
    const m = muya
    if (!m) return
    try {
      m.setCursorByOffset({ anchor: { line, ch: 0 }, focus: { line, ch: 0 } })
      // 让光标行进入视野
      const scroller = getScroller()
      const sel = document.getSelection()
      if (scroller && sel && sel.rangeCount) {
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        const scrollerRect = scroller.getBoundingClientRect()
        const target = scroller.scrollTop + (rect.top - scrollerRect.top) - scrollerRect.height / 3
        scroller.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
      }
    } catch {
      /* 行号可能超出文档范围，忽略 */
    }
  })
}

async function openReadingLink(session: EditorSession, href: string): Promise<void> {
  if (currentSession !== session || !isReading.value) return
  const owner = state.tabs.find(tab => tab.id === session.id)
  const target = readingLinkTarget(href, owner?.filePath ?? null)
  if (!target) return
  if (target.kind === 'fragment') { session.reading?.fragment(target.href); return }
  if (target.kind === 'external') { await window.inkdown.openExternal(target.href); return }
  try {
    const { useFile } = await import('../composables/useFile')
    await useFile().openPath(target.path)
    if (!target.fragment) return
    const incoming = currentSession
    scheduleColumnLayout()
    requestAnimationFrame(() => { void nextTick(() => {
      if (isReading.value && currentSession === incoming && activeTab.value?.filePath?.replace(/\\/g,'/').toLowerCase() === target.path.toLowerCase()) incoming?.reading?.fragment(target.fragment)
    }) })
  } catch { state.notice = { text: t('reading.linkUnavailable') } }
}

function restoreReadingPosition(session: EditorSession, position: ReadingPosition): void {
  if (currentSession !== session || !isReading.value) return
  const scroller = editorScrollRef.value
  if (!scroller) return
  scroller.scrollTop = position.top
  if (columnsActive.value && position.column !== undefined) {
    session.columnStart = position.column
    columnRestorePending = { session, start: position.column }
    scheduleColumnLayout()
  } else scroller.scrollLeft = position.left
}

function onReadingHeading(event: Event): void {
  const detail = (event as CustomEvent).detail
  if (isReading.value && detail?.id === currentSession?.id) currentSession?.reading?.go(detail.index)
}

watch(isReading, reading => {
  document.body.classList.toggle('is-reading-mode', reading)
  // 关键：同步每个会话的只读状态。
  // 进入阅读 → 锁 contenteditable；退出阅读 → 还原，
  // 否则切回编辑后仍然打不了字。
  for (const session of editorSessions.values()) session.reading?.syncReadOnly(reading)
  if (reading) currentSession?.reading?.activate()
}, { immediate: true })

/**
 * 离开所见即所得视图时自动退出阅读态。
 *
 * 源码 / 源码预览本身就是编辑视图，若保留 readingMode，
 * 切回来会莫名其妙仍是只读。这里统一复位，避免状态混淆。
 */
watch(
  () => state.viewMode,
  (mode) => {
    if (mode !== 'wysiwyg' && state.readingMode) state.readingMode = false
  }
)

onMounted(() => {
  window.addEventListener('inkdown:reading-heading', onReadingHeading)
  registerGlobalCommands()
  columnContentObserver = new MutationObserver(records => {
    if (!columnsActive.value) return
    // Gutter positions are presentation-only; they cannot change pagination.
    if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.mu-line-numbers-rows'))) scheduleColumnLayout()
  })
  mountEditor()
  registerEditorCommands()
  // 右键菜单用「捕获阶段」监听：
  // 内核在内容节点上对 contextmenu 做了 stopPropagation，
  // 冒泡阶段收不到（实测 calls 始终为 0）。
  // 捕获阶段先于内核处理，因此一定能拿到事件。
  window.addEventListener('contextmenu', onEditorContextMenu, true)
  // 若启动时就处于分栏模式，渲染一次预览
  nextTick(() => refreshPreview())
  // 暴露命令中心与已注册命令，供主进程自检核对
  ;(window as unknown as Record<string, unknown>).__inkdownCommands = {
    execute: executeCommand,
    has: (id: string) => hasCommand(id),
    ids: () => listCommandIds()
  }
  // 供端到端自检直接驱动拖入逻辑（合成事件无法携带真实文件路径）
  ;(window as unknown as Record<string, unknown>).__inkdownDrop = {
    openFiles: openDroppedFiles,
    setPathHook: setPathForFileHook
  }
  // 供端到端自检驱动分栏光标联动（程序化 setSelectionRange 不触发真实按键事件）
  ;(window as unknown as Record<string, unknown>).__inkdownSplitSync = {
    sync: syncPreviewToCursor,
    mapping: () => previewBlocks().map((node, i) => ({
      source: state.sourceContent.slice(previewStarts[i], previewStarts[i + 1]).slice(0, 100),
      tag: node.tagName,
      text: node.textContent?.slice(0, 50)
    }))
  }
  // 供端到端自检调用悬浮球插入逻辑
  ;(window as unknown as Record<string, unknown>).__inkdownOrb = {
    insert: onOrbInsert
  }
  window.addEventListener('inkdown:find', onFind)
  window.addEventListener('inkdown:find-close', onFindClose)
  window.addEventListener('inkdown:settings-changed', onSettingsChanged)
  window.addEventListener('inkdown:insert-text', onInsertText as EventListener)
  window.addEventListener('inkdown:goto-line', onGotoLine as EventListener)

  const sourceScroller = sourceRef.value?.closest('.source-scroll') as HTMLElement | null
  if (sourceScroller && typeof ResizeObserver !== 'undefined') {
    sourceResizeObserver = new ResizeObserver(() => resizeSourceEditor())
    sourceResizeObserver.observe(sourceScroller)
  }
  nextTick(resizeSourceEditor)
  columnsObserver = new ResizeObserver(scheduleColumnLayout)
  if (editorScrollRef.value) columnsObserver.observe(editorScrollRef.value)
})

onBeforeUnmount(() => {
  document.body.classList.remove('is-reading-mode')
  window.removeEventListener('inkdown:reading-heading', onReadingHeading)
  previewDiagrams.dispose()
  cancelPreviewRefresh()
  if (caretFrame != null) cancelAnimationFrame(caretFrame)
  if (sourceResizeFrame != null) cancelAnimationFrame(sourceResizeFrame)
  sourceResizeFrame = null
  window.removeEventListener('contextmenu', onEditorContextMenu, true)
  window.removeEventListener('inkdown:find', onFind)
  window.removeEventListener('inkdown:find-close', onFindClose)
  window.removeEventListener('inkdown:settings-changed', onSettingsChanged)
  window.removeEventListener('inkdown:insert-text', onInsertText as EventListener)
  window.removeEventListener('inkdown:goto-line', onGotoLine as EventListener)
  sourceResizeObserver?.disconnect()
  sourceResizeObserver = null
  if (cursorTimer != null) window.clearTimeout(cursorTimer)
  // 卸载前落定待处理的统计，避免定时器在组件销毁后触发
  flushCountsAndOutline()
  if (countsTimer != null) {
    window.clearTimeout(countsTimer)
    countsTimer = null
  }
  if (columnsFrame != null) cancelAnimationFrame(columnsFrame)
  editorScrollRef.value?.removeEventListener('wheel', onColumnsWheel)
  columnsObserver?.disconnect()
  columnContentObserver?.disconnect()
  for (const session of editorSessions.values()) destroySession(session)
  if (currentSession && !editorSessions.has(currentSession.id)) destroySession(currentSession)
  editorSessions.clear()
  currentSession = null
  muya = null
})

defineExpose({ focus, reloadFromTab, getMarkdown: () => isReading.value ? activeTab.value?.content ?? '' : muya?.getMarkdown() ?? '' })
</script>

<template>
  <div
    ref="hostRef"
    class="editor-host"
    :class="{ 'is-split': isSplit, 'is-paged': columnsActive }"
    :style="{
      '--editor-zoom': state.zoom,
      '--editor-font-size': `${settings.fontSize}px`,
      '--editor-code-size': `${settings.codeFontSize}px`,
      '--editor-code-font': settings.codeFontFamily || CODE_FONT_FALLBACK,
      '--editor-tab-size': settings.tabSize
    }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!--
      三种视图：
        所见即所得 —— 只显示 muya 编辑器
        源码预览   —— 左侧源码、右侧渲染效果
        源码       —— 只显示源码编辑器
      源码预览与源码共用同一个 textarea，避免两份内容源不同步。
    -->
    <div v-if="columnsActive" class="columns-sheets" aria-hidden="true">
      <span class="columns-sheet" />
      <span v-if="columnsPages > 1" class="columns-sheet" />
    </div>
    <div ref="editorScrollRef" v-show="!isSource && !isSplit" class="editor-scroll reading-scroll"
      :class="{ 'is-columns': columnsActive }" @scroll.passive="onColumnScroll" @load.capture="scheduleColumnLayout">
      <template v-if="columnsActive">
        <span class="columns-end" :style="{ left: `${columnsEnd}px` }" aria-hidden="true" />
        <span v-for="page in columnsLastStart" :key="page" class="columns-snap"
          :style="{ left: `${44 + (page - 1) * columnStride}px` }" aria-hidden="true" />
      </template>
    </div>
    <nav v-if="columnsActive" class="columns-pager" :aria-label="t('view.continuousColumns')">
      <span class="columns-flow">{{ t('view.continuousColumns') }}</span>
      <button :disabled="columnsPage <= 1" :aria-label="t('view.previousSpread')" @click="turnColumns(-1)">‹</button>
      <span>{{ t('view.columnPage', { range: columnsRange, pages: columnsPages }) }}</span>
      <button :disabled="columnsPage >= columnsLastStart" :aria-label="t('view.nextSpread')" @click="turnColumns(1)">›</button>
    </nav>
    <!-- 源码预览：左侧编辑源码，右侧渲染当前 Markdown -->
    <div
      v-show="isSource || isSplit"
      class="source-scroll"
      :class="{ 'split-left': isSplit }"
    >
      <div v-if="isSplit" class="source-head">
        <div class="split-head-label">
          <span class="split-eyebrow">{{ t('view.splitSourceHead') }}</span>
          <span class="source-meta">
            {{ t('view.splitSourceMeta', { eol: settings.lineEnding.toUpperCase() }) }}
          </span>
        </div>
        <span class="source-position">
          {{ t('view.splitSourcePosition', { line: sourceLine, lines: sourceLines, chars: state.charCount }) }}
        </span>
      </div>
      <div class="source-editor-wrap">
        <textarea
          ref="sourceRef"
          v-model="state.sourceContent"
          class="source-editor"
          spellcheck="false"
          @keydown="onSourceKeydown"
          @click="onSourceCaretMove"
          @keyup="onSourceCaretMove"
          @input="onSourceInput"
        />
      </div>
    </div>
    <div v-if="isSplit" class="split-preview">
      <div class="split-preview-head">
        <div class="split-head-label">
          <span class="split-eyebrow">{{ t('view.splitPreviewHead') }}</span>
          <span class="split-live"><span class="split-live-dot" />LIVE</span>
        </div>
        <span class="split-preview-title">{{ activeTab?.title ?? '' }}</span>
        <!-- 两个独立开关：虚线框标位置、视角跟随光标 -->
        <label class="split-opt" :title="t('view.splitHighlightBlockHint')">
          <input v-model="settings.splitHighlightBlock" type="checkbox" />
          {{ t('view.splitHighlightBlock') }}
        </label>
        <label class="split-opt" :title="t('view.splitSyncScrollHint')">
          <input v-model="settings.splitSyncScroll" type="checkbox" />
          {{ t('view.splitSyncScroll') }}
        </label>
      </div>
      <div ref="previewRef" class="split-preview-body markdown-body" @click="onPreviewClick" />
    </div>
    <!-- 悬浮球：源码预览与源码模式出现；拖动期间不展开 -->
    <BlockOrb v-if="(isSplit || isSource) && activeTab" @insert="onOrbInsert" />
    <div v-if="!activeTab" class="empty-state">
      <p class="empty-title">{{ t('app.name') }}</p>
      <p class="empty-hint">{{ t('editor.emptyHint') }}</p>
    </div>
    <!-- 拖入提示层 -->
    <div v-if="dragging" class="drop-overlay">
      <div class="drop-box">{{ t('editor.dropHint') }}</div>
    </div>
    <!-- 正文右键菜单 -->
    <div
      v-if="editorMenu.visible"
      class="editor-ctx"
      :style="{ left: `${editorMenu.x}px`, top: `${editorMenu.y}px` }"
    >
      <template v-for="(item, i) in editorMenuItems" :key="i">
        <div v-if="'separator' in item" class="ctx-sep" />
        <button v-else class="ctx-item" @click="runEditorMenuCommand(item.command)">
          {{ item.label }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.editor-host {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
/* 分栏模式：左右并排 */
.editor-host.is-split {
  display: flex;
  flex-direction: row;
}
.editor-scroll,
.source-scroll {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
/* 源码预览：左侧源码、右侧预览，各占一半 */
.source-scroll.split-left {
  flex: 1 1 50%;
  min-width: 0;
  border-right: 1px solid var(--ty-border);
}
.source-scroll.split-left,
.split-preview {
  min-height: 0;
}
.split-preview {
  display: flex;
  flex-direction: column;
  flex: 1 1 50%;
  min-width: 0;
  height: 100%;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ty-tabbar-bg) 38%, transparent), transparent 120px),
    var(--ty-bg);
  overflow: hidden;
}
.split-preview-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  min-height: 42px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ty-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ty-tabbar-bg) 88%, #ffffff), var(--ty-tabbar-bg));
  color: var(--ty-muted);
  font-size: 11px;
}
.split-head-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-width: 0;
}
.split-eyebrow {
  color: var(--ty-text);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.4px;
  text-transform: uppercase;
}
.split-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, var(--ty-accent) 28%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ty-accent) 8%, transparent);
  color: var(--ty-accent);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.8px;
}
.split-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ty-accent);
  box-shadow: 0 0 6px var(--ty-accent);
  animation: live-pulse 2s ease-in-out infinite;
}
@keyframes live-pulse {
  0%,
  100% {
    opacity: 0.62;
    transform: scale(0.86);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}
.split-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ty-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.split-opt {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: none;
  cursor: pointer;
  user-select: none;
  letter-spacing: 0;
  padding: 3px 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.split-opt:hover {
  border-color: color-mix(in srgb, var(--ty-border) 80%, transparent);
  background: var(--ty-hover);
}
.split-opt input {
  margin: 0;
  accent-color: var(--ty-accent);
}
/* 光标所在块：虚线框标出 */
:deep(.split-cursor-block) {
  outline: 1.5px dashed var(--ty-accent);
  outline-offset: 3px;
  border-radius: 3px;
  background: var(--ty-active);
  transition: background 0.15s ease;
}
.split-preview-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 34px clamp(28px, 5vw, 64px) 96px;
  color: var(--editor-color);
  font-size: calc(var(--editor-font-size) * var(--editor-zoom));
  line-height: 1.7;
  word-wrap: break-word;
  scrollbar-gutter: stable;
}
/* 预览区的排版细节（与导出的样式保持接近） */
.split-preview-body :deep(h1),
.split-preview-body :deep(h2) {
  border-bottom: 1px solid var(--editor-color-10);
  padding-bottom: 0.3em;
}
.split-preview-body :deep(h1),
.split-preview-body :deep(h2),
.split-preview-body :deep(h3),
.split-preview-body :deep(h4) {
  margin: 1.3em 0 0.6em;
  color: var(--editor-color-80);
}
.split-preview-body :deep(p) {
  margin: 0.8em 0;
}
.split-preview-body :deep(code) {
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: var(--code-block-bg-color);
  font-family: var(--editor-code-font);
  font-size: 0.9em;
}
.split-preview-body :deep(pre) {
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--code-block-bg-color);
  overflow-x: auto;
}
.split-preview-body :deep(pre code) {
  padding: 0;
  background: none;
}
.split-preview-body :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  border-left: 4px solid var(--blockquote-border-color);
  color: var(--blockquote-text-color);
}
.split-preview-body :deep(table) {
  border-collapse: collapse;
  margin: 1em 0;
}
.split-preview-body :deep(th),
.split-preview-body :deep(td) {
  border: 1px solid var(--table-border-color);
  padding: 5px 10px;
}
.split-preview-body :deep(img) {
  max-width: 100%;
}
.split-preview-body :deep(.split-diagram) {
  margin: 1em 0;
  padding: 12px 0;
  overflow-x: auto;
  text-align: center;
}
.split-preview-body :deep(.split-diagram-status),
.split-preview-body :deep(.split-diagram-error) {
  padding: 12px 16px;
  border-radius: 6px;
  background: var(--code-block-bg-color);
  color: var(--ty-muted);
  font-size: 0.9em;
}
.split-preview-body :deep(.split-diagram-error) {
  border-left: 3px solid #d1242f;
  text-align: left;
  overflow-wrap: anywhere;
}
.split-preview-body :deep(.split-diagram details) {
  margin-top: 8px;
  text-align: left;
}
.split-preview-body :deep(.katex-display) {
  overflow-x: auto;
  overflow-y: hidden;
}
.split-preview-body :deep(a) {
  color: var(--theme-color);
}
.split-preview-body :deep(hr) {
  border: 0;
  border-top: 1px solid var(--hr-color);
  margin: 1.4em 0;
}
/* GitLab 风格行内增删标记 */
.split-preview-body :deep(.idiff.addition) {
  padding: 0.04em 0.12em;
  border-radius: 3px;
  background: color-mix(in srgb, #35a35f 18%, transparent);
  color: inherit;
  text-decoration: none;
}
.split-preview-body :deep(.idiff.deletion) {
  padding: 0.04em 0.12em;
  border-radius: 3px;
  background: color-mix(in srgb, #d9505f 18%, transparent);
  color: inherit;
  text-decoration: none;
}
.muya-container {
  min-height: 100%;
  font-size: calc(var(--editor-font-size) * var(--editor-zoom));
}
.source-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ty-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ty-tabbar-bg) 88%, #ffffff), var(--ty-tabbar-bg));
  color: var(--ty-muted);
  font-size: 11px;
}
.source-meta {
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, var(--ty-border) 76%, transparent);
  border-radius: 999px;
  color: var(--ty-muted);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.source-position {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ty-muted);
  font-family: var(--editor-code-font);
  font-size: 10px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.source-editor-wrap {
  min-height: calc(100% - 42px);
}
.source-editor {
  display: block;
  width: 100%;
  height: auto;
  min-height: 100%;
  box-sizing: border-box;
  padding: 34px clamp(22px, 4vw, 42px) 120px;
  border: 0;
  outline: none;
  resize: none;
  overflow: hidden;
  font-family: var(--editor-code-font);
  font-size: calc(var(--editor-code-size) * var(--editor-zoom));
  line-height: 1.6;
  letter-spacing: 0.02em;
  color: var(--ty-text);
  background: transparent;
  tab-size: var(--editor-tab-size);
  scrollbar-width: thin;
}
.source-scroll.split-left {
  background:
    radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--ty-accent) 5%, transparent), transparent 260px),
    var(--ty-bg);
}
.source-scroll:not(.split-left) .source-editor {
  max-width: 980px;
  margin: 0 auto;
  padding: 48px 56px 120px;
}
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  color: var(--ty-muted);
}
.empty-title {
  margin: 0;
  font-size: 28px;
  font-weight: 300;
  letter-spacing: 2px;
}
.empty-hint {
  margin: 0;
  font-size: 13px;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ty-active);
  pointer-events: none;
}
/* 正文右键菜单 */
.editor-ctx {
  position: fixed;
  z-index: 300;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--ty-border);
  border-radius: 6px;
  background: var(--ty-bg);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  font-size: 12px;
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.ctx-item:hover {
  background: var(--ty-active);
}
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--ty-border);
}
.drop-box {
  padding: 18px 28px;
  border: 2px dashed var(--ty-accent);
  border-radius: 10px;
  background: var(--ty-bg);
  color: var(--ty-accent);
  font-size: 14px;
}
</style>

<style scoped>
.editor-host.is-paged { background: color-mix(in srgb, var(--ty-bg) 94%, var(--ty-text)); }
.columns-sheets { position: absolute; inset: 18px 28px 34px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; pointer-events: none; }
.columns-sheet { min-width: 0; border: 1px solid var(--ty-border); border-radius: 3px; background: var(--ty-bg); box-shadow: 0 2px 5px rgb(0 0 0 / 5%); }
.editor-scroll.is-columns { position: relative; z-index: 1; padding: 30px 44px 46px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scroll-padding-left: 44px; scrollbar-width: none; }
.editor-scroll.is-columns::-webkit-scrollbar { height: 0; }
.columns-snap { position: absolute; top: 0; width: 1px; height: 1px; scroll-snap-align: start; pointer-events: none; }
.columns-end { position: absolute; top: 0; width: 1px; height: 1px; pointer-events: none; }
/* Fixed paper sheets paint each page; the moving editor must not cover the gutter. */
.is-columns :deep(.muya-container) { height: 100%; min-height: 0; width: 100%; background: transparent; }
.is-columns :deep(.mu-container) { height: 100%; min-height: 0; max-width: none; margin: 0; padding: 0; column-count: 2; column-fill: auto; column-gap: 64px; container-type: normal; }
.is-columns :deep(.mu-container > *) { break-inside: avoid-column; }
.is-columns :deep(.mu-container h1), .is-columns :deep(.mu-container h2), .is-columns :deep(.mu-container h3) { break-after: avoid-column; }
.is-columns :deep(.mu-table), .is-columns :deep(.mu-code-block), .is-columns :deep(.mu-diagram-block > .mu-diagram-preview), .is-columns :deep(.mu-diagram-block.mu-active > .mu-diagram-container) { max-width: 100%; max-height: var(--column-content-height); overflow: auto; }
.columns-pager { position: absolute; z-index: 2; bottom: 5px; left: 50%; transform: translateX(-50%); white-space: nowrap; display: flex; align-items: center; gap: 10px; padding: 3px 8px; border: 1px solid var(--ty-border); border-radius: 7px; background: var(--ty-bg); color: var(--ty-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.columns-pager button { border: 0; border-radius: 4px; background: transparent; color: var(--ty-text); font-size: 19px; cursor: pointer; }
.columns-pager button:hover { background: var(--ty-hover); }
.columns-pager button:disabled { opacity: .3; cursor: default; }
.columns-flow { margin-right: 4px; }
.reading-scroll :deep(.mu-hide.mu-remove) { display: none !important; }
.reading-scroll :deep(.mu-container), .reading-scroll :deep(.mu-content) { cursor: text; user-select: text; }
.reading-scroll :deep(.mu-copy-header-link), .reading-scroll :deep(.mu-fold-toggle), .reading-scroll :deep(.mu-code-copy), .reading-scroll :deep(.mu-language-input) { display: none !important; }
.reading-scroll :deep(.muya-container:focus) { outline: none; }
</style>
<style>
.is-reading-mode .mu-float-wrapper, .is-reading-mode .mu-front-button-wrapper, .is-reading-mode .mu-image-resize-bar { display: none !important; }
</style>
