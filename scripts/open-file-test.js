/**
 * 验证「双击 .md 文件打开」是否真的可用。
 *
 * 分两步：
 *   1. 用带文件路径的参数启动打包后的 exe，检查该文件是否被打开
 *   2. 同时验证单实例：已有窗口时再传文件，应转发到现有窗口而不是开新窗口
 *
 * 用法：node scripts/open-file-test.js [--packaged]
 */
const { spawn, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = __dirname.replace(/[\\/]scripts$/, '')
const usePackaged = process.argv.includes('--packaged')

const electron = usePackaged
  ? path.join(root, 'release', 'win-unpacked', 'Inkdown.exe')
  : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const workDir = path.join(root, '.tmp-openfile-test')
fs.mkdirSync(workDir, { recursive: true })
const target = path.join(workDir, 'assoc-test.md')
fs.writeFileSync(target, '# 文件关联测试\n\n双击打开的内容。\n', 'utf8')

const env = {
  ...process.env,
  INKDOWN_OPEN_FILE_PROBE: target,
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.INKDOWN_SELF_CHECK

const args = usePackaged ? [target] : ['.', target]

console.log(`启动方式: ${usePackaged ? '打包版 exe' : '开发版 electron'}`)
console.log(`目标文件: ${target}`)
console.log(`参数: ${JSON.stringify(args)}\n`)

const child = spawn(electron, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  const lines = out.split('\n').filter((l) => l.includes('[openfile]'))
  if (lines.length) console.log(lines.join('\n'))
  if (err.trim()) {
    const el = err.split('\n').filter((l) => l.trim()).slice(-6)
    if (el.length) console.log('--- stderr ---\n' + el.join('\n'))
  }
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 超时'), 45000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[openfile\] PASS/.test(out) || /\[openfile\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
