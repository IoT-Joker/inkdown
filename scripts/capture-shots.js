/**
 * 截图脚本：启动 Electron 并把界面截图写到 screenshots/。
 * 用法：node scripts/capture-shots.js
 */
const { spawn } = require('child_process')
const path = require('path')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outDir = path.join(root, 'screenshots')

const env = {
  ...process.env,
  TYPRA2_SCREENSHOT: outDir,
  TYPRA2_NO_SESSION_RESTORE: '1',
  TYPRA2_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.TYPRA2_SELF_CHECK
delete env.TYPRA2_FILE_TEST

const child = spawn(electron, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  console.log(out.split('\n').filter((l) => l.includes('[shot]')).join('\n'))
  if (err.trim()) console.log('--- stderr ---\n' + err.split('\n').slice(-10).join('\n'))
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 截图超时'), 90000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[shot\] PASS/.test(out) || /\[shot\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}, 输出目录=${outDir}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
