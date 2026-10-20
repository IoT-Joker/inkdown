import { getActiveTab, state, persistView, createTab, closeTab } from '../store'

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
    'view:devtools': () => window.typra.toggleDevTools(),
    'app:preferences': () => {
      state.preferencesVisible = true
    },
    'app:quit': () => window.typra.quit(),
    'file:new': () => {
      createTab({ content: '' })
    },
    'file:closeTab': () => {
      if (state.activeId) closeTab(state.activeId)
    },
    'edit:find': () => {
      state.findMode = 'find'
      state.findVisible = true
    },
    'edit:replace': () => {
      state.findMode = 'replace'
      state.findVisible = true
    }
  })
}
