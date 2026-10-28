/**
 * 应用内性能基准：在真实渲染环境里测各项操作耗时。
 * 用法：node scripts/perf-in-app.js
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const unpacked = path.join(root, 'release', 'win-unpacked')
const exe = path.join(unpacked, 'Inkdown.exe')

if (!fs.existsSync(exe)) {
  console.error('未找到打包产物')
  process.exit(1)
}

const env = {
  ...process.env,
  INKDOWN_PERF_IN_APP: '1',
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(exe, [], { cwd: unpacked, env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
let settled = false

function finish(code) {
  if (settled) return
  settled = true
  try {
    child.kill('SIGKILL')
  } catch {}
  const lines = out.split('\n').filter((l) => l.includes('[perf]'))
  console.log(lines.join('\n'))
  process.exit(code)
}

child.stdout.on('data', (d) => {
  out += d.toString()
  if (out.includes('[perf] done')) finish(0)
})
child.stderr.on('data', (d) => (out += d.toString()))
child.on('exit', () => finish(0))
setTimeout(() => finish(1), 300000)
