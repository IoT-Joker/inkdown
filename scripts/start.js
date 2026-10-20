/**
 * 一键启动 Inkdown。
 *
 * 用法：
 *   node scripts/start.js          # 直接运行已构建的版本
 *   node scripts/start.js --dev    # 开发模式（热更新，需要 node 在 PATH）
 *
 * 本脚本会自动处理两个常见环境问题：
 *   1. node 不在 PATH 时，使用内置的 Node 运行时
 *   2. 宿主设置了 ELECTRON_RUN_AS_NODE=1 时将其剔除
 *      （否则 Electron 会退化为纯 Node 模式，报 whenReady 未定义）
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = __dirname.replace(/[\\/]scripts$/, '')
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

// 环境清理：ELECTRON_RUN_AS_NODE 必须剔除
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

if (!fs.existsSync(electron)) {
  console.error('找不到 Electron 可执行文件：', electron)
  console.error('请先在项目目录执行：pnpm install')
  process.exit(1)
}

const dev = process.argv.includes('--dev')

if (dev) {
  // 开发模式交给 electron-vite dev（需要 node 在 PATH）
  const pnpm = process.env.INKDOWN_PNPM
  if (!pnpm) {
    console.error('开发模式需要 Node.js 在 PATH 中，或设置 INKDOWN_PNPM 指向 pnpm.mjs')
    console.error('提示：直接运行已构建版本请用  node scripts/start.js')
    process.exit(1)
  }
  const child = spawn(process.execPath, [pnpm, 'exec', 'electron-vite', 'dev'], {
    cwd: root,
    env,
    stdio: 'inherit'
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  // 生产模式：直接用 Electron 运行构建产物
  if (!fs.existsSync(path.join(root, 'out', 'main', 'index.js'))) {
    console.error('尚未构建。请先执行：pnpm build')
    process.exit(1)
  }
  console.log('正在启动 Inkdown …（关闭窗口即退出）')
  const child = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
}
