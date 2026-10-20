/**
 * 验证单实例与文件转发：
 *   1. 启动第一个实例（带文件 A）
 *   2. 在它仍运行时，启动第二个实例（带文件 B）
 *   3. 第二个实例应立即退出，且文件 B 被转发到第一个实例的窗口
 *
 * 用法：node scripts/single-instance-test.js [--packaged]
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = __dirname.replace(/[\\/]scripts$/, '')
const usePackaged = process.argv.includes('--packaged')

const electron = usePackaged
  ? path.join(root, 'release', 'win-unpacked', 'Inkdown.exe')
  : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

const workDir = path.join(root, '.tmp-single-instance')
fs.rmSync(workDir, { recursive: true, force: true })
fs.mkdirSync(workDir, { recursive: true })
const fileA = path.join(workDir, 'first.md')
const fileB = path.join(workDir, 'second.md')
fs.writeFileSync(fileA, '# 第一个文件\n\n实例 A 打开。\n', 'utf8')
fs.writeFileSync(fileB, '# 第二个文件\n\n实例 B 转发。\n', 'utf8')

const baseEnv = {
  ...process.env,
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1',
  INKDOWN_SINGLE_INSTANCE_PROBE: '1'
}
delete baseEnv.ELECTRON_RUN_AS_NODE
delete baseEnv.INKDOWN_SELF_CHECK

const argsFor = (file) => (usePackaged ? [file] : ['.', file])

console.log(`模式: ${usePackaged ? '打包版' : '开发版'}`)
console.log(`文件 A: ${fileA}`)
console.log(`文件 B: ${fileB}\n`)

// 启动第一个实例
const first = spawn(electron, argsFor(fileA), {
  cwd: root,
  env: baseEnv,
  stdio: ['ignore', 'pipe', 'pipe']
})
let firstOut = ''
first.stdout.on('data', (d) => (firstOut += d.toString()))

const cleanup = () => {
  try {
    first.kill('SIGKILL')
  } catch {}
}

const fail = (msg) => {
  console.error('RESULT: FAILED -', msg)
  const lines = firstOut.split('\n').filter((l) => l.includes('[single]') || l.includes('[openfile]'))
  if (lines.length) console.log(lines.join('\n'))
  cleanup()
  process.exit(1)
}

// 等第一个实例就绪
setTimeout(() => {
  if (first.exitCode !== null) {
    fail(`第一个实例提前退出，code=${first.exitCode}`)
    return
  }
  console.log('第一个实例运行中，启动第二个实例…')

  // 启动第二个实例：它应立即退出并把 fileB 转发过去
  const second = spawn(electron, argsFor(fileB), {
    cwd: root,
    env: baseEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let secondOut = ''
  second.stdout.on('data', (d) => (secondOut += d.toString()))

  let secondExited = false
  second.on('exit', () => {
    secondExited = true
  })

  // 等第一个实例收到转发
  setTimeout(() => {
    const gotB = firstOut.includes('second.md')
    const openedA = firstOut.includes('first.md')
    console.log('--- 第一个实例输出 ---')
    console.log(firstOut.split('\n').filter((l) => l.trim()).slice(-10).join('\n'))
    if (secondOut.trim()) {
      console.log('--- 第二个实例输出 ---')
      console.log(secondOut.split('\n').filter((l) => l.trim()).slice(-5).join('\n'))
    }

    if (!openedA) {
      fail('第一个实例未打开文件 A')
      return
    }
    if (!secondExited) {
      fail('第二个实例未退出（单实例锁未生效）')
      return
    }
    if (!gotB) {
      fail('文件 B 未转发到第一个实例')
      return
    }
    console.log('RESULT: OK - 单实例生效，第二个文件已转发到现有窗口')
    cleanup()
    process.exit(0)
  }, 6000)
}, 9000)
