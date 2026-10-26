// 可编辑/阅读开关的行为契约。先写测试，后改实现。
const assert = require('node:assert')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const storeSrc = fs.readFileSync(path.join(root, 'src/renderer/src/store/index.ts'), 'utf8')
const hostSrc = fs.readFileSync(
  path.join(root, 'src/renderer/src/components/EditorHost.vue'),
  'utf8'
)

test('设置里有一个独立的阅读开关，且默认可编辑', () => {
  // 新增设置项 readingMode，默认 false（=可编辑）
  const m = storeSrc.match(/readingMode:\s*(true|false)/)
  assert.ok(m, 'store 里应有 readingMode 设置项')
  assert.equal(m[1], 'false', 'readingMode 默认必须是 false —— 打开软件就能编辑')
})

test('isReading 由独立开关决定，不再单独等于所见即所得', () => {
  const start = hostSrc.indexOf('const isReading = computed(')
  assert.ok(start > 0, '应能找到 isReading 定义')
  const end = hostSrc.indexOf('\n', start)
  const text = hostSrc.slice(start, end > 0 ? end : start + 200)

  // 必须同时要求「在所见即所得视图」且「readingMode 打开」。
  // 少了后者 → 永久只读（本次要修的 bug）；少了前者 → 源码模式下也拦输入。
  const hasView = /state\.viewMode\s*===\s*'wysiwyg'/.test(text)
  const hasSwitch = /state\.readingMode/.test(text)
  assert.ok(hasSwitch, 'isReading 必须纳入 state.readingMode，否则阅读态无法切换')
  assert.ok(hasView, 'isReading 仍应限定在所见即所得视图内')
  // 必须是「且」的关系，不能是「或」
  assert.ok(
    /&&/.test(text) || /state\.readingMode\)$/.test(text.trim()),
    'isReading 应是 viewMode 与 readingMode 的「且」，不能是「或」'
  )
})

test('阅读与编辑之间可以切换', () => {
  assert.ok(
    /'view:toggleReading'/.test(hostSrc) || /'view:toggleReading'/.test(
      fs.readFileSync(path.join(root, 'src/renderer/src/composables/useCommands.ts'), 'utf8')
    ),
    '应提供 view:toggleReading 命令'
  )
})

test('退出阅读模式后不再拦截输入事件', () => {
  // guardReadingEvent 只在 active() 为真时生效，active 必须依赖 readingMode
  assert.ok(
    /active:\s*\(\)\s*=>[^\n]*readingMode|active:\s*\(\)\s*=>[^\n]*isReading/.test(hostSrc),
    'reading 的 active 判定必须跟随开关，否则退出阅读后输入仍被拦截'
  )
})

test('打字机模式不再被阅读判定挡住', () => {
  const idx = hostSrc.indexOf('keepCursorCentered()')
  assert.ok(idx > 0, '应能找到 keepCursorCentered 调用')
  // 调用点所在行不能因为 isReading 被前置 return 掉
  const around = hostSrc.slice(Math.max(0, idx - 900), idx)
  const lastReturn = around.lastIndexOf('return')
  const lastGuard = around.slice(lastReturn)
  assert.ok(
    !/isReading\.value/.test(lastGuard) || /readingMode/.test(lastGuard),
    '打字机模式的守卫里 isReading 会把它挡掉；开关化后需确认仍然可达'
  )
})
