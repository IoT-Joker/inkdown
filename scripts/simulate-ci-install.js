/**
 * 本地模拟 CI 的干净安装环境，复现「安装依赖」失败。
 *
 * 与 CI 对齐的关键点：
 *   - 全新目录（无 node_modules、无 store 复用）
 *   - git 走 HTTPS 改写 + 禁用 SSH（模拟 CI 无密钥）
 *   - 使用独立 store，不复用本机已缓存的 git 依赖
 *
 * 用法：node scripts/simulate-ci-install.js
 */
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sim = path.join(path.dirname(root), 'tmp-ci-sim')
const NODE = process.execPath
const PNPM =
  'C:\\Users\\1\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs'

if (!fs.existsSync(PNPM)) {
  console.error('找不到 pnpm:', PNPM)
  process.exit(1)
}

// 清理并重建模拟目录
fs.rmSync(sim, { recursive: true, force: true })
fs.mkdirSync(sim, { recursive: true })

/** 递归复制，保留结构。 */
function copy(rel) {
  const src = path.join(root, rel)
  if (!fs.existsSync(src)) return false
  const dest = path.join(sim, rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
  return true
}

// 只复制 CI checkout 会拿到的内容
const files = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'tsconfig.muya.json'
]
for (const f of files) {
  if (!copy(f)) console.log('跳过（不存在）:', f)
}
// muya 包本体
copy('packages/muya/package.json')
copy('packages/muya/tsconfig.json')
copy('packages/muya/src')

console.log('=== 模拟目录内容 ===')
console.log(fs.readdirSync(sim).join(', '))
console.log('packages/muya:', fs.existsSync(path.join(sim, 'packages/muya')))

// 应用 CI 同款 git 配置
try {
  execFileSync('git', ['config', '--global', 'url."https://github.com/".insteadOf', 'git@github.com:'], { stdio: 'ignore' })
  execFileSync('git', ['config', '--global', 'url."https://github.com/".insteadOf', 'ssh://git@github.com:'], { stdio: 'ignore' })
  console.log('\n已设置 git insteadOf（SSH → HTTPS）')
} catch (e) {
  console.log('设置 git 配置失败:', e.message)
}

const env = {
  ...process.env,
  npm_config_store_dir: path.join(sim, '.pnpm-store'),
  GIT_TERMINAL_PROMPT: '0',
  // 禁用 SSH，模拟 CI 没有密钥
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=no'
}
delete env.ELECTRON_RUN_AS_NODE

console.log('\n=== 开始安装（模拟 CI）===\n')
const r = spawnSync(NODE, [PNPM, 'install', '--no-frozen-lockfile', '--reporter=default'], {
  cwd: sim,
  env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})

const out = (r.stdout || '') + (r.stderr || '')
fs.writeFileSync(path.join(sim, 'install.log'), out, 'utf8')

const lines = out.split('\n').filter((l) => l.trim())
console.log(lines.slice(-40).join('\n'))

console.log('\n=== 退出码:', r.status, '===')
if (r.status !== 0) {
  console.log('\n=== 错误行 ===')
  const errs = lines.filter((l) => /ERR|error|Error|failed|FATAL/i.test(l))
  console.log(errs.slice(0, 20).join('\n') || '(未匹配到错误关键字)')
}
console.log('\n完整日志:', path.join(sim, 'install.log'))
