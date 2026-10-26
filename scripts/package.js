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

/**
 * 结束残留的应用进程。
 *
 * 打包与测试会留下 Electron 进程，它们锁住 Chromium 缓存目录，
 * 导致后续运行报「Unable to move the cache: 拒绝访问」。
 */
function killStrayProcesses() {
  const names = ['Inkdown', 'electron']
  for (const name of names) {
    try {
      // 用 taskkill 而不是 process.kill：能一次清掉同名全部进程
      execFileSync('taskkill', ['/F', '/IM', `${name}.exe`, '/T'], { stdio: 'ignore' })
      console.log(`已结束残留进程: ${name}.exe`)
    } catch {
      // 没有该进程时 taskkill 返回非零，属正常
    }
  }
}

/**
 * 确认 electron 二进制存在；缺失则重新下载。
 *
 * @electron/rebuild 在打包过程中会清空 node_modules/electron/dist，
 * 使开发环境随后无法启动（spawn ENOENT）。
 */
function ensureElectronBinary() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (fs.existsSync(dist)) return
  console.log('electron 二进制缺失，重新下载…')
  try {
    execFileSync(NODE_EXE, [path.join(root, 'node_modules', 'electron', 'install.js')], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/'
      },
      stdio: 'inherit'
    })
    console.log('已恢复 electron 二进制')
  } catch (err) {
    console.error('恢复 electron 二进制失败:', err.message)
    console.error('请手动执行：node node_modules/electron/install.js')
  }
}

ensureShims()
// 打包前清掉可能锁住缓存的进程
killStrayProcesses()

const env = {
  ...process.env,
  // 垫片优先，让 electron-builder 能直接执行 node/pnpm
  PATH: `${shimDir};${path.dirname(NODE_EXE)};${process.env.PATH}`,
  // GitHub 直连不通，二进制走镜像
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'
}
// 本机固定 store 目录（C 盘与项目不在同一卷，pnpm 会因硬链接失败而告警，
// 该告警会污染 electron-builder 解析的 `pnpm list --json` 输出）。
// 用环境变量而非 .npmrc：后者随仓库共享，CI 上没有这个盘符。
if (process.env.INKDOWN_PNPM_STORE) {
  env.npm_config_store_dir = process.env.INKDOWN_PNPM_STORE
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
  // 打包会留下运行中的进程，且可能清空 electron 二进制——两者都要复原
  killStrayProcesses()
  ensureElectronBinary()

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
    console.log('开发环境已复原，可直接 pnpm dev / pnpm smoke')
  }
  process.exit(code ?? 0)
})
