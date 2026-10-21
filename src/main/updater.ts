import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { translate, type LocaleCode } from '../shared/i18n'
import { getLocale } from './locale'

/**
 * 自动更新。
 *
 * 更新源为 GitHub Releases（electron-builder 生成的 latest.yml 作为清单）。
 * 因为 GitHub 的下载通道在某些网络下不通，这里做了两件事：
 *   1. 检查更新失败不打扰用户，只在手动检查时报告原因
 *   2. 支持通过环境变量覆盖更新源（便于换镜像或自建服务器）
 *
 * 注意：未配置代码签名证书时，Windows 安装新版仍会弹 SmartScreen 警告，
 * 这是系统行为，自动更新无法绕过。
 */

/** 是否正在检查/下载，避免重复触发。 */
let busy = false

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

/**
 * 供端到端测试调用：把一段原始错误转成人话，便于验证分类逻辑。
 * 只在测试模式下暴露。
 */
export function humanizeUpdateErrorForTest(raw: string): string {
  return humanizeUpdateError(new Error(raw))
}

/** 更新源：默认 GitHub Releases，可用环境变量覆盖。 */
function configureFeed(): void {
  const custom = process.env['INKDOWN_UPDATE_URL']
  if (custom) {
    autoUpdater.setFeedURL({ provider: 'generic', url: custom })
    console.log('[updater] 使用自定义更新源:', custom)
  }
  // 未设置则用 electron-builder 写入的 publish 配置（GitHub / generic）
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
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    // 网络不通、无 Release 等都会走到这里；不弹窗，只记日志
    console.error('[updater] 更新出错:', err?.message ?? err)
  })

  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    void dialog
      .showMessageBox(win, {
        type: 'info',
        message: t('update.available'),
        detail: t('update.availableDetail', { version: info.version, current: app.getVersion() }),
        buttons: [t('update.download'), t('update.later')],
        defaultId: 0,
        cancelId: 1
      })
      .then((r) => {
        if (r.response === 0) {
          busy = true
          autoUpdater.downloadUpdate().catch((e) => {
            busy = false
            console.error('[updater] 下载失败:', e?.message ?? e)
          })
        }
      })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 已是最新版本')
  })

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] 下载中 ${Math.round(p.percent)}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    busy = false
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    void dialog
      .showMessageBox(win, {
        type: 'info',
        message: t('update.ready'),
        detail: t('update.readyDetail', { version: info.version }),
        buttons: [t('update.restart'), t('update.later')],
        defaultId: 0,
        cancelId: 1
      })
      .then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall()
      })
  })

  // 启动后稍等再检查，避免与窗口初始化抢资源
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.error('[updater] 检查更新失败:', e?.message ?? e)
    })
  }, 3000)
}

/**
 * 手动检查更新（帮助菜单）。
 * 与自动检查不同，这里会把失败原因告诉用户，避免"点了没反应"。
 */
export async function checkForUpdatesManually(): Promise<void> {
  const win = BrowserWindow.getAllWindows()[0]
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
  if (busy) {
    await dialog.showMessageBox(win, {
      type: 'info',
      message: t('update.busy'),
      buttons: [t('update.ok')]
    })
    return
  }

  busy = true
  try {
    configureFeed()
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      await dialog.showMessageBox(win, {
        type: 'warning',
        message: t('update.checkFailed'),
        detail: t('update.checkFailedDetail'),
        buttons: [t('update.ok')]
      })
    }
    // 有新版本时会触发 update-available 事件，由上面的处理器继续
  } catch (err) {
    console.error('[updater] 检查更新失败:', err)
    await dialog.showMessageBox(win, {
      type: 'warning',
      message: t('update.checkFailed'),
      // 不要把原始 HTTP 响应（含响应头与 cookie）直接展示给用户
      detail: humanizeUpdateError(err),
      buttons: [t('update.ok')]
    })
  } finally {
    busy = false
  }
}
