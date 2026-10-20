<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { Muya, registerMuyaPlugins, buildMuyaOptions, setDocPathForImages } from '../editor/muyaSetup'
import { registerCommands, registerGlobalCommands, executeCommand, hasCommand, listCommandIds } from '../composables/useCommands'
import { exportHtml, exportPdf, buildHtmlForCheck, renderPreviewHtml } from '../composables/useExport'
import { useI18n } from '../composables/useI18n'

// 供主进程端到端自检调用
;(window as unknown as Record<string, unknown>).__inkdownExport = { buildHtmlForCheck }
import { getActiveTab, isDirty, state, settings, type Tab } from '../store'
import { baseName } from '../composables/useFile'

const containerRef = ref<HTMLElement | null>(null)
const sourceRef = ref<HTMLTextAreaElement | null>(null)
const { t } = useI18n()
let muya: Muya | null = null
let suppress = false
/** 源码模式的等宽字体回退栈（通过 CSS 变量传给样式，避免 v-bind 依赖构建插件） */
const CODE_FONT_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
/** 各标签页的光标与滚动位置，切回时恢复。 */
const viewState = new Map<string, { cursor: Tab['cursor']; scrollTop: number }>()

const activeTab = computed(() => getActiveTab())
const isSource = computed(() => state.viewMode === 'source')
/** 分栏预览：左侧所见即所得，右侧静态预览。 */
const isSplit = computed(() => state.viewMode === 'split')
/** 右侧预览容器。 */
const previewRef = ref<HTMLElement | null>(null)

/** 刷新分栏预览区的内容。 */
function refreshPreview(): void {
  if (!isSplit.value) return
  const el = previewRef.value
  if (!el) return
  const tab = activeTab.value
  el.innerHTML = tab ? renderPreviewHtml(tab.content) : ''
}

// 分栏模式下内容或视图变化时更新预览
watch(
  () => [state.viewMode, activeTab.value?.content, state.activeId],
  () => {
    if (!isSplit.value) return
    nextTick(() => refreshPreview())
  },
  { flush: 'post' }
)

function updateCounts(markdown: string): void {
  const cjk = (markdown.match(/[\u4e00-\u9fa5]/g) || []).length
  const words = (markdown.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
  state.wordCount = cjk + words
  state.charCount = markdown.length
}

/** 保存当前标签的视图状态，供切换标签时恢复。 */
function stashViewState(): void {
  const tab = activeTab.value
  if (!tab) return
  if (muya) {
    const cursor = muya.getCursorOffset()
    const scroller = getScroller()
    viewState.set(tab.id, {
      cursor: cursor ?? null,
      scrollTop: scroller?.scrollTop ?? 0
    })
  }
}

function applyViewState(tab: Tab): void {
  const saved = viewState.get(tab.id)
  if (!saved || !muya) return
  if (saved.cursor) {
    try {
      muya.setCursorByOffset(saved.cursor)
    } catch {
      /* 光标位置可能已失效，忽略 */
    }
  }
  const scroller = getScroller()
  if (scroller) scroller.scrollTop = saved.scrollTop
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
}

/** 定位编辑器滚动容器。
 *  注意：muya 在 init() 时会替换掉传入的容器元素，因此不能依赖 containerRef，
 *  改为优先用 muya 自己的 domNode 向上查找，再退回文档查询。 */
function getScroller(): HTMLElement | null {
  const fromMuya = muya?.domNode?.closest?.('.editor-scroll') as HTMLElement | null
  if (fromMuya) return fromMuya
  const fromRef = containerRef.value?.closest('.editor-scroll') as HTMLElement | null
  if (fromRef) return fromRef
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

function mountEditor(): void {
  const el = containerRef.value
  if (!el) return
  registerMuyaPlugins()
  const tab = activeTab.value
  setDocPathForImages(tab?.filePath ?? null)
  muya = new Muya(el, buildMuyaOptions({ markdown: tab?.content ?? '' }))
  muya.init()

  // 暴露实例供主进程端到端自检使用（INKDOWN_SELF_CHECK 时才有意义）
  ;(window as unknown as Record<string, unknown>).__inkdownMuya = muya

  muya.on('json-change', () => {
    if (suppress) return
    const t = activeTab.value
    if (!t) return
    t.content = muya!.getMarkdown()
    updateCounts(t.content)
    refreshOutline()
  })

  muya.on('selection-change', () => {
    const t = activeTab.value
    if (!t || !muya) return
    const cursor = muya.getCursorOffset()
    if (cursor) t.cursor = cursor
    refreshOutline()
    if (state.typewriterMode) keepCursorCentered()
  })

  // 切标签或重载内容后，内核会重置搜索状态，这里按 store 里记的关键词重搜一次
  muya.on('search-refreshed', () => {
    restoreSearchIfNeeded()
  })

  updateCounts(tab?.content ?? '')
  refreshOutline()

  // 应用级载入钩子：走与界面相同的路径（载入内容 + 刷新字数与大纲），
  // 供主进程自检与截图使用，避免直接调用 muya.setContent 绕过 Vue 状态。
  ;(window as unknown as Record<string, unknown>).__inkdownLoad = (markdown: string) => {
    const t = activeTab.value
    if (!t || !muya) return false
    suppress = true
    muya.setContent(markdown, false)
    suppress = false
    t.content = markdown
    updateCounts(markdown)
    refreshOutline()
    return true
  }
}

/** 把某个标签的内容载入编辑器。 */
function loadTab(tab: Tab): void {
  setDocPathForImages(tab.filePath)
  if (isSource.value) {
    state.sourceContent = tab.content
    return
  }
  if (!muya) return
  suppress = true
  muya.setContent(tab.content, false)
  suppress = false
  updateCounts(tab.content)
  refreshOutline()
  // setContent 会清掉内核的搜索状态，切回来需要重新搜索
  restoreSearchIfNeeded()
}

watch(
  () => state.activeId,
  (_newId, oldId) => {
    if (oldId) stashViewState()
    const tab = activeTab.value
    if (!tab) return
    if (isSource.value) {
      state.sourceContent = tab.content
    } else {
      loadTab(tab)
      nextTick(() => applyViewState(tab))
    }
  }
)

watch(
  () => state.viewMode,
  (mode, prev) => {
    const tab = activeTab.value
    if (!tab) return

    // 离开源码模式时，把源码里改动过的内容同步回标签
    if (prev === 'source' && state.sourceContent !== tab.content) {
      tab.content = state.sourceContent
      updateCounts(tab.content)
    }

    if (mode === 'source') {
      // 进入源码模式：把当前内容交给 textarea
      state.sourceContent = tab.content
      nextTick(() => sourceRef.value?.focus())
      return
    }

    // 分栏与所见即所得都需要 muya 渲染最新内容
    nextTick(() => {
      loadTab(tab)
      refreshPreview()
      if (mode === 'wysiwyg') focus()
    })
  }
)

// 源码模式下编辑内容实时同步到标签
watch(
  () => state.sourceContent,
  (val) => {
    if (!isSource.value) return
    const tab = activeTab.value
    if (!tab) return
    tab.content = val
    updateCounts(val)
  }
)

// 专注模式：给编辑器根节点加类，由 CSS 淡化非当前段落
watch(
  () => [state.focusMode, state.typewriterMode],
  () => {
    document.body.classList.toggle('focus-mode', state.focusMode)
    document.body.classList.toggle('typewriter-mode', state.typewriterMode)
    if (muya) muya.setFocusMode(state.focusMode)
  }
)

function focus(): void {
  if (isSource.value) sourceRef.value?.focus()
  else muya?.focus()
}

/**
 * 段落与格式命令的取值直接对齐 marktext desktop 的菜单词汇表
 * （packages/desktop/src/main/menu/actions/*），确保内核能识别。
 */
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
    'format:link': 'link',
    'format:image': 'image',
    'format:clear': 'clear'
  }

  const commands: Record<string, () => void> = {
    'edit:undo': () => muya?.undo(),
    'edit:redo': () => muya?.redo(),
    'edit:copyMarkdown': () => muya?.copyAsMarkdown(),
    'edit:copyHtml': () => muya?.copyAsHtml(),
    'edit:pastePlain': () => void muya?.pasteAsPlainText(),
    'view:focusEditor': () => focus(),
    'file:exportHtml': () => void exportHtml(),
    'file:exportPdf': () => void exportPdf(),
    // 段落操作（对齐 marktext 的 Edit 菜单）
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
  registerCommands(commands)
}

async function insertImage(): Promise<void> {
  const files = await window.inkdown.openFileDialog()
  const src = files[0]?.filePath
  if (!src) return
  const docPath = activeTab.value?.filePath ?? null
  const finalSrc = await window.inkdown.copyImage(docPath, src)
  muya?.insertImage({ src: finalSrc, alt: baseName(src) })
}

function onSourceKeydown(e: KeyboardEvent): void {
  // 源码模式支持 Tab 缩进，避免焦点跳走
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = e.target as HTMLTextAreaElement
    const start = el.selectionStart
    const end = el.selectionEnd
    const value = el.value
    const indent = ' '.repeat(settings.tabSize)
    el.value = value.slice(0, start) + indent + value.slice(end)
    el.selectionStart = el.selectionEnd = start + indent.length
    state.sourceContent = el.value
  }
}

/** 查找/替换：FindBar 通过自定义事件把参数送进来，这里调用 muya 的搜索 API。 */
function onFind(e: Event): void {
  if (!muya) return
  const d = (e as CustomEvent).detail as {
    action: 'search' | 'next' | 'previous' | 'replace' | 'replaceAll'
    keyword: string
    replacement: string
    isRegexp: boolean
    isCaseSensitive: boolean
    isWholeWord: boolean
  }
  const opts = {
    isRegexp: d.isRegexp,
    isCaseSensitive: d.isCaseSensitive,
    isWholeWord: d.isWholeWord,
    selectHighlight: true
  }
  // 记住关键词与选项：切标签后要按它重搜（内核会清掉搜索状态）
  state.findKeyword = d.keyword
  state.findOptions = {
    isRegexp: d.isRegexp,
    isCaseSensitive: d.isCaseSensitive,
    isWholeWord: d.isWholeWord
  }
  switch (d.action) {
    case 'search':
      searchResult = muya.search(d.keyword, opts)
      // 内核 search() 设完选区会重渲染当前块，抹掉该块的高亮；
      // 补一次重放（只刷高亮、不动选区），避免「搜索后少一个高亮」。
      replayHighlights(d.keyword, opts, searchResult?.index ?? 0)
      break
    case 'next':
      searchResult = muya.find('next')
      break
    case 'previous':
      searchResult = muya.find('previous')
      break
    case 'replace':
      searchResult = muya.replace(d.replacement, { isSingle: true, isRegexp: d.isRegexp })
      break
    case 'replaceAll':
      searchResult = muya.replace(d.replacement, { isSingle: false, isRegexp: d.isRegexp })
      break
  }
  reportMatches()
}

/**
 * 重新应用当前搜索的高亮。
 *
 * 内核的 search() 结尾会 setCursor 选中当前匹配，随之触发该块重渲染；
 * 重渲染默认不带 highlights，于是当前匹配的一级高亮被抹掉
 * （表现为「搜索后少一个高亮、点一下下一处才恢复」）。
 *
 * 修法：用同一关键词、同一 highlightIndex 再搜一次，但 selectHighlight=false，
 * 这样只重新渲染高亮、不再动选区，也不会移动当前项。
 */
function replayHighlights(keyword: string, opts: Record<string, unknown>, index: number): void {
  if (!muya || !keyword) return
  requestAnimationFrame(() => {
    const m = muya
    if (!m) return
    try {
      searchResult = m.search(keyword, {
        ...opts,
        highlightIndex: index,
        selectHighlight: false
      })
      reportMatches()
    } catch {
      /* 忽略：重放失败不影响搜索本身 */
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
  const { findKeyword, findOptions } = state
  requestAnimationFrame(() => {
    const m = muya
    if (!m) return
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

/** 把匹配数量与当前序号回传给 FindBar 显示。 */
function reportMatches(): void {
  const matches = searchResult?.matches ?? []
  const index = searchResult?.index ?? -1
  window.dispatchEvent(
    new CustomEvent('inkdown:find-result', {
      detail: { count: matches.length, index: index >= 0 ? index + 1 : 0 }
    })
  )
}

function onFindClose(): void {
  muya?.hideAllFloatTools()
  const tab = activeTab.value
  if (tab) tab.content = muya?.getMarkdown() ?? tab.content
}

/** 外部文件变更后重新载入编辑器内容。 */
function reloadFromTab(): void {
  const tab = activeTab.value
  if (!tab) return
  if (isSource.value) {
    state.sourceContent = tab.content
    return
  }
  if (!muya) return
  suppress = true
  muya.setContent(tab.content, false)
  suppress = false
  updateCounts(tab.content)
  refreshOutline()
}

function onSettingsChanged(): void {
  if (!muya) return
  suppress = true
  muya.setOptions(buildMuyaOptions(), true)
  suppress = false
}

/**
 * 在光标处插入文本（用于「插入当前时间」）。
 * 内核没有公开的「插入文本」API，这里通过剪贴板粘贴路径实现：
 * 写入剪贴板 → 触发 pasteAsPlainText，光标处即出现该文本。
 */
async function onInsertText(e: Event): Promise<void> {
  const text = (e as CustomEvent).detail?.text
  if (typeof text !== 'string' || !text || !muya) return
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
  // 必须 preventDefault 才允许投放
  e.preventDefault()
  dragging.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(e: DragEvent): void {
  // 只在真正离开容器时隐藏提示层（子元素切换会连续触发）
  const related = e.relatedTarget as Node | null
  if (related && containerRef.value?.contains(related)) return
  dragging.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  dragging.value = false
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

onMounted(() => {
  registerGlobalCommands()
  mountEditor()
  registerEditorCommands()
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
  window.addEventListener('inkdown:find', onFind)
  window.addEventListener('inkdown:find-close', onFindClose)
  window.addEventListener('inkdown:settings-changed', onSettingsChanged)
  window.addEventListener('inkdown:insert-text', onInsertText as EventListener)
  window.addEventListener('inkdown:goto-line', onGotoLine as EventListener)
})

onBeforeUnmount(() => {
  window.removeEventListener('inkdown:find', onFind)
  window.removeEventListener('inkdown:find-close', onFindClose)
  window.removeEventListener('inkdown:settings-changed', onSettingsChanged)
  window.removeEventListener('inkdown:insert-text', onInsertText as EventListener)
  window.removeEventListener('inkdown:goto-line', onGotoLine as EventListener)
  muya?.destroy()
  muya = null
})

defineExpose({ focus, reloadFromTab, getMarkdown: () => muya?.getMarkdown() ?? '' })
</script>

<template>
  <div
    class="editor-host"
    :class="{ 'is-split': isSplit && !isSource }"
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
    <div v-show="!isSource" class="editor-scroll" :class="{ 'split-left': isSplit }">
      <div ref="containerRef" class="muya-container" />
    </div>
    <!-- 分栏预览：右侧渲染当前 Markdown 的静态 HTML -->
    <div v-if="isSplit && !isSource" class="split-preview">
      <div class="split-preview-head">{{ t('view.splitPreview') }}</div>
      <div ref="previewRef" class="split-preview-body markdown-body" />
    </div>
    <div v-show="isSource" class="source-scroll">
      <textarea
        ref="sourceRef"
        v-model="state.sourceContent"
        class="source-editor"
        spellcheck="false"
        @keydown="onSourceKeydown"
      />
    </div>
    <div v-if="!activeTab" class="empty-state">
      <p class="empty-title">{{ t('app.name') }}</p>
      <p class="empty-hint">{{ t('editor.emptyHint') }}</p>
    </div>
    <!-- 拖入提示层 -->
    <div v-if="dragging" class="drop-overlay">
      <div class="drop-box">{{ t('editor.dropHint') }}</div>
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
/* 分栏模式：左侧编辑器与右侧预览各占一半 */
.editor-scroll.split-left {
  flex: 1 1 50%;
  min-width: 0;
  border-right: 1px solid var(--ty-border);
}
.split-preview {
  display: flex;
  flex-direction: column;
  flex: 1 1 50%;
  min-width: 0;
  height: 100%;
  border-left: 1px solid var(--ty-border);
  background: var(--ty-bg);
  overflow: hidden;
}
.split-preview-head {
  flex: none;
  padding: 4px 12px;
  border-bottom: 1px solid var(--ty-border);
  background: var(--ty-tabbar-bg);
  color: var(--ty-muted);
  font-size: 11px;
  letter-spacing: 0.4px;
}
.split-preview-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 28px 80px;
  color: var(--editor-color);
  font-size: calc(var(--editor-font-size) * var(--editor-zoom));
  line-height: 1.7;
  word-wrap: break-word;
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
.split-preview-body :deep(a) {
  color: var(--theme-color);
}
.split-preview-body :deep(hr) {
  border: 0;
  border-top: 1px solid var(--hr-color);
  margin: 1.4em 0;
}
.muya-container {
  min-height: 100%;
  font-size: calc(var(--editor-font-size) * var(--editor-zoom));
}
.source-editor {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 40px 48px 120px;
  border: 0;
  outline: none;
  resize: none;
  font-family: var(--editor-code-font);
  font-size: calc(var(--editor-code-size) * var(--editor-zoom));
  line-height: 1.6;
  color: var(--ty-text);
  background: transparent;
  tab-size: var(--editor-tab-size);
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
.drop-box {
  padding: 18px 28px;
  border: 2px dashed var(--ty-accent);
  border-radius: 10px;
  background: var(--ty-bg);
  color: var(--ty-accent);
  font-size: 14px;
}
</style>
