import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Exercise real table plugins, including events arriving after their anchor changed. */
export async function runStabilityCheck(win: BrowserWindow): Promise<boolean> {
  for (let i = 0; i < 80; i++) {
    if (await win.webContents.executeJavaScript('!!window.__inkdownCommands && !!window.__inkdownApp?.activeTab()').catch(() => false)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const diagramServer = createServer((request, response) => {
    if (request.url?.startsWith('/fail')) {
      response.writeHead(503).end('unavailable')
      return
    }
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><text x="8" y="30">PlantUML test</text></svg>')
  })
  await new Promise<void>((resolve) => diagramServer.listen(0, '127.0.0.1', resolve))
  const address = diagramServer.address()
  if (!address || typeof address === 'string') throw new Error('Diagram test server failed to start')
  const diagramServerUrl = `http://127.0.0.1:${address.port}`
  const mappingFixturePath = join(process.cwd(), 'examples/comprehensive-test.md')
  const mappingFixture = existsSync(mappingFixturePath) ? readFileSync(mappingFixturePath, 'utf8') : [
    '<details>', '<summary>Nested Markdown</summary>', '', '**Nested paragraph**', '',
    '- Nested list', '', '</details>', '', '### Mermaid', '',
    '```mermaid', 'flowchart LR', ' A --> B', '```', '', '### PlantUML', '',
    '```plantuml', '@startuml', 'actor User', '@enduml', '```', '', '### Vega', '',
    '```vega-lite', '{"data":{"values":[]},"mark":"bar"}', '```'
  ].join('\n')
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const checks = []
      const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
      const muya = window.__inkdownMuya
      const app = window.__inkdownApp
      const commands = window.__inkdownCommands
      const plugins = muya._uiPlugins
      const menu = plugins.tableBarTools
      const columns = plugins.tableColumnTools
      const drag = plugins.tableDragBar
      const md = '| a | b | c |\\n| --- | --- | --- |\\n| 1 | 2 | 3 |\\n\\noutside\\n'
      const load = async () => {
        window.__inkdownLoad(md)
        await wait(80)
        return muya.editor.scrollPage.firstContentInDescendant().closestBlock('table')
      }
      const errors = []
      const onError = (e) => errors.push(e.message || String(e.reason))
      window.addEventListener('error', onError)
      window.addEventListener('unhandledrejection', onError)
      const attempt = async (name, run) => {
        try { await run() } catch (e) { check(name, false, String(e)) }
      }
      for (let i = 0; i < 4 && app.viewMode() !== 'wysiwyg'; i++) {
        await commands.execute('view:toggleSource')
        await wait(50)
      }
      await attempt('row menu ignores a duplicate click', async () => {
        const table = await load()
        const block = table.cellAt(1, 0)
        muya.eventCenter.emit('muya-table-bar', { reference: block.domNode, block, tableInfo: { barType: 'right' } })
        const item = menu.container.querySelector('li.item')
        item.click()
        item.click()
        await wait(60)
        check('row menu ignores a duplicate click', table.rowCount === 3, table.rowCount)
      })
      await attempt('column toolbar ignores a duplicate click', async () => {
        const table = await load()
        const block = table.cellAt(0, 0)
        columns._block = block
        columns.render()
        columns.show(block.domNode)
        const item = [...columns.container.querySelectorAll('li.item')].find((el) => /insert/.test(el.className))
        item.click()
        item.click()
        await wait(60)
        check('column toolbar ignores a duplicate click', table.columnCount === 4, table.columnCount)
      })
      await attempt('release outside cancels a pending table drag', async () => {
        const table = await load()
        drag._block = table.cellAt(0, 0)
        drag._barType = 'bottom'
        drag.show(drag._block.domNode)
        drag.container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
        await wait(360)
        check('release outside cancels a pending table drag', !drag._dragInfo && !drag._mouseTimer)
        drag._resetDragTableBar()
      })
      await attempt('table reorder tolerates a cleared native selection', async () => {
        const table = await load()
        table.cellAt(0, 0).firstContentInDescendant().setCursor(0, 0, true)
        muya.editor.selection.activate('table')
        table.active = true
        drag._block = table.cellAt(0, 0)
        drag._barType = 'bottom'
        drag._startDrag(new MouseEvent('mousedown', { button: 0 }))
        drag._dragInfo.curIndex = 1
        drag._dragInfo.offset = 50
        drag._switchTableData()
        drag._resetDragTableBar()
        await wait(80)
        const reordered = muya.editor.scrollPage.firstContentInDescendant().closestBlock('table').getState()
        check('table reorder tolerates a cleared native selection', reordered.children[0].children.map((cell) => cell.text).join(',') === 'b,a,c', muya.getMarkdown())
      })
      await attempt('a table removed during drop is not resurrected', async () => {
        const table = await load()
        drag._block = table.cellAt(0, 0)
        drag._barType = 'bottom'
        drag._startDrag(new MouseEvent('mousedown', { button: 0 }))
        drag._docMousemove(new MouseEvent('mousemove', { clientX: 400 }))
        drag._docMouseup(new MouseEvent('mouseup'))
        window.__inkdownLoad('replacement during drop')
        await wait(380)
        check('a table removed during drop is not resurrected', muya.getMarkdown().trim() === 'replacement during drop' && !drag._dragInfo)
      })
      await attempt('row and column operations survive repeated use', async () => {
        const table = await load()
        for (let i = 0; i < 30; i++) {
          let block = table.cellAt(1, 0)
          muya.eventCenter.emit('muya-table-bar', { reference: block.domNode, block, tableInfo: { barType: i % 2 ? 'bottom' : 'right' } })
          menu.container.querySelector('li.item').click()
          await wait(20)
          block = table.cellAt(1, 0)
          muya.eventCenter.emit('muya-table-bar', { reference: block.domNode, block, tableInfo: { barType: i % 2 ? 'bottom' : 'right' } })
          menu.container.querySelector('[data-label="remove"]').click()
          await wait(20)
        }
        check('row and column operations survive repeated use', table.rowCount === 2 && table.columnCount === 3, [table.rowCount, table.columnCount])
        const block = table.cellAt(0, 0)
        muya.eventCenter.emit('muya-table-bar', { reference: block.domNode, block, tableInfo: { barType: 'right' } })
        const staleItem = menu.container.querySelector('li.item')
        window.__inkdownLoad('replacement document')
        staleItem.click()
        await wait(60)
        check('stale table menu cannot edit a replacement document', muya.getMarkdown().trim() === 'replacement document')
      })
      await attempt('dark table menus have a dark opaque background', async () => {
        const table = await load()
        const block = table.cellAt(1, 0)
        muya.eventCenter.emit('muya-table-bar', { reference: block.domNode, block, tableInfo: { barType: 'right' } })
        const oldClass = document.body.className
        for (const theme of ['dark', 'night']) {
          document.body.className = 'theme-' + theme
          const bg = getComputedStyle(menu.floatBox).backgroundColor
          const color = getComputedStyle(menu.container.querySelector('li.item')).color
          const channels = bg.match(/\\d+/g)?.map(Number) || []
          check(theme + ' table menu contrast', channels.length >= 3 && Math.max(...channels.slice(0, 3)) < 70 && color !== bg, { bg, color })
        }
        document.body.className = oldClass
        muya.hideAllFloatTools()
      })
      await attempt('split preview follows the final input and tab', async () => {
        await commands.execute('view:toggleSplit')
        await wait(80)
        const ta = document.querySelector('.source-editor')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        for (let i = 0; i < 20; i++) {
          setter.call(ta, '# final-' + i + '\\n\\nbody-' + i)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        }
        for (let i = 0; i < 30 && document.querySelector('.split-preview-body h1')?.textContent !== 'final-19'; i++) await wait(50)
        check('split preview follows the final input', document.querySelector('.split-preview-body h1')?.textContent === 'final-19' && app.activeTab().content.includes('body-19'), { html: document.querySelector('.split-preview-body')?.innerHTML, content: app.activeTab().content, mode: app.viewMode(), visibility: document.visibilityState })
        window.dispatchEvent(new CustomEvent('inkdown:find-close'))
        await wait(80)
        check('closing find does not restore hidden editor content', app.activeTab().content.includes('body-19') && ta.value.includes('body-19'))
        const body = document.querySelector('.split-preview-body')
        let renders = 0
        const observer = new MutationObserver(() => renders++)
        observer.observe(body, { childList: true })
        const longDoc = '# Performance\\n\\n' + 'Paragraph **text** for a long document.\\n\\n'.repeat(500)
        for (let i = 0; i < 24; i++) {
          setter.call(ta, longDoc + 'last-input-' + i)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          await wait(15)
        }
        for (let i = 0; i < 30 && !body.textContent.includes('last-input-23'); i++) await wait(50)
        observer.disconnect()
        check('long-document input merges preview renders', renders > 0 && renders < 8 && body.textContent.includes('last-input-23'), { inputs: 24, renders, chars: ta.value.length })
        window.__inkdownLoad('# Reloaded split document\\n\\nreplacement')
        for (let i = 0; i < 30 && body.querySelector('h1')?.textContent !== 'Reloaded split document'; i++) await wait(50)
        check('reloading a split document updates source and preview', ta.value.includes('Reloaded split document') && body.querySelector('h1')?.textContent === 'Reloaded split document')
        await commands.execute('file:new')
        await wait(100)
        check('new split tab clears old preview', document.querySelector('.split-preview-body')?.textContent.trim() === '')
        await commands.execute('view:toggleSplit')
        await wait(80)
      })
      await attempt('source commands, search and preview mapping', async () => {
        await commands.execute('view:toggleSplit')
        await wait(100)
        window.__inkdownLoad('# Heading\\n## Child\\nsource sample sample')
        await wait(200)
        const ta = document.querySelector('.source-editor')
        const original = ta.value
        const start = original.indexOf('sample')
        ta.setSelectionRange(start, start + 6)
        await commands.execute('format:strong')
        await wait(80)
        check('source format writes to the visible document', ta.value.includes('**sample**') && app.activeTab().content === ta.value)
        await commands.execute('edit:undo')
        await wait(80)
        check('source undo restores source rather than hidden Muya', ta.value === original)
        await commands.execute('edit:redo')
        await wait(80)
        check('source redo restores formatting', ta.value.includes('**sample**'))
        window.dispatchEvent(new CustomEvent('inkdown:find', { detail: {
          action: 'replaceAll', keyword: 'sample', replacement: 'changed',
          isRegexp: false, isCaseSensitive: true, isWholeWord: false
        } }))
        await wait(200)
        check('source replace all preserves current source edits', ta.value.includes('**changed** changed') && ta.value.startsWith('# Heading'))
        const body = document.querySelector('.split-preview-body')
        const heading = body.querySelector('h1')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ta.value + '!')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(200)
        check('editing a paragraph preserves unchanged preview nodes', body.querySelector('h1') === heading)
        ta.setSelectionRange(ta.value.indexOf('source'), ta.value.indexOf('source'))
        window.__inkdownSplitSync.sync()
        check('adjacent headings do not shift preview cursor mapping', body.querySelector('.split-cursor-block')?.tagName === 'P', body.innerHTML)
        const firstTab = app.activeTab().id
        const firstText = ta.value
        await commands.execute('file:new')
        await wait(100)
        await commands.execute('edit:undo')
        await wait(50)
        check('a new source tab has independent undo history', ta.value === '')
        app.setActive(firstTab)
        await wait(100)
        check('switching source tabs preserves edits', ta.value === firstText)
        await commands.execute('view:toggleSplit')
        await wait(80)
      })
      await attempt('split alerts and preview-to-source navigation', async () => {
        await commands.execute('view:toggleSplit')
        await wait(80)
        const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']
        const prefix = Array.from({ length: 40 }, (_, i) => 'Before ' + i + '\\n\\n').join('')
        const suffix = Array.from({ length: 40 }, (_, i) => 'After ' + i + '\\n\\n').join('')
        const markdown = prefix + types.map((type) => '> [!' + type + ']\\n> Test **' + type + '**\\n\\n').join('') + suffix
        window.__inkdownLoad(markdown)
        await wait(300)
        const body = document.querySelector('.split-preview-body')
        const oldClass = document.body.className
        for (const theme of ['light', 'dark', 'night']) {
          document.body.className = 'theme-' + theme
          const colors = types.map((type) => {
            const alert = body.querySelector('.markdown-alert-' + type.toLowerCase())
            const style = getComputedStyle(alert)
            const titleStyle = getComputedStyle(alert.querySelector('.markdown-alert-title'))
            return { border: style.borderLeftWidth, color: style.borderLeftColor, title: titleStyle.color }
          })
          check(theme + ' split alerts retain five semantic colors and borders', colors.every((s) => s.border === '4px' && s.color === s.title) && new Set(colors.map((s) => s.color)).size === 5, colors)
        }
        document.body.className = oldClass
        const ta = document.querySelector('.source-editor')
        const scroller = ta.closest('.source-scroll')
        const target = body.querySelector('.markdown-alert-tip strong')
        const leftScroll = body.scrollTop
        target.click()
        await wait(100)
        const offset = markdown.indexOf('> [!TIP]')
        const style = getComputedStyle(ta)
        const line = markdown.slice(0, offset).split('\\n').length - 1
        const caretY = ta.getBoundingClientRect().top + parseFloat(style.paddingTop) + (line + 0.5) * parseFloat(style.lineHeight)
        const center = scroller.getBoundingClientRect().top + scroller.clientHeight / 2
        check('preview click places source caret at the matching block', ta.selectionStart === offset && ta.selectionEnd === offset, { actual: ta.selectionStart, expected: offset })
        check('preview click centers source without moving the preview or adding a frame', Math.abs(caretY - center) < 3 && body.scrollTop === leftScroll && !body.querySelector('.split-cursor-block'), { caretY, center, leftScroll, after: body.scrollTop })
        check('preview navigation does not edit document content', ta.value === markdown && app.activeTab().content === markdown)
        await commands.execute('view:toggleSplit')
        await wait(80)
      })
      await attempt('split preview renders and reuses diagrams', async () => {
        await commands.execute('view:toggleSplit')
        await wait(80)
        const markdown = '# Diagrams\\n\\n' +
          '\\x60\\x60\\x60mermaid\\nflowchart LR\\n A[Start] --> B[End]\\n\\x60\\x60\\x60\\n\\n' +
          '\\x60\\x60\\x60mermaid\\nsequenceDiagram\\n A->>B: Message\\n\\x60\\x60\\x60\\n\\n' +
          '\\x60\\x60\\x60mermaid\\nstateDiagram-v2\\n [*] --> Ready\\n\\x60\\x60\\x60\\n\\n' +
          '\\x60\\x60\\x60vega-lite\\n{"data":{"values":[{"x":"A","y":2}]},"mark":"bar","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"quantitative"}}}\\n\\x60\\x60\\x60\\n\\nTail paragraph'
        window.__inkdownLoad(markdown)
        const body = document.querySelector('.split-preview-body')
        for (let i = 0; i < 80 && body.querySelectorAll('.split-diagram svg').length < 4; i++) await wait(100)
        const diagrams = [...body.querySelectorAll('.split-diagram')]
        check('split preview renders flowchart, sequence, state and Vega diagrams', diagrams.length === 4 && diagrams.every((el) => el.querySelector('svg')), body.innerHTML.slice(0, 700))
        const firstSvg = body.querySelector('.split-diagram svg')
        const ta = document.querySelector('.source-editor')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ta.value + '!')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(300)
        check('typing outside a diagram preserves its rendered SVG', !!firstSvg && body.querySelector('.split-diagram svg') === firstSvg)
        if (firstSvg) {
          firstSvg.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          await wait(80)
          check('clicking diagram SVG locates its source fence', ta.selectionStart === markdown.indexOf('\\x60\\x60\\x60mermaid') && !body.querySelector('.split-cursor-block'))
        }
        window.__inkdownLoad('\\x60\\x60\\x60vega-lite\\ninvalid json\\n\\x60\\x60\\x60')
        for (let i = 0; i < 30 && !body.querySelector('.split-diagram-error'); i++) await wait(100)
        check('invalid diagrams show an error and recoverable source', !!body.querySelector('.split-diagram-error') && body.textContent.includes('invalid json'))
        await commands.execute('view:toggleSplit')
        await wait(80)
      })
      await attempt('split PlantUML image load and failure handling', async () => {
        await commands.execute('view:toggleSplit')
        await wait(80)
        const settings = app.settings()
        const original = settings.plantumlServer
        try {
          settings.plantumlServer = ${JSON.stringify(diagramServerUrl)} + '/ok'
          window.__inkdownLoad('\\x60\\x60\\x60plantuml\\n@startuml\\nAlice -> Bob: success\\n@enduml\\n\\x60\\x60\\x60')
          const body = document.querySelector('.split-preview-body')
          for (let i = 0; i < 40 && !body.querySelector('.split-diagram img')?.naturalWidth; i++) await wait(100)
          const img = body.querySelector('.split-diagram img')
          check('split PlantUML loads images through the renderer CSP', img?.naturalWidth === 160 && !body.querySelector('.split-diagram-status'))
          settings.plantumlServer = ${JSON.stringify(diagramServerUrl)} + '/fail'
          window.__inkdownLoad('\\x60\\x60\\x60plantuml\\n@startuml\\nAlice -> Bob: failure\\n@enduml\\n\\x60\\x60\\x60')
          for (let i = 0; i < 40 && !body.querySelector('.split-diagram-error'); i++) await wait(100)
          check('split PlantUML reports a failed image instead of a broken icon', !!body.querySelector('.split-diagram-error') && !body.querySelector('.split-diagram img') && body.textContent.includes('Alice -> Bob: failure'))
        } finally {
          settings.plantumlServer = original
          window.__inkdownLoad('After PlantUML checks')
          await wait(100)
          await commands.execute('view:toggleSplit')
          await wait(80)
        }
      })
      await attempt('full document source and diagram mapping', async () => {
        const markdown = ${JSON.stringify(mappingFixture)}
        if (!markdown) return
        await commands.execute('view:toggleSplit')
        await wait(80)
        const settings = app.settings()
        const original = settings.plantumlServer
        settings.plantumlServer = ${JSON.stringify(diagramServerUrl)} + '/ok'
        try {
          window.__inkdownLoad(markdown)
          await wait(600)
          const ta = document.querySelector('.source-editor')
          const body = document.querySelector('.split-preview-body')
          const offset = markdown.indexOf('actor User')
          ta.setSelectionRange(offset, offset)
          window.__inkdownSplitSync.sync()
          const active = body.querySelector('.split-cursor-block')
          check('PlantUML source highlights PlantUML in the comprehensive document', active?.dataset.previewDiagramKey && JSON.parse(active.dataset.previewDiagramKey)[0] === 'plantuml', { active: active?.tagName, mapping: window.__inkdownSplitSync.mapping().slice(-30) })
          const details = body.querySelector('details')
          for (const open of [true, false]) {
            details.open = open
            window.__inkdownSplitSync.sync()
            check('folding HTML details preserves PlantUML mapping: ' + open, JSON.parse(body.querySelector('.split-cursor-block')?.dataset.previewDiagramKey || '[]')[0] === 'plantuml')
          }
          for (const type of ['mermaid', 'plantuml', 'vega-lite']) {
            const figure = [...body.querySelectorAll('.split-diagram')].find((el) => JSON.parse(el.dataset.previewDiagramKey)[0] === type)
            figure.querySelector('.mu-diagram-preview')?.click()
            await wait(60)
            check('full document ' + type + ' click locates its own source', ta.selectionStart === markdown.indexOf('\\x60\\x60\\x60' + type), { actual: ta.selectionStart, expected: markdown.indexOf('\\x60\\x60\\x60' + type) })
          }
        } finally {
          settings.plantumlServer = original
          await commands.execute('view:toggleSplit')
          await wait(80)
        }
      })
      await attempt('footnote navigation keeps the application frame visible', async () => {
        for (let i = 0; i < 4 && app.viewMode() !== 'wysiwyg'; i++) {
          await commands.execute('view:toggleSource')
          await wait(50)
        }
        const text = 'Reference[^first]\\n\\n' + Array.from({ length: 100 }, (_, i) => 'Paragraph ' + i + '\\n\\n').join('') + '[^first]: Footnote definition\\n'
        window.__inkdownLoad(text)
        await wait(150)
        const shell = document.querySelector('.app-shell')
        const before = shell.getBoundingClientRect().top
        const tool = plugins.footnoteTool
        const reference = document.querySelector('[id="noteref-first"]')
        const footnotes = new Map()
        muya.editor.scrollPage.breadthFirstTraverse((block) => {
          if (block.blockName === 'footnote') footnotes.set(block.meta.identifier, block)
        })
        muya.eventCenter.emit('muya-footnote-tool', { reference, identifier: 'first', footnotes })
        await wait(120)
        const button = tool.container.querySelector('a.btn')
        if (!button) throw new Error('Footnote Go to button missing: ' + tool.container.innerHTML)
        button.click()
        await wait(900)
        const ancestors = []
        for (let el = document.querySelector('.mu-footnote'); el; el = el.parentElement) {
          ancestors.push({ name: el.className || el.tagName, top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left, scroll: el.scrollTop, scrollX: el.scrollLeft, height: el.clientHeight })
        }
        check('footnote navigation keeps the application frame visible', Math.abs(shell.getBoundingClientRect().top - before) < 1 && document.querySelector('.status-bar')?.getBoundingClientRect().bottom <= innerHeight, ancestors)
        document.querySelector('.mu-footnote-backlink').click()
        await wait(900)
        check('footnote backlink keeps the application frame visible', Math.abs(shell.getBoundingClientRect().top - before) < 1, shell.getBoundingClientRect().toJSON())
      })
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
      check('no uncaught renderer errors', errors.length === 0, errors)
      return checks
    })()
  `).finally(() => new Promise<void>((resolve) => diagramServer.close(() => resolve()))) as Array<{ name: string; pass: boolean; detail: unknown }>
  if (process.env['INKDOWN_PREVIEW_CAPTURE']) {
    const sample = '# Split preview\n\n> [!NOTE]\n> Note with **formatted text**.\n\n> [!TIP]\n> Click a block to locate its source.\n\n```mermaid\nflowchart LR\n A[Markdown] --> B[Live preview]\n B --> C[Source position]\n```\n\n| Feature | Result |\n| --- | --- |\n| Alerts | Color and border |\n| Diagrams | Live rendering |\n'
    await win.webContents.executeJavaScript(`(async () => {
      await window.__inkdownCommands.execute('view:toggleSplit');
      window.__inkdownLoad(${JSON.stringify(sample)});
      document.body.className = 'theme-light';
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 1300))
    const dir = join(process.cwd(), 'screenshots')
    mkdirSync(dir, { recursive: true })
    for (const theme of ['light', 'dark']) {
      await win.webContents.executeJavaScript(`document.body.className = 'theme-${theme}'; document.querySelector('.split-cursor-block')?.classList.remove('split-cursor-block'); document.querySelector('.split-preview-body').scrollTop = 0; document.querySelector('.source-scroll').scrollTop = 0`)
      await new Promise((resolve) => setTimeout(resolve, 120))
      writeFileSync(join(dir, `split-preview-${theme}.png`), (await win.webContents.capturePage()).toPNG())
    }
  }
  for (const check of result) {
    console.log(`[stability] ${check.pass ? 'OK' : 'FAIL'}: ${check.name} ${JSON.stringify(check.detail)}`)
  }
  const passed = result.every((check) => check.pass)
  console.log(`[stability] ${passed ? 'PASS' : 'FAILED'}: ${result.filter((check) => check.pass).length}/${result.length}`)
  return passed
}
