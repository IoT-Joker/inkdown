// 搜索结果整理的纯逻辑测试：行号、列号、上下文都要真的算对。
const assert = require('node:assert')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

/** 与项目其它测试一致：用 tsc 转译后在新上下文里执行。 */
function load(name, dependencies = {}, globals = {}) {
  const file = path.join(root, name)
  if (!fs.existsSync(file)) return {}
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext(
    '(function(require,exports){' + output + '})',
    { Math, String, Array, Object, console, ...globals }
  )((id) => {
    if (id in dependencies) return dependencies[id]
    throw Error('Unexpected dependency ' + id)
  }, exports)
  return exports
}

const api = load('src/renderer/src/editor/searchResults.ts')

function required(name) {
  assert.equal(typeof api[name], 'function', name + ' 必须已实现')
  return api[name]
}

test('行号按换行累计，列号是行内偏移', () => {
  const build = required('buildSearchResults')
  const text = '第一行\n第二行有目标\n第三行'
  const offset = text.indexOf('目标')
  const [item] = build([{ start: offset, end: offset + 2, match: '目标', blockText: text }])
  assert.equal(item.line, 2, '「目标」在第 2 行')
  // 「第二行有」共 4 个字符，命中从第 5 列开始
  assert.equal(item.column, 5)
  assert.equal(item.match, '目标')
})

test('首行命中的行号与列号正确', () => {
  const build = required('buildSearchResults')
  const text = 'abc目标def'
  const offset = text.indexOf('目标')
  const [item] = build([{ start: offset, end: offset + 2, match: '目标', blockText: text }])
  assert.equal(item.line, 1)
  assert.equal(item.column, 4)
})

test('上下文截取命中前后各一段，且不带换行', () => {
  const build = required('buildSearchResults')
  const text = 'aaa\nbbb目标ccc\nddd'
  const offset = text.indexOf('目标')
  const [item] = build([{ start: offset, end: offset + 2, match: '目标', blockText: text }])
  assert.equal(item.before, 'aaa bbb', '前文跨行时压平成空格')
  assert.equal(item.after, 'ccc ddd')
  assert.ok(!item.before.includes('\n') && !item.after.includes('\n'), '上下文里不能有换行')
})

test('多个匹配按顺序编号，index 与数组下标一致', () => {
  const build = required('buildSearchResults')
  const text = '目标一 目标二 目标三'
  const matches = []
  let from = 0
  for (let i = 0; i < 3; i++) {
    const at = text.indexOf('目标', from)
    matches.push({ start: at, end: at + 2, match: '目标', blockText: text })
    from = at + 2
  }
  const items = build(matches)
  assert.deepEqual(items.map((x) => x.index), [0, 1, 2])
  // 「目标一 」占 4 字，故三个命中分别从第 1、5、9 列开始（1 基）
  assert.deepEqual(items.map((x) => x.column), [1, 5, 9])
})

test('跨行匹配被标记，便于列表提示', () => {
  const build = required('buildSearchResults')
  const text = '开头\n中间目标\n结尾'
  const [item] = build([{ start: 3, end: 9, match: '间目标\n结', blockText: text }])
  assert.equal(item.multiline, true)
})

test('拿不到块文本时退回只显示匹配本身，不抛错', () => {
  const build = required('buildSearchResults')
  const [item] = build([{ start: -1, end: 2, match: '目标' }])
  assert.equal(item.match, '目标')
  assert.equal(item.line, 1)
  assert.equal(item.column, 1)
})

test('resultLineText 拼出「前文+命中+后文」', () => {
  const build = required('buildSearchResults')
  const lineText = required('resultLineText')
  const [item] = build([{ start: 3, end: 5, match: '目标', blockText: '前前前目标后后后' }])
  assert.equal(lineText(item), '前前前目标后后后')
})
