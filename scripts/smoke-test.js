// 冒烟测试：启动 Electron，执行主进程内的端到端自检，验证渲染层真正工作。
const { spawn } = require('child_process')
const path = require('path')
const { killStaleProcesses } = require('./cleanup')

// 从脚本位置推导项目根，避免硬编码路径（目录改名后仍可用）
const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

// 清理残留进程：它们持有 localStorage 的 leveldb 锁，会让新进程读不到数据
killStaleProcesses()

// 宿主环境可能带有 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化成纯 Node 模式，
// 必须剔除后才能正常启动窗口。
const env = {
  ...process.env,
  INKDOWN_SELF_CHECK: '1',
  INKDOWN_NO_SESSION_RESTORE: '1',
  INKDOWN_NO_SESSION_PERSIST: '1'
}
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})

let out = ''
let err = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (err += d.toString()))

const finish = (code, reason) => {
  console.log('RESULT:', reason)
  console.log('--- stdout ---')
  console.log(out.split('\n').slice(-30).join('\n'))
  console.log('--- stderr ---')
  console.log(err.split('\n').slice(-20).join('\n'))
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

// 自检内部有大量固定等待（合计约 37 秒），加上进程启动与渲染开销，
// 阈值必须留足余量：60 秒会在机器稍慢时误判为超时。
// 这里放到 150 秒，同时保留「超时即失败」的兜底。
const timer = setTimeout(() => finish(1, 'FAILED - 自检超时（150s）'), 150000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const selfcheckPassed = /\[selfcheck\] PASS/.test(out) || /\[selfcheck\] PASS/.test(err)
  if (code === 0 && selfcheckPassed) finish(0, 'OK - 端到端自检通过')
  else finish(1, `FAILED - exit=${code}, selfcheck=${selfcheckPassed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))

