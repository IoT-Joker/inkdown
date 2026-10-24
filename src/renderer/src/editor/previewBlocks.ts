import { lexBlock } from '@muyajs/core/utils/marked/lexBlock'
import type { ILexOption } from '@muyajs/core/utils/marked/types'

/** Use the Markdown parser's top-level blocks, including adjacent headings. */
export function previewBlockOffsets(markdown: string, options: ILexOption): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const token of lexBlock(markdown, options)) {
    const raw = token.raw
    const found = markdown.indexOf(raw, cursor)
    const start = found < 0 ? cursor : found
    cursor = start + raw.length
    if (['space', 'def', 'footnote'].includes(token.type)) continue
    let count = 1
    if (token.type === 'html') {
      const template = document.createElement('template')
      template.innerHTML = raw
      count = [...template.content.children].filter((el) => !['SCRIPT', 'STYLE', 'IFRAME'].includes(el.tagName)).length
    }
    for (let i = 0; i < count; i++) offsets.push(start)
  }
  return offsets
}

/** Keep unchanged prefix/suffix nodes (especially loaded images) mounted. */
export function patchPreview(container: HTMLElement, html: string, prepare?: (root: DocumentFragment) => void): void {
  const template = document.createElement('template')
  template.innerHTML = html
  prepare?.(template.content)
  const previous = [...container.childNodes]
  const next = [...template.content.childNodes]
  let start = 0
  while (start < previous.length && start < next.length && previous[start].isEqualNode(next[start])) start++
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1].isEqualNode(next[newEnd - 1])) {
    oldEnd--
    newEnd--
  }
  const anchor = previous[oldEnd] ?? null
  for (let i = start; i < oldEnd; i++) previous[i].remove()
  const fragment = document.createDocumentFragment()
  for (let i = start; i < newEnd; i++) fragment.append(next[i])
  container.insertBefore(fragment, anchor)
}
