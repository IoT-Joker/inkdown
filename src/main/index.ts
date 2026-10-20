import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { createWindow } from './window'
import { runSelfCheck } from './selfCheck'
import { captureScreenshots } from './screenshot'
import { runFileTest, runSessionRestoreTest } from './fileTest'
import { renderPdfToImages } from './renderPdf'

/**
 * Typra2 主进程入口。
 * 参考 marktext 的 main 进程分层，但只保留 Typora 式编辑器所需的最小集合，
 * 避免 keytar / native-keymap / ripgrep 等原生依赖带来的构建负担。
 */
app.whenReady().then(async () => {
  registerIpc()
  buildAppMenu()
  const win = createWindow()

  // TYPRA2_SELF_CHECK=1 时执行端到端自检（用于 CI/验证），完成后自动退出
  if (process.env['TYPRA2_SELF_CHECK']) {
    const ok = await runSelfCheck(win)
    app.exit(ok ? 0 : 1)
    return
  }

  // TYPRA2_SCREENSHOT=<目录> 时截取界面截图，用于人工核对视觉效果
  const shotDir = process.env['TYPRA2_SCREENSHOT']
  if (shotDir) {
    const ok = await captureScreenshots(win, shotDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // TYPRA2_FILE_TEST=<目录> 时验证打开/编辑/保存/导出全链路
  const fileTestDir = process.env['TYPRA2_FILE_TEST']
  if (fileTestDir) {
    const ok = await runFileTest(win, fileTestDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // TYPRA2_SESSION_TEST=<目录> 时验证会话恢复（需分两次启动进程）
  const sessionTestDir = process.env['TYPRA2_SESSION_TEST']
  if (sessionTestDir) {
    const ok = await runSessionRestoreTest(win, sessionTestDir)
    app.exit(ok ? 0 : 1)
    return
  }

  // TYPRA2_RENDER_PDF=<pdf路径> 时把 PDF 渲染成图片，用于人工核对导出内容
  const renderPdf = process.env['TYPRA2_RENDER_PDF']
  if (renderPdf) {
    const outDir = process.env['TYPRA2_RENDER_PDF_OUT'] ?? '.tmp-pdf-render'
    const ok = await renderPdfToImages(renderPdf, outDir)
    app.exit(ok ? 0 : 1)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
