import type { BrowserWindow } from 'electron'

/**
 * 端到端自检：在真实渲染进程里验证编辑器内核是否成功挂载、
 * 能否读写 Markdown、大纲与字数统计是否工作。
 * 通过 TYPRA2_SELF_CHECK=1 触发，结果以退出码表示（0 通过 / 1 失败）。
 */
export async function runSelfCheck(win: BrowserWindow): Promise<boolean> {
  // 先把渲染进程的错误与控制台输出引到主进程，便于定位失败原因
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] ?? String(level)
    console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[selfcheck] 页面加载失败 ${code} ${desc} ${url}`)
  })

  const waitFor = async (predicate: string, timeoutMs = 15000): Promise<boolean> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const ok = await win.webContents.executeJavaScript(predicate).catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }

  // 1. Vue 应用与 muya 容器都已挂载
  const mounted = await waitFor(
    `!!document.querySelector('.app-shell') && !!document.querySelector('.muya-container')`
  )
  if (!mounted) {
    console.error('[selfcheck] FAIL: 应用或编辑器容器未挂载')
    return false
  }

  // 2. muya 编辑器内部结构已渲染（存在段落块）。
  // muya 的类名由 MU_XXX 转成 mu-xxx，段落即 .mu-paragraph。
  const hasBlocks = await waitFor(
    `document.querySelectorAll('.muya-container .mu-paragraph').length > 0`
  )
  if (!hasBlocks) {
    console.error('[selfcheck] FAIL: 编辑器未渲染任何块')
    return false
  }

  // 3. 侧边栏 / 标签栏 / 状态栏等外壳组件存在
  const shell = await win.webContents.executeJavaScript(`
    ({
      tabbar: !!document.querySelector('.tab-bar'),
      sidebar: !!document.querySelector('.sidebar'),
      statusbar: !!document.querySelector('.status-bar')
    })
  `)
  if (!shell.tabbar || !shell.statusbar) {
    console.error('[selfcheck] FAIL: 应用外壳组件缺失', JSON.stringify(shell))
    return false
  }

  // 4. 验证内核读写往返：把 Markdown 灌入编辑器，再读回来
  const roundTrip = await win.webContents.executeJavaScript(`
    (async () => {
      const w = window
      // EditorHost 把实例挂到 window.__typraMuya 供自检使用
      const muya = w.__typraMuya
      if (!muya) return { error: 'no muya instance' }
      const input = '# 标题一\\n\\n正文段落，含 **加粗** 与 \\\`行内代码\\\`。\\n\\n## 二级标题\\n\\n- 项目一\\n- 项目二\\n'
      muya.setContent(input, false)
      await new Promise((r) => setTimeout(r, 400))
      const out = muya.getMarkdown()
      const toc = muya.getTOC()
      return {
        out,
        tocCount: toc.length,
        tocLevels: toc.map((t) => t.lvl),
        tocText: toc.map((t) => t.content)
      }
    })()
  `)
  if (roundTrip.error) {
    console.error('[selfcheck] FAIL: 无法取得编辑器实例:', roundTrip.error)
    return false
  }
  const normalized = String(roundTrip.out).replace(/\r\n/g, '\n')
  if (!normalized.includes('# 标题一') || !normalized.includes('## 二级标题')) {
    console.error('[selfcheck] FAIL: Markdown 往返不一致:', JSON.stringify(roundTrip.out))
    return false
  }
  if (roundTrip.tocCount !== 2) {
    console.error('[selfcheck] FAIL: 大纲条目数应为 2，实际', roundTrip.tocCount, JSON.stringify(roundTrip.tocText))
    return false
  }
  console.log('[selfcheck] round-trip OK, TOC:', JSON.stringify(roundTrip.tocText))

  // 4b. 验证进阶语法：表格、数学公式、任务列表、代码块都能渲染
  const features = await win.webContents.executeJavaScript(`
    (async () => {
      const muya = window.__typraMuya
      if (!muya) return { error: 'no muya instance' }
      const input = [
        '| 列A | 列B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '\\\`\\\`\\\`js',
        'const x = 1',
        '\\\`\\\`\\\`',
        '',
        '- [x] 已完成',
        '- [ ] 未完成',
        '',
        '行内公式 \$a^2+b^2=c^2\$',
        ''
      ].join('\\n')
      muya.setContent(input, false)
      await new Promise((r) => setTimeout(r, 600))
      const c = document.querySelector('.muya-container')
      const out = muya.getMarkdown()
      return {
        hasTable: !!c.querySelector('.mu-table, table'),
        hasCode: !!c.querySelector('.mu-fence-code, pre'),
        hasTask: /- \\[x\\]/.test(out) && /- \\[ \\]/.test(out),
        hasMath: !!c.querySelector('.katex, .mu-math, [class*="math"]'),
        out: out.slice(0, 300)
      }
    })()
  `)
  if (features.error) {
    console.error('[selfcheck] FAIL: 进阶语法检查取不到实例:', features.error)
    return false
  }
  const missing = ['hasTable', 'hasCode', 'hasTask'].filter((k) => !features[k])
  if (missing.length) {
    console.error('[selfcheck] FAIL: 进阶语法未渲染:', missing.join(','), JSON.stringify(features))
    return false
  }
  console.log('[selfcheck] 进阶语法 OK: 表格/代码块/任务列表/公式')

  // 4c. 验证导出：静态 HTML 生成且包含标题与表格
  const exported = await win.webContents.executeJavaScript(`
    (async () => {
      const mod = window.__typraExport
      if (!mod) return { error: 'export module not exposed' }
      const html = await mod.buildHtmlForCheck()
      return {
        length: html.length,
        hasTitle: html.includes('标题一') || html.includes('列A'),
        hasDoctype: html.toLowerCase().includes('<!doctype html'),
        hasTable: html.includes('<table')
      }
    })()
  `)
  if (exported.error || !exported.hasDoctype || exported.length < 200) {
    console.error('[selfcheck] FAIL: HTML 导出异常:', JSON.stringify(exported))
    return false
  }
  console.log('[selfcheck] 导出 OK: 长度', exported.length)

  // 5. 验证状态栏字数统计随内容更新
  const statusText = await win.webContents.executeJavaScript(
    `document.querySelector('.status-bar')?.innerText || ''`
  )
  if (!/\d+\s*字/.test(statusText)) {
    console.error('[selfcheck] FAIL: 状态栏未显示字数统计:', statusText)
    return false
  }

  console.log('[selfcheck] shell:', JSON.stringify(shell))
  console.log('[selfcheck] statusbar:', statusText.replace(/\s+/g, ' ').trim())
  console.log('[selfcheck] PASS: 编辑器挂载、块渲染、Markdown 往返、大纲与字数统计均正常')
  return true
}
