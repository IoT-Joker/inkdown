/**
 * 打包成可分发的安装程序。
 *
 * 处理三个本机特有的障碍：
 *   1. Node 与 pnpm 不在 PATH —— electron-builder 要直接执行 pnpm，先造垫片
 *   2. GitHub 直连不通 —— 二进制改从 npmmirror 取
 *   3. pnpm 输出混入提示行 —— 已在 .npmrc 里固定 store 并静音
 *
 * 用法：
 *   node scripts/package.js             # Windows 安装程序（默认）
 *   node scripts/package.js --dir       # 只出免安装目录，跳过安装程序
 *   node scripts/package.js --win --mac # 指定平台
 */
const { spawn, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = __dirname.replace(/[\\/]scripts$/, '')
const args = process.argv.slice(2)
const dirOnly = args.includes('--dir')
const platforms = ['win', 'mac', 'linux'].filter((p) => args.includes(`--${p}`))
const targets = platforms.length ? platforms : ['win']

/** 内置运行时位置。 */
const NODE_EXE = path.join(
  process.env.USERPROFILE || '',
  '.dsh',
  'dsh-runtimes',
  'dsh-primary-runtime',
  'dependencies',
  'node',
  'bin',
  'node.exe'
)
const PNPM_MJS = path.join(
  process.env.USERPROFILE || '',
  '.dsh',
  'dsh-runtimes',
  'dsh-primary-runtime',
  'dependencies',
  'pnpm',
  'bin',
  'pnpm.mjs'
)

const shimDir = path.join(path.dirname(root), 'inkdown-shims')

/** 生成 PATH 垫片（幂等）。 */
function ensureShims() {
  if (!fs.existsSync(NODE_EXE)) {
    console.error('找不到内置 node:', NODE_EXE)
    process.exit(1)
  }
  fs.mkdirSync(shimDir, { recursive: true })
  fs.writeFileSync(path.join(shimDir, 'node.cmd'), `@echo off\r\n"${NODE_EXE}" %*\r\n`, 'ascii')
  fs.writeFileSync(
    path.join(shimDir, 'pnpm.cmd'),
    `@echo off\r\n"${NODE_EXE}" "${PNPM_MJS}" %*\r\n`,
    'ascii'
  )
  console.log('垫片目录:', shimDir)
}

ensureShims()

const env = {
  ...process.env,
  // 垫片优先，让 electron-builder 能直接执行 node/pnpm
  PATH: `${shimDir};${path.dirname(NODE_EXE)};${process.env.PATH}`,
  // GitHub 直连不通，二进制走镜像
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.INKDOWN_SELF_CHECK
delete env.INKDOWN_FILE_TEST
delete env.INKDOWN_SESSION_TEST

// 先构建应用产物
console.log('--- 构建应用 ---')
execFileSync(NODE_EXE, [PNPM_MJS, 'exec', 'electron-vite', 'build'], {
  cwd: root,
  env,
  stdio: 'inherit'
})

// 再打包
const ebArgs = []
for (const p of targets) ebArgs.push(`--${p}`)
if (dirOnly) ebArgs.push('--dir')
ebArgs.push('--publish', 'never')

console.log(`--- 打包（${targets.join(', ')}${dirOnly ? '，仅免安装目录' : ''}）---`)
const child = spawn(NODE_EXE, [PNPM_MJS, 'exec', 'electron-builder', ...ebArgs], {
  cwd: root,
  env,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n=== 打包成功 ===')
    const rel = path.join(root, 'release')
    if (fs.existsSync(rel)) {
      for (const f of fs.readdirSync(rel, { withFileTypes: true })) {
        if (f.isFile() && /\.(exe|dmg|AppImage|deb)$/i.test(f.name)) {
          const mb = (fs.statSync(path.join(rel, f.name)).size / 1024 / 1024).toFixed(1)
          console.log(`  ${f.name}  (${mb} MB)`)
        }
      }
    }
  }
  process.exit(code ?? 0)
})
