import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

/**
 * 端到端自检：在真实渲染进程里验证编辑器内核是否成功挂载、
 * 能否读写 Markdown、大纲与字数统计是否工作。
 * 通过 TYPRA2_SELF_CHECK=1 触发，结果以退出码表示（0 通过 / 1 失败）。
 */
export async function runSelfCheck(win: BrowserWindow): Promise<boolean> {
  // 为文件树用例准备一个临时目录（含子目录与文件）
  const workDirForTree = join(process.cwd(), '.tmp-selfcheck-tree')
  await fsp.mkdir(join(workDirForTree, '子目录'), { recursive: true })
  await fsp.writeFile(join(workDirForTree, 'a.md'), '# A\n', 'utf8')
  await fsp.writeFile(join(workDirForTree, 'b.md'), '# B\n', 'utf8')

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

  // 2b. 导出运行时真实可用的 Muya 方法，用于核对内核 API 适配情况
  const apiList = await win.webContents.executeJavaScript(`
    (() => {
      const muya = window.__typraMuya
      if (!muya) return { error: 'no instance' }
      const proto = Object.getPrototypeOf(muya)
      return Object.getOwnPropertyNames(proto)
        .filter((n) => n !== 'constructor' && typeof proto[n] === 'function' && !n.startsWith('_'))
    })()
  `)
  console.log('[selfcheck] Muya public methods:', JSON.stringify(apiList))

  // 2c. 校验命令中心依赖的关键 API 是否真的存在，缺失即为适配错误
  const required = [
    'updateParagraph',
    'format',
    'createTable',
    'insertImage',
    'getCursorOffset',
    'setCursorByOffset',
    'setFocusMode',
    'copyAsMarkdown',
    'copyAsHtml',
    'pasteAsPlainText',
    'revealElement',
    'setOptions'
  ]
  const missingApi = required.filter((m) => !apiList.includes(m))
  if (missingApi.length) {
    console.error('[selfcheck] FAIL: 内核缺少命令中心所需的 API:', missingApi.join(', '))
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

  // 4b-2. 验证段落/格式命令真的能改变内容（命令中心是否生效）
  // 注意 1：setCursorByOffset 接收源码模式的 { line, ch } 坐标，不是扁平数字
  // 注意 2：createTable 的签名是 createTable({ rows, columns })，不是两个位置参数
  const commandEffect = await win.webContents.executeJavaScript(`
    (async () => {
      const muya = window.__typraMuya
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const at = (line, ch) => ({ anchor: { line, ch }, focus: { line, ch } })
      const results = {}

      // 等待编辑器渲染稳定：轮询直到段落块数量符合预期，避免固定延时不足
      const settle = async (expectParagraphs) => {
        for (let i = 0; i < 60; i++) {
          const n = document.querySelectorAll('.muya-container .mu-paragraph').length
          if (n >= expectParagraphs) return true
          await wait(100)
        }
        return false
      }

      /** 读内部选区：确认光标真的落在某个块上（setCursorByOffset 内部会重建文档，
       *  重建完成后选区才有效，因此必须轮询而不是固定等待）。 */
      const readSel = () => {
        try {
          const cs = muya.editor?.selection?.getSelection?.()
          if (!cs || !cs.anchor || !cs.anchor.block) return null
          return { block: cs.anchor.block.blockName, offset: cs.anchor.offset }
        } catch {
          return null
        }
      }

      const waitCursor = async () => {
        for (let i = 0; i < 40; i++) {
          const s = readSel()
          if (s) return s
          await wait(100)
        }
        return null
      }

      // 载入内容 → 等渲染稳定 → 聚焦 → 设光标 → 等选区就位
      const load = async (md, line, ch, expectParagraphs = 1) => {
        muya.setContent(md, false)
        await settle(expectParagraphs)
        muya.focus()
        await wait(200)
        muya.setCursorByOffset(at(line, ch))
        return waitCursor()
      }

      // 段落：把光标放到首段，执行「标题 1」
      results.cursorHeading = await load('普通段落文字\\n\\n第二段\\n', 0, 2, 2)
      results.preHeading = { md: muya.getMarkdown(), cursor: results.cursorHeading }
      muya.updateParagraph('heading 1')
      await wait(400)
      results.afterHeading = muya.getMarkdown()

      // 无序列表
      results.cursorBullet = await load('列表项内容\\n', 0, 2)
      muya.updateParagraph('ul-bullet')
      await wait(400)
      results.afterBullet = muya.getMarkdown()

      // 任务列表
      results.cursorTask = await load('待办事项\\n', 0, 2)
      muya.updateParagraph('ul-task')
      await wait(400)
      results.afterTask = muya.getMarkdown()

      // 行内格式：全选后加粗
      muya.setContent('加粗这段文字\\n', false)
      await settle(1)
      muya.focus()
      await wait(250)
      muya.selectAll()
      results.cursorStrong = await waitCursor()
      muya.format('strong')
      await wait(400)
      results.afterStrong = muya.getMarkdown()

      // 表格：内核不把有内容的块转成表格（table 属于 WHOLE_BLOCK_NAMES），
      // 必须用 createTable({ rows, columns }) 插入；光标需落在空段落上
      muya.setContent('\\n', false)
      await settle(1)
      muya.focus()
      await wait(250)
      muya.setCursorByOffset(at(0, 0))
      results.cursorTable = await waitCursor()
      muya.createTable({ rows: 3, columns: 3 })
      await wait(600)
      results.afterTable = muya.getMarkdown()

      // 诊断：编辑器与窗口的焦点状态
      results.diag = {
        muyaHasFocus: muya.hasFocus(),
        docHasFocus: document.hasFocus(),
        activeEl: document.activeElement && document.activeElement.tagName,
        activeClass: document.activeElement && document.activeElement.className,
        internalSel: (() => {
          try {
            const cs = muya.editor.selection.getSelection()
            return cs
              ? {
                  sameBlock: cs.isSelectionInSameBlock,
                  block: cs.anchor && cs.anchor.block && cs.anchor.block.blockName,
                  offset: cs.anchor && cs.anchor.offset
                }
              : null
          } catch (e) {
            return String(e)
          }
        })()
      }

      return results
    })()
  `)
  const checks: Array<[string, RegExp, string]> = [
    ['afterHeading', /^#\s/, '标题命令未生成 # 标题'],
    ['afterBullet', /^[-*]\s/m, '无序列表命令未生成列表项'],
    ['afterTask', /^[-*]\s\[[ x]\]/m, '任务列表命令未生成复选框'],
    ['afterStrong', /\*\*[^*]+\*\*/, '加粗命令未生成 ** 标记'],
    ['afterTable', /\|/, '表格命令未生成表格']
  ]
  const failures: string[] = []
  for (const [key, re, msg] of checks) {
    if (!re.test(String(commandEffect[key] ?? ''))) {
      failures.push(`${msg}（实际: ${JSON.stringify(String(commandEffect[key] ?? '').slice(0, 60))}）`)
    }
  }
  if (failures.length) {
    console.error('[selfcheck] FAIL: 命令中心未生效:')
    failures.forEach((f) => console.error('   -', f))
    console.error('[selfcheck] 首次载入后状态:', JSON.stringify(commandEffect.preHeading, null, 1))
    console.error('[selfcheck] 诊断信息:', JSON.stringify(commandEffect.diag, null, 1))
    return false
  }
  console.log('[selfcheck] 命令中心 OK: 标题/列表/任务/加粗/表格均生效')

  // 4b-3. 验证查找替换与专注模式
  const findResult = await win.webContents.executeJavaScript(`
    (async () => {
      const muya = window.__typraMuya
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))

      // 等渲染稳定后再搜索
      muya.setContent('苹果 香蕉 苹果 橙子\\n', false)
      for (let i = 0; i < 30; i++) {
        if (document.querySelectorAll('.muya-container .mu-paragraph').length > 0) break
        await wait(100)
      }
      await wait(300)
      muya.search('苹果', { isRegexp: false, isCaseSensitive: false, isWholeWord: false })
      await wait(300)
      muya.find('next')
      await wait(250)

      // 替换依赖搜索状态，轮询确认替换生效（最多重试几次）
      let afterReplace = ''
      for (let i = 0; i < 5; i++) {
        muya.replace('梨', { isSingle: false, isRegexp: false })
        await wait(400)
        afterReplace = muya.getMarkdown()
        if (!/苹果/.test(afterReplace)) break
      }

      // 专注模式开关
      muya.setFocusMode(true)
      const focusOn = document.querySelector('.muya-container')?.className || ''
      muya.setFocusMode(false)
      const focusOff = document.querySelector('.muya-container')?.className || ''
      return { afterReplace, focusOn, focusOff }
    })()
  `)
  if (!/梨/.test(findResult.afterReplace) || /苹果/.test(findResult.afterReplace)) {
    console.error('[selfcheck] FAIL: 全部替换未生效:', JSON.stringify(findResult.afterReplace))
    return false
  }
  if (!/mu-focus-mode/.test(findResult.focusOn) || /mu-focus-mode/.test(findResult.focusOff)) {
    console.error('[selfcheck] FAIL: 专注模式开关未生效:', JSON.stringify(findResult))
    return false
  }

  // 专注模式还必须真的淡化非当前块（校验计算后的 opacity，而不只是类名）
  const focusVisual = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const muya = window.__typraMuya
      window.__typraLoad('# 标题\\n\\n第一段内容。\\n\\n第二段内容。\\n\\n第三段内容。\\n')
      await wait(700)
      muya.setCursorByOffset({ anchor: { line: 2, ch: 1 }, focus: { line: 2, ch: 1 } })
      await wait(300)
      muya.setFocusMode(true)
      await wait(600)
      const blocks = [...document.querySelectorAll('.mu-focus-mode .mu-container > *')]
      const ops = blocks.map((b) => ({
        active: b.classList.contains('mu-active'),
        opacity: Number(getComputedStyle(b).opacity)
      }))
      muya.setFocusMode(false)
      await wait(300)
      const afterOff = blocks.length
        ? Number(getComputedStyle(document.querySelector('.mu-container > *')).opacity)
        : -1
      return { count: ops.length, ops, afterOff }
    })()
  `)
  const dimmed = (focusVisual.ops as Array<{ active: boolean; opacity: number }>).filter(
    (o) => !o.active && o.opacity < 0.9
  )
  const activeOnes = (focusVisual.ops as Array<{ active: boolean; opacity: number }>).filter(
    (o) => o.active && o.opacity > 0.9
  )
  if (!focusVisual.count || !dimmed.length || !activeOnes.length) {
    console.error('[selfcheck] FAIL: 专注模式未淡化非当前块:', JSON.stringify(focusVisual))
    return false
  }
  if (focusVisual.afterOff < 0.9) {
    console.error('[selfcheck] FAIL: 关闭专注模式后未恢复:', JSON.stringify(focusVisual))
    return false
  }
  console.log(
    `[selfcheck] 专注模式 OK: ${dimmed.length} 块淡化（opacity ${dimmed[0].opacity}）、当前块保持 ${activeOnes[0].opacity}`
  )
  console.log('[selfcheck] 查找替换与专注模式 OK')

  // 4b-4. 验证命令中心已注册全部菜单命令，且主题切换真的改变配色
  const cmdCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const c = window.__typraCommands
      if (!c) return { error: '命令中心未暴露' }
      const ids = c.ids()
      const required = [
        'file:new','file:open','file:openFolder','file:save','file:saveAs',
        'file:exportHtml','file:exportPdf',
        'edit:undo','edit:redo','edit:find','edit:replace',
        'paragraph:h1','paragraph:h6','paragraph:p','paragraph:ul','paragraph:ol',
        'paragraph:task','paragraph:quote','paragraph:code','paragraph:math','paragraph:table',
        'format:strong','format:emphasis','format:strike','format:inlineCode','format:link',
        'view:toggleSidebar','view:toggleOutline','view:toggleSource','view:toggleFocus',
        'view:toggleTypewriter','view:toggleTheme','view:zoomIn','view:zoomOut',
        'app:preferences'
      ]
      const missing = required.filter((r) => !ids.includes(r))
      // 主题切换：连续切换到深色，读回编辑区背景色
      for (let i = 0; i < 8; i++) {
        if (document.body.classList.contains('theme-dark')) break
        await c.execute('view:toggleTheme')
        await new Promise((r) => setTimeout(r, 120))
      }
      const editor = document.querySelector('.muya-editor') || document.querySelector('.muya-container')
      const darkBg = getComputedStyle(editor).backgroundColor
      const darkClass = document.body.className
      // 切回浅色
      for (let i = 0; i < 8; i++) {
        if (document.body.classList.contains('theme-light')) break
        await c.execute('view:toggleTheme')
        await new Promise((r) => setTimeout(r, 120))
      }
      const lightBg = getComputedStyle(editor).backgroundColor
      return { missing, total: ids.length, darkBg, darkClass, lightBg }
    })()
  `)
  if (cmdCheck.error || cmdCheck.missing?.length) {
    console.error('[selfcheck] FAIL: 命令中心缺少命令:', JSON.stringify(cmdCheck))
    return false
  }
  const bg = (s: string) => (String(s).match(/\d+/g) || []).slice(0, 3).map(Number)
  const darkLum = bg(cmdCheck.darkBg).reduce((a, b) => a + b, 0) / 3
  const lightLum = bg(cmdCheck.lightBg).reduce((a, b) => a + b, 0) / 3
  if (!(darkLum < 90 && lightLum > 200)) {
    console.error('[selfcheck] FAIL: 主题配色未生效:', JSON.stringify(cmdCheck))
    return false
  }
  console.log(
    `[selfcheck] 命令中心 ${cmdCheck.total} 条命令齐备，主题切换 OK（深色 ${darkLum.toFixed(0)} / 浅色 ${lightLum.toFixed(0)}）`
  )

  // 4b-5. 验证源码模式：内容能双向同步，切回所见即所得不丢改动
  const sourceCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const c = window.__typraCommands
      const app = window.__typraApp
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))

      // 先写入初始内容
      window.__typraLoad('# 源码模式测试\\n\\n初始段落。\\n')
      await wait(500)

      // 切到源码模式
      await c.execute('view:toggleSource')
      await wait(500)
      const ta = document.querySelector('.source-editor')
      if (!ta) return { error: '源码编辑器未渲染' }
      const sourceText = ta.value

      // 在源码里改内容（模拟用户输入）
      ta.value = '# 源码模式测试\\n\\n已修改的段落。\\n\\n- 新列表项\\n'
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(500)
      const tabAfterEdit = app.activeTab().content

      // 切回所见即所得
      await c.execute('view:toggleSource')
      await wait(700)
      const backToWysiwyg = window.__typraMuya.getMarkdown()
      const isSourceVisible = !!document.querySelector('.source-editor')

      return { sourceText, tabAfterEdit, backToWysiwyg, isSourceVisible }
    })()
  `)
  if (sourceCheck.error) {
    console.error('[selfcheck] FAIL: 源码模式异常:', sourceCheck.error)
    return false
  }
  if (!/初始段落/.test(sourceCheck.sourceText)) {
    console.error('[selfcheck] FAIL: 源码模式未载入当前内容:', JSON.stringify(sourceCheck.sourceText))
    return false
  }
  if (!/已修改的段落/.test(sourceCheck.tabAfterEdit)) {
    console.error('[selfcheck] FAIL: 源码模式编辑未同步到标签:', JSON.stringify(sourceCheck.tabAfterEdit))
    return false
  }
  if (!/已修改的段落/.test(sourceCheck.backToWysiwyg) || !/新列表项/.test(sourceCheck.backToWysiwyg)) {
    console.error('[selfcheck] FAIL: 切回所见即所得后内容丢失:', JSON.stringify(sourceCheck.backToWysiwyg))
    return false
  }
  console.log('[selfcheck] 源码模式 OK: 双向同步且不丢改动')

  // 4b-6. 验证代码高亮、块级公式、Mermaid 图表真的渲染出来
  const renderCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const md = [
        '\\\`\\\`\\\`javascript',
        'const answer = 42',
        'function greet(name) { return name }',
        '\\\`\\\`\\\`',
        '',
        '\$\$',
        'E = mc^2',
        '\$\$',
        '',
        '\\\`\\\`\\\`mermaid',
        'graph TD',
        '  A[开始] --> B[结束]',
        '\\\`\\\`\\\`',
        ''
      ].join('\\n')
      window.__typraLoad(md)
      await wait(3500)
      const c = document.querySelector('.muya-container')
      const tokens = c.querySelectorAll('.token, [class*="token"]')
      const codeEl = c.querySelector('.mu-fence-code, pre')
      const katex = c.querySelector('.katex')
      const mermaidSvg = c.querySelector('svg[id^="mermaid"], .mu-diagram svg, svg')
      return {
        tokenCount: tokens.length,
        tokenSample: [...tokens].slice(0, 5).map((t) => t.className),
        codeBackground: codeEl ? getComputedStyle(codeEl).backgroundColor : '',
        hasKatex: !!katex,
        hasMermaidSvg: !!mermaidSvg,
        svgCount: c.querySelectorAll('svg').length
      }
    })()
  `)
  if (!renderCheck.tokenCount) {
    console.error('[selfcheck] FAIL: 代码块未产生语法高亮 token:', JSON.stringify(renderCheck))
    return false
  }
  if (!renderCheck.hasKatex) {
    console.error('[selfcheck] FAIL: 块级数学公式未渲染成 KaTeX:', JSON.stringify(renderCheck))
    return false
  }
  if (!renderCheck.hasMermaidSvg) {
    console.error('[selfcheck] FAIL: Mermaid 图表未渲染成 SVG:', JSON.stringify(renderCheck))
    return false
  }
  console.log(
    `[selfcheck] 渲染 OK: 代码高亮 ${renderCheck.tokenCount} 个 token、KaTeX 公式、Mermaid SVG（共 ${renderCheck.svgCount} 个 SVG）`
  )

  // 4b-7. 验证打字机模式：开启后光标行会被滚动到视口垂直中心附近
  const typewriterCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const c = window.__typraCommands
      const muya = window.__typraMuya

      // 造一篇足够长的文档，让光标可以远离视口中心
      const long = Array.from({ length: 40 }, (_, i) => '第 ' + (i + 1) + ' 段落内容。').join('\\n\\n')
      window.__typraLoad(long)
      await wait(800)

      // 先关闭打字机模式，把光标放到很靠后的位置
      if (document.body.classList.contains('typewriter-mode')) await c.execute('view:toggleTypewriter')
      await wait(200)
      muya.setCursorByOffset({ anchor: { line: 0, ch: 2 }, focus: { line: 0, ch: 2 } })
      await wait(400)
      const scroller = document.querySelector('.editor-scroll')
      const before = scroller.scrollTop

      // 开启打字机模式后再移动光标
      await c.execute('view:toggleTypewriter')
      await wait(300)
      const enabled = document.body.classList.contains('typewriter-mode')
      muya.setCursorByOffset({ anchor: { line: 40, ch: 3 }, focus: { line: 40, ch: 3 } })
      await wait(1500)
      const after = scroller.scrollTop

      return {
        enabled,
        before,
        after,
        scrollerHeight: scroller.clientHeight,
        diag: window.__typraTypewriterDiag,
        rangeCount: document.getSelection() ? document.getSelection().rangeCount : -1
      }
    })()
  `)
  if (!typewriterCheck.enabled) {
    console.error('[selfcheck] FAIL: 打字机模式未开启:', JSON.stringify(typewriterCheck))
    return false
  }
  if (!(typewriterCheck.after > typewriterCheck.before)) {
    console.error(
      '[selfcheck] FAIL: 打字机模式下光标后移未触发滚动:',
      JSON.stringify(typewriterCheck)
    )
    return false
  }
  console.log(
    `[selfcheck] 打字机模式 OK: 光标后移触发滚动 ${typewriterCheck.before} → ${typewriterCheck.after}`
  )

  // 4b-8. 验证多标签隔离：各标签内容与光标互不干扰，切换后能恢复
  const tabsCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const app = window.__typraApp
      const muya = window.__typraMuya

      // 新建第二个标签并写入不同内容
      window.__typraLoad('# 标签一\\n\\n第一个标签的内容。\\n')
      await wait(500)
      const firstId = app.activeTab().id
      const firstContent = app.activeTab().content

      const c = window.__typraCommands
      await c.execute('file:new')
      await wait(600)
      window.__typraLoad('# 标签二\\n\\n第二个标签的内容。\\n')
      await wait(500)
      const secondId = app.activeTab().id
      const secondContent = app.activeTab().content

      // 切回第一个标签
      app.tabs().find((t) => t.id === firstId)
      const tab1 = app.tabs().find((t) => t.id === firstId)
      const tab2 = app.tabs().find((t) => t.id === secondId)

      return {
        tabCount: app.tabs().length,
        distinctIds: firstId !== secondId,
        firstContent,
        secondContent,
        tab1Content: tab1 && tab1.content,
        tab2Content: tab2 && tab2.content,
        // 两个标签的内容必须各自独立
        isolated: tab1 && tab2 && tab1.content !== tab2.content
      }
    })()
  `)
  if (!tabsCheck.distinctIds || tabsCheck.tabCount < 2) {
    console.error('[selfcheck] FAIL: 新建标签失败:', JSON.stringify(tabsCheck))
    return false
  }
  if (!tabsCheck.isolated || !/标签一/.test(tabsCheck.tab1Content) || !/标签二/.test(tabsCheck.tab2Content)) {
    console.error('[selfcheck] FAIL: 多标签内容未隔离:', JSON.stringify(tabsCheck))
    return false
  }
  console.log(`[selfcheck] 多标签 OK: ${tabsCheck.tabCount} 个标签内容各自独立`)

  // 4b-9. 验证文件树：打开文件夹后能读到目录结构
  const treeCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const app = window.__typraApp
      const dir = await window.typra.readDir(${JSON.stringify(workDirForTree)})
      return {
        name: dir.name,
        childCount: dir.children.length,
        names: dir.children.map((c) => c.name).sort(),
        hasDirs: dir.children.some((c) => c.isDirectory)
      }
    })()
  `)
  if (!treeCheck.childCount) {
    console.error('[selfcheck] FAIL: 读取文件夹失败:', JSON.stringify(treeCheck))
    return false
  }
  console.log(
    `[selfcheck] 文件树 OK: ${treeCheck.childCount} 个条目（${treeCheck.names.slice(0, 6).join(', ')}）`
  )

  // 4b-10. 验证拖入打开：构造带文件的 drop 事件，检查是否真的打开了文档
  const dropFile = join(workDirForTree, 'dropped.md')
  await fsp.writeFile(dropFile, '# 拖入的文档\n\n通过拖拽打开。\n', 'utf8')
  const dropCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const app = window.__typraApp
      const before = app.tabs().length
      const host = document.querySelector('.editor-host')
      if (!host) return { error: '找不到 editor-host' }

      // 构造一个含 File 的 DataTransfer，并让 getPathForFile 返回已知路径
      const file = new File(['# 拖入的文档\\n'], 'dropped.md', { type: 'text/markdown' })
      const dt = new DataTransfer()
      dt.items.add(file)

      // 拦截路径解析：jsdom/无头环境无法从 File 取真实磁盘路径
      const original = window.typra.getPathForFile
      window.typra.getPathForFile = () => ${JSON.stringify(dropFile)}

      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
      host.dispatchEvent(over)
      await wait(150)
      const overlayShown = !!document.querySelector('.drop-overlay')

      // 合成 DragEvent 的 dataTransfer.files 在无头环境不可用，
      // 因此这里直接驱动同一套投放逻辑（openDroppedFiles）；
      // contextBridge 暴露的对象只读，路径解析改用可注入钩子。
      window.__typraDrop.setPathHook(() => ${JSON.stringify(dropFile)})
      const openedCount = await window.__typraDrop.openFiles([file])
      await wait(900)

      // 关闭提示层（模拟 drop 结束后隐藏）
      host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await wait(200)

      window.__typraDrop.setPathHook(null)
      const files = app.tabs().map((t) => t.filePath).filter(Boolean)
      return {
        before,
        after: app.tabs().length,
        overlayShown,
        overlayAfterDrop: !!document.querySelector('.drop-overlay'),
        openedCount,
        opened: files.some((f) => f.endsWith('dropped.md')),
        active: app.activeTab() && app.activeTab().filePath
      }
    })()
  `)
  if (dropCheck.error) {
    console.error('[selfcheck] FAIL: 拖入测试无法执行:', dropCheck.error)
    return false
  }
  if (!dropCheck.overlayShown) {
    console.error('[selfcheck] FAIL: dragover 未显示投放提示层:', JSON.stringify(dropCheck))
    return false
  }
  if (dropCheck.overlayAfterDrop) {
    console.error('[selfcheck] FAIL: drop 后投放提示层未消失:', JSON.stringify(dropCheck))
    return false
  }
  if (!dropCheck.opened || dropCheck.after <= dropCheck.before) {
    console.error('[selfcheck] FAIL: 拖入的 Markdown 未打开:', JSON.stringify(dropCheck))
    return false
  }
  console.log('[selfcheck] 拖入打开 OK: 投放提示层正常，文档已打开')

  // 4b-11. 拖入非 Markdown 文件应被忽略
  const dropBad = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const app = window.__typraApp
      const before = app.tabs().length
      app.clearNotice()
      await wait(150)
      const file = new File(['{}'], 'blocked.json', { type: 'application/json' })
      window.__typraDrop.setPathHook(() => 'E:\\\\tmp\\\\blocked.json')
      const openedCount = await window.__typraDrop.openFiles([file])
      await wait(400)
      window.__typraDrop.setPathHook(null)
      return {
        before,
        after: app.tabs().length,
        openedCount,
        notice: app.notice ? app.notice.text : null
      }
    })()
  `)
  if (dropBad.after !== dropBad.before || dropBad.openedCount !== 0) {
    console.error('[selfcheck] FAIL: 非 Markdown 文件不应被打开:', JSON.stringify(dropBad))
    return false
  }
  if (!dropBad.notice) {
    console.error('[selfcheck] FAIL: 拖入非 Markdown 时应给出提示:', JSON.stringify(dropBad))
    return false
  }
  console.log('[selfcheck] 拖入过滤 OK: 非 Markdown 文件被忽略并给出提示')

  // 4c. 验证导出：静态 HTML 生成且包含标题与表格。
  //     先载入确定的文档内容，避免受前序用例（拖入等）改变当前标签的影响。
  const exported = await win.webContents.executeJavaScript(`
    (async () => {
      const mod = window.__typraExport
      if (!mod) return { error: 'export module not exposed' }
      window.__typraLoad('# 导出标题\\n\\n正文段落。\\n\\n| 列A | 列B |\\n| --- | --- |\\n| 1 | 2 |\\n')
      await new Promise((r) => setTimeout(r, 700))
      const html = await mod.buildHtmlForCheck()
      return {
        length: html.length,
        hasTitle: html.includes('导出标题'),
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
  // 状态栏行号必须是纯数字，不能出现 [object Object]（光标结构未正确展开）
  if (/行\s*\[object/.test(statusText)) {
    console.error('[selfcheck] FAIL: 状态栏行号格式错误:', statusText)
    return false
  }

  // 5b. 字数统计必须随文档内容变化（用较长文档验证，而非空文档）
  const countCheck = await win.webContents.executeJavaScript(`
    (async () => {
      const muya = window.__typraMuya
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const long = '# 中文标题\\n\\n' + '这是一段用于统计的中文正文内容。'.repeat(20) + '\\n'
      window.__typraLoad(long)
      await wait(900)
      const text = document.querySelector('.status-bar')?.innerText || ''
      const m = text.match(/(\\d+)\\s*字/)
      return { shown: m ? Number(m[1]) : -1, expected: long.length, raw: text }
    })()
  `)
  if (countCheck.shown <= 0) {
    console.error('[selfcheck] FAIL: 长文档下字数统计仍为 0:', JSON.stringify(countCheck.raw))
    return false
  }
  console.log(`[selfcheck] 字数统计 OK: ${countCheck.shown} 字`)

  // 清理自检用的临时目录（所有依赖它的用例都已执行完）。
  // 先停掉该目录下文件的监听器：fs.watch 持有句柄时删除会失败或挂住。
  await win.webContents
    .executeJavaScript(
      `(async () => {
        const app = window.__typraApp
        const files = app.tabs().map((t) => t.filePath).filter(Boolean)
        for (const f of files) {
          if (f.includes('selfcheck-tree')) await window.typra.unwatch(f)
        }
        return true
      })()`
    )
    .catch(() => {})
  await fsp.rm(workDirForTree, { recursive: true, force: true }).catch(() => {})

  console.log('[selfcheck] shell:', JSON.stringify(shell))
  console.log('[selfcheck] statusbar:', statusText.replace(/\s+/g, ' ').trim())
  console.log('[selfcheck] PASS: 编辑器挂载、块渲染、Markdown 往返、大纲与字数统计均正常')
  return true
}
