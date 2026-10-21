/**
 * 验证 Markdown → .docx 导出真的产出有效文件。
 *
 * 不只检查「有文件」，还要：
 *   1. 文件是合法 ZIP（docx 本质是 zip）
 *   2. 内含 word/document.xml
 *   3. 标题/正文/表格/代码块/列表的文本真的进了文档
 *   4. 标题带 Heading 样式（而不是普通段落）
 *
 * 用法：node scripts/docx-test.js
 */
const { spawn } = require('child_process')
const path = require('path')
const { killStaleProcesses } = require('./cleanup')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

killStaleProcesses()

const env = {
  ...process.env,
  INKDOWN_DOCX_TEST: '1',
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
  console.log(out.split('\n').filter((l) => l.includes('[docx]')).join('\n'))
  if (err.trim()) {
    const lines = err.split('\n').filter((l) => l.includes('[docx]'))
    if (lines.length) console.log(lines.join('\n'))
  }
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAILED - 超时'), 150000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const passed = /\[docx\] PASS/.test(out) || /\[docx\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))
