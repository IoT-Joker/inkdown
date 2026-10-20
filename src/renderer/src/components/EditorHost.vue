<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { Muya, registerMuyaPlugins, buildMuyaOptions, setDocPathForImages } from '../editor/muyaSetup'
import { registerCommands, registerGlobalCommands, executeCommand, hasCommand, listCommandIds } from '../composables/useCommands'
import { exportHtml, exportPdf, buildHtmlForCheck } from '../composables/useExport'
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
  (mode) => {
    const tab = activeTab.value
    if (!tab) return
    if (mode === 'source') {
      state.sourceContent = tab.content
      nextTick(() => sourceRef.value?.focus())
    } else {
      // 源码模式改动过内容，切回所见即所得时同步
      if (state.sourceContent !== tab.content) {
        tab.content = state.sourceContent
        updateCounts(tab.content)
      }
      nextTick(() => {
        loadTab(tab)
        focus()
      })
    }
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
    'file:exportPdf': () => void exportPdf()
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
  switch (d.action) {
    case 'search':
      muya.search(d.keyword, opts)
      break
    case 'next':
      muya.find('next')
      break
    case 'previous':
      muya.find('previous')
      break
    case 'replace':
      muya.replace(d.replacement, { isSingle: true, isRegexp: d.isRegexp })
      break
    case 'replaceAll':
      muya.replace(d.replacement, { isSingle: false, isRegexp: d.isRegexp })
      break
  }
  reportMatches()
}

/** 把匹配数量回传给 FindBar 显示。 */
function reportMatches(): void {
  if (!muya) return
  const matches = (muya as unknown as { searchMatches?: unknown[] }).searchMatches
  window.dispatchEvent(
    new CustomEvent('inkdown:find-result', { detail: { count: matches?.length ?? 0 } })
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

onMounted(() => {
  registerGlobalCommands()
  mountEditor()
  registerEditorCommands()
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
})

onBeforeUnmount(() => {
  window.removeEventListener('inkdown:find', onFind)
  window.removeEventListener('inkdown:find-close', onFindClose)
  window.removeEventListener('inkdown:settings-changed', onSettingsChanged)
  muya?.destroy()
  muya = null
})

defineExpose({ focus, reloadFromTab, getMarkdown: () => muya?.getMarkdown() ?? '' })
</script>

<template>
  <div
    class="editor-host"
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
    <div v-show="!isSource" class="editor-scroll">
      <div ref="containerRef" class="muya-container" />
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
.editor-scroll,
.source-scroll {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
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
