/**
 * 对打包版实测交互性能（滚动帧间隔 + 长任务）。
 *
 * 打包版不支持运行内部探针脚本，因此用 CDP 远程调试连接后注入测量代码。
 *
 * 用法：
 *   1. 先启动打包版并开启远程调试端口（脚本会自动启动）
 *   2. node scripts/packaged-perf-check.js
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const root = __dirname.replace(/[\\/]scripts$/, '')
const exe = path.join(root, 'release', 'win-unpacked', 'Inkdown.exe')
const PORT = 9333

if (!fs.existsSync(exe)) {
  console.error('找不到打包版：', exe)
  process.exit(1)
}

/** 等 CDP 端口可用。 */
function waitForTarget(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      http
        .get(`http://127.0.0.1:${PORT}/json/list`, (res) => {
          let d = ''
          res.on('data', (c) => (d += c))
          res.on('end', () => {
            try {
              const list = JSON.parse(d)
              const page = list.find((t) => t.type === 'page')
              if (page?.webSocketDebuggerUrl) return resolve(page)
            } catch {}
            if (Date.now() < deadline) setTimeout(tick, 300)
            else resolve(null)
          })
        })
        .on('error', () => {
          if (Date.now() < deadline) setTimeout(tick, 300)
          else resolve(null)
        })
    }
    tick()
  })
}

/** 极简 CDP 客户端（只用到 evaluate，不引入依赖）。 */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl)
    const key = Buffer.from(String(Math.random())).toString('base64')
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    })
    req.on('upgrade', (_res, socket) => {
      let id = 0
      const pending = new Map()
      let buf = Buffer.alloc(0)

      const send = (method, params) => {
        const msg = JSON.stringify({ id: ++id, method, params })
        const payload = Buffer.from(msg)
        const len = payload.length
        // 客户端帧需掩码
        let header
        if (len < 126) header = Buffer.from([0x81, 0x80 | len])
        else if (len < 65536) {
          header = Buffer.alloc(4)
          header[0] = 0x81
          header[1] = 0x80 | 126
          header.writeUInt16BE(len, 2)
        } else {
          header = Buffer.alloc(10)
          header[0] = 0x81
          header[1] = 0x80 | 127
          header.writeUInt32BE(0, 2)
          header.writeUInt32BE(len, 6)
        }
        const mask = Buffer.from([1, 2, 3, 4])
        const masked = Buffer.alloc(len)
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4]
        socket.write(Buffer.concat([header, mask, masked]))
        return new Promise((res) => pending.set(id, res))
      }

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 2) {
          const len0 = buf[1] & 0x7f
          let offset = 2
          let len = len0
          if (len0 === 126) {
            if (buf.length < 4) return
            len = buf.readUInt16BE(2)
            offset = 4
          } else if (len0 === 127) {
            if (buf.length < 10) return
            len = Number(buf.readBigUInt64BE(2))
            offset = 10
          }
          if (buf.length < offset + len) return
          const payload = buf.subarray(offset, offset + len).toString()
          buf = buf.subarray(offset + len)
          try {
            const msg = JSON.parse(payload)
            if (msg.id && pending.has(msg.id)) {
              const res = pending.get(msg.id)
              pending.delete(msg.id)
              res(msg)
            }
          } catch {}
        }
      })

      const evaluate = async (expr) => {
        const r = await send('Runtime.evaluate', {
          expression: expr,
          awaitPromise: true,
          returnByValue: true
        })
        if (r.result?.exceptionDetails) {
          throw new Error(r.result.exceptionDetails.text || 'evaluate failed')
        }
        return r.result?.result?.value
      }
      resolve({ send, evaluate, close: () => socket.destroy() })
    })
    req.on('error', reject)
    req.end()
  })
}

;(async () => {
  console.log('启动打包版（远程调试端口 %d）…', PORT)
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
    cwd: path.dirname(exe),
    env: (() => {
      const e = { ...process.env }
      delete e.ELECTRON_RUN_AS_NODE
      return e
    })(),
    stdio: 'ignore',
    detached: false
  })

  const page = await waitForTarget()
  if (!page) {
    console.error('无法连接调试端口，打包版可能未启动')
    try {
      child.kill()
    } catch {}
    process.exit(1)
  }

  const cdp = await connect(page.webSocketDebuggerUrl)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  // 等应用就绪
  let ready = false
  for (let i = 0; i < 100; i++) {
    ready = await cdp
      .evaluate('!!window.__inkdownMuya && !!window.__inkdownApp')
      .catch(() => false)
    if (ready) break
    await wait(200)
  }
  if (!ready) {
    console.error('应用未就绪')
    cdp.close()
    try {
      child.kill()
    } catch {}
    process.exit(1)
  }

  const version = await cdp.evaluate('window.__inkdownApp ? "ok" : "no"')
  console.log('应用就绪:', version)

  // 载入包含多个图表的大文档
  const fixturePath = path.join(root, 'examples', 'comprehensive-test.md')
  const fixture = fs.readFileSync(fixturePath, 'utf8')
  await cdp.evaluate('window.__inkdownLoad(' + JSON.stringify(fixture) + ')')
  await wait(2500)

  // 装长任务与帧采样，然后持续滚动
  await cdp.evaluate(`(() => {
    window.__p = { lt: [], frames: [], last: performance.now(), on: true }
    try {
      const po = new PerformanceObserver(l => {
        for (const e of l.getEntries()) window.__p.lt.push(+e.duration.toFixed(1))
      })
      po.observe({ entryTypes: ['longtask'] })
      window.__p.po = po
    } catch (e) { window.__p.err = String(e) }
    const tick = () => {
      if (!window.__p.on) return
      const now = performance.now()
      window.__p.frames.push(+(now - window.__p.last).toFixed(1))
      window.__p.last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return true
  })()`)

  // 滚动 6 秒（模拟阅读）
  await cdp.evaluate(`(async () => {
    const s = document.querySelector('.editor-scroll')
    s.scrollTop = 0
    const t0 = performance.now()
    while (performance.now() - t0 < 6000) {
      s.scrollTop += 40
      await new Promise(r => requestAnimationFrame(r))
      if (s.scrollTop > s.scrollHeight - s.clientHeight - 100) s.scrollTop = 0
    }
    return true
  })()`)

  // 菜单悬停 3 秒
  await cdp.evaluate(`(async () => {
    const labels = [...document.querySelectorAll('.menu-label')]
    const v = labels.find(b => /视图/.test(b.textContent))
    if (!v) return false
    v.click()
    await new Promise(r => setTimeout(r, 300))
    const items = [...document.querySelectorAll('.menu-panel .menu-item')]
    const t0 = performance.now(); let i = 0
    while (performance.now() - t0 < 3000) {
      items[i++ % items.length].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise(r => requestAnimationFrame(r))
    }
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    return true
  })()`)

  await wait(500)

  const result = await cdp.evaluate(`(() => {
    window.__p.on = false
    if (window.__p.po) window.__p.po.disconnect()
    const f = window.__p.frames.slice().sort((a,b)=>a-b)
    const p = q => f[Math.min(f.length-1, Math.floor(f.length*q))] || 0
    return {
      frames: f.length,
      p50: +p(0.5).toFixed(1),
      p95: +p(0.95).toFixed(1),
      p99: +p(0.99).toFixed(1),
      max: f.length ? f[f.length-1] : 0,
      over33: f.filter(x=>x>33).length,
      over50: f.filter(x=>x>50).length,
      longtasks: window.__p.lt.length,
      longtaskMax: window.__p.lt.length ? Math.max(...window.__p.lt) : 0,
      longtaskTotal: +window.__p.lt.reduce((a,b)=>a+b,0).toFixed(0),
      observerErr: window.__p.err || null
    }
  })()`)

  console.log('[packaged-perf] 滚动+悬停 9 秒实测:', JSON.stringify(result, null, 1))

  const ok = result.over33 === 0 && result.longtasks === 0
  console.log(
    ok
      ? '[packaged-perf] PASS: 打包版无卡顿帧（>33ms 为 0，长任务为 0）'
      : '[packaged-perf] FAIL: 仍有卡顿'
  )

  cdp.close()
  try {
    child.kill()
  } catch {}
  process.exit(ok ? 0 : 1)
})()
