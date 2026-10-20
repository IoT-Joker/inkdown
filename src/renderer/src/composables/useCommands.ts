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
    'view:toggleSource': () => {
      state.viewMode = state.viewMode === 'wysiwyg' ? 'source' : 'wysiwyg'
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
    'app:quit': () => window.inkdown.quit(),
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
      const { confirmClose } = useFile()
      for (const tab of state.tabs) {
        if (!(await confirmClose(tab))) return
      }
      window.inkdown.quit()
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
    // 插入当前时间（marktext 的 Insert Current Time）
    'edit:insertTime': () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const text = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      window.dispatchEvent(new CustomEvent('inkdown:insert-text', { detail: { text } }))
    }
  })
}
