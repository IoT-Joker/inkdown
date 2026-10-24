export interface TextSnapshot {
  text: string
  start: number
  end: number
}

/** Source history is independent of the hidden rich-text editor and of other tabs. */
export class TextHistory {
  private undoStack: TextSnapshot[] = []
  private redoStack: TextSnapshot[] = []
  private lastEdit = 0
  private mergeTyping = false

  constructor(public current: TextSnapshot) {}

  record(next: TextSnapshot, typing = false): void {
    if (next.text === this.current.text) {
      this.current = { ...next }
      return
    }
    const now = Date.now()
    if (!typing || !this.mergeTyping || now - this.lastEdit > 600) {
      this.undoStack.push({ ...this.current })
      // Bound both snapshot count and total retained text for large documents.
      let bytes = this.undoStack.reduce((sum, item) => sum + item.text.length * 2, 0)
      while (this.undoStack.length > 1 && (this.undoStack.length > 100 || bytes > 8 * 1024 * 1024)) {
        bytes -= this.undoStack.shift()!.text.length * 2
      }
    }
    this.redoStack = []
    this.current = { ...next }
    this.lastEdit = now
    this.mergeTyping = typing
  }

  undo(): TextSnapshot | undefined {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.current)
    this.current = previous
    this.mergeTyping = false
    return previous
  }

  redo(): TextSnapshot | undefined {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.current)
    this.current = next
    this.mergeTyping = false
    return next
  }
}

export function replaceRange(value: TextSnapshot, text: string, start = value.start, end = value.end): TextSnapshot {
  return { text: value.text.slice(0, start) + text + value.text.slice(end), start: start + text.length, end: start + text.length }
}

export function editSource(value: TextSnapshot, command: string): TextSnapshot | undefined {
  const { text, start, end } = value
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const lastSelected = end > start && text[end - 1] === '\n' ? end - 1 : end
  const lineEndAt = text.indexOf('\n', lastSelected)
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt
  const block = text.slice(lineStart, lineEnd)
  const heading = command.match(/^paragraph:h([1-6])$/)
  const prefixes: Record<string, string> = {
    'paragraph:ul': '- ', 'paragraph:ol': '1. ', 'paragraph:task': '- [ ] ', 'paragraph:quote': '> '
  }
  if (heading || command === 'paragraph:p' || command in prefixes) {
    const prefix = heading ? '#'.repeat(Number(heading[1])) + ' ' : prefixes[command] ?? ''
    const changed = block.split('\n').map((line) => prefix + line.replace(/^(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')).join('\n')
    const result = replaceRange(value, changed, lineStart, lineEnd)
    result.start = start === end ? Math.max(lineStart, start + changed.length - block.length) : lineStart
    result.end = start === end ? result.start : lineStart + changed.length
    return result
  }
  if (command === 'edit:duplicate') {
    const suffix = '\n' + block
    return replaceRange(value, suffix, lineEnd, lineEnd)
  }
  if (command === 'edit:deleteParagraph') {
    return replaceRange(value, '', lineStart, lineEnd < text.length ? lineEnd + 1 : lineEnd)
  }
  if (command === 'edit:insertParagraph') return replaceRange(value, '\n\n', lineEnd, lineEnd)
  if (command === 'format:clear') {
    const selected = text.slice(start, end)
    if (!selected) return editSource(value, 'paragraph:p')
    return replaceRange(value, selected.replace(/\*\*([^\n]+?)\*\*|~~([^\n]+?)~~|==([^\n]+?)==|`([^\n]+?)`|\*([^\n]+?)\*/g,
      (_match, ...groups) => groups.slice(0, 5).find((group) => group !== undefined) ?? ''))
  }
  const markers: Record<string, [string, string]> = {
    'format:strong': ['**', '**'], 'format:emphasis': ['*', '*'], 'format:underline': ['<u>', '</u>'],
    'format:strike': ['~~', '~~'], 'format:inlineCode': ['`', '`'], 'format:highlight': ['==', '=='],
    'format:inlineMath': ['$', '$'], 'format:superscript': ['<sup>', '</sup>'], 'format:subscript': ['<sub>', '</sub>'],
    'format:link': ['[', '](https://example.com)']
  }
  const marker = markers[command]
  if (!marker) return
  const [before, after] = marker
  if (text.slice(0, start).endsWith(before) && text.slice(end).startsWith(after)) {
    const result = replaceRange(value, text.slice(start, end), start - before.length, end + after.length)
    result.start = start - before.length
    return result
  }
  const selected = text.slice(start, end)
  const result = replaceRange(value, before + selected + after)
  result.start = start + before.length
  result.end = result.start + selected.length
  return result
}

export interface TextSearchOptions {
  isRegexp: boolean
  isCaseSensitive: boolean
  isWholeWord: boolean
}

export function textSearchRegex(query: string, options: TextSearchOptions): RegExp | null {
  if (!query) return null
  let pattern = options.isRegexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (options.isWholeWord) pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`
  try { return new RegExp(pattern, options.isCaseSensitive ? 'gu' : 'giu') } catch { return null }
}

export function textMatches(text: string, query: string, options: TextSearchOptions): RegExpExecArray[] {
  const regex = textSearchRegex(query, options)
  if (!regex) return []
  return [...text.matchAll(regex)]
}

export function replaceTextMatch(text: string, query: string, replacement: string, options: TextSearchOptions, index?: number): string {
  const regex = textSearchRegex(query, options)
  if (!regex) return text
  if (index === undefined) return options.isRegexp ? text.replace(regex, replacement) : text.replace(regex, () => replacement)
  const match = [...text.matchAll(regex)][index]
  if (!match) return text
  // Sticky matching preserves surrounding context and native replacement
  // semantics ($1, named groups, lookbehind, $`, $') for this one match.
  const single = new RegExp(regex.source, regex.flags.replace('g', '') + 'y')
  single.lastIndex = match.index!
  return options.isRegexp ? text.replace(single, replacement) : text.replace(single, () => replacement)
}

export function lineOffsets(text: string): number[] {
  const offsets = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offsets.push(i + 1)
  return offsets
}

export function offsetIndex(offsets: number[], offset: number): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (offsets[mid] <= offset) low = mid + 1
    else high = mid
  }
  return Math.max(0, low - 1)
}
