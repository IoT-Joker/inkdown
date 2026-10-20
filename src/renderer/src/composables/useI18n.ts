import { ref, computed } from 'vue'
import { translate, LOCALE_LABELS, type LocaleCode } from '../../../shared/i18n'
// 导入即把本批新增词条合并进主词典（主词典由并行工作流维护，此处不改动它）
import '../../../shared/i18nExtra'

/**
 * 渲染层 i18n。
 *
 * 语言偏好由主进程持有（菜单需要在渲染层就绪前就知道语言），
 * 这里启动时从主进程读一次，切换时写回主进程并重建菜单。
 */

const locale = ref<LocaleCode>('zh-CN')
/** 触发重新渲染的版本号：translate 依赖它才能被 Vue 追踪 */
const version = ref(0)

export const currentLocale = computed(() => locale.value)
export const localeLabel = computed(() => LOCALE_LABELS[locale.value])
export const localeOptions = Object.entries(LOCALE_LABELS).map(([value, label]) => ({
  value: value as LocaleCode,
  label
}))

/** 启动时从主进程读取语言偏好。 */
export async function initLocale(): Promise<void> {
  try {
    const l = await window.inkdown.getLocale()
    if (l === 'zh-CN' || l === 'en') locale.value = l
  } catch {
    /* 读取失败则用默认值 */
  }
  version.value += 1
}

/** 切换语言：写回主进程（同时重建菜单）并刷新界面。 */
export async function setAppLocale(next: LocaleCode): Promise<void> {
  locale.value = next
  version.value += 1
  try {
    await window.inkdown.setLocale(next)
  } catch {
    /* 持久化失败不影响本次会话 */
  }
}

/**
 * 翻译。用法：t('menu.file') 或 t('status.line', { n: 3 })。
 *
 * 注意：函数体内读取 version.value，让 Vue 把使用它的模板
 * 登记为依赖，语言切换时自动重新渲染。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  version.value
  return translate(locale.value, key, params)
}

/** 模板里直接当方法用（避免每个组件都 import 一次 t）。 */
export function useI18n() {
  return { t, locale: currentLocale, localeLabel, localeOptions, setAppLocale }
}

// 暴露给主进程端到端自检，用于验证语言切换
;(window as unknown as Record<string, unknown>).__inkdownI18n = {
  setAppLocale,
  current: () => locale.value
}
