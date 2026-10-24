import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import packageInfo from '../../package.json'
import { translate, type LocaleCode } from '../shared/i18n'
import { getLocale } from './locale'

/**
 * 自动更新。
 *
 * 更新源为 GitHub Releases（electron-builder 把 latest.yml 写在 Release 里）。
 * 仓库已改为公开，因此可以匿名读取 —— 这是自动更新能工作的前提。
 *
 * 使用方式：
 *   1. 启动后自动检查（可在偏好设置里关闭）
 *   2. 帮助 → 检查更新，状态直接在界面内显示
 *   3. 用户手动下载并在就绪后重启安装；退出时也会自动安装已下载的更新
 *
 * 注意：未配置代码签名证书时，Windows 安装新版仍会弹 SmartScreen 警告，
 * 这是系统行为，自动更新无法绕过。
 */

/** 更新阶段。 */
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

let phase: UpdatePhase = 'idle'
let availableVersion = ''
let downloadPercent = 0
let message = ''
let initialized = false
let autoCheckEnabled = true

function t(key: string, params?: Record<string, string | number>): string {
  return translate(getLocale() as LocaleCode, key, params)
}

/**
 * 把更新器抛出的原始错误转成用户看得懂的一句话。
 *
 * electron-updater 的报错里会带上完整 HTTP 响应（含响应头与 cookie），
 * 直接展示既难读又有信息泄露风险，这里按状态码归成几类。
 */
function humanizeUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/\b404\b/.test(raw)) {
    return t('update.err404')
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|timeout/i.test(raw)) {
    return t('update.errNetwork')
  }
  if (/\b401\b|\b403\b/.test(raw)) {
    return t('update.errAuth')
  }
  // 兜底：只保留第一行，避免把整段响应头糊到用户脸上
  const firstLine = raw.split('\n')[0].trim()
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine
}

/** 供端到端测试调用：把一段原始错误转成人话，便于验证分类逻辑。 */
export function humanizeUpdateErrorForTest(raw: string): string {
  return humanizeUpdateError(new Error(raw))
}

/** 更新源：默认 GitHub Releases，可用环境变量覆盖。 */
export function configureUpdaterFeed(): void {
  // Development may read release metadata, but must never download or install.
  autoUpdater.forceDevUpdateConfig = !app.isPackaged
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = app.isPackaged
  configureFeed()
  autoUpdater.requestHeaders = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache'
  }
}

/** 供自检直接驱动更新器。 */
export { autoUpdater }

/** 更新源：默认 GitHub Releases，可用环境变量覆盖。 */
function configureFeed(): void {
  const custom = process.env['INKDOWN_UPDATE_URL']
  if (custom) {
    autoUpdater.setFeedURL({ provider: 'generic', url: custom })
    console.log('[updater] 使用自定义更新源:', custom)
  }
  else if (!app.isPackaged) {
    // Development has no app-update.yml. Reuse the builder's GitHub feed in memory
    // rather than creating dev-app-update.yml or maintaining a second release URL.
    const feed = packageInfo.build.publish.find((entry) => entry.provider === 'github')
    if (!feed) throw new Error(t('update.feedMissing'))
    autoUpdater.setFeedURL({ ...feed, provider: 'github' })
  }
  // Packaged builds retain electron-builder's app-update.yml configuration.
}

function currentStatus(): UpdateStatus {
  return {
    phase,
    current: app.getVersion(),
    version: availableVersion,
    percent: downloadPercent,
    message,
    autoCheck: autoCheckEnabled
  }
}

/** 向所有窗口广播状态；渲染层只据此更新，不在主进程弹窗。 */
function publish(): void {
  const status = currentStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  }
}

function setState(
  next: UpdatePhase,
  patch: Partial<Pick<UpdateStatus, 'version' | 'percent' | 'message'>> = {}
): void {
  phase = next
  if (patch.version !== undefined) availableVersion = patch.version
  if (patch.percent !== undefined) downloadPercent = Math.max(0, Math.min(100, patch.percent))
  if (patch.message !== undefined) message = patch.message
  publish()
}

/** 初始化状态订阅；开发版允许手动只读检查，打包版还支持自动检查和安装。 */
export function initUpdater(): void {
  if (initialized) return
  initialized = true

  configureUpdaterFeed()

  autoUpdater.on('error', (err) => {
    console.error('[updater] 更新出错:', err?.message ?? err)
    if (phase === 'checking') {
      setState('error', { message: humanizeUpdateError(err) })
    } else if (phase === 'downloading') {
      setState('error', {
        percent: downloadPercent,
        message: `${t('update.downloadFailed')}: ${humanizeUpdateError(err)}`
      })
    } else if (phase === 'ready') {
      setState('ready', { message: `${t('update.installFailed')}: ${humanizeUpdateError(err)}` })
    }
  })

  autoUpdater.on('update-available', (info) => {
    setState('available', { version: info.version, percent: 0, message: '' })
  })

  autoUpdater.on('update-not-available', (info) => {
    setState('up-to-date', { version: info.version, percent: 0, message: '' })
  })

  autoUpdater.on('download-progress', (p) => {
    if (!Number.isFinite(p.percent)) return
    const percent = Math.round(p.percent)
    if (phase !== 'downloading' || percent === downloadPercent) return
    setState('downloading', { percent })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (!app.isPackaged) return
    setState('ready', { version: info.version, percent: 100, message: '' })
  })

  // Development checks are explicit; do not fetch on every hot-reload/launch.
  if (app.isPackaged && process.env['INKDOWN_DISABLE_UPDATE'] !== '1') {
    setTimeout(() => {
      if (shouldAutoCheck()) void checkForUpdatesManually()
    }, 3000)
  }

  publish()
}

/**
 * 是否允许启动时自动检查。
 *
 * 设置存在渲染层的 localStorage，主进程读不到；
 * 因此由渲染层在设置变化时通过 IPC 同步过来。
 */
/** 渲染层同步「启动时自动检查」开关。 */
export function setAutoCheckEnabled(enabled: boolean): void {
  autoCheckEnabled = enabled
  publish()
}

function shouldAutoCheck(): boolean {
  return autoCheckEnabled
}

/**
 * 手动检查更新（帮助菜单）。
 *
 * 与启动自动检查不同：这里一定会给用户明确结果 ——
 * 有新版本、已是最新、或失败原因，不会「点了没反应」。
 */
export async function checkForUpdatesManually(): Promise<UpdateStatus> {
  // A second check must not hide the action for an already downloaded update.
  if (phase === 'checking' || phase === 'downloading' || phase === 'ready') return currentStatus()

  setState('checking', { version: '', percent: 0, message: '' })
  try {
    configureUpdaterFeed()
    const result = await autoUpdater.checkForUpdates()
    if (!result?.updateInfo) {
      setState('error', { message: t('update.checkFailedDetail') })
    } else if ((phase as UpdatePhase) === 'checking') {
      // Preserve the updater's version comparison even if an event is absent.
      setState(result.isUpdateAvailable ? 'available' : 'up-to-date', {
        version: result.updateInfo.version
      })
    }
  } catch (err) {
    console.error('[updater] 检查更新失败:', err)
    setState('error', { message: humanizeUpdateError(err) })
  }
  return currentStatus()
}

/** 开始下载已发现的更新。 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    if (phase === 'available') setState('available', { message: t('update.devDownloadOnly') })
    return currentStatus()
  }
  if (phase !== 'available' || !availableVersion) return currentStatus()
  setState('downloading', { percent: 0, message: '' })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    console.error('[updater] 下载失败:', err)
    setState('error', {
      message: `${t('update.downloadFailed')}: ${humanizeUpdateError(err)}`
    })
  }
  return currentStatus()
}

/** 重启并安装当前已下载的更新。 */
export function restartToUpdate(): boolean {
  if (!app.isPackaged || phase !== 'ready') return false
  try {
    setState('ready', { message: '' })
    autoUpdater.quitAndInstall(false, true)
    return !message
  } catch (err) {
    setState('ready', { message: `${t('update.installFailed')}: ${humanizeUpdateError(err)}` })
    return false
  }
}

/** 供端到端自检读取当前更新状态。 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus()
}
