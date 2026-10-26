/**
 * 三项新功能的端到端验证（真实 Electron）：
 *   1. 大纲折叠：折叠父标题后子标题真的从 DOM 消失
 *   2. 搜索结果列表：展开后行可见，点击能跳到对应命中
 *   3. CI：已在单元测试里校验文件存在（此处不重复）
 *
 * 用法：node scripts/features-e2e-test.js
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { killStaleProcesses } = require('./cleanup')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

killStaleProcesses()

const env = {
  ...process.env,
  INKDOWN_FEATURES_TEST: '1',
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
      .filter((l) => l.includes('[feat]'))
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
  const passed = /\[feat\] PASS/.test(out) || /\[feat\] PASS/.test(err)
  finish(code === 0 && passed ? 0 : 1, `exit=${code}, passed=${passed}`)
})
child.on('error', (e) => finish(1, `FAILED - ${e.message}`))
