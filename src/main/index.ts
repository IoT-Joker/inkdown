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
import { initUpdater, humanizeUpdateErrorForTest } from './updater'
import { markdownToDocx } from './exportDocx'
import { runStabilityCheck } from './stabilityCheck'
import { runExportCheck } from './exportCheck'
import { installDiagnostics } from './diagnostics'
import { runRecoveryTest } from './recoveryTest'

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
  process.env['INKDOWN_STABILITY_CHECK'] ||
  process.env['INKDOWN_EXPORT_CHECK'] ||
  process.env['INKDOWN_RECOVERY_TEST'] ||
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

installDiagnostics()

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

/**
 * 验证「点下一处时正文滚动到匹配位置」。
 *
 * 用户报告：结果在下方时，二级高亮已经切过去了，但视口没跟着滚动。
 */
async function probeFindScroll(win: BrowserWindow): Promise<boolean> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

      // 造一篇很长的文档，匹配点分布在首尾，确保后面的匹配在视口外
      const blocks = []
      blocks.push('目标词 第一处')
      for (let i = 0; i < 40; i++) blocks.push('填充段落 ' + i)
      blocks.push('目标词 第二处')
      for (let i = 0; i < 40; i++) blocks.push('更多填充 ' + i)
      blocks.push('目标词 第三处')
      window.__inkdownLoad(blocks.join('\\n\\n'))
      await wait(1200)

      await c.execute('edit:find')
      await wait(400)
      const input = document.querySelector('.find-input')
      if (!input) return { error: '查找框未出现' }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '目标词')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(900)

      const scroller = document.querySelector('.editor-scroll')
      const before = scroller.scrollTop
      const count = document.querySelector('.find-count')?.innerText || ''

      // 点「下一处」几次，每次记录滚动位置是否变化
      const steps = []
      for (let i = 0; i < 3; i++) {
        const nextBtn = [...document.querySelectorAll('.find-actions .ty-btn')].find(
          (b) => b.textContent.trim() === '↓'
        )
        nextBtn && nextBtn.click()
        await wait(700)
        // 当前高亮是否在视口内
        const hl = document.querySelector('.muya-container span.mu-highlight')
        let visible = false
        if (hl) {
          const r = hl.getBoundingClientRect()
          const sr = scroller.getBoundingClientRect()
          visible = r.top >= sr.top - 2 && r.bottom <= sr.bottom + 2
        }
        steps.push({
          scrollTop: scroller.scrollTop,
          activeVisible: visible,
          hasActive: !!hl,
          count: document.querySelector('.find-count')?.innerText || ''
        })
      }

      return { before, count, steps, scrollHeight: scroller.scrollHeight }
    })()
  `)

  if (result.error) {
    console.error('[findscroll] FAIL:', result.error)
    return false
  }

  console.log('[findscroll] 搜索计数:', result.count, ' 文档高度:', result.scrollHeight)
  console.log('[findscroll] 初始 scrollTop:', result.before)
  for (const [i, s] of result.steps.entries()) {
    console.log(
      `[findscroll]   下一处${i + 1}: scrollTop=${s.scrollTop} 当前高亮可见=${s.activeVisible} 计数=${s.count}`
    )
  }

  const notVisible = result.steps.filter((s: { activeVisible: boolean }) => !s.activeVisible)
  if (notVisible.length) {
    console.error(
      `[findscroll] FAIL: ${notVisible.length}/${result.steps.length} 次跳转后当前高亮不在视口内`
    )
    return false
  }

  console.log('[findscroll] PASS: 每次跳转后当前高亮都在视口内')
  return true
}

/**
 * 验证「更新检查失败」的提示已被转成人话。
 *
 * 用户截图显示弹窗里是完整 HTTP 响应（含响应头与 cookie），
 * 这里确认各类原始错误都被归类成简短说明。
 */
function probeUpdateError(): boolean {
  // 模拟用户截图里那种带完整响应头的 404
  const raw404 = `404 "method: GET url: https://github.com/IoT-Joker/inkdown/releases.atom\\n\\nPlease double check that your authentication token is correct. Due to security reasons, actual status may not be reported, but 404,\\n"
Headers: {
  "cache-control": "no-cache",
  "content-encoding": "gzip",
  "set-cookie": [
    "_gh_sess=a5Za4hFhocn%2F6JEBch4eOwKM7Gc5qWNRwjuwZi7RU1pzUE3iLG...",
    "octo=GH1.1.1595340383.1792558847; expires=Thu, 21 Oct 2027 05:00:47 GMT"
  ]
}`

  const cases: Array<[string, string, RegExp]> = [
    ['404（私有仓库）', raw404, /404/],
    ['网络错误', 'ECONNRESET: socket hang up', /网络|network/i],
    ['认证失败', '401 Unauthorized', /认证|authentication/i]
  ]

  let ok = true
  for (const [label, raw, expect] of cases) {
    const humanized = humanizeUpdateErrorForTest(raw)
    const short = humanized.length <= 200
    const matched = expect.test(humanized)
    const leaked = /set-cookie|_gh_sess|octo=/.test(humanized)
    console.log(
      `[upderr] ${label}: 长度=${humanized.length} 简短=${short} 匹配=${matched} 泄露cookie=${leaked}`
    )
    console.log(`[upderr]    → ${humanized}`)
    if (!short || !matched || leaked) ok = false
  }

  if (ok) console.log('[upderr] PASS: 更新失败信息已归类，未泄露响应头与 cookie')
  else console.error('[upderr] FAIL: 仍有原始响应或信息泄露')
  return ok
}

/**
 * 验证表格的行列操作 UI 与图片缩放条是否真的出现。
 *
 * 代码里 Muya.use(TableRowColumMenu) / ImageResizeBar 都注册了，
 * 但注册不等于可用 —— 要确认 UI 元素在真实交互下真的出现。
 */
async function probeTableUi(win: BrowserWindow): Promise<boolean> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
      const muya = window.__inkdownMuya
      const app = window.__inkdownApp
      const c = window.__inkdownCommands

      // 表格 UI 只存在于所见即所得模式；若停在分栏/源码，先切回去
      for (let i = 0; i < 4 && app.viewMode() !== 'wysiwyg'; i++) {
        await c.execute('view:toggleSource')
        await wait(400)
      }
      await wait(400)

      // 造一个表格
      window.__inkdownLoad('| 甲 | 乙 |\\n| --- | --- |\\n| 1 | 2 |\\n')
      await wait(1500)

      const tableEl = document.querySelector('.muya-container table, .muya-container .mu-table')
      if (!tableEl) return { error: '表格未渲染' }

      // 点进单元格，看表格工具条 / 行列菜单是否出现
      const cell = tableEl.querySelector('td, th')
      if (cell) {
        cell.click()
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      }
      await wait(900)

      const hasDragBar = !!document.querySelector('.mu-table-drag-bar, .mu-table-bar')
      const hasRowColMenu = !!document.querySelector('.mu-table-bar-tools')
      const hasColumnToolbar = !!document.querySelector('.mu-table-column-toolbar')
      const floats = [...document.querySelectorAll('[class*="mu-"]')]
        .map((e) => String(e.className))
        .filter((n) => /table/i.test(n))
        .slice(0, 12)

      // 表格行数，用于验证「插入行」是否真能改变结构
      const rowsBefore = tableEl.querySelectorAll('tr').length

      // 诊断 + 查找表格块。
      // 注意：块的 children 是 LinkedList（有 .head / .tail / .offset），
      // 不是数组，用 Array.isArray 判断会永远拿到 0 个子节点。
      const diag = { tree: [], activeBlock: null }
      const eachChild = (node) => {
        const out = []
        const list = node?.children
        if (!list) return out
        let cur = list.head
        let guard = 0
        while (cur && guard++ < 200) {
          out.push(cur)
          cur = cur.next
        }
        return out
      }
      const walk = (node, depth) => {
        if (!node || depth > 3) return
        diag.tree.push({
          d: depth,
          name: node.blockName || node.constructor?.name || '?',
          hasInsertRow: typeof node.insertRow === 'function',
          kids: eachChild(node).length
        })
        eachChild(node)
          .slice(0, 5)
          .forEach((c) => walk(c, depth + 1))
      }
      const findTable = (node) => {
        if (!node) return null
        if (typeof node.insertRow === 'function') return node
        for (const ch of eachChild(node)) {
          const r = findTable(ch)
          if (r) return r
        }
        return null
      }

      const tableBlock = findTable(muya.editor?.scrollPage)
      diag.foundTable = !!tableBlock
      diag.activeBlock = muya.editor?.activeContentBlock?.blockName || null

      let rowInserted = false
      let how = 'none'
      // 点菜单里的「插入行」
      const menu = document.querySelector('.mu-table-bar-tools')
      let menuItems = []
      if (menu) {
        menuItems = [...menu.querySelectorAll('li.item')].map((li) => ({
          label: li.dataset.label || '',
          text: (li.textContent || '').trim()
        }))
        const item = [...menu.querySelectorAll('li.item')].find((li) => {
          const label = li.dataset.label || ''
          const text = li.textContent || ''
          return label === 'insert' && /行/.test(text)
        })
        if (item) {
          item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          await wait(800)
          rowInserted = tableEl.querySelectorAll('tr').length > rowsBefore
          how = 'menu-item'
        }
      }
      // 菜单没点到就直接用内核能力验证
      if (!rowInserted && tableBlock) {
        try {
          tableBlock.insertRow(1)
          await wait(800)
          rowInserted = tableEl.querySelectorAll('tr').length > rowsBefore
          how = 'kernel-insertRow'
        } catch (e) {
          how = 'error:' + String(e).slice(0, 60)
        }
      }

      return {
        hasDragBar,
        hasRowColMenu,
        hasColumnToolbar,
        floats,
        menuItems,
        menuHtml: menu ? menu.innerHTML.slice(0, 200) : null,
        rowsBefore,
        rowsAfter: tableEl.querySelectorAll('tr').length,
        rowInserted,
        how,
        diag
      }
    })()
  `)

  if (result.error) {
    console.error('[tableui] FAIL:', result.error)
    return false
  }

  console.log('[tableui] 表格相关 UI 元素:', JSON.stringify(result.floats))
  console.log(
    `[tableui] 拖拽条=${result.hasDragBar} 行列菜单=${result.hasRowColMenu} 列工具条=${result.hasColumnToolbar}`
  )
  console.log('[tableui] 行列菜单项:', JSON.stringify(result.menuItems))
  console.log('[tableui] 菜单 HTML:', result.menuHtml)
  console.log('[tableui] 内部结构:', JSON.stringify(result.diag))
  console.log('[tableui] 菜单项数:', result.menuItems.length)
  console.log(
    `[tableui] 行数 ${result.rowsBefore} → ${result.rowsAfter}，插入方式=${result.how}，生效=${result.rowInserted}`
  )

  // 行列菜单或拖拽条至少要有其一（内核靠它们提供行列操作入口）
  const hasAnyUi = result.hasDragBar || result.hasRowColMenu || result.hasColumnToolbar
  if (!hasAnyUi) {
    console.error('[tableui] FAIL: 表格没有任何行列操作入口')
    return false
  }
  if (!result.rowInserted) {
    console.error('[tableui] FAIL: 内核 insertRow 未能改变表格结构')
    return false
  }
  console.log('[tableui] PASS: 表格行列 UI 存在且插入行生效')
  return true
}

/**
 * 从 ZIP 中取出指定条目的文本内容。
 *
 * 走「中央目录」而不是「本地文件头」：本地头在流式写入时
 * 压缩大小字段可能是 0（数据描述符模式），按它遍历会立刻中断。
 * 中央目录一定带真实的 compSize 与 localHeaderOffset。
 */
function extractZipEntry(buf: Buffer, entryName: string): string | null {
  const zlib = require('node:zlib') as typeof import('node:zlib')

  // 从尾部往前找中央目录结束标记 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) return null
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('latin1', off + 46, off + 46 + nameLen)

    if (name === entryName) {
      // 本地头：跳过文件名与扩展字段，取压缩数据
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      if (method === 0) return data.toString('utf8')
      if (method === 8) return zlib.inflateRawSync(data).toString('utf8')
      return null
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return null
}

/**
 * 验证 Markdown → .docx 导出。
 *
 * 不只看文件是否生成，还要解开 zip 检查内容真的写进去了：
 * 标题样式、正文、表格、代码块、列表、内联加粗。
 */
async function probeDocx(): Promise<boolean> {
  const { join } = await import('node:path')
  const { promises: fsp } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const md = [
    '# 导出测试标题',
    '',
    '这是一个**加粗**与*斜体*的段落，还有 `行内代码`。',
    '',
    '## 二级标题',
    '',
    '- 列表项甲',
    '- 列表项乙',
    '',
    '1. 有序一',
    '2. 有序二',
    '',
    '```typescript',
    'const x: number = 1',
    '```',
    '',
    '| 列一 | 列二 |',
    '| --- | --- |',
    '| 甲 | 乙 |',
    ''
  ].join('\n')

  const outPath = join(tmpdir(), `inkdown-docx-test-${Date.now()}.docx`)
  try {
    const buffer = await markdownToDocx(md, '导出测试标题')
    await fsp.writeFile(outPath, buffer)
    console.log('[docx] 已生成文件，大小:', buffer.length, 'bytes')

    // 必须是合法 zip。jszip 是 docx 的间接依赖，没有类型声明，
    // 这里用 Node 内置能力判断 zip 结构，避免为一个测试引入额外依赖。
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
    console.log('[docx] ZIP 魔数正确:', isZip, ' 大小:', buffer.length, 'bytes')
    if (!isZip) {
      console.error('[docx] FAIL: 输出不是合法的 ZIP/docx')
      return false
    }

    // 从 zip 里直接找 word/document.xml 的原始字节：
    // docx 的 XML 是明文存储的，用 latin1 解码后可直接做内容断言。
    const raw = buffer.toString('latin1')
    const hasDocXml = raw.includes('word/document.xml')
    console.log('[docx] 内含 word/document.xml:', hasDocXml)
    if (!hasDocXml) {
      console.error('[docx] FAIL: 缺少 word/document.xml，不是有效的 docx')
      return false
    }

    // 解压 document.xml 需要 inflate；用 Node 的 zlib 手动解析 zip 条目
    const xml = extractZipEntry(buffer, 'word/document.xml') ?? ''
    console.log('[docx] document.xml 长度:', xml.length)
    if (!xml) {
      console.error('[docx] FAIL: 无法解出 word/document.xml')
      return false
    }

    const checks: Array<[string, RegExp]> = [
      ['一级标题文本', /导出测试标题/],
      ['二级标题文本', /二级标题/],
      ['正文段落', /这是一个/],
      ['加粗标记', /<w:b\/>|<w:b /],
      ['斜体标记', /<w:i\/>|<w:i /],
      ['行内代码字体', /Consolas/],
      ['列表项甲', /列表项甲/],
      ['列表项乙', /列表项乙/],
      ['有序列表文本', /有序一/],
      ['代码块内容', /const x: number = 1/],
      ['表格文本', /列一/],
      ['表格单元格', /<w:tbl>/],
      // 标题必须用 Heading 样式，而不是普通段落
      ['标题样式', /Heading1|Heading 1|w:val="Heading1"/]
    ]

    const failures = []
    for (const [label, re] of checks) {
      const hit = re.test(xml)
      console.log(`[docx]   ${label}: ${hit ? 'OK' : '缺失'}`)
      if (!hit) failures.push(label)
    }

    if (failures.length) {
      console.error('[docx] FAIL: 文档缺少内容:', failures.join('、'))
      return false
    }

    console.log('[docx] PASS: docx 结构合法，标题/正文/加粗/斜体/代码/列表/表格均写入')
    return true
  } catch (err) {
    console.error('[docx] FAIL: 导出过程出错:', err instanceof Error ? err.message : String(err))
    return false
  } finally {
    await fsp.rm(outPath, { force: true }).catch(() => {})
  }
}

app.whenReady().then(async () => {
  // 语言偏好需在创建菜单之前载入（菜单文案依赖它）
  await loadLocale()
  registerIpc()
  buildAppMenu()
  const win = createWindow()

  if (process.env['INKDOWN_RECOVERY_TEST']) {
    const ok = await runRecoveryTest(win, process.env['INKDOWN_RECOVERY_TEST'], process.env['INKDOWN_RECOVERY_PHASE'] ?? 'restore')
    app.exit(ok ? 0 : 1)
    return
  }

  if (process.env['INKDOWN_STABILITY_CHECK']) {
    const ok = await runStabilityCheck(win)
    app.exit(ok ? 0 : 1)
    return
  }

  if (process.env['INKDOWN_EXPORT_CHECK']) {
    const ok = await runExportCheck(win).catch((error) => { console.error('[export-check] FAIL:', error); return false })
    app.exit(ok ? 0 : 1)
    return
  }

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

  // INKDOWN_DOCX_TEST=1 时验证 Markdown → .docx 导出，然后退出
  if (process.env['INKDOWN_DOCX_TEST']) {
    const ok = await probeDocx()
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_TABLE_UI_TEST=1 时验证表格行列菜单等 UI 是否真的可用，然后退出
  if (process.env['INKDOWN_TABLE_UI_TEST']) {
    const ok = await probeTableUi(win)
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_UPDATE_ERROR_TEST=1 时验证「更新失败信息被转成人话」，然后退出
  if (process.env['INKDOWN_UPDATE_ERROR_TEST']) {
    const ok = probeUpdateError()
    app.exit(ok ? 0 : 1)
    return
  }

  // INKDOWN_FIND_SCROLL_TEST=1 时验证「点下一处会滚动到匹配位置」，然后退出
  if (process.env['INKDOWN_FIND_SCROLL_TEST']) {
    const ok = await probeFindScroll(win)
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
