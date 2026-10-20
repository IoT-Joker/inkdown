import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

let mainWindow: BrowserWindow | null = null

/**
 * 窗口图标路径。
 * 开发时用 build/icon.png，打包后由 electron-builder 从同一目录取用。
 */
function resolveIcon(): string | undefined {
  const candidates = [
    join(process.cwd(), 'build', 'icon.png'),
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../../resources/icon.png')
  ]
  return candidates.find((p) => existsSync(p))
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * 创建主窗口。渲染进程通过 preload 暴露的 window.inkdown API 与主进程通信。
 */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 420,
    show: false,
    backgroundColor: '#ffffff',
    icon: resolveIcon(),
    // 应用内自绘菜单栏（MenuBar.vue），隐藏原生菜单栏避免重复
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // 外部链接交给系统浏览器，避免在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
