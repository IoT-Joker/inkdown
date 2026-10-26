/**
 * 连到打包版，抓渲染层控制台报错，定位 Mermaid 渲染失败原因。
 *
 * 用法：node scripts/probe-packaged-console.js
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const root = __dirname.replace(/[\\/]scripts$/, '')
const exe = path.join(root, 'release', 'win-unpacked', 'Inkdown.exe')
const PORT = 9444

if (!fs.existsSync(exe)) {
  console.error('找不到打包版:', exe)
  process.exit(1)
}

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
              const page = JSON.parse(d).find((t) => t.type === 'page')
              if (page?.webSocketDebuggerUrl) return resolve(page)
            } catch {}
            Date.now() < deadline ? setTimeout(tick, 300) : resolve(null)
          })
        })
        .on('error', () => (Date.now() < deadline ? setTimeout(tick, 300) : resolve(null)))
    }
    tick()
  })
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.from(String(Math.random())).toString('base64'),
        'Sec-WebSocket-Version': '13'
      }
    })
    req.on('upgrade', (_r, socket) => {
      let id = 0
      const pending = new Map()
      const events = []
      let buf = Buffer.alloc(0)
      const send = (method, params) => {
        const payload = Buffer.from(JSON.stringify({ id: ++id, method, params }))
        const len = payload.length
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
              pending.get(msg.id)(msg)
              pending.delete(msg.id)
            } else if (msg.method) {
              events.push(msg)
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
          return { error: r.result.exceptionDetails.text, detail: r.result.exceptionDetails }
        }
        return r.result?.result?.value
      }
      resolve({ send, evaluate, events, close: () => socket.destroy() })
    })
    req.on('error', reject)
    req.end()
  })
}

;(async () => {
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
    cwd: path.dirname(exe),
    env: (() => {
      const e = { ...process.env }
      delete e.ELECTRON_RUN_AS_NODE
      return e
    })(),
    stdio: 'ignore'
  })

  const page = await waitForTarget()
  if (!page) {
    console.error('无法连接调试端口')
    child.kill()
    process.exit(1)
  }
  const cdp = await connect(page.webSocketDebuggerUrl)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  // 开启控制台与异常捕获
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  let ready = false
  for (let i = 0; i < 100; i++) {
    ready = await cdp.evaluate('!!window.__inkdownMuya && !!window.__inkdownApp').catch(() => false)
    if (ready) break
    await wait(200)
  }
  console.log('应用就绪:', ready)

  // 清空历史事件，只看插入图表之后
  cdp.events.length = 0

  // 插入一个 mermaid 图表并等待渲染
  const result = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const md = '# T\\n\\n\`\`\`mermaid\\ngraph LR\\n  A --> B\\n\`\`\`\\n'
    window.__inkdownLoad(md)
    for (let i = 0; i < 40; i++) {
      const svg = document.querySelectorAll('.mu-diagram-preview svg').length
      if (svg > 0) return { ok: true, svg, waited: i * 150 }
      await wait(150)
    }
    const block = document.querySelector('.mu-diagram-preview')
    // 深度诊断：手动触发一次 mermaid 渲染，看能否成功
    let manual = null
    try {
      const m = await import('./assets/mermaid.core-BvGSnTWl.js').catch(e => ({ __err: String(e) }))
      manual = m.__err ? { importError: m.__err } : { imported: true, keys: Object.keys(m).slice(0, 6) }
    } catch (e) {
      manual = { thrown: String(e).slice(0, 200) }
    }
    return {
      ok: false,
      svg: 0,
      blockHtml: block ? block.innerHTML.slice(0, 200) : '(无块)',
      hasBlock: !!block,
      manual,
      hasDeferred: typeof window.__inkdownDeferredDiagrams,
      blockCount: document.querySelectorAll('.mu-diagram-block').length
    }
  })()`)

  console.log('Mermaid 渲染结果:', JSON.stringify(result))

  // 打印控制台错误与异常
  const errs = cdp.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
    .map((e) => {
      if (e.method === 'Runtime.exceptionThrown') {
        const d = e.params.exceptionDetails
        return 'EXCEPTION: ' + (d.exception?.description || d.text || '').split('\n').slice(0, 3).join(' | ')
      }
      if (e.method === 'Log.entryAdded') {
        return 'LOG[' + e.params.entry.level + ']: ' + String(e.params.entry.text).split('\n')[0]
      }
      const args = (e.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
      return 'CONSOLE[' + e.params.type + ']: ' + String(args).split('\n')[0]
    })
    .filter((s) => /error|fail|mermaid|import|module|undefined|Cannot/i.test(s))

  console.log('\n=== 相关控制台输出（' + errs.length + ' 条）===')
  for (const line of errs.slice(0, 15)) console.log('  ' + line.slice(0, 220))

  cdp.close()
  child.kill()
  process.exit(0)
})()
