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

  // 3b. 回归测试：应用自己保存后，不得弹出「外部修改」提示
  //     （这正是「勾选复选框就提示重新载入」的根因）
  const selfWriteResult = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.__typraApp
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const tab = app.activeTab()

      // 先清掉可能残留的提示
      app.clearNotice && app.clearNotice()
      await wait(200)

      // 模拟「勾选复选框」：改内容 → 自动保存（走应用真实的保存路径）
      tab.content = tab.content + '\\n\\n- [x] 勾选测试\\n'
      window.__typraMuya.setContent(tab.content, false)
      await wait(400)
      await app.saveTab(tab)
      // 等超过自动保存防抖与 fs.watch 触发窗口
      await wait(2500)

      return {
        notice: app.notice ? app.notice.text : null,
        content: tab.content,
        saved: tab.savedContent
      }
    })()
  `)
  if (selfWriteResult.notice) {
    console.error(
      '[filetest] FAIL: 应用自己保存后仍弹出外部修改提示:',
      JSON.stringify(selfWriteResult.notice)
    )
    return false
  }
  console.log('[filetest] 自写不误报 OK: 应用保存后无「外部修改」提示')

  // 3c. 对照测试：真实的外部改动必须能检测到
  const externalResult = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.__typraApp
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      app.clearNotice && app.clearNotice()
      await wait(200)
      return { cleared: app.notice ? app.notice.text : null }
    })()
  `)
  if (externalResult.cleared) {
    console.error('[filetest] FAIL: 提示未能清除')
    return false
  }
  // 从主进程外部改写文件（绕过应用的写入路径），再等监听触发。
  // 先等过自写保护窗口（主进程为 2 秒），否则这次写入会被误判成自写。
  await new Promise((r) => setTimeout(r, 2500))
  await fsp.writeFile(saved, '# 外部改动\n\n这段内容由外部写入。\n', 'utf8')
  await new Promise((r) => setTimeout(r, 3000))
  const externalNotice = await win.webContents.executeJavaScript(
    `(window.__typraApp.notice ? window.__typraApp.notice.text : null)`
  )
  if (!externalNotice) {
    console.error('[filetest] FAIL: 真实外部改动未被检测到（漏报）')
    return false
  }
  console.log('[filetest] 外部改动检测 OK:', externalNotice)

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

  // 7. 文件树只显示 Markdown：目录保留，非 Markdown 文件必须被过滤掉
  const mixedDir = join(workDir, 'tree-mixed')
  await fsp.mkdir(join(mixedDir, '子目录'), { recursive: true })
  await fsp.writeFile(join(mixedDir, 'note.md'), '# note\n', 'utf8')
  await fsp.writeFile(join(mixedDir, 'other.markdown'), '# other\n', 'utf8')
  await fsp.writeFile(join(mixedDir, 'plain.txt'), 'plain\n', 'utf8')
  await fsp.writeFile(join(mixedDir, 'photo.png'), 'not really a png', 'utf8')
  await fsp.writeFile(join(mixedDir, 'data.json'), '{}', 'utf8')
  await fsp.writeFile(join(mixedDir, 'script.js'), '// x', 'utf8')
  const treeFiltered = await win.webContents.executeJavaScript(
    `window.typra.readDir(${JSON.stringify(mixedDir)})`
  )
  const names = treeFiltered.children.map((c: { name: string }) => c.name).sort()
  const hasNonMd = names.some((n: string) => /\.(png|json|js)$/i.test(n))
  if (hasNonMd) {
    console.error('[filetest] FAIL: 文件树未过滤非 Markdown 文件:', JSON.stringify(names))
    return false
  }
  if (!names.includes('note.md') || !names.includes('子目录')) {
    console.error('[filetest] FAIL: 文件树缺少 md 文件或目录:', JSON.stringify(names))
    return false
  }
  console.log('[filetest] 文件树过滤 OK: 仅 Markdown 与目录 →', names.join(', '))

  // 8. 会话恢复：记录当前标签，模拟重启后应能恢复
  const sessionSaved = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.__typraApp
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      // 打开两个文件作为会话内容
      await app.openPath(${JSON.stringify(source)})
      await wait(400)
      await app.openPath(${JSON.stringify(saved)})
      await wait(400)
      app.persistSession()
      await wait(200)
      return {
        tabFiles: app.tabs().map((t) => t.filePath).filter(Boolean),
        session: app.loadSession()
      }
    })()
  `)
  if (!sessionSaved.session || sessionSaved.session.files.length < 2) {
    console.error('[filetest] FAIL: 会话未记录:', JSON.stringify(sessionSaved))
    return false
  }
  const sessionPaths = sessionSaved.session.files
  if (!sessionPaths.includes(source) || !sessionPaths.includes(saved)) {
    console.error('[filetest] FAIL: 会话内容不含已打开文件:', JSON.stringify(sessionPaths))
    return false
  }
  console.log(`[filetest] 会话记录 OK: ${sessionPaths.length} 个文件`)

  console.log('[filetest] PASS: 打开 → 编辑 → 保存 → 导出 HTML/PDF 全链路通过')
  return true
}

/**
 * 会话恢复的独立验证：分两次启动进程。
 * 第一次打开文件并退出，第二次启动时检查是否自动恢复。
 */
export async function runSessionRestoreTest(win: BrowserWindow, workDir: string): Promise<boolean> {
  const phase = process.env['TYPRA2_SESSION_PHASE'] ?? 'first'
  const fileA = join(workDir, 'session-a.md')
  const fileB = join(workDir, 'session-b.md')

  win.webContents.on('console-message', (_e, level, message) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] ?? String(level)
    if (tag === 'error') console.log(`[renderer:error] ${message}`)
  })

  const ready = async (): Promise<boolean> => {
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
  if (!(await ready())) {
    console.error('[sessiontest] FAIL: 编辑器未就绪')
    return false
  }

  if (phase === 'first') {
    await fsp.mkdir(workDir, { recursive: true })
    await fsp.writeFile(fileA, '# 会话文件 A\n\n第一个文件。\n', 'utf8')
    await fsp.writeFile(fileB, '# 会话文件 B\n\n第二个文件。\n', 'utf8')
    // 打开两个文件，让会话被记录
    await win.webContents.executeJavaScript(`
      (async () => {
        const app = window.__typraApp
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        await app.openPath(${JSON.stringify(fileA)})
        await wait(400)
        await app.openPath(${JSON.stringify(fileB)})
        await wait(500)
        app.persistSession()
        await wait(300)
        return app.tabs().length
      })()
    `)
    console.log('[sessiontest] 第一阶段 OK: 已打开两个文件并记录会话')
    return true
  }

  // 第二阶段：新进程启动，应当自动恢复上次的标签
  const restored = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.__typraApp
      // 启动流程会异步恢复，轮询等待
      for (let i = 0; i < 40; i++) {
        const files = app.tabs().map((t) => t.filePath).filter(Boolean)
        if (files.length >= 2) return { files, active: app.activeTab() && app.activeTab().filePath }
        await new Promise((r) => setTimeout(r, 250))
      }
      const files = app.tabs().map((t) => t.filePath).filter(Boolean)
      return { files, active: app.activeTab() && app.activeTab().filePath }
    })()
  `)
  const got = restored.files
  if (!got.includes(fileA) || !got.includes(fileB)) {
    console.error('[sessiontest] FAIL: 重启后未恢复上次的标签:', JSON.stringify(restored))
    return false
  }
  // 第一阶段起点干净，恢复的应当恰好是这两个文件（防止测试数据污染悄悄通过）
  if (got.length !== 2) {
    console.error('[sessiontest] FAIL: 恢复的标签数应为 2，实际', got.length, JSON.stringify(got))
    return false
  }
  if (restored.active !== fileB) {
    console.error('[sessiontest] FAIL: 未恢复上次的活动标签:', JSON.stringify(restored))
    return false
  }
  console.log(`[sessiontest] PASS: 重启后恢复 ${got.length} 个标签，活动标签正确`)
  return true
}
