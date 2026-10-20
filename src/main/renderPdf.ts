/**
 * 把导出的 PDF 渲染成 PNG，用于人工核对导出内容。
 * 用法：electron . （带 TYPRA2_RENDER_PDF=<pdf路径>）
 */
import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { BrowserWindow as BW } from 'electron'

export async function renderPdfToImages(pdfPath: string, outDir: string): Promise<boolean> {
  await fsp.mkdir(outDir, { recursive: true })

  const win = new BW({
    show: false,
    width: 1000,
    height: 1400,
    webPreferences: { plugins: true, sandbox: true }
  })

  try {
    // Chromium 内置 PDF 查看器可直接加载 PDF
    await win.loadURL('file://' + pdfPath.split('\\').join('/'))
    await new Promise((r) => setTimeout(r, 4000))

    const shot = await win.webContents.capturePage()
    await fsp.writeFile(`${outDir}\\pdf-page1.png`, shot.toPNG())
    console.log('[pdfrender] 已写出 pdf-page1.png', shot.getSize())

    // 同时导出 PDF 内嵌文本（若可读），辅助判断内容
    return true
  } catch (err) {
    console.error('[pdfrender] 失败:', err)
    return false
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
