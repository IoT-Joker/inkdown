import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'

/**
 * 截图模式：把演示文档灌入编辑器，等渲染稳定后分别截图并写出 PNG。
 * 通过 TYPRA2_SCREENSHOT=<输出目录> 触发，用于人工核对界面效果。
 */
export async function captureScreenshots(win: BrowserWindow, outDir: string): Promise<boolean> {
  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${['verbose', 'info', 'warning', 'error'][level] ?? level}] ${message}`)
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

  // 灌入演示文档
  const demo = await fsp.readFile('E:\\Desktop\\JX\\07-DSH\\02-typra2\\examples\\demo.md', 'utf8')
  await win.webContents.executeJavaScript(`
    (async () => {
      const muya = window.__typraMuya
      muya.setContent(${JSON.stringify(demo)}, false)
      await new Promise((r) => setTimeout(r, 1200))
      return true
    })()
  `)

  // 等图表与公式渲染完成
  await new Promise((r) => setTimeout(r, 4000))

  await fsp.mkdir(outDir, { recursive: true })
  const shoot = async (name: string): Promise<void> => {
    const image = await win.webContents.capturePage()
    await fsp.writeFile(`${outDir}\\${name}.png`, image.toPNG())
    console.log(`[shot] 已写出 ${name}.png`)
  }

  await shoot('01-wysiwyg')

  // 大纲面板
  await win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('.sidebar-tab')]
      const outline = btns.find((b) => b.textContent.includes('大纲'))
      outline && outline.click()
      return true
    })()
  `)
  await new Promise((r) => setTimeout(r, 600))
  await shoot('02-outline')

  // 深色主题
  await win.webContents.executeJavaScript(`
    (() => {
      document.body.className = document.body.className.replace(/theme-[a-z]+/g, '').trim()
      document.body.classList.add('theme-dark')
      return true
    })()
  `)
  await new Promise((r) => setTimeout(r, 600))
  await shoot('03-dark')

  // 源码模式
  await win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('.status-btn')]
      const src = btns.find((b) => b.textContent.includes('所见即所得'))
      src && src.click()
      return true
    })()
  `)
  await new Promise((r) => setTimeout(r, 800))
  await shoot('04-source')

  // 恢复浅色与所见即所得
  await win.webContents.executeJavaScript(`
    (() => {
      document.body.className = document.body.className.replace(/theme-[a-z]+/g, '').trim()
      document.body.classList.add('theme-light')
      const btns = [...document.querySelectorAll('.status-btn')]
      const src = btns.find((b) => b.textContent.includes('源码'))
      src && src.click()
      return true
    })()
  `)

  console.log('[shot] PASS: 截图完成')
  return true
}
