import { lexBlock } from '@muyajs/core/utils/marked/lexBlock'
import type { ILexOption } from '@muyajs/core/utils/marked/types'
import { trackHtmlParents } from '@muyajs/core/utils/marked/extensions/githubAlerts'

/** Use the Markdown parser's top-level blocks, including adjacent headings. */
export function previewBlockOffsets(markdown: string, options: ILexOption): number[] {
  const offsets: number[] = []
  const htmlParents: string[] = []
  const excluded = new Set(['SCRIPT', 'STYLE', 'IFRAME'])
  let cursor = 0
  for (const token of lexBlock(markdown, options)) {
    const raw = token.raw
    const found = markdown.indexOf(raw, cursor)
    const start = found < 0 ? cursor : found
    cursor = start + raw.length
    if (['space', 'def', 'footnote'].includes(token.type)) continue
    // Markdown inside an open HTML container renders inside that same node,
    // not as another child of the preview (e.g. paragraphs inside <details>).
    let count = htmlParents.length ? 0 : 1
    if (token.type === 'html') {
      const template = document.createElement('template')
      template.innerHTML = htmlParents.map((tag) => `<${tag}>`).join('') + raw
      const existingRoot = htmlParents.length && !excluded.has(htmlParents[0].toUpperCase()) ? 1 : 0
      count = Math.max(0, [...template.content.children].filter((el) => !excluded.has(el.tagName)).length - existingRoot)
      trackHtmlParents(raw, htmlParents)
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
  const equal = (a: Node, b: Node): boolean => {
    if (a instanceof HTMLElement && b instanceof HTMLElement && a.dataset.previewDiagramKey && a.tagName === b.tagName) {
      return a.dataset.previewDiagramKey === b.dataset.previewDiagramKey
    }
    return a.isEqualNode(b)
  }
  let start = 0
  while (start < previous.length && start < next.length && equal(previous[start], next[start])) start++
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && equal(previous[oldEnd - 1], next[newEnd - 1])) {
    oldEnd--
    newEnd--
  }
  const anchor = previous[oldEnd] ?? null
  for (let i = start; i < oldEnd; i++) previous[i].remove()
  const fragment = document.createDocumentFragment()
  for (let i = start; i < newEnd; i++) fragment.append(next[i])
  container.insertBefore(fragment, anchor)
}
