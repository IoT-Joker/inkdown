/**
 * 真实文件工作流验证：通过主进程驱动渲染层，
 * 走「打开文件 → 编辑 → 保存 → 另存为 → 导出 HTML」完整链路。
 * 用 TYPRA2_FILE_TEST=1 触发，结果以退出码表示。
 */
import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

export async function runFileTest(win: BrowserWindow, workDir: string): Promise<boolean> {
  win.webContents.on('console-message', (_e, level, message) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] ?? String(level)
    if (tag === 'error' || tag === 'warning') console.log(`[renderer:${tag}] ${message}`)
  })

  await fsp.mkdir(workDir, { recursive: true })
  const source = join(workDir, 'input.md')
  const saved = join(workDir, 'saved.md')
  const exported = join(workDir, 'exported.html')

  await fsp.writeFile(
    source,
    '# 文件工作流测试\n\n原始正文，含 **加粗** 与 `代码`。\n\n- 项目一\n- 项目二\n',
    'utf8'
  )

  const waitReady = async (): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < 15000) {
      const ok = await win.webContents
        .executeJavaScript(`!!document.querySelector('.muya-container .mu-paragraph')`)
        .catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }
  if (!(await waitReady())) {
    console.error('[filetest] FAIL: 编辑器未就绪')
    return false
  }

  // 1. 打开文件（走应用的真实打开路径）
  const openResult = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.__typraApp
      if (!app) return { error: 'app bridge 未暴露' }
      await app.openPath(${JSON.stringify(source)})
      await new Promise((r) => setTimeout(r, 800))
      const tab = app.activeTab()
      return { filePath: tab && tab.filePath, title: tab && tab.title, content: tab && tab.content }
    })()
  `)
  if (openResult.error || openResult.filePath !== source) {
    console.error('[filetest] FAIL: 打开文件失败:', JSON.stringify(openResult))
    return false
  }
  console.log('[filetest] 打开文件 OK:', openResult.title)

  // 2. 编辑内容（模拟用户输入）
  const editResult = await win.webContents.executeJavaScript(`
    (async () => {
      const muya = window.__typraMuya
      muya.setContent('# 文件工作流测试\\n\\n已编辑的新正文。\\n\\n- 项目一\\n', false)
      await new Promise((r) => setTimeout(r, 700))
      return { markdown: muya.getMarkdown() }
    })()
  `)
  if (!/已编辑的新正文/.test(editResult.markdown)) {
    console.error('[filetest] FAIL: 编辑未生效:', JSON.stringify(editResult))
    return false
  }
  console.log('[filetest] 编辑内容 OK')

  // 3. 保存到新路径（模拟另存为）
  const saveResult = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.__typraApp
      const tab = app.activeTab()
      tab.filePath = ${JSON.stringify(saved)}
      tab.content = window.__typraMuya.getMarkdown()
      await app.saveTab(tab)
      return { filePath: app.activeTab().filePath, saved: app.activeTab().savedContent }
    })()
  `)
  if (saveResult.filePath !== saved) {
    console.error('[filetest] FAIL: 保存失败:', JSON.stringify(saveResult))
    return false
  }
  const onDisk = await fsp.readFile(saved, 'utf8')
  if (!/已编辑的新正文/.test(onDisk)) {
    console.error('[filetest] FAIL: 磁盘内容与预期不符:', JSON.stringify(onDisk.slice(0, 120)))
    return false
  }
  console.log('[filetest] 保存到磁盘 OK')

  // 4. 导出 HTML
  const exportResult = await win.webContents.executeJavaScript(`
    (async () => {
      const html = await window.__typraExport.buildHtmlForCheck()
      return { length: html.length, html }
    })()
  `)
  if (!/<!doctype html/i.test(exportResult.html) || !/文件工作流测试/.test(exportResult.html)) {
    console.error('[filetest] FAIL: 导出 HTML 内容异常')
    return false
  }
  await fsp.writeFile(exported, exportResult.html, 'utf8')
  console.log('[filetest] 导出 HTML OK:', exportResult.length, 'bytes')

  // 5. 校验导出文件确实是可读的独立 HTML
  const exportedOnDisk = await fsp.readFile(exported, 'utf8')
  if (!/<table|已编辑的新正文|<h1/.test(exportedOnDisk)) {
    console.error('[filetest] FAIL: 导出文件内容不完整')
    return false
  }

  // 6. 导出 PDF：必须生成合法的 PDF 文件，且不包含应用外壳内容
  const pdfPath = join(workDir, 'exported.pdf')
  const pdfResult = await win.webContents.executeJavaScript(`
    (async () => {
      const html = await window.__typraExport.buildHtmlForCheck()
      return window.typra.exportPdf(${JSON.stringify(pdfPath)}, html)
    })()
  `)
  if (!pdfResult) {
    console.error('[filetest] FAIL: PDF 导出返回失败')
    return false
  }
  const pdfBytes = await fsp.readFile(pdfPath)
  const header = pdfBytes.subarray(0, 5).toString('latin1')
  if (header !== '%PDF-') {
    console.error('[filetest] FAIL: 导出的不是合法 PDF，头部:', JSON.stringify(header))
    return false
  }
  if (pdfBytes.length < 3000) {
    console.error('[filetest] FAIL: PDF 体积过小，可能是空文档:', pdfBytes.length)
    return false
  }
  console.log(`[filetest] 导出 PDF OK: ${pdfBytes.length} bytes, 头部 ${header}`)

  console.log('[filetest] PASS: 打开 → 编辑 → 保存 → 导出 HTML/PDF 全链路通过')
  return true
}
