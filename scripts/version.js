/**
 * 版本号管理：改 package.json 的 version，并校验一致性。
 *
 * 自动更新依赖版本号判断新旧：新包版本号若不变，
 * electron-updater 会认为「已是最新」，用户永远收不到更新。
 * 因此每次发布前必须递增版本。
 *
 * 用法：
 *   node scripts/version.js              # 显示当前版本
 *   node scripts/version.js patch        # 0.2.0 → 0.2.1
 *   node scripts/version.js minor        # 0.2.0 → 0.3.0
 *   node scripts/version.js major        # 0.2.0 → 1.0.0
 *   node scripts/version.js 1.2.3        # 指定具体版本
 */
const fs = require('fs')
const path = require('path')

const root = __dirname.replace(/[\\/]scripts$/, '')
const pkgPath = path.join(root, 'package.json')

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const current = pkg.version
const arg = process.argv[2]

if (!arg) {
  console.log('当前版本:', current)
  const parsed = current.split('.').map(Number)
  console.log('  patch →', `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`)
  console.log('  minor →', `${parsed[0]}.${parsed[1] + 1}.0`)
  console.log('  major →', `${parsed[0] + 1}.0.0`)
  process.exit(0)
}

function nextVersion(cur, kind) {
  const [major, minor, patch] = cur.split('.').map(Number)
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'major') return `${major + 1}.0.0`
  // 显式版本号
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  return null
}

const next = nextVersion(current, arg)
if (!next) {
  console.error('无效参数:', arg)
  console.error('用法: patch | minor | major | <x.y.z>')
  process.exit(1)
}

pkg.version = next
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

console.log(`版本已更新: ${current} → ${next}`)
console.log('')
console.log('提示：自动更新靠版本号判断新旧，改完请重新打包：')
console.log('  pnpm package')
console.log('  node scripts/publish-release.js')
