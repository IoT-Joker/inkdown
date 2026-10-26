/** Physical units: millimetres for margins, points for text. */
export interface ExportOptions {
  pageSize: 'A4' | 'A5' | 'Letter'
  orientation: 'portrait' | 'landscape'
  marginMm: { top: number; right: number; bottom: number; left: number }
  fontSize: number
  pageNumbers: boolean
}

export interface ExportIssue {
  kind: 'image' | 'diagram' | 'fallback'
  message: string
  source?: string
}

export interface ExportPreviewResult { pdf: Uint8Array; issues: ExportIssue[] }

/** A single rasterized PDF page; page numbers are 1-based. */
export interface ExportPreviewPage { image: string; page: number; pageCount: number }

/** Also accepts the PDF bridge's original landscape flag. */
export type ExportFileOptions = Partial<ExportOptions> & { landscape?: boolean; allowResourceFailures?: boolean }

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = Object.freeze({
  pageSize: 'A4', orientation: 'portrait',
  marginMm: Object.freeze({ top: 15, right: 15, bottom: 15, left: 15 }),
  fontSize: 12, pageNumbers: false
})

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const bounded = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

/** No coercion of strings/booleans; never retain references to persisted/IPC data. */
export function normalizeExportOptions(value: unknown): ExportOptions {
  const input = record(value)
  const margin = record(input.marginMm)
  const defaults = DEFAULT_EXPORT_OPTIONS
  return {
    pageSize: input.pageSize === 'A5' || input.pageSize === 'Letter' ? input.pageSize : 'A4',
    orientation: input.orientation === 'portrait' || input.orientation === 'landscape'
      ? input.orientation : input.landscape === true ? 'landscape' : 'portrait',
    marginMm: {
      top: bounded(margin.top, defaults.marginMm.top, 0, 50), right: bounded(margin.right, defaults.marginMm.right, 0, 50),
      bottom: bounded(margin.bottom, defaults.marginMm.bottom, 0, 50), left: bounded(margin.left, defaults.marginMm.left, 0, 50)
    },
    fontSize: bounded(input.fontSize, defaults.fontSize, 6, 72), pageNumbers: input.pageNumbers === true
  }
}

/** Dimensions in the selected orientation. */
export function exportPageSizeMm(options: ExportOptions): { width: number; height: number } {
  const [width, height] = options.pageSize === 'A5' ? [148, 210] : options.pageSize === 'Letter' ? [215.9, 279.4] : [210, 297]
  return options.orientation === 'landscape' ? { width: height, height: width } : { width, height }
}

/** Shared by standalone HTML, PDF, and Chromium's DOCX layout/capture pass. */
export function exportOptionsCss(value: unknown, htmlPageNumbers = true): string {
  const options = normalizeExportOptions(value)
  const { top, right, bottom, left } = options.marginMm
  const width = exportPageSizeMm(options).width - left - right
  return `
    @page {
      size: ${options.pageSize} ${options.orientation} !important;
      margin: ${top}mm ${right}mm ${bottom}mm ${left}mm !important;
      @top-left { content: none !important; } @top-center { content: none !important; } @top-right { content: none !important; }
      @bottom-left { content: none !important; } @bottom-right { content: none !important; }
      @bottom-center { content: ${htmlPageNumbers && options.pageNumbers ? 'counter(page)' : 'none'} !important; color: #57606a; font-size: 9pt; }
    }
    :root, html { color-scheme: light !important; background: #fff !important; }
    html body { width: ${width}mm !important; max-width: ${width}mm !important; margin: 0 auto !important; padding: 0 !important; background: #fff !important; color: #24292f !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
      font-size: ${options.fontSize}pt !important; line-height: 1.75; }
    html body .markdown-body { box-sizing: border-box !important; width: ${width}mm !important;
      min-width: 0 !important; max-width: ${width}mm !important; margin: 0 auto !important; padding: 0 !important;
      background: #fff !important; color: #24292f !important; font-size: ${options.fontSize}pt !important; }
    html body :is(p, li, td, th, blockquote, details, summary) { font-size: inherit !important; }
    html body h1 { font-size: 2em !important; } html body h2 { font-size: 1.5em !important; }
    html body h3 { font-size: 1.25em !important; } html body h4 { font-size: 1em !important; }
    html body h5 { font-size: .875em !important; } html body h6 { font-size: .85em !important; }
    html body :is(code, pre, th) { background-color: #f6f8fa !important; color: #24292f !important; }
    html body pre { font-size: .9em !important; white-space: pre-wrap !important; overflow: visible !important; overflow-wrap: anywhere; }
    html body pre code { font-size: inherit !important; background: none !important; white-space: inherit !important; }
    html body a { color: #0969da !important; }
    html body blockquote { color: #57606a !important; border-left-color: #d0d7de !important; }
    html body :is(h1, h2, th, td) { border-color: #d0d7de !important; }
    html body .idiff.addition { background: #c7f0d2 !important; color: #1f1f1f !important; }
    html body .idiff.deletion { background: #fac5cd !important; color: #1f1f1f !important; }
    html body .katex-display, html body .katex-display > .katex { overflow: visible !important; }
    html body :is(img, svg) { max-width: 100%; }
    html body :is(h1, h2, h3, h4, h5, h6) { break-after: avoid-page; page-break-after: avoid; }
    html body :is(.mermaid, .plantuml, .vega-lite, .flowchart, .sequence) { break-inside: avoid-page; }
    *::-webkit-scrollbar { display: none !important; }
    @media print { html body, html body .markdown-body { width: 100% !important; max-width: none !important; } }
  `
}

/** Append after supplied styles; repeat application replaces our previous preset. */
export function applyExportOptionsToHtml(html: string, options: unknown): string {
  const clean = html.replace(/<style\b[^>]*\bdata-inkdown-export-options(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  return clean + '\n<style data-inkdown-export-options>\n' + exportOptionsCss(options) + '\n</style>'
}
