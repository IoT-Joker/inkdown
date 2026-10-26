/**
 * 打包产物完整性校验。
 *
 * 体积优化最大的风险是「排除过度」：少一个包，打包版启动即崩
 * （典型报错 Cannot find module 'xxx'），而开发环境完全正常。
 *
 * 这个脚本做三件事：
 * 1. 解析 asar，列出 node_modules 里实际保留的包
 * 2. 从 out/main 的 bundle 里提取 require 的裸包，逐个确认在 asar 中存在
 * 3. 递归校验这些包的 dependencies 是否也都在（防止二级依赖被误删）
 *
 * 用法：node scripts/verify-package.js
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const asarPath = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar')

/** 读取 asar 头部，返回其内部文件树。 */
function readAsarTree(asar) {
  const fd = fs.openSync(asar, 'r')
  const sizeBuf = Buffer.alloc(16)
  fs.readSync(fd, sizeBuf, 0, 16, 0)
  const headerSize = sizeBuf.readUInt32LE(12)
  const headerBuf = Buffer.alloc(headerSize)
  fs.readSync(fd, headerBuf, 0, headerSize, 16)
  fs.closeSync(fd)
  const json = headerBuf.toString('utf8').replace(/\0+$/g, '')
  return JSON.parse(json)
}

/** 按路径取 asar 中的节点。 */
function getNode(tree, p) {
  let n = tree
  for (const seg of p.split('/').filter(Boolean)) {
    if (!n.files || !n.files[seg]) return null
    n = n.files[seg]
  }
  return n
}

/** 统计节点下的文件数。 */
function countFiles(node) {
  if (!node) return 0
  if (!node.files) return node.size != null ? 1 : 0
  let c = 0
  for (const v of Object.values(node.files)) c += countFiles(v)
  return c
}

/** 从主进程 bundle 提取被 externalize 的裸包名。 */
function mainProcessExternals() {
  const dir = path.join(root, 'out', 'main')
  const pkgs = new Set()
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const re = /require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g
    let m
    while ((m = re.exec(src))) {
      const id = m[1]
      if (id.startsWith('node:') || id === 'electron') continue
      pkgs.add(id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0])
    }
  }
  return [...pkgs]
}

/**
 * 判断一个依赖是否真的需要「运行时存在」。
 *
 * @types/* 只是 TypeScript 类型声明，运行时不会 require；
 * 有些包把它写进 dependencies（docx 就是如此），
 * 若按字面要求它在 asar 里就会误报。
 */
function isTypeOnlyDep(name) {
  return name.startsWith('@types/') || name === '@types/node' || name === 'undici-types'
}

/** 读取某个包在源 node_modules 中的 package.json（支持 @scope/name）。 */
function readPkgJson(name) {
  const p = path.join(root, 'node_modules', name, 'package.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 在 asar 中判断某个包是否存在。
 * 支持 @scope/name 形式（asar 树里是两层）。
 */
function pkgInAsar(tree, name) {
  const segs = name.split('/')
  let node = tree
  for (const seg of ['node_modules', ...segs]) {
    if (!node.files || !node.files[seg]) return false
    node = node.files[seg]
  }
  return true
}

function main() {
  if (!fs.existsSync(asarPath)) {
    console.error('未找到 asar:', asarPath)
    console.error('请先执行 pnpm package:dir')
    process.exit(1)
  }

  const tree = readAsarTree(asarPath)
  const asarSize = (fs.statSync(asarPath).size / 1024 / 1024).toFixed(1)
  console.log(`asar 体积: ${asarSize} MB`)

  const nm = getNode(tree, 'node_modules')
  const present = new Set(
    nm ? Object.keys(nm.files || {}).filter((k) => !k.startsWith('.')) : []
  )
  console.log(`asar 内 node_modules 包数: ${present.size}`)

  // 主进程入口必须在
  if (!getNode(tree, 'out/main/index.js')) {
    console.error('FAIL: asar 里缺少 out/main/index.js')
    process.exit(1)
  }

  const externals = mainProcessExternals()
  console.log(`主进程外部依赖: ${externals.join(', ')}`)

  const problems = []

  // 1. 主进程直接依赖必须在
  for (const name of externals) {
    if (!pkgInAsar(tree, name)) {
      problems.push(`主进程依赖缺失: ${name}`)
      continue
    }
    const pkg = readPkgJson(name)
    const entry = pkg?.main || 'index.js'
    // 入口文件必须在（防止只留了 package.json）
    if (!getNode(tree, `node_modules/${name}/${entry}`)) {
      problems.push(`包入口缺失: ${name}/${entry}`)
    }
  }

  // 2. 递归校验依赖闭包（只查主进程可达的那部分）
  const visited = new Set()
  const queue = [...externals]
  while (queue.length) {
    const name = queue.shift()
    if (visited.has(name)) continue
    visited.add(name)
    // 类型声明包不参与运行时校验
    if (isTypeOnlyDep(name)) continue
    if (!pkgInAsar(tree, name)) {
      problems.push(`传递依赖缺失: ${name}`)
      continue
    }
    const pkg = readPkgJson(name)
    if (!pkg) continue
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (isTypeOnlyDep(dep)) continue
      if (!pkgInAsar(tree, dep)) {
        problems.push(`${name} 的依赖缺失: ${dep}`)
      } else if (!visited.has(dep)) {
        queue.push(dep)
      }
    }
  }

  // 3. 关键文件抽查
  const spotChecks = [
    'node_modules/docx/dist/index.cjs',
    'node_modules/electron-updater/package.json',
    'out/renderer/index.html'
  ]
  for (const f of spotChecks) {
    if (!getNode(tree, f)) problems.push(`关键文件缺失: ${f}`)
  }

  console.log(`已校验包: ${visited.size}`)

  if (problems.length) {
    console.error('\nFAIL: 打包产物不完整')
    for (const p of problems.slice(0, 20)) console.error('  - ' + p)
    if (problems.length > 20) console.error(`  ...共 ${problems.length} 项`)
    process.exit(1)
  }

  console.log('PASS: 打包产物依赖完整，主进程所需包均在 asar 中')
}

main()
