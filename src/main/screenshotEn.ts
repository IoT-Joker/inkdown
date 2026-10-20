/**
 * 英文界面截图：切到英文后截一张，用于人工核对。
 * 用法：electron . （带 INKDOWN_SHOT_EN=1）
 */
import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

export async function captureEnglishScreenshot(win: BrowserWindow, outDir: string): Promise<boolean> {
  win.webContents.on('console-message', (_e, level, message) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] ?? String(level)
    if (tag === 'error') console.log(`[renderer:error] ${message}`)
  })

  const ready = async (predicate: string, timeoutMs = 15000): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const ok = await win.webContents.executeJavaScript(predicate).catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }
  if (!(await ready(`!!document.querySelector('.muya-container .mu-paragraph')`))) {
    console.error('[shot] 编辑器未就绪')
    return false
  }

  const demo = await fsp.readFile(join(process.cwd(), 'examples', 'demo.md'), 'utf8')
  await win.webContents.executeJavaScript(`
    (async () => {
      const i18n = window.__inkdownI18n
      await i18n.setAppLocale('en')
      window.__inkdownLoad(${JSON.stringify(demo)})
      await new Promise((r) => setTimeout(r, 1500))
      // 打开偏好设置，展示语言下拉
      document.querySelector('.tab-settings')?.click()
      await new Promise((r) => setTimeout(r, 700))
      return true
    })()
  `)
  await new Promise((r) => setTimeout(r, 3000))

  await fsp.mkdir(outDir, { recursive: true })
  const image = await win.webContents.capturePage()
  await fsp.writeFile(join(outDir, '05-english-prefs.png'), image.toPNG())
  console.log('[shot] 已写出 05-english-prefs.png')

  // 关闭偏好设置，再截一张英文主界面
  await win.webContents.executeJavaScript(`
    (async () => {
      const btns = [...document.querySelectorAll('.dialog-foot .ty-btn')]
      const cancel = btns.find((b) => /Cancel/.test(b.textContent))
      cancel && cancel.click()
      await new Promise((r) => setTimeout(r, 600))
      return true
    })()
  `)
  await new Promise((r) => setTimeout(r, 800))
  const image2 = await win.webContents.capturePage()
  await fsp.writeFile(join(outDir, '06-english-main.png'), image2.toPNG())
  console.log('[shot] 已写出 06-english-main.png')

  // 还原中文
  await win.webContents.executeJavaScript(`window.__inkdownI18n.setAppLocale('zh-CN')`)
  console.log('[shot] PASS: 英文界面截图完成')
  return true
}
