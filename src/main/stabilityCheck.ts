import type { BrowserWindow } from 'electron'

/** Exercise real table plugins, including events arriving after their anchor changed. */
export async function runStabilityCheck(win: BrowserWindow): Promise<boolean> {
  for (let i = 0; i < 80; i++) {
    if (await win.webContents.executeJavaScript('!!window.__inkdownCommands && !!window.__inkdownApp?.activeTab()').catch(() => false)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
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
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
      check('no uncaught renderer errors', errors.length === 0, errors)
      return checks
    })()
  `) as Array<{ name: string; pass: boolean; detail: unknown }>
  for (const check of result) {
    console.log(`[stability] ${check.pass ? 'OK' : 'FAIL'}: ${check.name} ${JSON.stringify(check.detail)}`)
  }
  const passed = result.every((check) => check.pass)
  console.log(`[stability] ${passed ? 'PASS' : 'FAILED'}: ${result.filter((check) => check.pass).length}/${result.length}`)
  return passed
}
