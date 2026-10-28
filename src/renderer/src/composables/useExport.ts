import { reactive } from 'vue'
import { DEFAULT_EXPORT_OPTIONS, normalizeExportOptions, applyExportOptionsToHtml, type ExportOptions, type ExportIssue, type ExportPreviewResult, type ExportPreviewPage } from '../../../shared/exportOptions'
import { translate } from '../../../shared/i18n'
import { currentLocale } from './useI18n'
import '../../../shared/i18nExport'
import { MarkdownToHtml, renderToStaticHTML } from '@muyajs/core'
import { getActiveTab, settings, state } from '../store'
import { baseName } from './useFile'

/** 导出时追加的排版样式：让脱离应用的 HTML/PDF 依然接近 Typora 的观感。 */
const EXPORT_CSS = `
:root { color-scheme: light dark; }
body {
  margin: 0; padding: 44px 24px; background: #fff; color: #24292f;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 16px; line-height: 1.75;
}
.markdown-body { max-width: 860px; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.6em; line-height: 1.3; font-weight: 600; }
h1 { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
h3 { font-size: 1.25em; }
p { margin: 0.85em 0; }
a { color: #0969da; }
code { background: #f6f8fa; padding: .2em .4em; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
pre { background: #f6f8fa; padding: 14px 16px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; border-left: 4px solid #d0d7de; color: #57606a; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #d0d7de; padding: 6px 12px; text-align: left; }
th { background: #f6f8fa; font-weight: 600; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.6em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: .3em 0; }
.idiff.addition { background: #c7f0d2; color: #1f1f1f; border-radius: 2px; }
.idiff.deletion { background: #fac5cd; color: #1f1f1f; border-radius: 2px; }
.katex-display { overflow-x: auto; }
@media print { body { padding: 0; } .markdown-body { max-width: none; } }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #d4d4d4; }
  code, pre, th { background: #2d2d2d; }
  h1, h2 { border-bottom-color: #333; }
  blockquote { border-left-color: #444; color: #9a9a9a; }
  th, td { border-color: #333; }
  a { color: #569cd6; }
  .idiff.addition { background: #234f35; color: #d7f5e1; }
  .idiff.deletion { background: #5a2b35; color: #f7d9de; }
}
`

/** 取当前标签的导出文件名（去掉原扩展名，换成目标扩展名）。 */
function exportName(ext: string): string {
  const tab = getActiveTab()
  if (!tab) return `untitled.${ext}`
  const stem = tab.filePath ? baseName(tab.filePath).replace(/\.[^.]+$/, '') : tab.title
  return `${stem}.${ext}`
}

/**
 * 生成完整独立 HTML。
 *
 * 优先走 `MarkdownToHtml.generate()`：它复用编辑器实例，能把 Mermaid/Vega/
 * PlantUML 图表渲染成静态 SVG，导出结果与所见一致。
 * 该路径依赖图表运行时，一旦失败就退回同步的 `renderToStaticHTML`，
 * 保证导出始终可用（此时图表会以普通代码块保留）。
 */
async function buildHtml(issues: ExportIssue[] = [], tab = getActiveTab()): Promise<string> {
  if (!tab) return ''
  const muya = (window as unknown as { __inkdownMuya?: unknown }).__inkdownMuya
  if (muya) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const converter = new MarkdownToHtml(tab.content, muya as never)
      // 图表渲染可能因外部依赖挂起，加超时保护，超时即回退
      const rendered = await Promise.race([
        converter.generate({ title: tab.title, extraCSS: EXPORT_CSS }),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 30000) })
      ])
      if (rendered) return rendered
      console.warn('[export] 图表渲染超时，回退到静态渲染')
      issues.push({ kind: 'fallback', message: et('export.fallbackTimeout') })
    } catch (err) {
      console.warn('[export] 图表渲染导出失败，回退到静态渲染：', err)
      issues.push({ kind: 'fallback', message: et('export.fallbackError'), source: err instanceof Error ? err.message : String(err) })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  return wrapDocument(
    renderToStaticHTML(tab.content, {
      footnote: settings.footnote,
      superSubScript: settings.superSubScript,
      frontMatter: settings.frontMatter,
      highlightSyntax: settings.highlightSyntax,
      inlineDiff: true,
      multilineBlockquote: settings.multilineBlockquote,
      githubAlerts: settings.githubAlerts
    }),
    tab.title
  )
}

/** 把正文 HTML 包进带样式的完整文档。 */
function wrapDocument(body: string, title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}

/** 供端到端自检调用：不弹保存对话框，直接返回生成的 HTML。 */
export async function buildHtmlForCheck(): Promise<string> {
  return buildHtml()
}

/**
 * 把 Markdown 渲染成静态 HTML 片段，供分栏预览使用。
 *
 * 同步生成基础 HTML；EditorHost 再异步渲染图表，复用未变化的图表节点。
 */
export function renderPreviewHtml(markdown: string): string {
  try {
    return renderToStaticHTML(markdown, {
      footnote: settings.footnote,
      superSubScript: settings.superSubScript,
      frontMatter: settings.frontMatter,
      // 默认是 false，不开的话 ==高亮== 会原样显示
      highlightSyntax: settings.highlightSyntax,
      // 公式：与偏好设置保持一致（选项名是 texMathDollars / texMathGfm）
      texMathDollars: settings.texMathDollars,
      texMathGfm: settings.texMathGfm,
      texMathSingleBackslash: settings.texMathSingleBackslash,
      texMathDoubleBackslash: settings.texMathDoubleBackslash,
      multilineBlockquote: settings.multilineBlockquote,
      githubAlerts: settings.githubAlerts,
      inlineDiff: true
    })
  } catch (err) {
    console.warn('[preview] 渲染失败:', err)
    return ''
  }
}

// 暴露给主进程自检使用
;(window as unknown as Record<string, unknown>).__inkdownExport = { buildHtmlForCheck }


function et(key: string): string { return translate(currentLocale.value, key) }
type ExportFormat = 'pdf' | 'docx' | 'html'
const OPTIONS_KEY = 'inkdown-export-options-v1'
export function loadExportOptions(): ExportOptions {
  try { return normalizeExportOptions(JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null')) }
  catch { return normalizeExportOptions(DEFAULT_EXPORT_OPTIONS) }
}
export const exportPreview = reactive({
  visible: false, format: 'pdf' as ExportFormat, title: '', name: '', markdown: '', html: '',
  options: loadExportOptions(), issues: [] as ExportIssue[],
  phase: 'building' as 'building' | 'previewing' | 'ready' | 'saving', error: '', pdfUrl: '',
  pdfBytes: new Uint8Array(), pageImage: '', imageReady: false, page: 1, pageCount: 1, pageBusy: false
})
let requestId = 0
let pageRequestId = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined
let resolveExport: ((saved: boolean) => void) | undefined
let renderIssues: ExportIssue[] = []
interface PreviewLayout { result: ExportPreviewResult; pages: Map<number, ExportPreviewPage> }
const layouts = new Map<string, PreviewLayout>()
let activeLayout: PreviewLayout | undefined
let documentEpoch = 0
let pdfRunning = false
let queuedPreview: { id: number; epoch: number; key: string; html: string; options: ExportOptions } | null = null
const layoutKey = (options: ExportOptions): string => JSON.stringify(normalizeExportOptions(options))
function trimLayouts(): void {
  const cost = (): number => [...layouts.values()].reduce((total, entry) => total + entry.result.pdf.byteLength + [...entry.pages.values()].reduce((bytes, page) => bytes + page.image.length * 2, 0), 0)
  while (layouts.size > 1 && (layouts.size > 3 || cost() > 24 * 1024 * 1024)) {
    const oldest = [...layouts].find(([, entry]) => entry !== activeLayout)?.[0]
    if (!oldest) break
    layouts.delete(oldest)
  }
}

function releasePdf(clearImage = true): void {
  if (exportPreview.pdfUrl) URL.revokeObjectURL(exportPreview.pdfUrl)
  exportPreview.pdfUrl = ''
  exportPreview.pdfBytes = new Uint8Array()
  exportPreview.imageReady = false
  if (clearImage) exportPreview.pageImage = ''
  activeLayout = undefined
  pageRequestId++
}

export function closeExportPreview(saved = false): void {
  if (exportPreview.phase === 'saving' && !saved) return
  requestId++
  documentEpoch++
  queuedPreview = null
  layouts.clear()
  const release = window.inkdown.releaseExportPreview
  if (release) void release().catch(() => {})
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = undefined
  exportPreview.visible = false
  releasePdf()
  resolveExport?.(saved)
  resolveExport = undefined
}

async function displayLayout(entry: PreviewLayout): Promise<void> {
  releasePdf(false)
  activeLayout = entry
  exportPreview.pdfBytes = new Uint8Array(entry.result.pdf)
  exportPreview.pdfUrl = URL.createObjectURL(new Blob([new Uint8Array(entry.result.pdf)], { type: 'application/pdf' }))
  exportPreview.issues = [...renderIssues, ...entry.result.issues]
  await showExportPage(1)
}

/** Serialize expensive PDF jobs, retaining only the newest pending settings. */
async function generatePreview(id: number): Promise<void> {
  if (id !== requestId || !exportPreview.visible) return
  const options = normalizeExportOptions(exportPreview.options)
  const cached = layouts.get(layoutKey(options))
  if (cached) {
    queuedPreview = null
    layouts.delete(layoutKey(options))
    layouts.set(layoutKey(options), cached)
    await displayLayout(cached)
    return
  }
  queuedPreview = { id, epoch: documentEpoch, key: layoutKey(options), html: exportPreview.html, options }
  if (pdfRunning) return
  pdfRunning = true
  try {
    while (queuedPreview) {
      const work = queuedPreview
      queuedPreview = null
      if (work.id !== requestId || work.epoch !== documentEpoch || !exportPreview.visible) continue
      try {
        let entry = layouts.get(work.key)
        if (!entry) {
          const result = await window.inkdown.previewExport(work.html, work.options)
          if (work.epoch !== documentEpoch || !exportPreview.visible) continue
          entry = { result: { pdf: new Uint8Array(result.pdf), issues: result.issues }, pages: new Map() }
        }
        layouts.delete(work.key)
        layouts.set(work.key, entry)
        trimLayouts()
        if (work.id !== requestId || work.epoch !== documentEpoch || !exportPreview.visible) continue
        await displayLayout(entry)
      } catch (error) {
        if (work.id !== requestId || work.epoch !== documentEpoch || !exportPreview.visible) continue
        exportPreview.error = error instanceof Error ? error.message : String(error)
        exportPreview.phase = 'ready'
      }
    }
  } finally { pdfRunning = false }
}

export async function showExportPage(page: number): Promise<void> {
  if (!exportPreview.visible || !exportPreview.pdfBytes.length || !activeLayout) return
  const id = ++pageRequestId, documentId = requestId, epoch = documentEpoch, entry = activeLayout
  exportPreview.pageBusy = true
  try {
    let result = entry.pages.get(page)
    if (!result) {
      result = await window.inkdown.previewExportPage(new Uint8Array(exportPreview.pdfBytes), page)
      if (epoch !== documentEpoch) return
      entry.pages.set(result.page, result)
      while (entry.pages.size > 1 && (entry.pages.size > 10 || [...entry.pages.values()].reduce((sum, page) => sum + page.image.length * 2, 0) > 8 * 1024 * 1024)) entry.pages.delete(entry.pages.keys().next().value!)
      trimLayouts()
    }
    if (id !== pageRequestId || documentId !== requestId || !exportPreview.visible) return
    exportPreview.error = ''
    exportPreview.imageReady = true
    exportPreview.pageImage = result.image
    exportPreview.page = result.page
    exportPreview.pageCount = result.pageCount
    exportPreview.phase = 'ready'
  } catch (error) {
    if (id !== pageRequestId || documentId !== requestId || !exportPreview.visible) return
    exportPreview.error = error instanceof Error ? error.message : String(error)
    exportPreview.phase = 'ready'
  } finally {
    if (id === pageRequestId) exportPreview.pageBusy = false
  }
}

export async function retryExportPreview(): Promise<void> {
  if (!exportPreview.visible || exportPreview.phase !== 'ready' || exportPreview.pageBusy) return
  exportPreview.error = ''
  exportPreview.phase = 'previewing'
  if (exportPreview.pdfBytes.length && activeLayout) await showExportPage(1)
  else await generatePreview(++requestId)
}

export function updateExportOptions(options: ExportOptions): void {
  const normalized = normalizeExportOptions(options)
  if (layoutKey(normalized) === layoutKey(exportPreview.options)) return
  exportPreview.options = normalized
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(exportPreview.options)) } catch { /* Storage may be unavailable. */ }
  if (!exportPreview.visible || !exportPreview.html || exportPreview.phase === 'saving') return
  const id = ++requestId
  exportPreview.phase = 'previewing'
  exportPreview.error = ''
  releasePdf(false)
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => { previewTimer = undefined; void generatePreview(id) }, 250)
}

async function openExportPreview(format: ExportFormat): Promise<boolean> {
  if (exportPreview.phase === 'saving') return false
  const tab = getActiveTab()
  if (!tab) return false
  const snapshot = { ...tab }
  closeExportPreview()
  const id = ++requestId
  Object.assign(exportPreview, { visible: true, format, title: snapshot.title, name: exportName(format), markdown: snapshot.content,
    html: '', issues: [], phase: 'building', error: '', page: 1, pageCount: 1, pageBusy: false, options: loadExportOptions() })
  renderIssues = []
  const finished = new Promise<boolean>(resolve => { resolveExport = resolve })
  const collected: ExportIssue[] = []
  try {
    const html = await buildHtml(collected, snapshot)
    if (id !== requestId || !exportPreview.visible) return finished
    exportPreview.html = html
    renderIssues = collected
    exportPreview.issues = [...renderIssues]
    exportPreview.phase = 'previewing'
    void generatePreview(id)
  } catch (error) {
    if (id === requestId && exportPreview.visible) {
      exportPreview.error = error instanceof Error ? error.message : String(error)
      exportPreview.phase = 'ready'
    }
  }
  return finished
}

export async function saveExportPreview(): Promise<void> {
  if (exportPreview.phase !== 'ready' || !exportPreview.imageReady || !exportPreview.pageImage || exportPreview.pageBusy || !exportPreview.pdfUrl) return
  exportPreview.phase = 'saving'
  exportPreview.error = ''
  try {
    const options = { ...normalizeExportOptions(exportPreview.options), allowResourceFailures: true }
    let saved = false
    if (exportPreview.format === 'pdf') {
      const target = await window.inkdown.saveAsDialog(exportPreview.name)
      if (target) {
        saved = await window.inkdown.exportPdf(target, exportPreview.html, options)
        if (!saved) throw new Error(et('export.saveError'))
      }
    } else if (exportPreview.format === 'docx') {
      saved = !!await window.inkdown.exportDocx(exportPreview.markdown, exportPreview.name, exportPreview.title, exportPreview.html, options)
    } else {
      saved = !!await window.inkdown.saveFileDialog(exportPreview.name, applyExportOptionsToHtml(exportPreview.html, options))
    }
    if (saved) closeExportPreview(true)
  } catch (error) {
    exportPreview.error = error instanceof Error ? error.message : String(error)
  } finally {
    exportPreview.phase = 'ready'
  }
}

export async function exportHtml(): Promise<boolean> { return openExportPreview('html') }
export async function exportDocxFile(): Promise<boolean> { return openExportPreview('docx') }
export async function exportPdf(): Promise<boolean> { return openExportPreview('pdf') }

/**
 * 打印当前文档。
 *
 * 与导出走同一个 buildHtml：同一套图表渲染与 CSS，保证「打印所见」与「导出所得」一致。
 * 不经过导出预览对话框——打印由系统对话框负责页面设置，多一层预览反而绕。
 * 用户取消打印返回 false，调用方不应把它当错误提示。
 */
export async function printDocument(): Promise<boolean> {
  const tab = getActiveTab()
  if (!tab) return false
  const issues: ExportIssue[] = []
  const html = await buildHtml(issues, tab)
  const result = await window.inkdown.print(html)
  return result.printed
}
