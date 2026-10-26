/**
 * 打包版自检：验证 release/win-unpacked 里的应用能正常启动并跑完自检。
 *
 * 与 stability-test.js 的区别：那个跑开发版（electron .），这个跑打包产物，
 * 用于确认「体积精简没有删掉运行期必需的依赖」。
 *
 * 判定方式：轮询输出流，一旦看到自检的 PASS / FAIL 行就立即结束，
 * 不依赖进程退出（打包版启动慢，等退出容易误判超时）。
 *
 * 用法：node scripts/verify-packaged.js
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const unpacked = path.join(root, 'release', 'win-unpacked')
const exe = path.join(unpacked, 'Inkdown.exe')

if (!fs.existsSync(exe)) {
  console.error('未找到打包产物:', exe)
  console.error('请先执行 node scripts/package.js --dir')
  process.exit(1)
}

const env = {
  ...process.env,
  INKDOWN_SELF_CHECK: '1',
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.INKDOWN_SCREENSHOT
delete env.INKDOWN_SHOT_EN
delete env.INKDOWN_SHOT_FIND

const child = spawn(exe, [], { cwd: unpacked, env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let settled = false

function cleanup() {
  try {
    child.kill('SIGKILL')
  } catch {}
}

function report(passed, reason) {
  if (settled) return
  settled = true
  cleanup()

  console.log('RESULT:', reason)

  const all = out
  const missing = all.match(/Cannot find module '[^']+'/g) || []
  if (missing.length) {
    console.log('--- 缺失模块 ---')
    for (const m of [...new Set(missing)]) console.log('  ' + m)
  }

  const fails = all.split('\n').filter((l) => l.includes('[selfcheck] FAIL'))
  if (fails.length) {
    console.log('--- 失败项 ---')
    for (const l of fails.slice(0, 6)) console.log('  ' + l.trim())
  }

  const logs = all.split('\n').filter((l) => l.includes('[selfcheck]'))
  console.log(`--- 自检日志（共 ${logs.length} 条，最后 3 条）---`)
  for (const l of logs.slice(-3)) console.log('  ' + l.trim())

  process.exit(passed ? 0 : 1)
}

/** 每次收到输出就检查是否已出结论。 */
function onChunk(text) {
  out += text
  if (/\[selfcheck\] PASS:/.test(out)) {
    report(true, 'OK - 打包版自检通过（依赖完整）')
  } else if (/\[selfcheck\] FAIL/.test(out)) {
    report(false, 'FAILED - 打包版自检有用例失败')
  }
}

child.stdout.on('data', (d) => onChunk(d.toString()))
child.stderr.on('data', (d) => onChunk(d.toString()))

// 打包版冷启动 + 全套用例，给足 8 分钟
const timer = setTimeout(() => report(false, 'FAILED - 打包版自检超时（未出现结论）'), 480000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const all = out
  if (/\[selfcheck\] PASS:/.test(all)) {
    report(true, `OK - 打包版自检通过（进程退出码 ${code}）`)
  } else {
    report(false, `FAILED - 进程退出（code=${code}）但未见自检结论`)
  }
})

child.on('error', (e) => {
  clearTimeout(timer)
  report(false, `FAILED - spawn error: ${e.message}`)
})
