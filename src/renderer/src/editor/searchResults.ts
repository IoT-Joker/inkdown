/**
 * 把查找/替换内核返回的匹配结果整理成可点击的列表项。
 *
 * 内核的 IMatch 只有 start/end/block/match，列表要展示「第几行 + 上下文」，
 * 因此需要从匹配位置反推行号，并截取前后文。
 *
 * 独立成模块的原因：这是纯函数逻辑，可以脱离 DOM 与 Electron 单测。
 */

/** 一条搜索结果。 */
export interface SearchResultItem {
  /** 在全部匹配中的序号（0 基），用于跳转。 */
  index: number
  /** 匹配文本。 */
  match: string
  /** 1 基行号。 */
  line: number
  /** 1 基列号。 */
  column: number
  /** 命中前的上下文片段。 */
  before: string
  /** 命中后的上下文片段。 */
  after: string
  /** 是否跨行匹配（跨行时上下文展示会省略换行）。 */
  multiline: boolean
}

/** 内核 IMatch 里本模块需要的字段，避免直接依赖内核类型。 */
export interface RawMatch {
  start: number
  end: number
  match: string
  /** 命中所在块的纯文本。可选：拿不到时退化为仅显示匹配文本。 */
  blockText?: string
}

/** 上下文各取多少个字符。 */
const CONTEXT_CHARS = 40

/** 折叠换行与连续空白，保证列表里是单行。 */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * 统计 `text` 中 offset 之前的换行数，得到 1 基行号。
 * 同时返回该行起始偏移，用于算列号。
 */
function lineInfoAt(text: string, offset: number): { line: number; lineStart: number } {
  let line = 1
  let lineStart = 0
  const limit = Math.min(offset, text.length)
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++
      lineStart = i + 1
    }
  }
  return { line, lineStart }
}

/**
 * 把内核匹配结果整理成列表项。
 *
 * 关于行号：内核的 `start` 是**块内偏移**，块与块之间的换行不计入。
 * 直接用它算出行号会得到「每个段落都是第 1 行」，对用户没有意义。
 * 因此这里额外接收一个「文档绝对偏移」，由调用方按块在文档中的顺序累加得出。
 *
 * @param matches 内核返回的匹配数组
 * @param blockTextOf 取某个匹配所在块的纯文本；拿不到可返回 undefined
 * @param docOffsetOf 取某个匹配在整篇文档中的绝对字符偏移（含块间换行）
 */
export function buildSearchResults(
  matches: readonly RawMatch[],
  blockTextOf?: (match: RawMatch) => string | undefined,
  docOffsetOf?: (match: RawMatch, index: number) => number | undefined,
  documentText?: string
): SearchResultItem[] {
  return matches.map((m, index) => {
    const text = m.blockText ?? blockTextOf?.(m) ?? m.match
    // start 是块内偏移；文本比偏移短时（例如块文本获取失败）退化为整个匹配
    const offset = m.start >= 0 && m.start <= text.length ? m.start : 0

    // 行号优先用整篇文档的绝对偏移来算 —— 这才是用户看到的行
    const docOffset = docOffsetOf?.(m, index)
    let line = 1
    let column = offset - lineInfoAt(text, offset).lineStart + 1
    if (typeof docOffset === 'number' && docOffset >= 0 && typeof documentText === 'string') {
      const info = lineInfoAt(documentText, docOffset)
      line = info.line
      column = docOffset - info.lineStart + 1
    } else {
      // 没有绝对偏移时退回块内行号
      const info = lineInfoAt(text, offset)
      line = info.line
      column = offset - info.lineStart + 1
    }

    const beforeRaw = text.slice(Math.max(0, offset - CONTEXT_CHARS), offset)
    const afterRaw = text.slice(
      Math.min(text.length, offset + m.match.length),
      Math.min(text.length, offset + m.match.length + CONTEXT_CHARS)
    )

    return {
      index,
      match: m.match,
      line,
      column,
      before: flatten(beforeRaw),
      // 命中若跨行，后半段会带上换行，压平后仍可读
      after: flatten(afterRaw),
      multiline: m.match.includes('\n')
    }
  })
}

/** 列表项的展示文本：`前文` + 命中 + `后文`，用于就地高亮。 */
export function resultLineText(item: SearchResultItem): string {
  return `${item.before}${item.match}${item.after}`
}
