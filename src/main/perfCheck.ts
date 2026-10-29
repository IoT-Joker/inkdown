import type { BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * 应用内性能基准（INKDOWN_PERF_IN_APP=1）。
 *
 * 在真实渲染环境里测耗时，比静态分析更有意义：
 * 大文档载入、全库搜索、主题切换、连续输入、内存占用。
 * 输出 `[perf]` 前缀的日志，供 scripts/perf-in-app.js 收集。
 */
export async function runPerfInApp(win: BrowserWindow): Promise<void> {
  const wc = win.webContents

  const waitReady = async (): Promise<boolean> => {
    for (let i = 0; i < 100; i++) {
      const ok = await wc
        .executeJavaScript(`!!document.querySelector('.muya-container .mu-paragraph')`)
        .catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }

  if (!(await waitReady())) {
    console.log('[perf] FAIL: 编辑器未就绪')
    console.log('[perf] done')
    return
  }

  // 预热：先载入一个小文档，让内核完成首次初始化。
  // 否则第一次测量会把内核冷初始化算进去（实测能差 10 倍）。
  await wc.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      window.__inkdownLoad('# 预热\\n\\n预热段落。\\n')
      await wait(800)
      return true
    })()
  `)

  // ---------- 1. 大文档载入 ----------
  // 分批渲染后要区分两个指标：
  //   firstPaint = 首批块渲染完（用户能看到内容、可开始阅读）
  //   fullDone   = 全部块渲染完（大纲/搜索才完整）
  for (const n of [200, 800, 2000]) {
    const doc = buildDoc(n)
    const r = await wc.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const t0 = performance.now()
        window.__inkdownLoad(${JSON.stringify(doc)})
        // 首屏可读 = 至少 30 个正文段落出现（约一到两屏，用户已经能开始读）
        let firstPaint = 0
        for (let i = 0; i < 3000; i++) {
          const c = document.querySelectorAll('.muya-container .mu-paragraph').length
          if (!firstPaint && c >= Math.min(30, ${n})) firstPaint = performance.now() - t0
          if (c >= ${n}) break
          await wait(10)
        }
        const fullDone = performance.now() - t0
        return {
          firstPaint: Math.round(firstPaint),
          fullDone: Math.round(fullDone),
          paragraphs: document.querySelectorAll('.muya-container .mu-paragraph').length
        }
      })()
    `)
    console.log(
      `[perf] 载入 ${n} 段落 (${(Buffer.byteLength(doc) / 1024).toFixed(0)} KB): 首屏 ${r.firstPaint} ms，全部渲染 ${r.fullDone} ms（${r.paragraphs} 段）`
    )
  }

  // ---------- 1b. 定位瓶颈归属：内核 vs 应用层 ----------
  // 实测结论（2000 段落）：纯内核 setContent 2979ms vs 应用层封装 3004ms，
  // 两者一致 → 统计/大纲/列布局都不是瓶颈，问题在内核渲染管线本身。
  // 另一个对照：2000 段纯正文（无标题）仅 593ms，带标题则 2988ms，
  // 说明成本主要来自标题相关的结构与样式，而非单纯字符数。
  const kernelCompare = await wc.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const muya = window.__inkdownMuya
      const measure = async (fn) => {
        const t0 = performance.now()
        fn()
        for (let i = 0; i < 1500; i++) {
          if (document.querySelectorAll('.muya-container .mu-paragraph').length >= 800) break
          await wait(20)
        }
        return Math.round(performance.now() - t0)
      }
      const doc = ${JSON.stringify(buildDoc(800))}
      const kernelMs = await measure(() => muya.setContent(doc, false))
      await wait(500)
      const appMs = await measure(() => window.__inkdownLoad(doc))
      return { kernelMs, appMs }
    })()
  `)
  console.log(
    `[perf] 800 段落瓶颈归属: 纯内核 setContent ${kernelCompare.kernelMs} ms vs 应用层封装 ${kernelCompare.appMs} ms`
  )

  // ---------- 2. 连续输入响应 ----------
  // 分小文档与 800 段落两档对比。
  // 用 execCommand('insertText') 走浏览器真实编辑路径——合成的 beforeinput
  // 不会真正改动文档，测不到 json-change 链路（这点踩过坑）。
  for (const n of [0, 800]) {
    const setup = n > 0 ? buildDoc(n) : '# 输入测试\\n\\n'
    const typePerf = await wc.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const muya = window.__inkdownMuya
        window.__inkdownLoad(${JSON.stringify(setup)})
        await wait(1000)
        muya.focus()
        const line = ${n} > 0 ? ${n * 2} : 2
        muya.setCursorByOffset({ anchor: { line, ch: 0 }, focus: { line, ch: 0 } })
        await wait(400)

        const times = []
        for (let i = 0; i < 40; i++) {
          const t0 = performance.now()
          document.execCommand('insertText', false, '字')
          await wait(0)
          times.push(performance.now() - t0)
        }
        times.sort((a, b) => a - b)
        return {
          total: Math.round(times.reduce((a, b) => a + b, 0)),
          p50: Math.round(times[Math.floor(times.length * 0.5)]),
          p95: Math.round(times[Math.floor(times.length * 0.95)]),
          max: Math.round(times[times.length - 1])
        }
      })()
    `)
    const label = n > 0 ? `${n} 段落文档` : '小文档'
    console.log(
      `[perf] 输入 40 次（${label}）: 总 ${typePerf.total} ms，p50 ${typePerf.p50} / p95 ${typePerf.p95} / max ${typePerf.max} ms`
    )
  }

  // ---------- 2b. 单次统计/大纲刷新的成本 ----------
  // 防抖把这些开销从「每次击键」降到「停顿后一次」，
  // 这里量化单次成本，用来算防抖省下多少。
  const costPerRefresh = await wc.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      window.__inkdownLoad(${JSON.stringify(buildDoc(800))})
      await wait(1000)
      const muya = window.__inkdownMuya

      const measure = (fn, times = 10) => {
        const arr = []
        for (let i = 0; i < times; i++) {
          const t = performance.now()
          fn()
          arr.push(performance.now() - t)
        }
        arr.sort((a, b) => a - b)
        return Math.round(arr[Math.floor(arr.length / 2)] * 10) / 10
      }

      const getMd = measure(() => muya.getMarkdown())
      const toc = measure(() => muya.getTOC())
      const count = measure(() => {
        const md = window.__inkdownApp.activeTab().content || ''
        return (md.match(/[\\u4e00-\\u9fa5]|[A-Za-z0-9_'-]+/g) || []).length
      })
      return { getMd, toc, count, paragraphs: document.querySelectorAll('.muya-container .mu-paragraph').length }
    })()
  `)
  console.log(
    `[perf] 单次开销（${costPerRefresh.paragraphs} 段落）: getMarkdown ${costPerRefresh.getMd} ms，getTOC(大纲) ${costPerRefresh.toc} ms，字数统计 ${costPerRefresh.count} ms`
  )

  // ---------- 3. 主题切换 ----------
  // 主题切换的成本几乎全在浏览器样式重算：CSS 变量定义在 body 上，
  // 切换 class 时所有引用变量的元素都要重算 computed style。
  // 这里分「典型规模」与「极端规模」两档，判断它是否真的构成问题。
  for (const n of [200, 800]) {
    const themePerf = await wc.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const c = window.__inkdownCommands
        window.__inkdownLoad(${JSON.stringify(buildDoc(n))})
        await wait(900)

        // 纯 CSS：直接切 body class 并强制同步重算，不经过 Vue
        const cssTimes = []
        for (let i = 0; i < 5; i++) {
          const t = performance.now()
          document.body.classList.remove('theme-light', 'theme-dark', 'theme-github', 'theme-newsprint', 'theme-night')
          document.body.classList.add(i % 2 === 0 ? 'theme-dark' : 'theme-light')
          void document.body.offsetHeight
          const first = document.querySelector('.mu-paragraph')
          if (first) void getComputedStyle(first).color
          cssTimes.push(performance.now() - t)
        }
        cssTimes.sort((a, b) => a - b)

        // 完整命令链路（Vue 状态 + watch + class + persistView）
        const cmdTimes = []
        for (let i = 0; i < 5; i++) {
          const t = performance.now()
          await c.execute('view:toggleTheme')
          void document.body.offsetHeight
          cmdTimes.push(performance.now() - t)
        }
        cmdTimes.sort((a, b) => a - b)

        return {
          cssP50: Math.round(cssTimes[2]), cssMax: Math.round(cssTimes[4]),
          cmdP50: Math.round(cmdTimes[2]), cmdMax: Math.round(cmdTimes[4]),
          paragraphs: document.querySelectorAll('.muya-container .mu-paragraph').length
        }
      })()
    `)
    console.log(
      `[perf] 主题切换（${themePerf.paragraphs} 段落）: 纯CSS p50 ${themePerf.cssP50} / max ${themePerf.cssMax} ms；完整命令 p50 ${themePerf.cmdP50} / max ${themePerf.cmdMax} ms`
    )
  }

  // ---------- 4. 全库搜索 ----------
  // 造真实规模目录：200 与 1000 个文件，观察是否线性退化
  for (const fileCount of [200, 1000]) {
    const searchRoot = join(tmpdir(), `inkdown-perf-search-${fileCount}-${Date.now()}`)
    await fsp.mkdir(searchRoot, { recursive: true })
    for (let i = 0; i < fileCount; i++) {
      const body =
        `# 文件 ${i}\n\n` +
        `这是第 ${i} 个文件的正文。包含关键词${i % 10 === 0 ? '命中' : '普通'}内容。\n\n`.repeat(8)
      await fsp.writeFile(join(searchRoot, `f${i}.md`), body, 'utf8')
    }
    const searchPerf = await wc.executeJavaScript(`
      (async () => {
        // 先跑一次预热（文件系统缓存未命中会显著偏慢）
        await window.inkdown.searchInFolder(${JSON.stringify(searchRoot)}, {
          query: '预热', maxResults: 1
        })
        const t0 = performance.now()
        const r = await window.inkdown.searchInFolder(${JSON.stringify(searchRoot)}, {
          query: '命中', isCaseSensitive: false, isRegexp: false, maxResults: 500
        })
        return {
          ms: Math.round(performance.now() - t0),
          hits: r.hits.length,
          files: r.filesScanned,
          matched: r.filesMatched
        }
      })()
    `)
    console.log(
      `[perf] 全库搜索 ${fileCount} 文件: ${searchPerf.ms} ms（命中 ${searchPerf.hits} 处 / ${searchPerf.matched} 个文件）`
    )
    await fsp.rm(searchRoot, { recursive: true, force: true }).catch(() => {})
  }

  // ---------- 5. 内存占用 ----------
  const mem = await wc.executeJavaScript(`
    (async () => {
      const m = performance.memory || {}
      return {
        usedMB: m.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1024 / 1024) : -1,
        totalMB: m.totalJSHeapSize ? Math.round(m.totalJSHeapSize / 1024 / 1024) : -1,
        limitMB: m.jsHeapSizeLimit ? Math.round(m.jsHeapSizeLimit / 1024 / 1024) : -1
      }
    })()
  `)
  const proc = process.memoryUsage()
  console.log(
    `[perf] 内存: 渲染层 JS 堆 ${mem.usedMB} MB（上限 ${mem.limitMB} MB）；主进程 RSS ${Math.round(proc.rss / 1024 / 1024)} MB`
  )

  // ---------- 6. 滚动流畅度 ----------
  // 长文档滚动是否掉帧，直接决定「印字机般顺滑」还是「一顿一顿」。
  // 用 requestAnimationFrame 采样帧间隔，统计掉帧率（>25ms 视为掉帧）。
  const scrollPerf = await wc.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      window.__inkdownLoad(${JSON.stringify(buildDoc(800))})
      await wait(1200)
      const scroller = document.querySelector('.editor-scroll')
      if (!scroller) return { error: '未找到滚动容器' }

      // 预热滚动，让浏览器建立图层
      scroller.scrollTop = 0
      await wait(300)

      const frames = []
      let last = performance.now()
      let rafId = 0
      let running = true
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (running) rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)

      // 连续滚动约 2 秒
      const step = Math.max(1, Math.round(scroller.scrollHeight / 120))
      for (let i = 0; i < 120; i++) {
        scroller.scrollTop += step
        await wait(16)
      }
      running = false
      cancelAnimationFrame(rafId)

      const real = frames.filter((f) => f > 0).sort((a, b) => a - b)
      if (!real.length) return { error: '未采到帧' }
      const p50 = real[Math.floor(real.length * 0.5)]
      const p95 = real[Math.floor(real.length * 0.95)]
      const dropped = real.filter((f) => f > 25).length
      return {
        samples: real.length,
        p50: Math.round(p50 * 10) / 10,
        p95: Math.round(p95 * 10) / 10,
        max: Math.round(real[real.length - 1] * 10) / 10,
        dropRate: Math.round((dropped / real.length) * 1000) / 10,
        fps: Math.round(1000 / p50)
      }
    })()
  `)
  if (scrollPerf.error) {
    console.log('[perf] 滚动: ' + scrollPerf.error)
  } else {
    console.log(
      `[perf] 滚动（800 段落）: p50 ${scrollPerf.p50} ms（约 ${scrollPerf.fps} fps），p95 ${scrollPerf.p95} ms，max ${scrollPerf.max} ms，掉帧率 ${scrollPerf.dropRate}%`
    )
  }

  // ---------- 7. 内存增长（反复替换大文档） ----------
  // 检查内容替换是否有泄漏：同一标签反复载入大文档，
  // 旧文档的解析树与渲染节点应被回收，堆不应持续上涨。
  // 不用 file:closeTab——它会走保存确认流程，在无头环境里会卡住。
  const leakPerf = await wc.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const readHeap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : -1)

      // 先跑两轮让缓存与 GC 稳定
      window.__inkdownLoad(${JSON.stringify(buildDoc(600))})
      await wait(900)
      window.__inkdownLoad(${JSON.stringify(buildDoc(600))})
      await wait(900)
      const baseline = readHeap()

      // 反复替换内容 8 次
      for (let i = 0; i < 8; i++) {
        window.__inkdownLoad(${JSON.stringify(buildDoc(600))})
        await wait(500)
      }
      await wait(800)
      const after = readHeap()
      return { baseline, after, delta: after - baseline }
    })()
  `)
  console.log(
    `[perf] 内存增长（同一标签替换 600 段落文档 8 次）: ${leakPerf.baseline} MB → ${leakPerf.after} MB（Δ ${leakPerf.delta > 0 ? '+' : ''}${leakPerf.delta} MB）`
  )

  console.log('[perf] done')
}

/** 生成指定段落数的大文档。 */
function buildDoc(paragraphs: number): string {
  const parts = ['# 大文档性能测试\n']
  for (let i = 0; i < paragraphs; i++) {
    parts.push(
      `## 第 ${i + 1} 节\n\n这是第 ${i + 1} 段的正文，含 **加粗**、*斜体* 与 \`代码\`。\n\n`
    )
  }
  return parts.join('')
}
