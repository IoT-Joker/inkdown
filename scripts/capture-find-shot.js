/**
 * 查找栏截图脚本：启动 Electron，打开查找/替换面板并截图。
 * 用法：node scripts/capture-find-shot.js
 */
const { spawn } = require('child_process')
const path = require('path')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outDir = path.join(root, 'screenshots')

const env = {
  ...process.env,
  INKDOWN_SHOT_FIND: outDir,
  // 必须禁用会话恢复与记录：否则会自动打开上次的文件，覆盖演示文档
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.INKDOWN_SELF_CHECK
delete env.INKDOWN_FILE_TEST
delete env.INKDOWN_SESSION_TEST
delete env.INKDOWN_SCREENSHOT
delete env.INKDOWN_SHOT_EN

const child = spawn(electron, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  console.log(out.split('\n').filter((l) => l.includes('[shot]')).join('\n'))
  if (err.trim()) console.log('--- stderr ---\n' + err.split('\n').slice(-8).join('\n'))
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 截图超时'), 90000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[shot\] PASS/.test(out) || /\[shot\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
