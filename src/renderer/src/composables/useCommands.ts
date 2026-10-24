import { reactive } from 'vue'
import { getActiveTab, state, persistView, createTab, closeTab, settings, persistSettings, clearRecent } from '../store'
import { useFile } from './useFile'
import { translate } from '../../../shared/i18n'
import { currentLocale } from './useI18n'

/** 取当前语言的文案（命令中心不在组件上下文里）。 */
function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale.value, key, params)
}

type CommandHandler = (payload?: unknown) => void | Promise<void>

const handlers = new Map<string, CommandHandler>()
let quitInProgress = false

export interface CommandShortcut {
  id: string
  keys: string
}

/** 快捷键覆盖：值是 Electron accelerator；空值时回退到默认。 */
export const shortcutOverrides = reactive<Record<string, string>>({})

/** 注册命令。后注册的覆盖先注册的，方便编辑器组件接管编辑类命令。 */
export function registerCommand(id: string, handler: CommandHandler): void {
  handlers.set(id, handler)
}

export function registerCommands(map: Record<string, CommandHandler>): void {
  for (const [id, handler] of Object.entries(map)) handlers.set(id, handler)
}

/** 执行命令；未注册时静默忽略，避免菜单点了没反应却报错。 */
export async function executeCommand(id: string, payload?: unknown): Promise<void> {
  const handler = handlers.get(id)
  if (handler) await handler(payload)
}

/** 命令是否已注册（自检用）。 */
export function hasCommand(id: string): boolean {
  return handlers.has(id)
}

/** 已注册命令 id 列表（自检用）。 */
export function listCommandIds(): string[] {
  return [...handlers.keys()].sort()
}

/** 默认快捷键表；命令中心不依赖菜单组件。 */
export const DEFAULT_SHORTCUTS: CommandShortcut[] = [
  { id: 'file:new', keys: 'Ctrl+N' },
  { id: 'file:open', keys: 'Ctrl+O' },
  { id: 'file:openFolder', keys: 'Ctrl+Shift+O' },
  { id: 'file:save', keys: 'Ctrl+S' },
  { id: 'file:saveAs', keys: 'Ctrl+Shift+S' },
  { id: 'file:closeTab', keys: 'Ctrl+W' },
  { id: 'app:preferences', keys: 'Ctrl+,' },
  { id: 'edit:undo', keys: 'Ctrl+Z' },
  { id: 'edit:redo', keys: 'Ctrl+Shift+Z' },
  { id: 'edit:pastePlain', keys: 'Ctrl+Shift+V' },
  { id: 'edit:find', keys: 'Ctrl+F' },
  { id: 'edit:replace', keys: 'Ctrl+H' },
  { id: 'edit:findInFolder', keys: 'Ctrl+Shift+F' },
  { id: 'paragraph:h1', keys: 'Ctrl+1' },
  { id: 'paragraph:h2', keys: 'Ctrl+2' },
  { id: 'paragraph:h3', keys: 'Ctrl+3' },
  { id: 'paragraph:h4', keys: 'Ctrl+4' },
  { id: 'paragraph:h5', keys: 'Ctrl+5' },
  { id: 'paragraph:h6', keys: 'Ctrl+6' },
  { id: 'paragraph:p', keys: 'Ctrl+0' },
  { id: 'paragraph:ul', keys: 'Ctrl+Shift+8' },
  { id: 'paragraph:ol', keys: 'Ctrl+Shift+7' },
  { id: 'paragraph:task', keys: 'Ctrl+Shift+9' },
  { id: 'paragraph:quote', keys: 'Ctrl+Shift+Q' },
  { id: 'paragraph:code', keys: 'Ctrl+Shift+K' },
  { id: 'paragraph:math', keys: 'Ctrl+Shift+M' },
  { id: 'format:strong', keys: 'Ctrl+B' },
  { id: 'format:emphasis', keys: 'Ctrl+I' },
  { id: 'format:underline', keys: 'Ctrl+U' },
  { id: 'format:strike', keys: 'Alt+Shift+5' },
  { id: 'format:inlineCode', keys: 'Ctrl+Shift+`' },
  { id: 'format:highlight', keys: 'Ctrl+Shift+H' },
  { id: 'format:inlineMath', keys: 'Ctrl+Shift+E' },
  { id: 'format:link', keys: 'Ctrl+L' },
  { id: 'format:image', keys: 'Ctrl+Shift+I' },
  { id: 'format:clear', keys: 'Ctrl+\\' },
  { id: 'view:toggleSidebar', keys: 'Ctrl+Shift+L' },
  { id: 'view:toggleOutline', keys: 'Ctrl+Shift+1' },
  { id: 'view:toggleSource', keys: 'Ctrl+/' },
  { id: 'view:toggleFocus', keys: 'F8' },
  { id: 'view:toggleTypewriter', keys: 'F9' },
  { id: 'view:zoomIn', keys: 'Ctrl+=' },
  { id: 'view:zoomOut', keys: 'Ctrl+-' },
  { id: 'view:zoomReset', keys: 'Ctrl+Shift+0' },
  { id: 'view:fullscreen', keys: 'F11' },
  { id: 'view:devtools', keys: 'F12' },
  { id: 'app:commandPalette', keys: 'Ctrl+Shift+P' },
  { id: 'help:shortcuts', keys: 'Ctrl+Shift+/' }
]

export const SHORTCUT_STORAGE_KEY = 'inkdown-shortcuts'

export function shortcutFor(id: string): string {
  return shortcutOverrides[id] ?? DEFAULT_SHORTCUTS.find((item) => item.id === id)?.keys ?? ''
}

/** 界面提示用的快捷键文本：持久化和菜单仍使用 Electron accelerator。 */
export function displayShortcutFor(id: string): string {
  return shortcutFor(id).replace(/CmdOrCtrl/g, 'Ctrl').replace(/Cmd/g, 'Win')
}

/**
 * 命令显示名的 i18n 词条。
 *
 * 多数命令遵循 menu.<group>.<action> 规则，但应用设置、命令面板、
 * 帮助等命令不在 menu 命名空间下，必须显式映射；快捷键冲突提示和
 * 命令面板共用这份映射，避免显示内部 id。
 */
const COMMAND_LABEL_KEYS: Record<string, string> = {
  'app:commandPalette': 'palette.title',
  'app:preferences': 'menu.file.preferences',
  'app:quit': 'menu.file.quit',
  'edit:findInFolder': 'search.folder',
  'edit:duplicate': 'menu.edit.duplicate',
  'edit:insertParagraph': 'menu.edit.insertParagraphBefore',
  'edit:deleteParagraph': 'menu.edit.deleteParagraph',
  'edit:lineEnding': 'menu.edit.lineEnding',
  'edit:insertTime': 'menu.edit.insertTime',
  'edit:copyMarkdown': 'menu.edit.copyMarkdown',
  'edit:copyHtml': 'menu.edit.copyHtml',
  'edit:pastePlain': 'menu.edit.pastePlain',
  'view:toggleSplit': 'view.splitPreview',
  'view:toggleColumns': 'view.continuousColumns',
  'view:toggleTheme': 'menu.view.toggleTheme',
  'theme:cycle': 'menu.view.toggleTheme',
  'view:zoomIn': 'menu.view.zoomIn',
  'view:zoomOut': 'menu.view.zoomOut',
  'view:zoomReset': 'menu.view.zoomReset',
  'view:fullscreen': 'menu.view.fullscreen',
  'view:devtools': 'menu.view.devtools',
  'help:about': 'menu.help.about',
  'help:shortcuts': 'menu.help.shortcuts',
  'help:repo': 'menu.help.repo',
  'help:feedback': 'menu.help.feedback',
  'help:checkUpdate': 'menu.help.update',
  'file:openRecent': 'menu.file.recent',
  'file:clearRecent': 'menu.file.clearRecent',
  'file:saveAll': 'menu.file.save'
}

/** 取命令显示名对应的 i18n 词条；没有专用映射时按 menu group/action 推导。 */
export function commandLabelKey(id: string): string {
  const explicit = COMMAND_LABEL_KEYS[id]
  if (explicit) return explicit
  const separator = id.indexOf(':')
  if (separator === -1) return id
  return `menu.${id.slice(0, separator)}.${id.slice(separator + 1)}`
}

export function loadShortcutOverrides(): void {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0 && value.length <= 80) shortcutOverrides[id] = value
    }
  } catch {
    /* 损坏的快捷键配置回退默认值。 */
  }
}

export function persistShortcutOverrides(): void {
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcutOverrides))
  } catch {
    /* 存储不可用时仍可在本次会话使用。 */
  }
  void window.inkdown.setShortcutOverrides({ ...shortcutOverrides })
}

export function restoreDefaultShortcuts(): void {
  for (const key of Object.keys(shortcutOverrides)) delete shortcutOverrides[key]
  persistShortcutOverrides()
}

/** 从键盘事件生成 Electron accelerator，并返回便于展示的文本。 */
export interface CapturedShortcut {
  accelerator: string
  display: string
}

export function captureShortcut(event: KeyboardEvent): CapturedShortcut | null {
  const key = event.key
  if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(key)) return null

  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.metaKey) modifiers.push('Cmd')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')

  // Use the physical key where possible so punctuation does not change when
  // Shift is held (`Ctrl+Shift+/` can arrive as `event.key === "?"`).
  const code = event.code
  let acceleratorKey = ''
  let displayKey = ''
  if (key === ' ') {
    acceleratorKey = 'Space'
    displayKey = 'Space'
  } else if (key === 'ArrowUp') {
    acceleratorKey = 'Up'
    displayKey = '↑'
  } else if (key === 'ArrowDown') {
    acceleratorKey = 'Down'
    displayKey = '↓'
  } else if (key === 'ArrowLeft') {
    acceleratorKey = 'Left'
    displayKey = '←'
  } else if (key === 'ArrowRight') {
    acceleratorKey = 'Right'
    displayKey = '→'
  } else if (code === 'Backquote') {
    acceleratorKey = '`'
    displayKey = '`'
  } else if (code === 'Minus') {
    acceleratorKey = '-'
    displayKey = '-'
  } else if (code === 'Equal') {
    acceleratorKey = '='
    displayKey = '='
  } else if (code === 'BracketLeft') {
    acceleratorKey = '['
    displayKey = '['
  } else if (code === 'BracketRight') {
    acceleratorKey = ']'
    displayKey = ']'
  } else if (code === 'Backslash') {
    acceleratorKey = '\\'
    displayKey = '\\'
  } else if (code === 'Semicolon') {
    acceleratorKey = ';'
    displayKey = ';'
  } else if (code === 'Quote') {
    acceleratorKey = "'"
    displayKey = "'"
  } else if (code === 'Comma') {
    acceleratorKey = ','
    displayKey = ','
  } else if (code === 'Period') {
    acceleratorKey = '.'
    displayKey = '.'
  } else if (code === 'Slash') {
    acceleratorKey = '/'
    displayKey = '/'
  } else if (key.length === 1) {
    acceleratorKey = /[a-z]/i.test(key) ? key.toUpperCase() : key
    displayKey = acceleratorKey
  } else if (/^F\d{1,2}$/.test(key)) {
    acceleratorKey = key
    displayKey = key
  } else if (['Enter', 'Escape', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Insert', 'Backspace'].includes(key)) {
    acceleratorKey = key
    displayKey = key
  } else {
    acceleratorKey = key
    displayKey = key
  }

  // 单独一个普通字符不形成有效快捷键；至少要有修饰键或功能键。
  if (!modifiers.length && !/^F\d{1,2}$/.test(acceleratorKey)) return null
  return {
    accelerator: [...modifiers, acceleratorKey].join('+'),
    display: [...modifiers, displayKey].join('+')
  }
}

/** 快捷键持久化后由 App 挂载一次全局键盘分发。 */
export function installShortcutDispatcher(): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    const captured = captureShortcut(event)
    if (!captured) return
    const target = event.target as HTMLElement | null
    // 输入框/可编辑正文里的普通快捷键交给编辑器；只有带 Ctrl/Meta/Alt 或功能键
    // 的全局快捷键在这里接管，避免吞掉用户正在输入的字符。
    const inEditable =
      target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') != null
    if (inEditable && !/Ctrl\+|Cmd\+|Alt\+|^F\d+/.test(captured.accelerator)) return
    const match = DEFAULT_SHORTCUTS.find((item) => shortcutFor(item.id) === captured.accelerator)
    if (!match) return
    event.preventDefault()
    void executeCommand(match.id)
  }
  window.addEventListener('keydown', onKeydown)
  return () => window.removeEventListener('keydown', onKeydown)
}

/** 全局视图类命令，与编辑器无关，应用启动时注册一次。 */
export function registerGlobalCommands(): void {
  registerCommands({
    'view:toggleSidebar': () => {
      state.sidebarVisible = !state.sidebarVisible
    },
    'view:toggleOutline': () => {
      state.sidebarVisible = true
      state.sidebarTab = state.sidebarTab === 'outline' ? 'files' : 'outline'
    },
    // 三种视图循环：所见即所得 → 源码预览 → 纯源码 → 回到所见即所得
    'view:toggleSource': () => {
      const order = ['wysiwyg', 'split', 'source'] as const
      const i = order.indexOf(state.viewMode as (typeof order)[number])
      state.viewMode = order[(i + 1) % order.length]
    },
    // 直接切到源码预览（与纯源码模式互斥）
    'view:toggleSplit': () => {
      state.viewMode = state.viewMode === 'split' ? 'wysiwyg' : 'split'
    },
    'view:toggleColumns': () => {
      state.viewMode = 'wysiwyg'
      state.wysiwygColumns = !state.wysiwygColumns
    },
    'view:toggleFocus': () => {
      state.focusMode = !state.focusMode
    },
    'view:toggleTypewriter': () => {
      state.typewriterMode = !state.typewriterMode
    },
    'view:toggleTheme': () => {
      const order: Array<typeof state.theme> = ['light', 'dark', 'github', 'newsprint', 'night']
      const i = order.indexOf(state.theme)
      state.theme = order[(i + 1) % order.length]
      persistView()
    },
    // Used by the quick-action ring where a command-like id is convenient.
    'theme:cycle': () => executeCommand('view:toggleTheme'),
    'view:zoomIn': () => {
      state.zoom = Math.min(2, Number((state.zoom + 0.1).toFixed(2)))
      persistView()
    },
    'view:zoomOut': () => {
      state.zoom = Math.max(0.6, Number((state.zoom - 0.1).toFixed(2)))
      persistView()
    },
    'view:zoomReset': () => {
      state.zoom = 1
      persistView()
    },
    'view:devtools': () => window.inkdown.toggleDevTools(),
    // 全屏切换：先问主进程当前状态，再取反设置
    'view:fullscreen': async () => {
      const wasFull = await window.inkdown.isFullScreen()
      await window.inkdown.setFullScreen(!wasFull)
    },
    'app:preferences': () => {
      state.preferencesVisible = true
    },
    // 全库搜索：需要先打开一个文件夹作为搜索范围
    'edit:findInFolder': () => {
      if (!state.workspace) {
        state.notice = { text: t('search.folderNoFolder') }
        return
      }
      state.folderSearchVisible = true
    },
    // 命令面板
    'app:commandPalette': () => {
      state.paletteVisible = true
    },
    // 帮助菜单
    'help:about': () => {
      state.aboutVisible = true
    },
    'help:shortcuts': () => {
      state.shortcutsVisible = true
    },
    'help:repo': () => {
      void window.inkdown.openExternal('https://github.com/IoT-Joker/inkdown')
    },
    'help:feedback': () => {
      void window.inkdown.openExternal('https://github.com/IoT-Joker/inkdown/issues')
    },
    'help:checkUpdate': () => {
      void window.inkdown.checkForUpdates()
    },
    'app:quit': () => executeCommand('file:quit'),
    // 最近打开：由菜单传文件路径进来
    'file:openRecent': async (payload?: unknown) => {
      const filePath = typeof payload === 'string' ? payload : ''
      if (!filePath) return
      const { openPath } = useFile()
      await openPath(filePath)
    },
    'file:clearRecent': () => {
      clearRecent()
    },
    'file:new': () => {
      createTab({ content: '' })
    },
    'file:closeTab': async () => {
      const tab = getActiveTab()
      if (!tab) return
      const { confirmClose } = useFile()
      // 关闭前按惯例询问是否保存；用户取消则中止
      if (!(await confirmClose(tab))) return
      closeTab(tab.id)
    },
    // 文件读写命令：这些是菜单与快捷键的主入口，必须注册，否则 Ctrl+O/Ctrl+S 会静默失效
    'file:open': async () => {
      const { openDialog } = useFile()
      await openDialog()
    },
    'file:openFolder': async () => {
      const { openFolder } = useFile()
      await openFolder()
    },
    'file:save': async () => {
      const { saveTab } = useFile()
      await saveTab()
    },
    'file:saveAs': async () => {
      const { saveTab } = useFile()
      await saveTab(getActiveTab(), true)
    },
    'file:saveAll': async () => {
      const { saveAll } = useFile()
      await saveAll()
    },
    // 退出前逐个确认未保存的标签，用户取消则整体中止
    'file:quit': async () => {
      if (quitInProgress) return
      quitInProgress = true
      const { confirmClose } = useFile()
      try {
        for (const tab of state.tabs) {
          if (!(await confirmClose(tab))) return
        }
        state.quitConfirmed = true
        await window.inkdown.quit()
      } finally {
        quitInProgress = false
      }
    },
    'edit:find': () => {
      state.findMode = 'find'
      state.findVisible = true
    },
    'edit:replace': () => {
      state.findMode = 'replace'
      state.findVisible = true
    },
    // 换行符：只改存盘与显示用的行尾，不影响编辑器内部（编辑器统一用 \n）
    'edit:lineEnding': async (payload?: unknown) => {
      const mode = payload === 'crlf' ? 'crlf' : 'lf'
      settings.lineEnding = mode
      persistSettings()
      // 仅当标签已有磁盘路径时才立即按新行尾写盘；
      // 未保存过的文档只改设置，等用户首次保存时生效（避免弹出保存对话框）
      const tab = getActiveTab()
      if (tab?.filePath) {
        const { saveTab } = useFile()
        await saveTab(tab)
      }
      state.notice = { text: t('notice.lineEndingChanged', { mode: mode.toUpperCase() }) }
    },
    // 插入当前时间
    'edit:insertTime': () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const text = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      window.dispatchEvent(new CustomEvent('inkdown:insert-text', { detail: { text } }))
    }
  })
}
