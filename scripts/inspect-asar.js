// 检查 asar 归档里实际有哪些顶层条目，确认打包产物是否完整。
const fs = require('node:fs')

const asar = 'release/win-unpacked/resources/app.asar'
if (!fs.existsSync(asar)) {
  console.log('asar 不存在')
  process.exit(1)
}

const buf = fs.readFileSync(asar)
// asar 格式：4 字节 pickle 长度 + 8 字节头 + JSON 目录树
const headerSize = buf.readUInt32LE(4)
const headerJson = buf.subarray(8, 8 + headerSize).toString('utf8')
// JSON 后面可能有补齐字节，截到最后一个 }
const end = headerJson.lastIndexOf('}')
let tree
try {
  tree = JSON.parse(headerJson.slice(0, end + 1))
} catch (e) {
  console.log('头部解析失败:', e.message)
  process.exit(1)
}

const top = Object.keys(tree.files || {})
console.log('asar 顶层条目:', JSON.stringify(top))
console.log('大小:', (buf.length / 1024 / 1024).toFixed(1), 'MB')

// 关键路径检查
const exists = (p) => {
  let node = tree
  for (const part of p.split('/')) {
    node = node?.files?.[part]
    if (!node) return false
  }
  return true
}
for (const p of [
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'node_modules/docx',
  'node_modules/electron-updater',
  'package.json'
]) {
  console.log('  ', p.padEnd(32), exists(p) ? '存在' : '✖ 缺失')
}
