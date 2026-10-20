import { getActiveTab, state, persistView, createTab, closeTab, hasUnsavedTabs, isDirty } from '../store'
import { useFile } from './useFile'

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
    // 关闭窗口前先处理未保存内容
    'file:quit': async () => {
      if (!hasUnsavedTabs()) {
        window.typra.quit()
        return
      }
      const answer = await window.typra.messageBox('有未保存的改动', '是否保存后再退出？', [
        '保存并退出',
        '直接退出',
        '取消'
      ])
      if (answer === 0) {
        const { saveAll } = useFile()
        await saveAll()
        window.typra.quit()
      } else if (answer === 1) {
        window.typra.quit()
      }
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
