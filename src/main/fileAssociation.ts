import { app, BrowserWindow } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 文件关联与单实例支持。
 *
 * 双击 .md 文件时，Windows 会把路径作为命令行参数传给应用。
 * 需要处理两种情况：
 *   1. 应用未启动 —— 记住路径，等窗口就绪后打开
 *   2. 应用已在运行 —— 把路径转发给现有窗口（单实例），而不是开新窗口
 *
 * 注意：不能从渲染层读 process.argv。打包后渲染层是隔离的，
 * window.process 不存在；必须由主进程解析后经 IPC 下发。
 */

/** 支持的文档扩展名。 */
const DOC_EXT_RE = /\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i

/** 应用启动时待打开的文件（首次启动用）。 */
let pendingFile: string | null = null

/** 从命令行参数中挑出第一个存在的文档路径。 */
export function extractFileFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    // 跳过开关与 Electron/Chromium 的内部参数
    if (!arg || arg.startsWith('-') || arg.startsWith('--')) continue
    if (!DOC_EXT_RE.test(arg)) continue
    try {
      const abs = resolve(arg)
      if (existsSync(abs) && statSync(abs).isFile()) return abs
    } catch {
      /* 忽略无法访问的路径 */
    }
  }
  return null
}

/** 记录待打开的文件（在窗口创建前调用）。 */
export function rememberPendingFile(filePath: string | null): void {
  pendingFile = filePath
}

/** 取出并清空待打开的文件。 */
export function takePendingFile(): string | null {
  const f = pendingFile
  pendingFile = null
  return f
}

/**
 * 申请单实例锁。返回 true 表示本进程是主实例。
 *
 * 非主实例在拿到锁失败时，其命令行参数会由主实例的 second-instance 事件接收，
 * 因此这里直接退出即可——不在这里转发，避免两条路径重复处理。
 */
export function acquireSingleInstanceLock(): boolean {
  return app.requestSingleInstanceLock()
}

/** 监听第二实例启动，把文件转发给现有窗口。 */
export function onSecondInstance(openInWindow: (filePath: string) => void): void {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const file = extractFileFromArgv(argv)
    if (file) openInWindow(file)
  })
}

/** macOS 的 open-file 事件（Finder 双击）。 */
export function onOpenFileMac(openInWindow: (filePath: string) => void): void {
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (app.isReady()) openInWindow(filePath)
    else rememberPendingFile(filePath)
  })
}
