/**
 * 真实文件工作流验证脚本。
 * 用法：node scripts/file-test.js
 * 通过 TYPRA2_FILE_TEST 驱动 Electron，验证打开 → 编辑 → 保存 → 导出全链路。
 */
const { spawn } = require('child_process')
const path = require('path')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const workDir = path.join(root, '.tmp-file-test')

const env = {
  ...process.env,
  TYPRA2_FILE_TEST: workDir,
  TYPRA2_NO_SESSION_RESTORE: '1',
  // 测试不记录会话，避免污染真实使用的会话数据
  TYPRA2_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.TYPRA2_SELF_CHECK
delete env.TYPRA2_SCREENSHOT
delete env.TYPRA2_SESSION_TEST

const child = spawn(electron, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  console.log('--- stdout ---')
  console.log(out.split('\n').slice(-30).join('\n'))
  if (err.trim()) {
    console.log('--- stderr ---')
    console.log(err.split('\n').slice(-15).join('\n'))
  }
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 文件测试超时'), 90000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[filetest\] PASS/.test(out) || /\[filetest\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
