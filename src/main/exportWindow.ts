import { BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A file-origin document can load local images; a data: document cannot. */
export async function withExportWindow<T>(html: string, run: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'inkdown-print-'))
  const win = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'inkdown-export', backgroundThrottling: false }
  })
  try {
    const source = join(dir, 'document.html')
    // Block all document scripts while allowing our privileged layout probes.
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data: file: https: http:; img-src data: file: https: http:; font-src data: file: https: http:; object-src 'none'; frame-src 'none'; base-uri 'none'">`
    // The trusted prefix must precede every byte of supplied HTML, including
    // malformed documents with a script before <head>. Nested document tags
    // are ignored by the HTML parser; their styles and body content remain.
    const safeHtml = '<!doctype html><html><head><meta charset="utf-8">' + policy + '</head><body>' + html + '</body></html>'
    await writeFile(source, safeHtml, 'utf8')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    let loadTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        win.loadFile(source),
        new Promise<never>((_, reject) => { loadTimer = setTimeout(() => reject(new Error('Export document loading timed out')), 25000) })
      ])
    } finally { if (loadTimer) clearTimeout(loadTimer) }
    const failures = await win.webContents.executeJavaScript(`(async () => {
      const failed = [];
      const pending = [...document.images].map((img) => new Promise((resolve) => {
        img.loading = 'eager';
        const finish = () => { if (!img.naturalWidth) failed.push(img.getAttribute('src') || img.alt); resolve(); };
        if (img.complete) finish();
        else { img.addEventListener('load', finish, { once: true }); img.addEventListener('error', finish, { once: true }); }
      }));
      let timer;
      try {
        await Promise.race([
          Promise.all([...pending, document.fonts.ready]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Images or fonts timed out')), 20000); })
        ]);
      } finally { clearTimeout(timer); }
      return failed;
    })()`) as string[]
    if (failures.length) throw new Error(`图片加载失败：${failures.slice(0, 3).join('\n')}`)
    await win.webContents.insertCSS(`
      @media print {
        body { padding: 0 !important; }
        .markdown-body { padding: 0 !important; min-width: 0 !important; max-width: none !important; }
        .katex-display, .katex-display > .katex { overflow: visible !important; }
        pre { white-space: pre-wrap !important; overflow: visible !important; overflow-wrap: anywhere; }
        pre code { white-space: inherit !important; }
        *::-webkit-scrollbar { display: none !important; }
        img, svg { max-width: 100%; }
        h1, h2, h3, h4, h5, h6 { break-after: avoid-page; page-break-after: avoid; }
        .mermaid, .plantuml, .vega-lite, .flowchart, .sequence { break-inside: avoid-page; }
      }
    `)
    return await run(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function writeHtmlPdf(filePath: string, html: string, landscape = false): Promise<void> {
  await withExportWindow(html, async (win) => {
    const data = await win.webContents.printToPDF({
      printBackground: true, landscape, pageSize: 'A4',
      generateTaggedPDF: true, generateDocumentOutline: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
    await writeFile(filePath, data)
  })
}
