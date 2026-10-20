/**
 * 查找栏截图：打开查找框、输入关键词、翻到第二处，截图用于人工核对。
 * 用法：electron . （带 INKDOWN_SHOT_FIND=1）
 */
import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

export async function captureFindScreenshot(win: BrowserWindow, outDir: string): Promise<boolean> {
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
  const info = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const c = window.__inkdownCommands
      window.__inkdownLoad(${JSON.stringify(demo)})
      // 轮询确认文档真的载入（否则后续搜索必然为空）
      let loaded = false
      for (let i = 0; i < 40; i++) {
        const md = window.__inkdownMuya.getMarkdown()
        if (md && md.length > 200) { loaded = true; break }
        await wait(150)
      }
      if (!loaded) {
        return {
          error: '演示文档未载入',
          mdLen: window.__inkdownMuya.getMarkdown().length,
          mdHead: window.__inkdownMuya.getMarkdown().slice(0, 80)
        }
      }
      await wait(500)
      const mdAfterLoad = window.__inkdownMuya.getMarkdown()
      const activeTitle = window.__inkdownApp.activeTab()?.title

      await c.execute('edit:replace')
      await wait(500)
      const inputs = [...document.querySelectorAll('.find-input')]
      if (inputs.length < 2) return { error: '查找/替换输入框未就绪' }
      const setInput = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      // demo.md 里 "Markdown" 出现 5 次
      setInput(inputs[0], 'Markdown')
      setInput(inputs[1], 'MD')
      // 轮询等结果，而不是固定等待（注意正则里的斜杠要转义，否则会截断模板字符串）
      let count = ''
      for (let i = 0; i < 30; i++) {
        count = document.querySelector('.find-count')?.innerText || ''
        if (/\\d+\\s*\\/\\s*\\d+/.test(count)) break
        await wait(150)
      }

      // 翻到第二处，展示「2 / N」计数
      const nextBtn = [...document.querySelectorAll('.find-actions .ty-btn')].find((b) => b.textContent.trim() === '↓')
      nextBtn && nextBtn.click()
      await wait(700)

      return {
        iconCount: document.querySelectorAll('.find-icon').length,
        count: document.querySelector('.find-count')?.innerText || '',
        inputCount: inputs.length,
        inputValues: inputs.map((el) => el.value),
        highlights:
          document.querySelectorAll('.muya-container span.mu-highlight').length +
          document.querySelectorAll('.muya-container span.mu-selection').length,
        // 诊断：直接问内核要匹配数，判断是 UI 事件没到还是内核没搜到
        directMatches: (() => {
          try {
            const r = window.__inkdownMuya.search('Markdown', {
              isRegexp: false,
              isCaseSensitive: false,
              isWholeWord: false
            })
            return r && r.matches ? r.matches.length : -1
          } catch (e) {
            return 'ERR:' + String(e)
          }
        })(),
        docHasWord: window.__inkdownMuya.getMarkdown().includes('Markdown'),
        mdLenAfterLoad: mdAfterLoad.length,
        mdHeadAfterLoad: mdAfterLoad.slice(0, 60),
        activeTitle
      }
    })()
  `)
  console.log('[shot] 查找栏信息:', JSON.stringify(info))
  if (info.error) {
    console.error('[shot] FAIL:', info.error)
    return false
  }
  // 必须真的搜到并高亮，否则截图没有意义
  if (!/\d+\s*\/\s*\d+/.test(info.count) || info.highlights < 2) {
    console.error('[shot] FAIL: 查找未生效（计数或高亮为空）:', JSON.stringify(info))
    return false
  }

  await fsp.mkdir(outDir, { recursive: true })
  const image = await win.webContents.capturePage()
  await fsp.writeFile(join(outDir, '07-find-bar.png'), image.toPNG())
  console.log('[shot] 已写出 07-find-bar.png')

  // 顺带截「关于」与「快捷键」两个对话框
  const dialogs = [
    { cmd: 'help:about', selector: '.about', name: '08-about.png' },
    { cmd: 'help:shortcuts', selector: '.sc-dialog', name: '09-shortcuts.png' }
  ]
  for (const d of dialogs) {
    await win.webContents.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        // 关掉可能开着的其它面板
        document.querySelectorAll('.about-actions .primary, .sc-head .ty-btn, .dialog-foot .ty-btn').forEach((b) => b.click())
        await wait(250)
        await window.__inkdownCommands.execute('${d.cmd}')
        await wait(600)
        return !!document.querySelector('${d.selector}')
      })()
    `)
    await new Promise((r) => setTimeout(r, 400))
    const shot = await win.webContents.capturePage()
    await fsp.writeFile(join(outDir, d.name), shot.toPNG())
    console.log(`[shot] 已写出 ${d.name}`)
  }

  // 再截一张分栏预览
  const splitInfo = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const c = window.__inkdownCommands
      const app = window.__inkdownApp
      // 关掉对话框
      document.querySelectorAll('.about-actions .primary, .sc-head .ty-btn').forEach((b) => b.click())
      await wait(300)
      // 载入演示文档并切到分栏
      window.__inkdownLoad(${JSON.stringify(demo)})
      await wait(1200)
      for (let i = 0; i < 4 && app.viewMode() !== 'split'; i++) {
        await c.execute('view:toggleSource')
        await wait(400)
      }
      await wait(600)
      return {
        mode: app.viewMode(),
        hasPreview: !!document.querySelector('.split-preview-body')
      }
    })()
  `)
  console.log('[shot] 分栏信息:', JSON.stringify(splitInfo))
  if (splitInfo.mode === 'split' && splitInfo.hasPreview) {
    const shot = await win.webContents.capturePage()
    await fsp.writeFile(join(outDir, '10-split-preview.png'), shot.toPNG())
    console.log('[shot] 已写出 10-split-preview.png')
  }

  // 全库搜索与命令面板
  const extra = [
    {
      name: '11-folder-search.png',
      setup: `
        (async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms))
          const c = window.__inkdownCommands
          const app = window.__inkdownApp
          // 先回所见即所得，避免停在分栏
          if (app.viewMode() !== 'wysiwyg') await c.execute('view:toggleSplit')
          await wait(300)
          const dir = await window.inkdown.readDir(${JSON.stringify(process.cwd())}, 1)
          app.setWorkspace(dir)
          await wait(300)
          await c.execute('edit:findInFolder')
          await wait(400)
          const input = document.querySelector('.fs-input')
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(input, 'Markdown')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          for (let i = 0; i < 40; i++) {
            if (document.querySelectorAll('.fs-hit').length > 0) break
            await wait(200)
          }
          return true
        })()
      `
    },
    {
      name: '12-command-palette.png',
      setup: `
        (async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms))
          const c = window.__inkdownCommands
          document.querySelector('.fs-close')?.click()
          await wait(300)
          await c.execute('app:commandPalette')
          await wait(600)
          return true
        })()
      `
    }
  ]
  for (const e of extra) {
    await win.webContents.executeJavaScript(e.setup)
    await new Promise((r) => setTimeout(r, 500))
    const shot = await win.webContents.capturePage()
    await fsp.writeFile(join(outDir, e.name), shot.toPNG())
    console.log(`[shot] 已写出 ${e.name}`)
  }

  console.log('[shot] PASS: 查找栏截图完成')
  return true
}
