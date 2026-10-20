/**
 * 生成 node / pnpm 的 PATH 垫片。
 *
 * electron-builder 会用 `getPackageManagerCommand(PNPM)` 直接执行 `pnpm`，
 * 而本机 Node 与 pnpm 都不在 PATH 中（Node 是内置运行时、pnpm 是 .mjs 文件），
 * 导致它拿到空输出并报 "No JSON content found in output"。
 * 这个脚本在项目外生成两个 .cmd 垫片，打包前把它加入 PATH 即可。
 *
 * 用法：node scripts/make-shims.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

/** 内置运行时的位置（可用环境变量覆盖）。 */
const NODE_EXE =
  process.env.INKDOWN_NODE_EXE ||
  path.join(
    process.env.USERPROFILE || '',
    '.dsh',
    'dsh-runtimes',
    'dsh-primary-runtime',
    'dependencies',
    'node',
    'bin',
    'node.exe'
  )
const PNPM_MJS =
  process.env.INKDOWN_PNPM_MJS ||
  path.join(
    process.env.USERPROFILE || '',
    '.dsh',
    'dsh-runtimes',
    'dsh-primary-runtime',
    'dependencies',
    'pnpm',
    'bin',
    'pnpm.mjs'
  )

const outDir = process.env.INKDOWN_SHIM_DIR || path.join(path.dirname(__dirname), '..', 'inkdown-shims')

function main() {
  if (!fs.existsSync(NODE_EXE)) {
    console.error('找不到 node.exe:', NODE_EXE)
    console.error('请设置 INKDOWN_NODE_EXE 指向实际路径')
    process.exit(1)
  }
  if (!fs.existsSync(PNPM_MJS)) {
    console.error('找不到 pnpm.mjs:', PNPM_MJS)
    console.error('请设置 INKDOWN_PNPM_MJS 指向实际路径')
    process.exit(1)
  }

  fs.mkdirSync(outDir, { recursive: true })

  // .cmd 垫片：cmd 下 %* 会原样转发参数
  fs.writeFileSync(
    path.join(outDir, 'node.cmd'),
    `@echo off\r\n"${NODE_EXE}" %*\r\n`,
    'ascii'
  )
  fs.writeFileSync(
    path.join(outDir, 'pnpm.cmd'),
    `@echo off\r\n"${NODE_EXE}" "${PNPM_MJS}" %*\r\n`,
    'ascii'
  )
  // 无扩展名的 shell 版本，供 git-bash 等环境使用
  fs.writeFileSync(
    path.join(outDir, 'node'),
    `#!/bin/sh\nexec "${NODE_EXE.replace(/\\/g, '/')}" "$@"\n`,
    'utf8'
  )
  fs.writeFileSync(
    path.join(outDir, 'pnpm'),
    `#!/bin/sh\nexec "${NODE_EXE.replace(/\\/g, '/')}" "${PNPM_MJS.replace(/\\/g, '/')}" "$@"\n`,
    'utf8'
  )

  // 验证垫片确实可执行
  try {
    const v = execFileSync(path.join(outDir, 'pnpm.cmd'), ['--version'], {
      encoding: 'utf8',
      shell: true
    })
    console.log('pnpm 垫片版本:', v.trim())
  } catch (err) {
    console.error('垫片验证失败:', err.message)
    process.exit(1)
  }

  console.log('垫片目录:', outDir)
  console.log('请把该目录加入 PATH 后再执行打包')
  console.log('PASS: 垫片生成完成')
}

main()
