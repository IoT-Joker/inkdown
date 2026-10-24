/**
 * 抓主线程长任务（Long Task）与帧间隔抖动。
 *
 * 用户症状：鼠标已到、阴影延迟才来；滚轮转了一圈、页面才开始动。
 * 这类"事件到了但反馈延迟"的典型原因是主线程被长任务周期性占满，
 * 输入事件排在任务队列里等。
 *
 * 用 PerformanceObserver 抓 longtask，用 rAF 采样帧间隔抖动。
 *
 * 用法：node scripts/jank-profile.js
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = process.env.INKDOWN_PROJECT || path.resolve(__dirname, '..')

if (!process.versions.electron) {
  const { spawn } = require('node:child_process')
  const output =
    process.env.INKDOWN_JANK_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-jank-'))
  fs.mkdirSync(output, { recursive: true })
  const env = {
    ...process.env,
    INKDOWN_PROJECT: root,
    INKDOWN_JANK_OUTPUT: output,
    INKDOWN_NO_SESSION_RESTORE: '1',
    INKDOWN_NO_SESSION_PERSIST: '1'
  }
  for (const name of Object.keys(env)) {
    if (/^INKDOWN_.*(?:CHECK|TEST|PROBE|SCREENSHOT|SHOT_)/.test(name)) delete env[name]
  }
  delete env.ELECTRON_RUN_AS_NODE
  const runner = path.join(output, 'runner.cjs')
  fs.copyFileSync(__filename, runner)
  const child = spawn(
    path.join(root, 'node_modules/electron/dist/electron.exe'),
    [runner, '--user-data-dir=' + path.join(output, 'profile')],
    { cwd: root, env, stdio: 'inherit' }
  )
  child.on('exit', (code) => {
    console.log('抖动证据: ' + output)
    process.exitCode = code ?? 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(async () => {
    require(path.join(root, 'out/main/index.js'))
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))

    let win
    for (let i = 0; i < 150; i++) {
      win = BrowserWindow.getAllWindows()[0]
      const ready = win
        ? await win.webContents
            .executeJavaScript('!!window.__inkdownMuya && !!window.__inkdownApp')
            .catch(() => false)
        : false
      if (ready) break
      await wait(100)
    }
    if (!win) {
      console.log('[jank] FAIL: 窗口未就绪')
      app.exit(1)
      return
    }
    win.setSize(1480, 900)
    await wait(600)

    const evaluate = (code) => win.webContents.executeJavaScript(code)

    // 载入大文档（与用户阅读场景一致）
    const fixture = fs.readFileSync(path.join(root, 'examples/comprehensive-test.md'), 'utf8')
    await win.webContents.executeJavaScript(
      'window.__inkdownLoad(' + JSON.stringify(fixture) + ')'
    )
    await wait(2000)

    // 装长任务观察器 + 开始 rAF 采样
    await evaluate(`(() => {
      window.__jank = { longtasks: [], frames: [], last: performance.now(), raf: null, running: true }
      try {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const entry = { name: e.name, dur: +e.duration.toFixed(1), start: +e.startTime.toFixed(0) }
            // 长任务发生时，记录当时的时间戳到 DOM 元素数的快照，便于推断来源
            entry.mutation = window.__jankMutationCount || 0
            entry.elCount = document.querySelectorAll('*').length
            window.__jank.longtasks.push(entry)
          }
        })
        po.observe({ entryTypes: ['longtask'] })
        window.__jank.po = po
      } catch (e) {
        window.__jank.observerError = String(e)
      }
      // 统计 DOM 变更量：长任务若伴随大量 mutation，说明是渲染/重排引起
      window.__jankMutationCount = 0
      try {
        window.__jankMo = new MutationObserver(list => { window.__jankMutationCount += list.length })
        window.__jankMo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
      } catch (e) {}
      // 采样滚动/布局耗时：每帧记录一次 getBoundingClientRect 触发次数
      const tick = () => {
        if (!window.__jank.running) return
        const now = performance.now()
        window.__jank.frames.push(+(now - window.__jank.last).toFixed(1))
        window.__jank.last = now
        window.__jank.raf = requestAnimationFrame(tick)
      }
      window.__jank.raf = requestAnimationFrame(tick)
      return { ok: true }
    })()`)

    // 劫持布局读取 API，统计调用来源（长任务期间的重排元凶）
    await evaluate(`(() => {
      const probe = { getBoundingClientRect: {}, getClientRects: {}, offsetHeight: 0, scrollHeight: 0, total: 0 }
      window.__domProbe = probe
      const stackKey = () => {
        const s = new Error().stack || ''
        const lines = s.split('\\n').slice(2, 5).map(x => x.trim())
        return lines.find(x => /inkdown|assets|index-/.test(x)) || lines[1] || '(unknown)'
      }
      const wrapRect = (proto, name, bucket) => {
        const orig = proto[name]
        if (!orig) return
        proto[name] = function (...args) {
          probe.total++
          const k = stackKey().slice(0, 120)
          bucket[k] = (bucket[k] || 0) + 1
          return orig.apply(this, args)
        }
      }
      wrapRect(Element.prototype, 'getBoundingClientRect', probe.getBoundingClientRect)
      wrapRect(Element.prototype, 'getClientRects', probe.getClientRects)
      for (const name of ['offsetHeight', 'offsetWidth']) {
        const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
        if (d && d.get) {
          Object.defineProperty(HTMLElement.prototype, name, {
            configurable: true,
            get() { probe[name] = (probe[name] || 0) + 1; return d.get.call(this) }
          })
        }
      }
      for (const name of ['scrollHeight', 'scrollWidth']) {
        const d = Object.getOwnPropertyDescriptor(Element.prototype, name)
        if (d && d.get) {
          Object.defineProperty(Element.prototype, name, {
            configurable: true,
            get() { probe[name] = (probe[name] || 0) + 1; return d.get.call(this) }
          })
        }
      }
      probe.total = 0
      return true
    })()`)

    // 模拟真实阅读：持续滚动 6 秒
    await evaluate(`(async () => {
      const scroller = document.querySelector('.editor-scroll')
      scroller.scrollTop = 0
      const t0 = performance.now()
      while (performance.now() - t0 < 6000) {
        scroller.scrollTop += 40
        await new Promise(r => requestAnimationFrame(r))
        if (scroller.scrollTop > scroller.scrollHeight - scroller.clientHeight - 100) scroller.scrollTop = 0
      }
      return true
    })()`)

    // 模拟菜单悬停：打开菜单反复 hover 3 秒
    await evaluate(`(async () => {
      const labels = [...document.querySelectorAll('.menu-label')]
      const view = labels.find(b => /视图/.test(b.textContent))
      if (!view) return false
      view.click()
      await new Promise(r => setTimeout(r, 300))
      const items = [...document.querySelectorAll('.menu-panel .menu-item')]
      const t0 = performance.now()
      let i = 0
      while (performance.now() - t0 < 3000) {
        const it = items[i++ % items.length]
        it.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        await new Promise(r => requestAnimationFrame(r))
      }
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      return true
    })()`)

    await wait(600)

    // 统计慢帧期间的 DOM 读取行为，判断是谁在触发布局
    const domProbe = await evaluate(`(() => {
      const p = window.__domProbe || {}
      const top = (obj, n) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
      return {
        totalReads: p.total || 0,
        rectTop: top(p.getBoundingClientRect, 6),
        rectsTop: top(p.getClientRects, 3),
        offsetHeight: p.offsetHeight || 0,
        offsetWidth: p.offsetWidth || 0,
        scrollHeight: p.scrollHeight || 0,
        scrollWidth: p.scrollWidth || 0
      }
    })()`)

    const result = await evaluate(`(() => {
      window.__jank.running = false
      if (window.__jank.raf) cancelAnimationFrame(window.__jank.raf)
      if (window.__jank.po) window.__jank.po.disconnect()
      const f = window.__jank.frames.slice().sort((a, b) => a - b)
      const p = q => f[Math.min(f.length - 1, Math.floor(f.length * q))] || 0
      const lt = window.__jank.longtasks
      const totalLong = lt.reduce((s, x) => s + x.dur, 0)
      return {
        observerError: window.__jank.observerError || null,
        frameCount: f.length,
        p50: +p(0.5).toFixed(1),
        p95: +p(0.95).toFixed(1),
        p99: +p(0.99).toFixed(1),
        max: f.length ? f[f.length - 1] : 0,
        over33: f.filter(x => x > 33).length,
        over50: f.filter(x => x > 50).length,
        longtaskCount: lt.length,
        longtaskTotalMs: +totalLong.toFixed(0),
        topLongtasks: lt.sort((a, b) => b.dur - a.dur).slice(0, 8)
      }
    })()`)

    console.log('[jank] 帧与长任务:', JSON.stringify(result, null, 1))
    console.log('[jank] DOM 读取探针:', JSON.stringify(domProbe))

    const outDir = process.env.INKDOWN_JANK_OUTPUT
    if (outDir) {
      fs.writeFileSync(path.join(outDir, 'jank.json'), JSON.stringify(result, null, 2))
    }
    app.exit(0)
  })
}
