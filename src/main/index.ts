import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { createWindow } from './window'
import { runSelfCheck } from './selfCheck'
import { captureScreenshots } from './screenshot'
import { runFileTest, runSessionRestoreTest } from './fileTest'
import { renderPdfToImages } from './renderPdf'
import { captureEnglishScreenshot } from './screenshotEn'
import { captureFindScreenshot } from './screenshotFind'
import { makeIcons } from './makeIcons'
import { loadLocale } from './locale'
import {
  acquireSingleInstanceLock,
  extractFileFromArgv,
  onOpenFileMac,
  onSecondInstance,
  rememberPendingFile,
  takePendingFile
} from './fileAssociation'
import { getMainWindow } from './window'
import { initUpdater } from './updater'

/**
 * Inkdown 主进程入口。
 * 参考 marktext 的 main 进程分层，但只保留 Typora 式编辑器所需的最小集合，
 * 避免 keytar / native-keymap / ripgrep 等原生依赖带来的构建负担。
 */

// 单实例：双击多个文件时复用同一窗口，而不是开出多个实例。
//
// 拿不到锁说明已有实例在运行：本进程的参数会由主实例的 second-instance 事件接收，
// 这里必须立刻停止后续初始化。注意 app.quit() 是异步的，代码仍会往下跑，
// 若不显式早退，第二个实例会继续走到 whenReady 并创建出一个多余窗口。
//
// 自动化测试要跳过它：测试会在同一台机器上连续启动多个进程，
// 若被单实例逻辑拦掉，第二个进程会静默退出（exit 0 且无任何输出），
// 表现为「自检莫名其妙没有结果」。
//
// 注意 SINGLE_INSTANCE_PROBE 不在这个列表里 —— 那个测试恰恰需要锁生效，
// 否则它验证不了「第二个实例把文件转发给第一个实例」。
const isTestRun = !!(
  process.env['INKDOWN_SELF_CHECK'] ||
  process.env['INKDOWN_FILE_TEST'] ||
  process.env['INKDOWN_SESSION_TEST'] ||
  process.env['INKDOWN_SCREENSHOT'] ||
  process.env['INKDOWN_SHOT_EN'] ||
  process.env['INKDOWN_SHOT_FIND'] ||
  process.env['INKDOWN_MAKE_ICONS'] ||
  process.env['INKDOWN_RENDER_PDF'] ||
  process.env['INKDOWN_OPEN_FILE_PROBE']
)

if (!isTestRun && !acquireSingleInstanceLock()) {
  app.quit()
  // 用立即退出而非 return：本文件是模块顶层，return 不适用
  process.exit(0)
}

// 启动参数里的文档路径（文件关联双击时由系统传入）
const startupFile = extractFileFromArgv(process.argv)
rememberPendingFile(startupFile)
if (process.env['INKDOWN_SINGLE_INSTANCE_PROBE'] === '1' && startupFile) {
  console.log('[single] 启动参数文件:', startupFile)
}

/** 把文件推给渲染层打开。 */
function openFileInWindow(filePath: string): void {
  const win = getMainWindow()
  // 单实例测试靠这行日志判断转发是否到达
  if (process.env['INKDOWN_SINGLE_INSTANCE_PROBE'] === '1') {
    console.log('[single] 转发文件到现有窗口:', filePath)
  }
  if (win) win.webContents.send('app:openFile', filePath)
}

// 第二个实例启动时（用户又双击了一个文件），转发给现有窗口
onSecondInstance(openFileInWindow)
// macOS 的 Finder 双击走 open-file 事件
onOpenFileMac(openFileInWindow)

/**
 * 验证「双击 .md 打开」链路。
 *
 * 检查两件事：
 *   1. 命令行参数被正确解析成待打开文件（extractFileFromArgv）
 *   2. 渲染层确实打开了该文件（标签页的 filePath 与内容匹配）
 */
async function probeOpenFile(win: BrowserWindow, expected: string): Promise<boolean> {
  const parsed = extractFileFromArgv(process.argv)
  console.log('[openfile] 命令行解析结果:', parsed)
  console.log('[openfile] 期望打开:', expected)
  if (!parsed || resolve(parsed) !== resolve(expected)) {
    console.error('[openfile] FAIL: 命令行参数未解析出目标文件')
    return false
  }

  // 等渲染层就绪并完成打开
  const started = Date.now()
  let last: { files: string[]; content: string } | null = null
  while (Date.now() - started < 20000) {
    const state = await win.webContents
      .executeJavaScript(
        `(() => {
          const app = window.__inkdownApp
          if (!app) return null
          const tab = app.activeTab()
          return { files: app.tabs().map((t) => t.filePath).filter(Boolean), content: tab ? tab.content : '' }
        })()`
      )
      .catch(() => null)
    if (state) {
      last = state
      if (state.files.some((f: string) => resolve(f) === resolve(expected))) break
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  const opened = last?.files.some((f: string) => resolve(f) === resolve(expected))
  if (!opened) {
    console.error('[openfile] FAIL: 渲染层未打开目标文件:', JSON.stringify(last))
    return false
  }
  if (!last?.content || last.content.length < 5) {
    console.error('[openfile] FAIL: 打开后内容为空:', JSON.stringify(last))
    return false
  }
  console.log('[openfile] PASS: 双击文件打开链路正常，内容已载入')
  return true
}

/**
 * 验证「在查找框输入时，焦点不会被抢到正文」。
 *
 * 用户报告：打字打到一半，光标跳到正文上。
 * 预期原因：搜索时 selectHighlight 会把光标移进正文（内核 setCursor 行为）。
 */
async function probeFindFocus(win: BrowserWindow): Promise<boolean> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // 等编辑器就绪
  for (let i = 0; i < 60; i++) {
    const ok = await win.webContents
      .executeJavaScript(`!!document.querySelector('.muya-container .mu-paragraph')`)
      .catch(() => false)
    if (ok) break
    await wait(250)
  }

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const c = window.__inkdownCommands
      const app = window.__inkdownApp

      // 造一篇含多处「苹果」的文档
      window.__inkdownLoad('苹果一 香蕉\\n\\n苹果二 橙子\\n\\n苹果三 葡萄\\n')
      await wait(900)

      await c.execute('edit:find')
      await wait(400)
      const input = document.querySelector('.find-input')
      if (!input) return { error: '查找框未出现' }
      input.focus()

      const samples = []
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

      // 逐字符输入「苹果」，每次输入后记录焦点在哪
      for (const text of ['苹', '苹果', '苹果x']) {
        setter.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(500)
        const active = document.activeElement
        samples.push({
          typed: text,
          activeTag: active ? active.tagName : null,
          activeClass: active ? String(active.className).slice(0, 60) : null,
          isFindInput: active === input,
          count: document.querySelector('.find-count')?.innerText || ''
        })
      }

      return { samples, stillFindInput: document.activeElement === input }
    })()
  `)

  if (result.error) {
    console.error('[findfocus] FAIL:', result.error)
    return false
  }

  console.log('[findfocus] 逐字符输入时的焦点变化:')
  for (const s of result.samples) {
    console.log(
      `[findfocus]   输入「${s.typed}」 → 焦点=${s.activeTag}.${s.activeClass} 仍在查找框=${s.isFindInput} 计数=${s.count}`
    )
  }

  const lost = result.samples.filter((s: { isFindInput: boolean }) => !s.isFindInput)
  if (lost.length) {
    console.error(
      `[findfocus] FAIL: 输入过程中焦点被抢走 ${lost.length} 次（首次在「${lost[0].typed}」）`
    )
    return false
  }

  console.log('[findfocus] PASS: 逐字符输入全程焦点保持在查找框')
  return true
}

app.whenReady().then(async () => {
  // 语言偏好需在创建菜单之前载入（菜单文案依赖它）
  await loadLocale()
  registerIpc()
  buildAppMenu()
  const win = createWindow()

  // INKDOWN_SELF_CHECK=1 时执行端到端自检（用于 CI/验证），完成后自动退出
  if (process.env['INKDOWN_SELF_CHECK']) {
    const ok = await runSelfCheck(win)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_SCREENSHOT=<目录> 时截取界面截图，用于人工核对视觉效果
  const shotDir = process.env['INKDOWN_SCREENSHOT']
  if (shotDir) {
    const ok = await captureScreenshots(win, shotDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_FILE_TEST=<目录> 时验证打开/编辑/保存/导出全链路
  const fileTestDir = process.env['INKDOWN_FILE_TEST']
  if (fileTestDir) {
    const ok = await runFileTest(win, fileTestDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_SESSION_TEST=<目录> 时验证会话恢复（需分两次启动进程）
  const sessionTestDir = process.env['INKDOWN_SESSION_TEST']
  if (sessionTestDir) {
    const ok = await runSessionRestoreTest(win, sessionTestDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_SHOT_EN=<目录> 时截取英文界面截图，用于人工核对翻译效果
  const shotEnDir = process.env['INKDOWN_SHOT_EN']
  if (shotEnDir) {
    const ok = await captureEnglishScreenshot(win, shotEnDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_SHOT_FIND=<目录> 时截取查找栏截图
  const shotFindDir = process.env['INKDOWN_SHOT_FIND']
  if (shotFindDir) {
    const ok = await captureFindScreenshot(win, shotFindDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_MAKE_ICONS=<目录> 时生成应用图标（PNG + ICO）
  const iconDir = process.env['INKDOWN_MAKE_ICONS']
  if (iconDir) {
    const ok = await makeIcons(iconDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_RENDER_PDF=<pdf路径> 时把 PDF 渲染成图片，用于人工核对导出内容
  const renderPdf = process.env['INKDOWN_RENDER_PDF']
  if (renderPdf) {
    const outDir = process.env['INKDOWN_RENDER_PDF_OUT'] ?? '.tmp-pdf-render'
    const ok = await renderPdfToImages(renderPdf, outDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_FIND_FOCUS_TEST=1 时验证「查找框输入不被抢焦点」，然后退出
  if (process.env['INKDOWN_FIND_FOCUS_TEST']) {
    const ok = await probeFindFocus(win)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_OPEN_FILE_PROBE=<文件> 时验证「双击文件打开」链路，然后退出
  const openProbe = process.env['INKDOWN_OPEN_FILE_PROBE']
  if (openProbe) {
    const ok = await probeOpenFile(win, openProbe)
    app.exit(ok ? 0 : 1)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 打包版启用自动更新（开发版自动跳过）。
  // 测试运行不启用：它会发起网络请求，拖住进程退出，
  // 表现为「自检所有用例都 PASS，但整体判定失败」。
  if (!isTestRun) initUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
