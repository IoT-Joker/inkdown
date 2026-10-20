/**
 * 会话恢复验证脚本。
 *
 * 分两次启动真实 Electron 进程：
 *   第一次：打开两个文件并记录会话，然后退出
 *   第二次：全新进程启动，检查是否自动恢复上次的标签与活动标签
 *
 * 用法：node scripts/session-test.js
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const workDir = path.join(root, '.tmp-session-test')

function run(phase) {
  return new Promise((resolve) => {
    const env = { ...process.env, TYPRA2_SESSION_TEST: workDir, TYPRA2_SESSION_PHASE: phase }
    // 第一阶段要求干净起点（不恢复旧会话）但仍要记录新会话；
    // 第二阶段才真正验证「重启后自动恢复」。
    if (phase === 'first') env.TYPRA2_NO_SESSION_RESTORE = '1'
    delete env.ELECTRON_RUN_AS_NODE
    delete env.TYPRA2_SELF_CHECK
    delete env.TYPRA2_SCREENSHOT
    delete env.TYPRA2_FILE_TEST

    const child = spawn(electron, ['.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      resolve({ code: 1, out, err, reason: '超时' })
    }, 90000)

    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 0, out, err, reason: '' })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 1, out, err: e.message, reason: 'spawn 失败' })
    })
  })
}

;(async () => {
  // 每次验证前清空旧的会话数据，避免上一次的残留影响判断
  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true })

  console.log('--- 第一阶段：打开文件并记录会话 ---')
  const first = await run('first')
  const firstOut = first.out.split('\n').filter((l) => l.includes('[sessiontest]')).join('\n')
  console.log(firstOut || first.out.split('\n').slice(-8).join('\n'))
  if (first.code !== 0) {
    console.error('RESULT: FAILED - 第一阶段失败', first.reason, first.err.split('\n').slice(-6).join('\n'))
    process.exit(1)
  }

  console.log('--- 第二阶段：全新进程启动，检查会话恢复 ---')
  const second = await run('second')
  const secondOut = second.out.split('\n').filter((l) => l.includes('[sessiontest]')).join('\n')
  console.log(secondOut || second.out.split('\n').slice(-8).join('\n'))

  const passed = second.code === 0 && /\[sessiontest\] PASS/.test(second.out)
  if (!passed) {
    console.error('RESULT: FAILED - 第二阶段失败', second.reason)
    console.error(second.err.split('\n').slice(-10).join('\n'))
    process.exit(1)
  }
  console.log('RESULT: OK - 会话恢复验证通过（重启后自动重开上次标签）')
  process.exit(0)
})()
