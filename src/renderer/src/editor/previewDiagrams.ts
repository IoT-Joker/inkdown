import { finalizeRenderedDiagram, renderDiagram, type IRenderOptions } from '@muyajs/core/utils/diagram/render'

type Options = Omit<IRenderOptions, 'type' | 'code' | 'target'>
const types = new Set(['mermaid', 'plantuml', 'vega-lite', 'flowchart', 'sequence'])

/** Stable placeholders keep Markdown block indexes and already-rendered diagrams intact. */
export function preparePreviewDiagrams(root: DocumentFragment, options: Options): void {
  for (const code of root.querySelectorAll('pre > code')) {
    const type = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9)
    if (!type || !types.has(type)) continue
    const figure = document.createElement('figure')
    figure.className = 'mu-diagram-block split-diagram'
    figure.dataset.previewDiagramKey = JSON.stringify([type, code.textContent ?? '', options])
    const loading = document.createElement('div')
    loading.className = 'split-diagram-status'
    loading.textContent = '正在渲染图表…'
    figure.append(loading)
    code.parentElement!.replaceWith(figure)
  }
}

export class PreviewDiagrams {
  private jobs = new Map<HTMLElement, { cancel?: () => void }>()

  update(root: HTMLElement): void {
    for (const [element, job] of this.jobs) {
      if (!root.contains(element)) {
        job.cancel?.()
        this.jobs.delete(element)
      }
    }
    for (const figure of root.querySelectorAll<HTMLElement>('.split-diagram')) {
      if (this.jobs.has(figure)) continue
      const job: { cancel?: () => void } = {}
      this.jobs.set(figure, job)
      void this.render(figure, job)
    }
  }

  private async render(figure: HTMLElement, job: { cancel?: () => void }): Promise<void> {
    const [type, code, options] = JSON.parse(figure.dataset.previewDiagramKey!) as [string, string, Options]
    const target = document.createElement('div')
    target.className = 'mu-diagram-preview'
    figure.append(target)
    figure.setAttribute('aria-busy', 'true')
    try {
      await renderDiagram({ ...options, type, code, target })
      if (this.jobs.get(figure) !== job) return
      job.cancel = finalizeRenderedDiagram(target, type)
      figure.querySelector('.split-diagram-status')?.remove()
    } catch (error) {
      if (this.jobs.get(figure) !== job) return
      const message = document.createElement('div')
      message.className = 'split-diagram-error'
      message.setAttribute('role', 'alert')
      message.textContent = `图表暂时无法显示：${error instanceof Error ? error.message : String(error)}`
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = '查看图表源码'
      const pre = document.createElement('pre')
      pre.textContent = code
      details.append(summary, pre)
      figure.replaceChildren(message, details)
    } finally {
      figure.removeAttribute('aria-busy')
    }
  }

  dispose(): void {
    for (const job of this.jobs.values()) job.cancel?.()
    this.jobs.clear()
  }
}
