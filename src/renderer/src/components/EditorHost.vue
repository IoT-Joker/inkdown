<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { Muya, registerMuyaPlugins, buildMuyaOptions, setDocPathForImages } from '../editor/muyaSetup'
import { registerCommands, registerGlobalCommands } from '../composables/useCommands'
import { exportHtml, exportPdf, buildHtmlForCheck } from '../composables/useExport'

// 供主进程端到端自检调用
;(window as unknown as Record<string, unknown>).__typraExport = { buildHtmlForCheck }
import { getActiveTab, isDirty, state, settings, type Tab } from '../store'
import { baseName } from '../composables/useFile'

const containerRef = ref<HTMLElement | null>(null)
const sourceRef = ref<HTMLTextAreaElement | null>(null)
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
    const scroller = containerRef.value?.closest('.editor-scroll') as HTMLElement | null
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
  const scroller = containerRef.value?.closest('.editor-scroll') as HTMLElement | null
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

/** 打字机模式：让光标所在块保持在视口垂直中心附近。 */
function keepCursorCentered(): void {
  const scroller = containerRef.value?.closest('.editor-scroll') as HTMLElement | null
  if (!scroller) return
  const sel = document.getSelection()
  if (!sel || !sel.rangeCount) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (!rect.height && !rect.top) return
  const scrollerRect = scroller.getBoundingClientRect()
  const target = scroller.scrollTop + (rect.top - scrollerRect.top) - scrollerRect.height / 2
  scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
}

function mountEditor(): void {
  const el = containerRef.value
  if (!el) return
  registerMuyaPlugins()
  const tab = activeTab.value
  setDocPathForImages(tab?.filePath ?? null)
  muya = new Muya(el, buildMuyaOptions({ markdown: tab?.content ?? '' }))
  muya.init()

  // 暴露实例供主进程端到端自检使用（TYPRA2_SELF_CHECK 时才有意义）
  ;(window as unknown as Record<string, unknown>).__typraMuya = muya

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
  const files = await window.typra.openFileDialog()
  const src = files[0]?.filePath
  if (!src) return
  const docPath = activeTab.value?.filePath ?? null
  const finalSrc = await window.typra.copyImage(docPath, src)
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
    new CustomEvent('typra:find-result', { detail: { count: matches?.length ?? 0 } })
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

onMounted(() => {
  registerGlobalCommands()
  mountEditor()
  registerEditorCommands()
  window.addEventListener('typra:find', onFind)
  window.addEventListener('typra:find-close', onFindClose)
  window.addEventListener('typra:settings-changed', onSettingsChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener('typra:find', onFind)
  window.removeEventListener('typra:find-close', onFindClose)
  window.removeEventListener('typra:settings-changed', onSettingsChanged)
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
      <p class="empty-title">Typra2</p>
      <p class="empty-hint">按 Ctrl+N 新建文档，或 Ctrl+O 打开文件</p>
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
</style>
