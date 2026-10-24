/**
 * 测量交互延迟（滚轮滚动 + 菜单悬停），用于优化前后对比。
 *
 * 只测量、不修改任何实现 —— 先拿到基线数据，再决定改什么。
 *
 * 用法：node scripts/interaction-latency-test.js
 */
const { spawn } = require('child_process')
const path = require('path')
const { killStaleProcesses } = require('./cleanup')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

killStaleProcesses()

const env = {
  ...process.env,
  INKDOWN_LATENCY_TEST: '1',
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.INKDOWN_SELF_CHECK

const child = spawn(electron, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  console.log(
    (out + '\n' + err)
      .split('\n')
      .filter((l) => l.includes('[latency]'))
      .join('\n')
  )
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 超时'), 180000)

child.on('exit', (code) => {
  clearTimeout(timer)
  finish(code, `exit=${code}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
