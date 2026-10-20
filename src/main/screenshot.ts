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

  // 灌入演示文档（走应用级载入路径，字数统计与大纲同步刷新）
  const demo = await fsp.readFile('E:\\Desktop\\JX\\07-DSH\\02-typra2\\examples\\demo.md', 'utf8')
  await win.webContents.executeJavaScript(`
    (async () => {
      window.__typraLoad(${JSON.stringify(demo)})
      await new Promise((r) => setTimeout(r, 1500))
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

  // 诊断：确认命令中心已注册哪些命令，以及主题命令是否可执行
  const cmdDiag = await win.webContents.executeJavaScript(`
    (async () => {
      const c = window.__typraCommands
      if (!c) return { error: '命令中心未暴露' }
      const ids = c.ids()
      const before = document.body.className
      await c.execute('view:toggleTheme')
      await new Promise((r) => setTimeout(r, 200))
      return {
        hasToggleTheme: c.has('view:toggleTheme'),
        totalCommands: ids.length,
        sample: ids.slice(0, 12),
        before,
        after: document.body.className
      }
    })()
  `)
  console.log('[shot] 命令诊断:', JSON.stringify(cmdDiag))

  // 深色主题：通过命令中心连续切换，直到进入深色
  const darkInfo = await win.webContents.executeJavaScript(`
    (async () => {
      const c = window.__typraCommands
      for (let i = 0; i < 8; i++) {
        if (document.body.classList.contains('theme-dark')) break
        await c.execute('view:toggleTheme')
        await new Promise((r) => setTimeout(r, 150))
      }
      const editor = document.querySelector('.muya-editor') || document.querySelector('.muya-container')
      const cs = getComputedStyle(editor)
      return {
        bodyClass: document.body.className,
        editorBg: cs.backgroundColor,
        editorColor: cs.color
      }
    })()
  `)
  console.log('[shot] 深色主题:', JSON.stringify(darkInfo))
  await new Promise((r) => setTimeout(r, 800))
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
  await new Promise((r) => setTimeout(r, 1000))
  await shoot('04-source')

  // 恢复浅色与所见即所得
  await win.webContents.executeJavaScript(`
    (async () => {
      const c = window.__typraCommands
      for (let i = 0; i < 8; i++) {
        if (document.body.classList.contains('theme-light')) break
        await c.execute('view:toggleTheme')
        await new Promise((r) => setTimeout(r, 150))
      }
      await c.execute('view:toggleSource')
      return true
    })()
  `)
  await new Promise((r) => setTimeout(r, 600))

  console.log('[shot] PASS: 截图完成')
  return true
}
