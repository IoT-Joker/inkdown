// 冒烟测试：启动 Electron，执行主进程内的端到端自检，验证渲染层真正工作。
const { spawn } = require('child_process')
const path = require('path')

const root = 'E:\\Desktop\\JX\\07-DSH\\02-typra2'
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

// 宿主环境可能带有 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化成纯 Node 模式，
// 必须剔除后才能正常启动窗口。
const env = { ...process.env, TYPRA2_SELF_CHECK: '1' }
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

const timer = setTimeout(() => finish(1, 'FAILED - 自检超时'), 60000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const selfcheckPassed = /\[selfcheck\] PASS/.test(out) || /\[selfcheck\] PASS/.test(err)
  if (code === 0 && selfcheckPassed) finish(0, 'OK - 端到端自检通过')
  else finish(1, `FAILED - exit=${code}, selfcheck=${selfcheckPassed}`)
})

child.on('error', (e) => finish(1, `FAILED - spawn error: ${e.message}`))

