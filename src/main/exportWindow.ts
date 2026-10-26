import { BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyExportOptionsToHtml, exportOptionsCss, exportPageSizeMm, normalizeExportOptions,
  type ExportFileOptions, type ExportIssue, type ExportPreviewResult, type ExportPreviewPage
} from '../shared/exportOptions'

interface ExportWindowSettings { options?: unknown; allowResourceFailures?: boolean }

async function deadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

/** File origin permits local images. Strict unless preview/continue is explicit. */
export async function withExportWindow<T>(
  html: string, run: (win: BrowserWindow, issues: ExportIssue[]) => Promise<T>, settings: ExportWindowSettings = {}
): Promise<T> {
  const options = normalizeExportOptions(settings.options)
  const page = exportPageSizeMm(options)
  const dir = await mkdtemp(join(tmpdir(), 'inkdown-print-'))
  let win: BrowserWindow | undefined
  try {
    win = new BrowserWindow({
      show: false, width: Math.ceil(page.width * 96 / 25.4) + 80, height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'inkdown-export', backgroundThrottling: false }
    })
    const source = join(dir, 'document.html')
    // Keep this prefix ahead of every supplied byte, including scripts before <head>.
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data: file: https: http:; img-src data: file: https: http:; font-src data: file: https: http:; object-src 'none'; frame-src 'none'; base-uri 'none'">`
    const safeHtml = '<!doctype html><html><head><meta charset="utf-8">' + policy + '</head><body>' + applyExportOptionsToHtml(html, options) + '</body></html>'
    await writeFile(source, safeHtml, 'utf8')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    const issues: ExportIssue[] = []
    try {
      await deadline(win.loadFile(source), 25000, 'Export document loading timed out')
    } catch (error) {
      if (!settings.allowResourceFailures || !(error instanceof Error) || error.message !== 'Export document loading timed out') throw error
      win.webContents.stop()
      issues.push({ kind: 'fallback', message: 'Export document loading timed out; the preview may omit unfinished resources.' })
    }
    const resources = await deadline(win.webContents.executeJavaScript(`(async () => {
      const issues = [];
      const seen = new Set();
      const add = (kind, message, source) => {
        const key = kind + ':' + (source || message);
        if (!seen.has(key)) { seen.add(key); issues.push({ kind, message, ...(source ? { source } : {}) }); }
      };
      const cleanups = [];
      const waiting = new Set();
      const reportImage = (img) => {
        const source = img.getAttribute('src') || img.alt || undefined;
        const diagram = img.closest('.mermaid, .plantuml, .vega-lite, .flowchart, .sequence, .mu-diagram-preview');
        add(diagram ? 'diagram' : 'image', 'Image failed to load' + (source ? ': ' + source : ''), source);
      };
      const pending = [...document.images].map((img) => new Promise((resolve) => {
        img.loading = 'eager';
        const finish = () => {
          waiting.delete(img);
          if (!img.naturalWidth) reportImage(img);
          resolve();
        };
        if (img.complete) finish();
        else {
          waiting.add(img);
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
          cleanups.push(() => { img.removeEventListener('load', finish); img.removeEventListener('error', finish); });
        }
      }));
      let fontsReady = false;
      const fonts = document.fonts.ready.then(() => { fontsReady = true; }, () => {
        fontsReady = true; add('fallback', 'Fonts failed to load; fallback fonts are used.');
      });
      let timer;
      let timedOut = false;
      try {
        await Promise.race([
          Promise.all([...pending, fonts]),
          new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, 20000); })
        ]);
      } finally { clearTimeout(timer); cleanups.forEach((cleanup) => cleanup()); }
      for (const img of waiting) reportImage(img);
      if (!fontsReady) add('fallback', 'Fonts timed out; fallback fonts are used.');
      for (const element of document.querySelectorAll('.mu-diagram-error, .diagram-error, [data-export-issue]')) {
        const kind = element.getAttribute('data-export-issue') === 'fallback' ? 'fallback' : 'diagram';
        add(kind, element.textContent.trim() || 'Diagram rendering failed; source is retained.', element.getAttribute('data-source') || undefined);
      }
      return { issues, timedOut };
    })()`), 22000, 'Images or fonts timed out') as { issues: ExportIssue[]; timedOut: boolean }
    if (!settings.allowResourceFailures) {
      if (resources.timedOut) throw new Error('Images or fonts timed out')
      const images = resources.issues.filter((issue) => issue.kind === 'image' || issue.kind === 'diagram')
      if (images.length) throw new Error(`图片加载失败：${images.slice(0, 3).map((issue) => issue.source || issue.message).join('\n')}`)
    }
    issues.push(...resources.issues)
    // User-origin !important rules override supplied author CSS. PDF counters use
    // the native footer instead of the standalone HTML margin-box counter.
    await deadline(win.webContents.insertCSS(exportOptionsCss(options, false), { cssOrigin: 'user' }), 5000, 'Export styling timed out')
    return await deadline(run(win, issues), 60000, 'Export rendering timed out')
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** The sole PDF rendering path: preview and final output use identical settings. */
async function renderHtmlPdf(html: string, input?: unknown, allowResourceFailures = false): Promise<ExportPreviewResult> {
  const options = normalizeExportOptions(input)
  return withExportWindow(html, async (win, issues) => {
    const pdf = await win.webContents.printToPDF({
      printBackground: true, landscape: options.orientation === 'landscape', pageSize: options.pageSize,
      generateTaggedPDF: true, generateDocumentOutline: true, preferCSSPageSize: false,
      margins: {
        top: options.marginMm.top / 25.4, bottom: options.marginMm.bottom / 25.4,
        left: options.marginMm.left / 25.4, right: options.marginMm.right / 25.4
      },
      displayHeaderFooter: options.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font-size:9pt;color:#57606a"><span class="pageNumber"></span></div>'
    })
    return { pdf: new Uint8Array(pdf), issues }
  }, { options, allowResourceFailures })
}

export function previewHtmlPdf(html: string, options: unknown): Promise<ExportPreviewResult> {
  return renderHtmlPdf(html, options, true)
}

/** Load the plugin-enabled rasterizer only for an explicit page request. */
let rasterModule: Promise<typeof import('./exportPdfPreview')> | undefined
let rasterGeneration = 0

export async function previewPdfPage(pdf: unknown, page: unknown): Promise<ExportPreviewPage> {
  const generation = rasterGeneration
  const { renderPdfPreviewPage } = await (rasterModule ??= import('./exportPdfPreview'))
  if (generation !== rasterGeneration) throw new Error('PDF preview released or cancelled')
  return renderPdfPreviewPage(pdf, page)
}

export async function releasePdfPreview(): Promise<void> {
  rasterGeneration++
  if (rasterModule) await (await rasterModule).releasePdfPreview()
}

export async function writeHtmlPdf(filePath: string, html: string, input?: boolean | ExportFileOptions): Promise<void> {
  let options: ExportFileOptions | undefined = typeof input === 'boolean' ? { landscape: input } : input
  // Old calls supplied only landscape (or no options): preserve their 0.6in margins.
  // A new preset, including an explicitly partial preset, uses shared defaults.
  if (!options || !['pageSize', 'orientation', 'marginMm', 'fontSize', 'pageNumbers'].some((key) => Object.hasOwn(options!, key))) {
    options = { ...options, marginMm: { top: 15.24, right: 15.24, bottom: 15.24, left: 15.24 } }
  }
  const { pdf } = await renderHtmlPdf(html, options, options?.allowResourceFailures === true)
  await writeFile(filePath, pdf)
}
