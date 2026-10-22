import { app, crashReporter, type BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 2 * 1024 * 1024
let logPath = ''
let consoleWindowStart = 0
let consoleCount = 0

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

export function logDiagnostic(event: string, detail: unknown): void {
  try {
    if (!logPath) {
      const dir = join(app.getPath('userData'), 'logs')
      mkdirSync(dir, { recursive: true })
      logPath = join(dir, 'diagnostics.log')
    }
    if (existsSync(logPath) && statSync(logPath).size >= MAX_LOG_BYTES) {
      rmSync(logPath + '.1', { force: true })
      renameSync(logPath, logPath + '.1')
    }
    appendFileSync(logPath, `${new Date().toISOString()} [${event}] ${describe(detail).slice(0, 12000)}\n`, 'utf8')
  } catch {
    // Diagnostics must never turn an I/O error into another uncaught error.
  }
}

export function installDiagnostics(): void {
  // Observe fatal exceptions without suppressing Node's normal exit behavior.
  process.on('uncaughtExceptionMonitor', (error, origin) => logDiagnostic(origin, error))
  app.on('render-process-gone', (_event, contents, details) => {
    logDiagnostic('render-process-gone', { id: contents.id, ...details })
  })
  app.on('child-process-gone', (_event, details) => logDiagnostic('child-process-gone', details))
  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_event, _path, error) => logDiagnostic('preload-error', error))
    contents.on('console-message', (_event, level, message, line, source) => {
      if (level < 3) return
      const now = Date.now()
      if (now - consoleWindowStart > 60000) { consoleWindowStart = now; consoleCount = 0 }
      if (consoleCount++ < 60) logDiagnostic('renderer-error', `${message}\n${source}:${line}`)
    })
  })
  app.on('quit', (_event, code) => logDiagnostic('quit', { code }))
  try {
    crashReporter.start({ uploadToServer: false })
  } catch (error) {
    logDiagnostic('crash-reporter-error', error)
  }
  logDiagnostic('start', { version: app.getVersion(), electron: process.versions.electron, pid: process.pid })
}

export function observeWindow(win: BrowserWindow): void {
  win.on('unresponsive', () => logDiagnostic('unresponsive', { id: win.id }))
  win.on('responsive', () => logDiagnostic('responsive', { id: win.id }))
}
