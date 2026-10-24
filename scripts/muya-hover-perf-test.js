// Run: node --test scripts/muya-hover-perf-test.js
// Measure executed handler bodies (throttling/DOM/layout time deliberately excluded):
// node scripts/muya-hover-perf-test.js --measure
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const blockKey = '__MUYA_BLOCK__'

// A minimal event-target tree, not a browser or a layout timing emulator.
class Target {
  constructor(parent = null) { this.parentNode = parent; this.isConnected = true }
  contains(node) {
    for (; node; node = node.parentNode) if (node === this) return true
    return false
  }
}

function load(file, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext('(function(require,exports){' + code + '\n})', globals)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.endsWith('.css') || name.endsWith('.png')) return { default: name }
    throw new Error('Unexpected dependency: ' + name)
  }, exports)
  return exports
}

function harness(pluginName, directory) {
  const counts = { rects: 0, points: 0, point: 0, patches: 0, styles: 0, heightWrites: 0 }
  let hits = []
  const body = new Target()
  const editor = new Target(body)
  const outside = new Target(body)
  const content = new Target(editor)
  const float = new Target(body)
  const floatChild = new Target(float)
  editor.getClientRects = () => { counts.rects++; return [{}] }
  const document = {
    body,
    elementsFromPoint() { counts.points++; return hits },
    elementFromPoint() { counts.point++; return hits[0] ?? null }
  }
  const dom = load('packages/muya/src/utils/dom.ts', {
    '../config': { BLOCK_DOM_PROPERTY: blockKey }
  }, { Node: Target })
  const callbacks = []
  const muya = {
    domNode: editor, options: {}, ui: { shownFloat: new Set() },
    eventCenter: {
      emit() {},
      attachDOMEvent(target, event, callback) {
        if (event === 'mousemove' && (target === body || target === document)) callbacks.push(callback)
      }
    }
  }
  class Base { listen() {} }
  const module = load('packages/muya/src/ui/' + directory + '/index.ts', {
    '../../utils': { isMouseEvent: (e) => 'x' in e, throttle: (fn) => fn },
    '../../utils/dom': dom,
    '../../config': { BLOCK_DOM_PROPERTY: blockKey },
    '../../block/scrollPage': { ScrollPage: {} },
    '../../block/commonMark/bulletList': { default: class {} },
    '../../block/commonMark/orderList': { default: class {} },
    '@floating-ui/dom': {},
    '../../utils/snabbdom': { h: (...args) => args, patch() { counts.patches++ } },
    '../baseFloat': { default: Base },
    './config': {
      default: [], getIcon: (block) => block.icon ?? 'paragraph',
      PREVIEW_BLOCK_NAMES: new Set(['html-block', 'math-block', 'diagram'])
    }
  }, {
    document, Node: Target,
    getComputedStyle() { counts.styles++; return { lineHeight: '24px' } }
  })
  const instance = Object.create(module[pluginName].prototype)
  Object.assign(instance, {
    muya, status: false, floatBox: float, container: float,
    _container: float, _floatBox: float, _iconWrapper: {},
    _oldVNode: null, _block: null, _status: false,
    _renderedIcon: null, _disableListen: false, _dragInfo: null,
    _mouseTimer: null, _dropTimer: null,
    hide() { this.status = false; this._status = false; this._block = null }
  })
  let height = ''
  float.style = {
    get height() { return height },
    set height(value) { counts.heightWrites++; height = value }
  }
  instance.listen()
  assert.equal(callbacks.length, 1)
  return {
    instance, counts, editor, outside, content, floatChild,
    hit(elements) { hits = elements },
    move(target) { callbacks[0]({ x: 30, y: 40, target }) },
    block(icon = 'paragraph') { return { muya, icon, domNode: content, isOutMostBlock: true } }
  }
}

const plugins = [
  ['ParagraphFrontButton', 'paragraphFrontButton'],
  ['PreviewToolBar', 'previewToolBar'],
  ['TableColumnToolbar', 'tableColumnToolbar'],
  ['TableDragBar', 'tableDragBar']
]
const geometry = (counts) => counts.rects + counts.points + counts.point

if (process.argv.includes('--measure')) {
  const rows = []
  for (const [name, directory] of plugins) {
    const h = harness(name, directory)
    for (let i = 0; i < 30; i++) h.move(h.outside)
    rows.push({ plugin: name, executedCallbacks: 30, ...h.counts })
  }
  const h = harness('ParagraphFrontButton', 'paragraphFrontButton')
  h.instance._block = h.block()
  for (let i = 0; i < 30; i++) h.instance.render()
  rows.push({ plugin: 'ParagraphFrontButton.render (same icon/line height)', executedCallbacks: 30, ...h.counts })
  console.log(JSON.stringify(rows, null, 2))
} else {
  for (const [name, directory] of plugins) {
    test(name + ': menu movement does no editor geometry and hides a stale tool', () => {
      const h = harness(name, directory)
      h.instance.status = h.instance._status = true
      for (let i = 0; i < 30; i++) h.move(h.outside)
      assert.equal(geometry(h.counts), 0)
      assert.equal(h.instance.status || h.instance._status, false)
    })
    test(name + ': detached cached editors do no geometry', () => {
      const h = harness(name, directory)
      h.editor.isConnected = false
      h.move(h.content)
      assert.equal(geometry(h.counts), 0)
    })
    test(name + ': retains its own toolbar hover without geometry', () => {
      const h = harness(name, directory)
      h.instance.status = h.instance._status = true
      h.move(h.floatChild)
      assert.equal(geometry(h.counts), 0)
      assert.equal(h.instance.status || h.instance._status, true)
    })
    test(name + ': editor content still reaches the block hit test', () => {
      const h = harness(name, directory)
      h.move(h.content)
      assert.ok(h.counts.points > 0)
    })
    test(name + ': another live editor is outside this editor', () => {
      const h = harness(name, directory)
      h.move(new Target(h.outside))
      assert.equal(geometry(h.counts), 0)
    })
  }
  test('paragraph icon rendering skips repeated patches and unchanged height writes', () => {
    const h = harness('ParagraphFrontButton', 'paragraphFrontButton')
    const block = h.block()
    h.instance._block = block
    for (let i = 0; i < 30; i++) h.instance.render()
    assert.equal(h.counts.patches, 1)
    assert.equal(h.counts.heightWrites, 1)
    block.icon = 'heading-2'
    h.instance.render()
    assert.equal(h.counts.patches, 2, 'changing heading level must update its icon')
  })
}
