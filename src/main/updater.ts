import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { translate, type LocaleCode } from '../shared/i18n'
import { getLocale } from './locale'

/**
 * 自动更新。
 *
 * 更新源为 GitHub Releases（electron-builder 把 latest.yml 写在 Release 里）。
 * 仓库已改为公开，因此可以匿名读取 —— 这是自动更新能工作的前提。
 *
 * 三种使用方式：
 *   1. 启动后自动检查（可在偏好设置里关闭）；发现新版本时询问用户
 *   2. 帮助 → 检查更新（手动），会明确告知「已是最新」或失败原因
 *   3. 下载完成后提示重启，由 autoInstallOnAppQuit 兜底（退出时自动安装）
 *
 * 注意：未配置代码签名证书时，Windows 安装新版仍会弹 SmartScreen 警告，
 * 这是系统行为，自动更新无法绕过。
 */

/** 当前阶段：空闲 / 检查中 / 下载中 / 已就绪。 */
type Phase = 'idle' | 'checking' | 'downloading' | 'ready'

let phase: Phase = 'idle'
/** 最近一次检查是否已有结果（用于手动检查时区分「已是最新」）。 */
let lastCheckFoundUpdate = false
/** 下载进度百分比，供状态栏/对话框展示。 */
let downloadPercent = 0

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
  configureFeed()
  // 与 initUpdater 保持一致：自检也会走这条路径
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
  // 未设置则用 electron-builder 写入的 publish 配置（GitHub）
}

/** 取当前主窗口（可能已全部关闭）。 */
function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

/** 询问是否下载新版本。 */
async function askDownload(version: string): Promise<void> {
  const win = mainWindow()
  if (!win) return
  const r = await dialog.showMessageBox(win, {
    type: 'info',
    message: t('update.available'),
    detail: t('update.availableDetail', { version, current: app.getVersion() }),
    buttons: [t('update.download'), t('update.later')],
    defaultId: 0,
    cancelId: 1
  })
  if (r.response !== 0) return

  phase = 'downloading'
  downloadPercent = 0
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    phase = 'idle'
    console.error('[updater] 下载失败:', err instanceof Error ? err.message : err)
    const w = mainWindow()
    if (w) {
      await dialog.showMessageBox(w, {
        type: 'warning',
        message: t('update.downloadFailed'),
        detail: humanizeUpdateError(err),
        buttons: [t('update.ok')]
      })
    }
  }
}

/** 询问是否重启安装。 */
async function askInstall(version: string): Promise<void> {
  const win = mainWindow()
  if (!win) return
  const r = await dialog.showMessageBox(win, {
    type: 'info',
    message: t('update.ready'),
    detail: t('update.readyDetail', { version }),
    buttons: [t('update.restart'), t('update.later')],
    defaultId: 0,
    cancelId: 1
  })
  if (r.response === 0) autoUpdater.quitAndInstall()
}

/** 初始化：仅在打包后启用（开发版没有 latest.yml，检查必然失败）。 */
export function initUpdater(): void {
  if (!app.isPackaged) {
    console.log('[updater] 开发模式，跳过自动更新')
    return
  }
  if (process.env['INKDOWN_DISABLE_UPDATE'] === '1') {
    console.log('[updater] 已通过环境变量禁用')
    return
  }

  configureFeed()
  // 先问再下，避免在用户不知情时占用带宽
  autoUpdater.autoDownload = false
  // 退出时若已下载完成则自动安装，作为「稍后」的兜底
  autoUpdater.autoInstallOnAppQuit = true
  // 禁用更新清单的缓存：electron-updater 默认会缓存 latest.yml，
  // 实测发布新版本后本机仍读到旧版本号（要手动清
  // %LOCALAPPDATA%/inkdown-updater 才能更新），
  // 这会让用户长期收不到更新提示。
  autoUpdater.requestHeaders = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache'
  }

  autoUpdater.on('error', (err) => {
    phase = 'idle'
    // 网络不通等情况不弹窗打扰，只记日志
    console.error('[updater] 更新出错:', err?.message ?? err)
  })

  autoUpdater.on('update-available', (info) => {
    lastCheckFoundUpdate = true
    phase = 'idle'
    void askDownload(info.version)
  })

  autoUpdater.on('update-not-available', () => {
    lastCheckFoundUpdate = false
    phase = 'idle'
    console.log('[updater] 已是最新版本')
  })

  autoUpdater.on('download-progress', (p) => {
    downloadPercent = Math.round(p.percent)
    // 每 10% 记一次，避免刷屏
    if (downloadPercent % 10 === 0) {
      console.log(`[updater] 下载中 ${downloadPercent}%`)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    phase = 'ready'
    void askInstall(info.version)
  })

  // 启动后稍等再检查，避免与窗口初始化抢资源。
  // 用户可在偏好设置里关闭「启动时自动检查」。
  setTimeout(() => {
    if (!shouldAutoCheck()) {
      console.log('[updater] 用户已关闭启动自动检查')
      return
    }
    void autoUpdater.checkForUpdates().catch((e) => {
      console.error('[updater] 检查更新失败:', e?.message ?? e)
    })
  }, 3000)
}

/**
 * 是否允许启动时自动检查。
 *
 * 设置存在渲染层的 localStorage，主进程读不到；
 * 因此由渲染层在设置变化时通过 IPC 同步过来。
 */
let autoCheckEnabled = true

/** 渲染层同步「启动时自动检查」开关。 */
export function setAutoCheckEnabled(enabled: boolean): void {
  autoCheckEnabled = enabled
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
export async function checkForUpdatesManually(): Promise<void> {
  const win = mainWindow()
  if (!win) return

  if (!app.isPackaged) {
    await dialog.showMessageBox(win, {
      type: 'info',
      message: t('update.devMode'),
      detail: t('update.devModeDetail'),
      buttons: [t('update.ok')]
    })
    return
  }
  if (phase === 'downloading' || phase === 'ready') {
    await dialog.showMessageBox(win, {
      type: 'info',
      message: t('update.busy'),
      detail: t('update.busyDetail', { percent: downloadPercent }),
      buttons: [t('update.ok')]
    })
    return
  }
  if (phase === 'checking') {
    return
  }

  phase = 'checking'
  lastCheckFoundUpdate = false
  try {
    configureFeed()
    const result = await autoUpdater.checkForUpdates()
    // 注意：不能在这里用 finally 把 phase 复位。
    // update-available 事件里会紧接着开始下载，
    // 提前复位会让并发保护失效（下载中又能再点检查）。
    if (result?.updateInfo && !lastCheckFoundUpdate) {
      // 没有新版本：明确告知，避免用户以为没反应
      phase = 'idle'
      const current = app.getVersion()
      await dialog.showMessageBox(win, {
        type: 'info',
        message: t('update.upToDate'),
        detail: t('update.upToDateDetail', { current }),
        buttons: [t('update.ok')]
      })
      return
    }
    // 有新版本时由 update-available 处理器继续（它负责询问与下载）
  } catch (err) {
    phase = 'idle'
    console.error('[updater] 检查更新失败:', err)
    await dialog.showMessageBox(win, {
      type: 'warning',
      message: t('update.checkFailed'),
      // 不要把原始 HTTP 响应（含响应头与 cookie）直接展示给用户
      detail: humanizeUpdateError(err),
      buttons: [t('update.ok')]
    })
  }
}

/** 供端到端自检读取当前更新状态。 */
export function getUpdateStatus(): {
  phase: Phase
  current: string
  percent: number
  autoCheck: boolean
} {
  return {
    phase,
    current: app.getVersion(),
    percent: downloadPercent,
    autoCheck: autoCheckEnabled
  }
}
