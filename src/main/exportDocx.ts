import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType
} from 'docx'

/**
 * Markdown → Word (.docx) 导出。
 *
 * 设计取舍：不直接搬 HTML，而是把 Markdown 解析成块级结构后映射到
 * Word 的原生段落样式（标题层级、列表、表格、代码块），
 * 这样导出的文档在 Word 里是「真样式」，可继续编辑、能生成目录。
 *
 * 内联格式（加粗/斜体/行内代码/删除线/链接）按 span 级别还原。
 */

/** 内联节点：带格式的文本片段。 */
interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  underline?: boolean
  highlight?: boolean
}

/** 块级节点。 */
type BlockNode =
  | { kind: 'heading'; level: number; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'list'; ordered: boolean; items: InlineRun[][] }
  | { kind: 'quote'; runs: InlineRun[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; header: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: 'hr' }

/** 把一段含 Markdown 内联标记的文本解析成带格式的片段。 */
function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  // 逐个识别 **粗体**、*斜体*、`代码`、~~删除线~~、==高亮==、<u>下划线</u>
  const re =
    /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(~~([^~]+)~~)|(==([^=]+)==)|(<u>([^<]+)<\/u>)/g
  let last = 0
  let m: RegExpExecArray | null

  const pushPlain = (s: string): void => {
    if (s) runs.push({ text: s })
  }

  while ((m = re.exec(text))) {
    pushPlain(text.slice(last, m.index))
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true })
    else if (m[4] !== undefined) runs.push({ text: m[4], bold: true })
    else if (m[6] !== undefined) runs.push({ text: m[6], italic: true })
    else if (m[8] !== undefined) runs.push({ text: m[8], italic: true })
    else if (m[10] !== undefined) runs.push({ text: m[10], code: true })
    else if (m[12] !== undefined) runs.push({ text: m[12], strike: true })
    else if (m[14] !== undefined) runs.push({ text: m[14], highlight: true })
    else if (m[16] !== undefined) runs.push({ text: m[16], underline: true })
    last = m.index + m[0].length
  }
  pushPlain(text.slice(last))
  return runs.length ? runs : [{ text }]
}

/** 表格一行：按 | 切分，去掉首尾空列。 */
function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

/** 判断是否是表格分隔行（|---|---|）。 */
function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
}

/** 把 Markdown 解析成块级结构。 */
export function parseMarkdownBlocks(md: string): BlockNode[] {
  const lines = md.split(/\r?\n/)
  const blocks: BlockNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (!line.trim()) {
      i++
      continue
    }

    // 代码块
    const fence = line.match(/^\s*(```|~~~)(.*)$/)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2].trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i])
        i++
      }
      i++ // 跳过结束标记
      blocks.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length, runs: parseInline(h[2]) })
      i++
      continue
    }

    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line).map(parseInline)
      i += 2
      const rows: InlineRun[][][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]).map(parseInline))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', runs: parseInline(body.join(' ')) })
      continue
    }

    // 列表（有序 / 无序 / 任务列表）
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[2])
      const items: InlineRun[][] = []
      while (i < lines.length) {
        const lm = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
        if (!lm) break
        if (/^\d+\./.test(lm[2]) !== ordered) break
        // 去掉任务列表的 [ ] / [x] 前缀
        const content = lm[3].replace(/^\[[ xX]\]\s*/, '')
        items.push(parseInline(content))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // 普通段落：连续非空行合并
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      para.push(lines[i])
      i++
    }
    if (para.length) blocks.push({ kind: 'paragraph', runs: parseInline(para.join(' ')) })
  }

  return blocks
}

/** 把内联片段转成 docx 的 TextRun。 */
function toRuns(runs: InlineRun[]): TextRun[] {
  return runs.map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        strike: r.strike,
        underline: r.underline ? {} : undefined,
        highlight: r.highlight ? 'yellow' : undefined,
        font: r.code ? 'Consolas' : undefined,
        shading: r.code ? { fill: 'F2F2F2' } : undefined
      })
  )
}

/** 标题层级 → docx 的 HeadingLevel。 */
function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const map = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6
  ]
  return map[Math.min(level, 6) - 1] ?? HeadingLevel.HEADING_1
}

/** 把块级结构转成 docx 的文档元素。 */
function blocksToDocx(blocks: BlockNode[], title: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []

  // 文档标题
  if (title) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 36 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 }
      })
    )
  }

  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: headingLevel(b.level),
            children: toRuns(b.runs),
            spacing: { before: 240, after: 120 }
          })
        )
        break

      case 'paragraph':
        out.push(new Paragraph({ children: toRuns(b.runs), spacing: { after: 120 } }))
        break

      case 'quote':
        out.push(
          new Paragraph({
            children: toRuns(b.runs),
            indent: { left: 480 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 }
            },
            spacing: { after: 120 }
          })
        )
        break

      case 'code':
        out.push(
          new Paragraph({
            children: [
              new TextRun({
                text: b.text,
                font: 'Consolas',
                size: 20
              })
            ],
            shading: { fill: 'F6F8FA' },
            spacing: { after: 120 }
          })
        )
        break

      case 'list':
        for (const item of b.items) {
          out.push(
            new Paragraph({
              children: toRuns(item),
              bullet: b.ordered ? undefined : { level: 0 },
              numbering: b.ordered ? { reference: 'ordered', level: 0 } : undefined,
              spacing: { after: 60 }
            })
          )
        }
        break

      case 'table': {
        const colCount = Math.max(b.header.length, ...b.rows.map((r) => r.length))
        const makeRow = (cells: InlineRun[][], isHeader: boolean): TableRow =>
          new TableRow({
            tableHeader: isHeader,
            children: Array.from({ length: colCount }, (_, ci) => {
              const cell = cells[ci] ?? [{ text: '' }]
              return new TableCell({
                children: [
                  new Paragraph({
                    children: toRuns(cell.map((r) => (isHeader ? { ...r, bold: true } : r)))
                  })
                ],
                width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE }
              })
            })
          })

        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [makeRow(b.header, true), ...b.rows.map((r) => makeRow(r, false))]
          })
        )
        out.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        break
      }

      case 'hr':
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD' } },
            spacing: { after: 120 }
          })
        )
        break
    }
  }

  return out
}

/**
 * 把 Markdown 转成 .docx 的二进制内容。
 *
 * @param markdown 文档内容
 * @param title 文档标题（通常用文件名）
 */
export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const blocks = parseMarkdownBlocks(markdown)
  const children = blocksToDocx(blocks, title)

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {},
        children: children.length ? children : [new Paragraph({ text: '' })]
      }
    ]
  })

  return Packer.toBuffer(doc)
}

// 供自检使用
export const __docxInternals = { parseMarkdownBlocks }
