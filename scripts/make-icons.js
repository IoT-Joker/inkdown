/**
 * 图标生成脚本：由 build/icon.svg 生成各尺寸 PNG 与 Windows ICO。
 * 用法：node scripts/make-icons.js
 */
const { spawn } = require('child_process')
const path = require('path')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outDir = path.join(root, 'build')

const env = { ...process.env, INKDOWN_MAKE_ICONS: outDir }
delete env.ELECTRON_RUN_AS_NODE
delete env.INKDOWN_SELF_CHECK
delete env.INKDOWN_FILE_TEST
delete env.INKDOWN_SESSION_TEST
delete env.INKDOWN_SCREENSHOT
delete env.INKDOWN_SHOT_EN
delete env.INKDOWN_SHOT_FIND

const child = spawn(electron, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  console.log(out.split('\n').filter((l) => l.includes('[icon]')).join('\n'))
  if (err.trim()) console.log('--- stderr ---\n' + err.split('\n').slice(-8).join('\n'))
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 图标生成超时'), 90000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[icon\] PASS/.test(out) || /\[icon\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}, 输出目录=${outDir}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
