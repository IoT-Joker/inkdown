import { reactive, ref } from 'vue'
import { translate } from '../../../shared/i18n'
import { currentLocale } from '../composables/useI18n'

export type ViewMode = 'wysiwyg' | 'source' | 'split'

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

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'
  | 'dev'

export interface UpdateStatus {
  phase: UpdatePhase
  current: string
  version: string
  percent: number
  message: string
  autoCheck: boolean
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
  wysiwygColumns: false,
  focusMode: false,
  typewriterMode: false,
  theme: 'light' as 'light' | 'dark' | 'github' | 'newsprint' | 'night',
  zoom: 1,
  wordCount: 0,
  charCount: 0,
  findVisible: false,
  findMode: 'find' as 'find' | 'replace',
  /**
   * 当前查找关键词与选项。
   * 放在 store 里是为了切标签后能重新执行搜索：
   * 内核在 setContent（切标签会触发）时会 reset 搜索状态，匹配会丢失。
   */
  findKeyword: '',
  findOptions: { isRegexp: false, isCaseSensitive: false, isWholeWord: false },
  preferencesVisible: false,
  aboutVisible: false,
  shortcutsVisible: false,
  /** 全库搜索面板是否可见。 */
  folderSearchVisible: false,
  /** 命令面板是否可见。 */
  paletteVisible: false,
  statusMessage: '',
  /** 非阻塞提示条：用于外部改动等需要告知但不打断写作的情况 */
  notice: null as { text: string; action?: string; filePath?: string } | null,
  sourceContent: '',
  quitConfirmed: false,
  updateStatus: {
    phase: 'idle',
    current: '',
    version: '',
    percent: 0,
    message: '',
    autoCheck: true
  } as UpdateStatus
})

export function getActiveTab(): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeId)
}

/** 未命名标签的显示名（随界面语言）。 */
export function untitledLabel(): string {
  return translate(currentLocale.value, 'tab.untitled')
}

export function createTab(partial: Partial<Tab> = {}): Tab {  const tab: Tab = {
    id: nextId(),
    filePath: null,
    title: untitledLabel(),
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
 * 把标签 fromId 移动到 toId 之前或之后（拖拽排序）。
 * 移动后保持 fromId 仍为活动标签，避免拖拽导致焦点跳走。
 */
export function moveTab(fromId: string, toId: string, before: boolean): void {
  const from = state.tabs.findIndex((t) => t.id === fromId)
  const to = state.tabs.findIndex((t) => t.id === toId)
  if (from === -1 || to === -1 || from === to) return

  const [moved] = state.tabs.splice(from, 1)
  // 移除后目标下标可能前移一位
  let insertAt = state.tabs.findIndex((t) => t.id === toId)
  if (!before) insertAt += 1
  state.tabs.splice(insertAt, 0, moved)
  // 拖拽不改变当前编辑的文档
  state.activeId = fromId
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
  orbMenuOpacity: 0.96,
  orbFontSize: 12,
  orbAnimations: true,
  /** 存盘时使用的行尾符 */
  lineEnding: 'lf' as 'lf' | 'crlf',
  /** 源码预览：右侧预览跟随左侧源码光标滚动，把对应位置移到预览窗口中心 */
  splitSyncScroll: true,
  /** 源码预览：在右侧预览中标出光标所在的块 */
  splitHighlightBlock: true,
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
  /** 启动时自动检查应用更新（与上面内核的 autoCheck 无关）。 */
  autoCheckUpdate: true,
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

const STORAGE_KEY = 'inkdown-settings'

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) Object.assign(settings, JSON.parse(raw))
  } catch {
    /* 忽略损坏的设置 */
  }
  const t = localStorage.getItem('inkdown-theme')
  if (t) state.theme = t as typeof state.theme
  const z = localStorage.getItem('inkdown-zoom')
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
  localStorage.setItem('inkdown-theme', state.theme)
  localStorage.setItem('inkdown-zoom', String(state.zoom))
}

/** 最近打开的文件列表，用于「文件」菜单与欢迎页。 */
export const recentFiles = ref<string[]>([])

export function pushRecent(filePath: string): void {
  const list = recentFiles.value.filter((p) => p !== filePath)
  list.unshift(filePath)
  recentFiles.value = list.slice(0, 12)
  try {
    localStorage.setItem('inkdown-recent', JSON.stringify(recentFiles.value))
  } catch {
    /* ignore */
  }
}

export function loadRecent(): void {
  try {
    const raw = localStorage.getItem('inkdown-recent')
    if (raw) recentFiles.value = JSON.parse(raw)
  } catch {
    /* ignore */
  }
}

/** 清除最近打开记录。 */
export function clearRecent(): void {
  recentFiles.value = []
  try {
    localStorage.removeItem('inkdown-recent')
  } catch {
    /* ignore */
  }
}

/* ------------------------------ 会话恢复 ------------------------------ */

const SESSION_KEY = 'inkdown-session'

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

const RECOVERY_KEY = 'inkdown-recovery-v1'
export type RecoveryDraft = Pick<Tab, 'filePath' | 'title' | 'content' | 'savedContent'>

export function persistRecovery(): void {
  try {
    const drafts = state.tabs.filter(isDirty).map(({ filePath, title, content, savedContent }) => ({ filePath, title, content, savedContent }))
    if (drafts.length) localStorage.setItem(RECOVERY_KEY, JSON.stringify(drafts))
    else localStorage.removeItem(RECOVERY_KEY)
  } catch {
    // A full/unavailable browser store must not interrupt editing; the last
    // successfully written recovery snapshot remains available.
  }
}

export function loadRecovery(): RecoveryDraft[] {
  try {
    const drafts: unknown = JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? '[]')
    if (!Array.isArray(drafts)) return []
    return drafts.filter((draft): draft is RecoveryDraft => !!draft &&
      (draft.filePath === null || typeof draft.filePath === 'string') &&
      typeof draft.title === 'string' && typeof draft.content === 'string' && typeof draft.savedContent === 'string')
  } catch { return [] }
}

export function clearRecovery(): void {
  try { localStorage.removeItem(RECOVERY_KEY) } catch { /* Storage unavailable. */ }
}
