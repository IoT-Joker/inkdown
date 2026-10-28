/**
 * 连跑打包版自检，抓到失败时保存完整输出，便于定位偶发原因。
 *
 * 用法：node scripts/repeat-packaged-check.js [次数]
 */
const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = __dirname.replace(/[\\/]scripts$/, '')
const exe = path.join(root, 'release', 'win-unpacked', 'Inkdown.exe')
const outDir = path.join(root, '.tmp-packaged-repeat')
const rounds = Number(process.argv[2] || 5)

if (!fs.existsSync(exe)) {
  console.error('找不到打包版:', exe)
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

function killAll() {
  for (const name of ['Inkdown.exe', 'electron.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/IM', name, '/T'], { stdio: 'ignore' })
    } catch {
      /* 没有该进程 */
    }
  }
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* busy wait */
  }
}

function runOnce() {
  return new Promise((resolve) => {
    const env = { ...process.env, INKDOWN_SELF_CHECK: '1', INKDOWN_NO_SESSION_RESTORE: '1', INKDOWN_NO_SESSION_PERSIST: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(exe, [], { cwd: path.dirname(exe), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    // 用 close 而不是 exit：Node 的 exit 事件在 stdio 流关闭前触发，
    // 此时 out 可能还没读完，会把「跑完了」误判成「输出不全」。
    // 超时也放宽到 480s：打包版冷启动 + 多个轮询用例累加可能好几分钟，
    // 与 verify-packaged.js 保持一致。
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      resolve({ code: 'timeout', out, err })
    }, 480000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 'spawn-error', out, err: String(e) })
    })
  })
}

;(async () => {
  let pass = 0
  let fail = 0
  for (let i = 1; i <= rounds; i++) {
    killAll()
    sleepSync(2500)
    const r = await runOnce()
    const ok = /\[selfcheck\] PASS/.test(r.out) || /\[selfcheck\] PASS/.test(r.err)
    const lines = (r.out + r.err).split('\n').filter((l) => l.trim()).length
    console.log(`第 ${i} 次: exit=${r.code} 行数=${lines} PASS=${ok}`)
    if (ok) {
      pass++
    } else {
      fail++
      const f = path.join(outDir, `fail-${i}.log`)
      fs.writeFileSync(f, r.out + '\n--- STDERR ---\n' + r.err, 'utf8')
      const tail = (r.out + r.err).split('\n').filter((l) => l.trim()).slice(-8)
      console.log('  失败现场已存:', f)
      for (const l of tail) console.log('   ' + l.trim().slice(0, 150))
    }
  }
  killAll()
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}（共 ${rounds} 次）`)
  process.exit(fail === 0 ? 0 : 1)
})()
