/**
 * 验证「更新检查失败」的错误信息会被转成人话，而不是把整段 HTTP 响应糊给用户。
 *
 * 用户截图里的弹窗显示了完整响应头（含 gh_sess / octo cookie），
 * 既难读也有信息泄露风险。
 *
 * 用法：node scripts/update-error-test.js
 */
const { spawn } = require('child_process')
const path = require('path')
const { killStaleProcesses } = require('./cleanup')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

killStaleProcesses()

const env = {
  ...process.env,
  INKDOWN_UPDATE_ERROR_TEST: '1',
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
  console.log(out.split('\n').filter((l) => l.includes('[upderr]')).join('\n'))
  if (err.trim()) {
    const lines = err.split('\n').filter((l) => l.includes('[upderr]'))
    if (lines.length) console.log(lines.join('\n'))
  }
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 超时'), 90000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[upderr\] PASS/.test(out) || /\[upderr\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
