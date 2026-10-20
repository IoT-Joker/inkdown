import { reactive, ref } from 'vue'

export type ViewMode = 'wysiwyg' | 'source'

/** 源码模式坐标：行号与列号（与 muya 的 setCursorByOffset 一致）。 */
export interface SourcePos {
  line: number
  ch: number
}

/** 编辑器光标：两端都可能为空（例如无选区时）。 */
export interface EditorCursor {
  anchor: SourcePos | null
  focus: SourcePos | null
}

export interface Tab {
  id: string
  filePath: string | null
  title: string
  content: string
  savedContent: string
  mtimeMs: number
  /** 光标位置（源码模式行列坐标），切标签时用于恢复 */
  cursor: EditorCursor | null
  scrollTop: number
}

let tabSeq = 0
function nextId(): string {
  tabSeq += 1
  return `tab-${tabSeq}`
}

export interface OutlineItem {
  /** 标题层级 1-6 */
  level: number
  /** 标题纯文本 */
  text: string
  /** 标题 HTML（含行内标记），用于大纲中显示富文本 */
  html: string
  /** muya 生成的稳定锚点 id，用于点击跳转 */
  slug: string
  /** GitHub 风格锚点，与 HTML 导出一致 */
  githubSlug: string
}

/** 全局响应式状态：标签页、侧边栏、视图选项、设置。 */
export const state = reactive({
  tabs: [] as Tab[],
  activeId: '' as string,
  sidebarVisible: true,
  sidebarTab: 'files' as 'files' | 'outline',
  outline: [] as OutlineItem[],
  workspace: null as { path: string; name: string; children: any[] } | null,
  viewMode: 'wysiwyg' as ViewMode,
  focusMode: false,
  typewriterMode: false,
  theme: 'light' as 'light' | 'dark' | 'github' | 'newsprint' | 'night',
  zoom: 1,
  wordCount: 0,
  charCount: 0,
  findVisible: false,
  findMode: 'find' as 'find' | 'replace',
  preferencesVisible: false,
  statusMessage: '',
  /** 非阻塞提示条：用于外部改动等需要告知但不打断写作的情况 */
  notice: null as { text: string; action?: string; filePath?: string } | null,
  sourceContent: ''
})

export function getActiveTab(): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeId)
}

export function createTab(partial: Partial<Tab> = {}): Tab {
  const tab: Tab = {
    id: nextId(),
    filePath: null,
    title: '未命名',
    content: '',
    savedContent: '',
    mtimeMs: 0,
    cursor: null,
    scrollTop: 0,
    ...partial
  }
  state.tabs.push(tab)
  state.activeId = tab.id
  return tab
}

export function closeTab(id: string): void {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return
  state.tabs.splice(index, 1)
  if (state.activeId === id) {
    const next = state.tabs[index] ?? state.tabs[index - 1]
    state.activeId = next ? next.id : ''
  }
}

export function isDirty(tab: Tab | undefined): boolean {
  return !!tab && tab.content !== tab.savedContent
}

/**
 * 标签显示名：有未保存改动时在文件名后加 `*`（编辑器惯例）。
 * 未命名文档同样适用。
 */
export function tabLabel(tab: Tab | undefined): string {
  if (!tab) return ''
  return isDirty(tab) ? `${tab.title} *` : tab.title
}

export function hasUnsavedTabs(): boolean {
  return state.tabs.some((t) => isDirty(t))
}

/** 设置持久化到 localStorage，跨会话保留主题/视图偏好。 */
export const settings = reactive({
  fontSize: 16,
  lineHeight: 1.7,
  editorFontFamily: '',
  codeFontSize: 14,
  codeFontFamily: '',
  autoSave: true,
  /** 自动保存防抖延迟（毫秒） */
  autoSaveDelay: 1500,
  autoPairBracket: true,
  autoPairMarkdownSyntax: true,
  autoPairQuote: true,
  tabSize: 4,
  listIndentation: 1,
  preferLooseListItem: true,
  bulletListMarker: '-',
  orderListDelimiter: '.',
  frontMatter: true,
  superSubScript: false,
  footnote: true,
  texMathDollars: true,
  texMathGfm: true,
  texMathSingleBackslash: false,
  texMathDoubleBackslash: false,
  highlightSyntax: true,
  codeBlockLineNumbers: false,
  wrapCodeBlocks: true,
  hideQuickInsertHint: false,
  hideLinkPopup: false,
  autoCheck: true,
  spellcheckEnabled: false,
  spellcheckHideMarks: true,
  multilineBlockquote: true,
  githubAlerts: true,
  softNewlineAsSpace: false,
  autoMoveCheckedToEnd: false,
  disableHtml: false,
  mermaidTheme: 'default',
  vegaTheme: 'latimes',
  plantumlServer: 'https://www.plantuml.com/plantuml',
  sequenceTheme: 'hand' as 'hand' | 'simple'
})

const STORAGE_KEY = 'typra2-settings'

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) Object.assign(settings, JSON.parse(raw))
  } catch {
    /* 忽略损坏的设置 */
  }
  const t = localStorage.getItem('typra2-theme')
  if (t) state.theme = t as typeof state.theme
  const z = localStorage.getItem('typra2-zoom')
  if (z) state.zoom = Number(z) || 1
}

export function persistSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function persistView(): void {
  localStorage.setItem('typra2-theme', state.theme)
  localStorage.setItem('typra2-zoom', String(state.zoom))
}

/** 最近打开的文件列表，用于「文件」菜单与欢迎页。 */
export const recentFiles = ref<string[]>([])

export function pushRecent(filePath: string): void {
  const list = recentFiles.value.filter((p) => p !== filePath)
  list.unshift(filePath)
  recentFiles.value = list.slice(0, 12)
  try {
    localStorage.setItem('typra2-recent', JSON.stringify(recentFiles.value))
  } catch {
    /* ignore */
  }
}

export function loadRecent(): void {
  try {
    const raw = localStorage.getItem('typra2-recent')
    if (raw) recentFiles.value = JSON.parse(raw)
  } catch {
    /* ignore */
  }
}

/* ------------------------------ 会话恢复 ------------------------------ */

const SESSION_KEY = 'typra2-session'

/** 上次退出时打开的标签页（文件路径），重启后据此恢复。 */
export interface SessionSnapshot {
  files: string[]
  activeFile: string | null
}

/** 记录当前会话：只保存已落盘的标签，未命名文档不参与恢复。 */
export function persistSession(): void {
  try {
    const files = state.tabs.map((t) => t.filePath).filter((p): p is string => !!p)
    const active = getActiveTab()?.filePath ?? null
    localStorage.setItem(SESSION_KEY, JSON.stringify({ files, activeFile: active }))
  } catch {
    /* ignore */
  }
}

export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionSnapshot
    if (!Array.isArray(parsed.files)) return null
    return { files: parsed.files, activeFile: parsed.activeFile ?? null }
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
