/**
 * 验证「在查找框输入时，光标是否会被抢到正文」。
 *
 * 复现路径：打开查找框 → 聚焦输入框 → 逐字符输入 → 检查 activeElement 是否仍是输入框。
 *
 * 用法：node scripts/find-focus-test.js
 */
const { spawn } = require('child_process')
const path = require('path')
const { killStaleProcesses } = require('./cleanup')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

killStaleProcesses()

const env = {
  ...process.env,
  INKDOWN_FIND_FOCUS_TEST: '1',
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
  console.log(out.split('\n').filter((l) => l.includes('[findfocus]')).join('\n'))
  if (err.trim()) {
    const lines = err.split('\n').filter((l) => l.includes('[findfocus]'))
    if (lines.length) console.log(lines.join('\n'))
  }
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 超时'), 120000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[findfocus\] PASS/.test(out) || /\[findfocus\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
