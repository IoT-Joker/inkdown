/**
 * 诊断交互延迟的根因：GPU 状态、滚动帧耗时、菜单悬停耗时、合成层情况。
 *
 * 用法：node scripts/latency-diagnose.js
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = process.env.INKDOWN_PROJECT || path.resolve(__dirname, '..')

if (!process.versions.electron) {
  // 外层：用 Electron 重新执行自己
  const { spawn } = require('node:child_process')
  const output =
    process.env.INKDOWN_DIAG_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-diag-'))
  fs.mkdirSync(output, { recursive: true })
  const env = {
    ...process.env,
    INKDOWN_PROJECT: root,
    INKDOWN_DIAG_OUTPUT: output,
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
    console.log('诊断证据: ' + output)
    process.exitCode = code ?? 1
  })
} else {
  // 内层：在 Electron 里做真实测量
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
      console.log('[diag] FAIL: 窗口未就绪')
      app.exit(1)
      return
    }
    win.setSize(1480, 900)
    await wait(500)

    const evaluate = async (code) => win.webContents.executeJavaScript(code)

    // 1) GPU / 合成状态
    const gpu = await evaluate(`(() => {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      let renderer = '(no webgl)'
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '(unknown)'
      }
      return {
        webgl: !!gl,
        renderer: String(renderer),
        software: /swiftshader|software|basic render/i.test(String(renderer)),
        dpr: window.devicePixelRatio,
        cores: navigator.hardwareConcurrency
      }
    })()`)
    console.log('[diag] GPU:', JSON.stringify(gpu))

    // 2) 打开一份大文档
    const fixture = fs.readFileSync(path.join(root, 'examples/comprehensive-test.md'), 'utf8')
    await win.webContents.executeJavaScript(
      'window.__inkdownLoad(' + JSON.stringify(fixture) + ')'
    )
    await wait(1500)

    // 3) 单栏滚动帧耗时：连续滚 30 次，测每帧间隔
    const scrollPerf = await evaluate(`(async () => {
      const scroller = document.querySelector('.editor-scroll')
      scroller.scrollTop = 0
      await new Promise(r => requestAnimationFrame(r))
      const frames = []
      let last = performance.now()
      for (let i = 0; i < 30; i++) {
        scroller.scrollTop += 60
        await new Promise(r => requestAnimationFrame(r))
        const now = performance.now()
        frames.push(now - last)
        last = now
      }
      frames.sort((a, b) => a - b)
      const p = q => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))]
      return {
        p50: +p(0.5).toFixed(1),
        p95: +p(0.95).toFixed(1),
        max: +frames[frames.length - 1].toFixed(1),
        over33: frames.filter(x => x > 33).length,
        total: frames.length
      }
    })()`)
    console.log('[diag] 单栏滚动帧耗时:', JSON.stringify(scrollPerf))

    // 4) 菜单悬停耗时（打开菜单后连续 hover）
    const hoverPerf = await evaluate(`(async () => {
      const labels = [...document.querySelectorAll('.menu-label')]
      const view = labels.find(b => /视图/.test(b.textContent))
      if (!view) return { error: '未找到视图菜单' }
      view.click()
      await new Promise(r => setTimeout(r, 300))
      const items = [...document.querySelectorAll('.menu-panel .menu-item')]
      const spans = []
      for (let round = 0; round < 2; round++) {
        for (const it of items) {
          const t0 = performance.now()
          it.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
          it.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
          const style = getComputedStyle(it)
          void style.backgroundColor
          const t1 = performance.now()
          spans.push(t1 - t0)
          await new Promise(r => requestAnimationFrame(r))
        }
      }
      spans.sort((a, b) => a - b)
      const p = q => spans[Math.min(spans.length - 1, Math.floor(spans.length * q))]
      return {
        items: items.length,
        p50: +p(0.5).toFixed(2),
        p95: +p(0.95).toFixed(2),
        max: +spans[spans.length - 1].toFixed(2)
      }
    })()`)
    console.log('[diag] 菜单悬停耗时:', JSON.stringify(hoverPerf))

    // 5) 大面积滤镜/阴影/合成层
    const paint = await evaluate(`(() => {
      const out = []
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el)
        const blur = s.filter && s.filter !== 'none' ? s.filter : ''
        const shadow = s.boxShadow && s.boxShadow !== 'none' ? s.boxShadow : ''
        const bg = s.backdropFilter && s.backdropFilter !== 'none' ? s.backdropFilter : ''
        if (blur || bg || /rgba/.test(shadow)) {
          const r = el.getBoundingClientRect()
          if (r.width * r.height > 40000) {
            out.push({
              cls: String(el.className).slice(0, 40),
              w: Math.round(r.width), h: Math.round(r.height),
              filter: blur.slice(0, 30), shadow: shadow.slice(0, 30), backdrop: bg.slice(0, 30)
            })
          }
        }
      }
      return out.slice(0, 12)
    })()`)
    console.log('[diag] 大面积滤镜/阴影元素:', JSON.stringify(paint))

    // 6) 关键：真实滚轮事件 → 实际滚动位移 的端到端延迟
    //    这比 scrollTop 赋值更接近用户感受（含事件派发与浏览器滚动线程）
    const wheelLatency = await evaluate(`(async () => {
      const scroller = document.querySelector('.editor-scroll')
      scroller.scrollTop = 0
      await new Promise(r => requestAnimationFrame(r))
      const samples = []
      for (let i = 0; i < 12; i++) {
        const before = scroller.scrollTop
        const t0 = performance.now()
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
        // 等到 scrollTop 真的变化
        let waited = 0
        while (scroller.scrollTop === before && waited < 400) {
          await new Promise(r => requestAnimationFrame(r))
          waited = performance.now() - t0
        }
        samples.push({ moved: scroller.scrollTop !== before, ms: +(performance.now() - t0).toFixed(1) })
      }
      const moved = samples.filter(s => s.moved).map(s => s.ms)
      if (!moved.length) return { note: '原生滚轮事件不移动 scrollTop（合成事件常见）', samples: samples.slice(0, 3) }
      moved.sort((a, b) => a - b)
      return {
        movedCount: moved.length,
        p50: moved[Math.floor(moved.length * 0.5)],
        max: moved[moved.length - 1]
      }
    })()`)
    console.log('[diag] 滚轮事件端到端延迟:', JSON.stringify(wheelLatency))

    // 7) 检查是否有 CSS 动画/过渡常驻（会持续触发合成）
    const anim = await evaluate(`(() => {
      const running = document.getAnimations ? document.getAnimations().filter(a => a.playState === 'running') : []
      const transitions = [...document.querySelectorAll('*')].filter(el => {
        const d = getComputedStyle(el).transitionDuration
        return d && d !== '0s' && parseFloat(d) > 0.2
      }).map(el => String(el.className).slice(0, 30))
      return { runningAnimations: running.length, slowTransitions: [...new Set(transitions)].slice(0, 10) }
    })()`)
    console.log('[diag] 动画/慢过渡:', JSON.stringify(anim))

    const outDir = process.env.INKDOWN_DIAG_OUTPUT
    if (outDir) {
      fs.writeFileSync(
        path.join(outDir, 'diagnose.json'),
        JSON.stringify({ gpu, scrollPerf, hoverPerf, paint }, null, 2)
      )
    }
    app.exit(0)
  })
}
