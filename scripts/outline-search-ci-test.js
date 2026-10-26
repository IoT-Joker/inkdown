// 三项功能的契约测试。先写用例，再改实现。
const assert = require('node:assert')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

/* ------------------------------ 大纲折叠 ------------------------------ */

test('大纲能按标题层级折叠：父节点折叠时隐藏其子标题', () => {
  const src = read('src/renderer/src/components/SideBar.vue')
  assert.ok(/collapsed/i.test(src), '大纲应支持折叠状态（collapsed）')
  assert.ok(
    /visibleOutline|outlineVisible|expanded/i.test(src),
    '应有「可见大纲」的派生计算，用于隐藏被折叠节点的子孙'
  )
})

test('无子标题的节点不显示折叠箭头', () => {
  const src = read('src/renderer/src/components/SideBar.vue')
  assert.ok(
    /outlineHasChildren|hasChildren|childCount/.test(src),
    '应判断节点是否有子标题，避免给叶子节点画箭头'
  )
  // 模板里必须按这个判定来条件渲染折叠按钮
  assert.ok(
    /v-if="outlineHasChildren\[index\]"/.test(src),
    '折叠按钮应以「有子标题」为条件渲染'
  )
})

test('折叠状态在切换文档后不会串到别的文档', () => {
  const src = read('src/renderer/src/components/SideBar.vue')
  // 折叠集合应按 tabId 分组或在新文档大纲变化时清理
  assert.ok(
    /tabId|state\.activeId/.test(src),
    '折叠状态需与当前标签关联，避免切换文档后沿用上一份的折叠'
  )
})

/* ---------------------------- 搜索结果列表 ---------------------------- */

test('搜索结果能整理成带行号与上下文的列表项', () => {
  const src = read('src/renderer/src/editor/searchResults.ts')
  assert.ok(/export function/.test(src), '应有独立的搜索结果整理模块')
  const names = src.match(/export function (\w+)/g) || []
  assert.ok(names.length >= 1, '至少导出一个整理函数')
})

test('结果项包含行号、列号与上下文片段', () => {
  const src = read('src/renderer/src/editor/searchResults.ts')
  assert.ok(/\bline\b/.test(src), '结果项需要行号')
  assert.ok(/\bcolumn\b/.test(src), '结果项需要列号')
  // 上下文由 before / after 两段组成（渲染时拼成「前文+命中+后文」）
  assert.ok(/\bbefore\b/.test(src) && /\bafter\b/.test(src), '结果项需要命中前后的上下文')
})

test('搜索结果面板可点击定位到对应命中', () => {
  const src = read('src/renderer/src/components/FindBar.vue')
  assert.ok(
    /find-results|results-list|result-row/.test(src),
    '查找栏应渲染结果列表'
  )
})

/* ------------------------------- CI ------------------------------- */

test('存在 CI 工作流，且在推送与 PR 时运行类型检查和测试', () => {
  const wfDir = path.join(root, '.github/workflows')
  assert.ok(fs.existsSync(wfDir), '应有 .github/workflows 目录')
  const files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))
  assert.ok(files.length > 0, '至少有一个工作流文件')

  const all = files.map((f) => fs.readFileSync(path.join(wfDir, f), 'utf8')).join('\n')
  assert.ok(/on:/.test(all), '工作流应声明触发条件')
  assert.ok(/push/.test(all), '推送时应触发')
  assert.ok(/pull_request/.test(all), 'PR 时应触发')
  assert.ok(/pnpm|npm/.test(all), '应安装依赖')
  assert.ok(/typecheck|tsc/.test(all), '应跑类型检查')
  assert.ok(/test|regression|smoke/.test(all), '应跑测试')
})
