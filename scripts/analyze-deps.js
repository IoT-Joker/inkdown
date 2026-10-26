/**
 * 分析主进程 bundle 的外部依赖（被 externalize 的裸包）。
 * 这些包必须随应用一起打包，其余依赖渲染层已 bundle 进 out/renderer。
 */
const fs = require('fs')
const path = require('path')

const mainDir = path.join(__dirname, '..', 'out', 'main')
const files = fs.readdirSync(mainDir).filter((f) => f.endsWith('.js'))

const pkgs = new Set()
for (const f of files) {
  const src = fs.readFileSync(path.join(mainDir, f), 'utf8')
  const re = /require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g
  let m
  while ((m = re.exec(src))) {
    const id = m[1]
    // 跳过 electron 内置模块与相对路径
    if (id.startsWith('node:') || id === 'electron') continue
    const pkg = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]
    pkgs.add(pkg)
  }
}

console.log('主进程外部依赖（需要随包携带）:')
for (const p of [...pkgs].sort()) console.log('  ' + p)

// 逐个报告其实际体积
console.log('\n体积:')
for (const p of [...pkgs].sort()) {
  const dir = path.join(__dirname, '..', 'node_modules', p)
  if (!fs.existsSync(dir)) {
    console.log(`  ${p.padEnd(28)} (未找到)`)
    continue
  }
  let total = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else total += fs.statSync(full).size
    }
  }
  walk(dir)
  console.log(`  ${p.padEnd(28)} ${(total / 1024 / 1024).toFixed(1)} MB`)
}
