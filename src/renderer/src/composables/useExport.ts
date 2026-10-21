import { MarkdownToHtml, renderToStaticHTML } from '@muyajs/core'
import { getActiveTab, settings } from '../store'
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
.katex-display { overflow-x: auto; }
@media print { body { padding: 0; } .markdown-body { max-width: none; } }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #d4d4d4; }
  code, pre, th { background: #2d2d2d; }
  h1, h2 { border-bottom-color: #333; }
  blockquote { border-left-color: #444; color: #9a9a9a; }
  th, td { border-color: #333; }
  a { color: #569cd6; }
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
async function buildHtml(): Promise<string> {
  const tab = getActiveTab()
  if (!tab) return ''
  const muya = (window as unknown as { __inkdownMuya?: unknown }).__inkdownMuya
  if (muya) {
    try {
      const converter = new MarkdownToHtml(tab.content, muya as never)
      // 图表渲染可能因外部依赖挂起，加超时保护，超时即回退
      const rendered = await Promise.race([
        converter.generate({ title: tab.title, extraCSS: EXPORT_CSS }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
      ])
      if (rendered) return rendered
      console.warn('[export] 图表渲染超时，回退到静态渲染')
    } catch (err) {
      console.warn('[export] 图表渲染导出失败，回退到静态渲染：', err)
    }
  }
  return wrapDocument(
    renderToStaticHTML(tab.content, {
      footnote: settings.footnote,
      superSubScript: settings.superSubScript,
      frontMatter: settings.frontMatter
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
 * 走同步的 renderToStaticHTML：不渲染 Mermaid/Vega 等图表（那些需要异步运行时），
 * 换来的是即时响应——预览区随输入实时更新，不适合每次等几秒渲染图表。
 * 需要完整图表时用导出功能。
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
      githubAlerts: settings.githubAlerts
    })
  } catch (err) {
    console.warn('[preview] 渲染失败:', err)
    return ''
  }
}

// 暴露给主进程自检使用
;(window as unknown as Record<string, unknown>).__inkdownExport = { buildHtmlForCheck }

/** 导出为 HTML 文件。 */
export async function exportHtml(): Promise<boolean> {
  const tab = getActiveTab()
  if (!tab) return false
  const html = await buildHtml()
  const saved = await window.inkdown.saveFileDialog(exportName('html'), html)
  return !!saved
}

/**
 * 导出为 Word (.docx)。
 *
 * 直接把 Markdown 源码交给主进程，由主进程解析成 Word 原生段落样式
 * （标题层级、列表、表格、代码块），这样在 Word 里是可继续编辑的真样式，
 * 而不是一张图片或一堆散落的 HTML。
 */
export async function exportDocxFile(): Promise<boolean> {
  const tab = getActiveTab()
  if (!tab) return false
  const title = tab.filePath ? baseName(tab.filePath).replace(/\.[^.]+$/, '') : tab.title
  const saved = await window.inkdown.exportDocx(tab.content, exportName('docx'), title || 'Inkdown')
  return !!saved
}

/**
 * 导出为 PDF。
 * 文档 HTML 交给主进程在独立的隐藏窗口里渲染并打印，
 * 避免把侧边栏/标签栏/状态栏一起打进 PDF。
 */
export async function exportPdf(): Promise<boolean> {
  const tab = getActiveTab()
  if (!tab) return false
  const target = await window.inkdown.saveAsDialog(exportName('pdf'))
  if (!target) return false

  const html = await buildHtml()
  return window.inkdown.exportPdf(target, html)
}
