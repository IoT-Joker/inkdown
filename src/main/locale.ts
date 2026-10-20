import { app } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { translate, type LocaleCode } from '../shared/i18n'
// 导入即把新增词条合并进主词典（主词典由并行工作流维护）
import '../shared/i18nExtra'

/**
 * 主进程的语言状态。
 *
 * 语言偏好存在 userData 下的小文件里：主进程需要在创建菜单时就知道语言，
 * 而此时渲染层的 localStorage 还读不到。
 */

let currentLocale: LocaleCode = 'zh-CN'

function settingsFile(): string {
  return join(app.getPath('userData'), 'inkdown-locale.json')
}

/** 依据系统语言猜测默认值（首次启动时用）。 */
function detectSystemLocale(): LocaleCode {
  const sys = app.getLocale() || ''
  return sys.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** 启动时载入语言偏好。 */
export async function loadLocale(): Promise<LocaleCode> {
  try {
    const raw = await fsp.readFile(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as { locale?: LocaleCode }
    if (parsed.locale === 'zh-CN' || parsed.locale === 'en') {
      currentLocale = parsed.locale
      return currentLocale
    }
  } catch {
    /* 首次启动或文件损坏，走系统语言 */
  }
  currentLocale = detectSystemLocale()
  return currentLocale
}

export function getLocale(): LocaleCode {
  return currentLocale
}

/** 保存语言偏好。 */
export async function setLocale(locale: LocaleCode): Promise<void> {
  currentLocale = locale
  try {
    await fsp.writeFile(settingsFile(), JSON.stringify({ locale }), 'utf8')
  } catch {
    /* 写入失败不影响本次会话 */
  }
}

/** 主进程侧翻译。 */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale, key, params)
}
