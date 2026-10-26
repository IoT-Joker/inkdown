import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun, AlignmentType, Bookmark, InternalHyperlink, Footer, PageNumber, PageOrientation, type ParagraphChild } from 'docx'
import { withExportWindow } from './exportWindow'
import { exportPageSizeMm, normalizeExportOptions, type ExportFileOptions } from '../shared/exportOptions'

interface VisualBlock {
  index: number
  kind: 'text' | 'image'
  level: number
  bookmark?: string
  indent?: number
  before: number
  after: number
  align: string
  runs: Array<{ anchor?: string; text: string; bold: boolean; italic: boolean; strike: boolean; underline: boolean; font: string; size: number; color: string }>
}

/** Keep ordinary text editable; capture complex blocks using Chromium's real layout. */
export async function htmlToVisualDocx(html: string, title: string, input?: ExportFileOptions): Promise<Buffer> {
  const options = normalizeExportOptions(input)
  const page = exportPageSizeMm(options)
  const contentWidth = (page.width - options.marginMm.left - options.marginMm.right) * 96 / 25.4
  const contentHeight = (page.height - options.marginMm.top - options.marginMm.bottom) * 96 / 25.4
  const twips = (mm: number) => Math.round(mm * 1440 / 25.4)
  return withExportWindow(html, async (win) => {
    await win.webContents.insertCSS(`html, body { overflow: visible !important; } html body .markdown-body { box-sizing: border-box; width: ${contentWidth}px !important; max-width: ${contentWidth}px !important; padding-left: 0 !important; padding-right: 0 !important; margin-left: auto !important; margin-right: auto !important; } .katex-display, .katex-display > .katex { overflow: visible !important; } *::-webkit-scrollbar { display: none !important; }`, { cssOrigin: 'user' })
    const blocks = await win.webContents.executeJavaScript(`(() => {
      for (const details of document.querySelectorAll('details')) details.open = true;
      const root = document.querySelector('article.markdown-body') || document.body;
      const headings = new Map();
      const targets = new Map();
      for (const element of root.children) {
        if (!/^H[1-6]$/.test(element.tagName)) continue;
        const bookmark = 'inkdown_h_' + (headings.size + 1);
        headings.set(element, bookmark);
        if (element.id && !targets.has(element.id)) targets.set(element.id, bookmark);
      }
      const targetFor = (anchor) => {
        const href = anchor?.getAttribute('href');
        if (!href?.startsWith('#')) return undefined;
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch {}
        return targets.get(id);
      };
      const readBlock = (element, index, tocItem = false) => {
        const style = getComputedStyle(element);
        const text = tocItem || /^(P|H[1-6])$/.test(element.tagName) && !element.querySelector('img, svg, .katex, input, canvas');
        const runs = [];
        const walk = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const s = getComputedStyle(node.parentElement);
            const color = s.color.match(/\\d+/g)?.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('') || '24292f';
            const fonts = s.fontFamily.split(',').map((name) => name.trim().replace(/['"]/g, ''));
            const font = fonts.includes('Consolas') ? 'Consolas' : fonts.find((name) => !/^(-|BlinkMac|ui-|system-ui|sans-serif|serif|monospace|Noto Music|Noto Sans Math)/i.test(name)) || 'Segoe UI';
            const anchor = targetFor(node.parentElement.closest('a[href]'));
            runs.push({ text: /pre/.test(s.whiteSpace) ? node.textContent : node.textContent.replace(/\\s+/g, ' '), bold: Number(s.fontWeight) >= 600, italic: s.fontStyle === 'italic', strike: s.textDecorationLine.includes('line-through'), underline: s.textDecorationLine.includes('underline'), font, size: Math.round(parseFloat(s.fontSize) * 1.5), color, anchor });
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (getComputedStyle(node).display === 'none') return;
            if (tocItem && node !== element && /^(UL|OL)$/.test(node.tagName)) return;
            if (node.tagName === 'BR') { runs.push({ text: '\\n' }); return; }
            for (const child of node.childNodes) walk(child);
          }
        };
        if (text) walk(element);
        return { index, kind: text ? 'text' : 'image', level: /^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1]) : 0, bookmark: headings.get(element), before: parseFloat(style.marginTop) || 0, after: parseFloat(style.marginBottom) || 0, align: style.textAlign, runs };
      };
      return [...root.children].flatMap((element, index) => {
        element.setAttribute('data-inkdown-export-index', index);
        if (/^(UL|OL)$/.test(element.tagName)) {
          const items = [...element.querySelectorAll('li')];
          const blocks = items.map((item) => readBlock(item, index, true));
          const toc = blocks.length && blocks.every((block) => {
            const visibleRuns = block.runs.filter((run) => run.text.trim());
            return visibleRuns.length && visibleRuns.every((run) => run.anchor);
          });
          if (toc) return blocks.map((block, i) => {
            let indent = 0;
            for (let parent = items[i].parentElement; parent && parent !== element; parent = parent.parentElement) {
              if (/^(UL|OL)$/.test(parent.tagName)) indent++;
            }
            return { ...block, indent };
          });
        }
        return [readBlock(element, index)];
      });
    })()`) as VisualBlock[]
    const children: Paragraph[] = []
    for (const block of blocks) {
      if (block.kind === 'text') {
        const runs: ParagraphChild[] = block.runs.flatMap((run) => run.text.split('\n').map((text, i) => {
          const content = new TextRun({
            text, break: i ? 1 : undefined, bold: run.bold, italics: run.italic,
            strike: run.strike, underline: run.underline ? {} : undefined,
            font: run.font, size: run.size, color: run.color,
            style: run.anchor ? 'Hyperlink' : undefined
          })
          return run.anchor ? new InternalHyperlink({ anchor: run.anchor, children: [content] }) : content
        }))
        const heading = block.level ? Object.values(HeadingLevel)[block.level - 1] : undefined
        children.push(new Paragraph({ children: block.bookmark ? [new Bookmark({ id: block.bookmark, children: runs })] : runs, heading,
          indent: block.indent ? { left: block.indent * 360 } : undefined,
          alignment: block.align === 'center' ? AlignmentType.CENTER : block.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { before: Math.round(block.before * 15), after: Math.round(block.after * 15) },
          keepNext: !!heading
        }))
        continue
      }
      const dimensions = await win.webContents.executeJavaScript(`(() => {
        const r = document.querySelector('[data-inkdown-export-index="${block.index}"]').getBoundingClientRect();
        return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
      })()`) as { width: number; height: number }
      if (!dimensions.width || !dimensions.height) continue
      const scale = Math.min(1, contentWidth / dimensions.width)
      // Reserve room for the Word paragraph's line box/spacing around pictures.
      const chunkHeight = Math.max(1, Math.min(1000, Math.floor(Math.max(1, contentHeight - 32) / scale)))
      for (let offset = 0; offset < dimensions.height; offset += chunkHeight) {
        const height = Math.min(chunkHeight, dimensions.height - offset)
        const rect = await win.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('[data-inkdown-export-index="${block.index}"]');
          const top = el.getBoundingClientRect().top + scrollY + ${offset};
          scrollTo(0, top);
          const r = el.getBoundingClientRect();
          return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top + ${offset})), width: Math.min(${dimensions.width}, innerWidth - Math.max(0, Math.floor(r.left))), height: ${height} };
        })()`) as { x: number; y: number; width: number; height: number }
        await new Promise((resolve) => setTimeout(resolve, 30))
        const image = await win.webContents.capturePage(rect)
        const picture = new ImageRun({ type: 'png', data: image.toPNG(), transformation: { width: rect.width * scale, height: height * scale } })
        const bookmark = offset === 0 ? block.bookmark : undefined
        children.push(new Paragraph({
          children: bookmark ? [new Bookmark({ id: bookmark, children: [picture] })] : [picture],
          spacing: { before: offset === 0 ? Math.round(block.before * 15) : 0, after: 120 }
        }))
      }
    }
    // docx swaps the supplied portrait dimensions when orientation is landscape.
    const portrait = exportPageSizeMm({ ...options, orientation: 'portrait' })
    const doc = new Document({ title, creator: 'Inkdown',
      styles: { default: { document: { run: { size: options.fontSize * 2 } } } },
      sections: [{
        properties: { page: {
          size: { width: twips(portrait.width), height: twips(portrait.height), orientation: options.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: twips(options.marginMm.top), right: twips(options.marginMm.right), bottom: twips(options.marginMm.bottom), left: twips(options.marginMm.left), footer: twips(Math.min(7, options.marginMm.bottom / 2)) }
        } },
        footers: options.pageNumbers ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '57606a' })] })] }) } : undefined,
        children: children.length ? children : [new Paragraph('')]
      }]
    })
    return Packer.toBuffer(doc)
  }, { options, allowResourceFailures: input?.allowResourceFailures === true })
}
