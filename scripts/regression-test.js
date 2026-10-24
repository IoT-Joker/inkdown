const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

test('Word export layout probe remains valid JavaScript after template escaping', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/exportVisualDocx.ts'), 'utf8')
  const raw = source.match(/executeJavaScript\(`([\s\S]*?)`\)/)[1]
  const script = vm.runInNewContext('`' + raw + '`')
  assert.doesNotThrow(() => new vm.Script(script))
})


test('launcher refuses incomplete builds instead of opening a blank window', () => {
  for (const missing of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
    const messages = []
    let spawned = false
    const context = {
      __dirname: path.join(root, 'scripts'),
      require: (name) => ({
        child_process: { spawn() { spawned = true } }, path,
        fs: { existsSync: (file) => file !== path.join(root, missing) }
      })[name],
      console: { error: (...args) => messages.push(args.join(' ')), log() {} },
      process: { env: {}, argv: [], exit(code) { throw new Error('exit:' + code) } }
    }
    assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts/start.js'), 'utf8'), context), /exit:1/)
    assert.equal(spawned, false)
    assert.ok(messages.some((message) => message.includes(missing)))
  }
})

test('PlantUML waits for image load and reports network failures', async () => {
  let img
  const Diagram = load('packages/muya/src/utils/diagram/plantuml/index.ts', {
    'plantuml-encoder': { default: { encode: () => 'encoded' } }
  }, { URL, setTimeout, clearTimeout, document: { createElement: () => (img = {}) } }).default
  const target = { tagName: 'DIV', replaceChildren() {} }
  const diagram = Diagram.parse('diagram', 'https://example.test/plantuml/')
  let finished = false
  const pending = Promise.resolve(diagram.insertImgElement(target)).then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false, 'must not treat an unloaded image as a rendered diagram')
  assert.equal(img.src, 'https://example.test/plantuml/svg/encoded')
  img.onload()
  await pending
  const failed = diagram.insertImgElement(target)
  img.onerror()
  await assert.rejects(failed, /PlantUML.*(network|server)/i)
})

test('renderer CSP permits remote diagram images but not remote scripts', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
  assert.match(html, /img-src[^;]*https:/)
  assert.match(html, /script-src 'self';/)
})
function load(file, deps = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext('(function(require,exports){' + code + '\n})', globals)((name) => {
    if (Object.hasOwn(deps, name)) return deps[name]
    if (name.startsWith('node:')) return require(name)
    throw new Error('Unexpected dependency: ' + name)
  }, exports)
  return exports
}

function fileHarness(bridge = {}) {
  const tab = { id: 'test', filePath: 'E:/docs/a.md', title: 'a.md', content: 'A', savedContent: 'original' }
  const state = { tabs: [tab], activeId: tab.id }
  const store = { state, settings: { lineEnding: 'lf' }, getActiveTab: () => tab,
    isDirty: (t) => t.content !== t.savedContent, pushRecent() {} }
  const api = { watch: async () => true, unwatch: async () => true, ...bridge }
  const files = load('src/renderer/src/composables/useFile.ts', {
    '../store': store, '../../../shared/i18n': { translate: (_l, key) => key },
    './useI18n': { currentLocale: { value: 'en' } }
  }, { window: { inkdown: api } }).useFile()
  return { tab, state, files, store, api }
}

function componentFunction(file, name) {
  const script = fs.readFileSync(path.join(root, file), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true)
  return ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
}

function ipcHarness() {
  const handlers = new Map()
  const ipc = load('src/main/ipc.ts', {
    electron: { app: {}, dialog: {}, shell: {}, clipboard: {}, BrowserWindow: {}, ipcMain: { handle: (key, fn) => handlers.set(key, fn) } },
    './window': {}, './menu': {}, './locale': { getLocale: () => 'en' },
    '../shared/i18n': { translate: (_locale, key) => key }, './fileAssociation': {},
    './updater': {}, './exportDocx': {}, './folderSearch': {}, './exportWindow': {}, './exportVisualDocx': {}
  }, { Buffer, console, process, setTimeout, clearTimeout })
  ipc.registerIpc()
  return handlers
}

test('source and split commands do not touch the hidden Muya document', async () => {
  for (const mode of ['source', 'split']) {
    const calls = []
    const context = {
      isSource: { value: mode === 'source' }, isSplit: { value: mode === 'split' },
      muya: new Proxy({}, { get: (_target, method) => () => { throw new Error('Hidden editor called: ' + method) } }),
      runSourceCommand: async (id) => calls.push(id),
      registerCommands: (map) => { context.commands = map },
      focus() {}, insertImage() {}, exportHtml() {}, exportPdf() {}, exportDocxFile() {}
    }
    vm.runInNewContext(ts.transpileModule(componentFunction('src/renderer/src/components/EditorHost.vue', 'registerEditorCommands') + '\nregisterEditorCommands();', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    await context.commands['edit:undo']()
    await context.commands['paragraph:h1']()
    await context.commands['format:strong']()
    assert.deepEqual(calls, ['edit:undo', 'paragraph:h1', 'format:strong'])
  }
})

test('renaming a directory updates all descendant document paths', async () => {
  const h = fileHarness({ rename: async () => true })
  h.tab.filePath = 'E:/docs/folder/a.md'
  h.state.tabs.push({ ...h.tab, id: 'second', filePath: 'E:/docs/folder/sub/b.md' })
  await h.files.renamePath('E:/docs/folder', 'E:/docs/renamed')
  assert.deepEqual(h.state.tabs.map((tab) => tab.filePath), ['E:/docs/renamed/a.md', 'E:/docs/renamed/sub/b.md'])
})

test('source history supports formatting undo/redo and drops obsolete redo after editing', () => {
  const { TextHistory, editSource } = load('src/renderer/src/editor/sourceEditing.ts')
  const original = { text: 'source only', start: 0, end: 6 }
  const history = new TextHistory(original)
  const formatted = editSource(original, 'format:strong')
  history.record(formatted)
  assert.equal(formatted.text, '**source** only')
  assert.equal(history.undo().text, original.text)
  assert.equal(history.redo().text, formatted.text)
  history.undo()
  history.record({ text: 'different', start: 9, end: 9 })
  assert.equal(history.redo(), undefined)
})

test('source regex replacement handles captures, literal dollars and zero-width matches', () => {
  const { textMatches, replaceTextMatch } = load('src/renderer/src/editor/sourceEditing.ts')
  const options = { isRegexp: true, isCaseSensitive: false, isWholeWord: false }
  assert.equal(textMatches('a1 a2', 'a(\\d)', options).length, 2)
  assert.equal(replaceTextMatch('a1 a2', 'a(\\d)', '$1!', options, 1), 'a1 2!')
  assert.equal(replaceTextMatch('a1 a2', 'a(\\d)', '$1!', options), '1! 2!')
  assert.equal(textMatches('ab', '(?=.)', options).length, 2)
  assert.equal(replaceTextMatch('abc', 'a', '$&', { ...options, isRegexp: false }), '$&bc')
  assert.equal(textMatches('abc', '[', options).length, 0)
  assert.equal(textMatches('cat catch', 'cat', { ...options, isWholeWord: true }).length, 1)
  assert.equal(textMatches('猫 猫咪', '猫', { ...options, isWholeWord: true }).length, 1)
  assert.equal(replaceTextMatch('a1 a2', '(?<=a)(\\d)', '$1!', options, 1), 'a1 a2!')
  assert.equal(replaceTextMatch('abc', 'a', '$<missing>', options, 0), '$<missing>bc')
})

test('source line prefixes preserve the selected line and repeated heading changes', () => {
  const { editSource } = load('src/renderer/src/editor/sourceEditing.ts')
  const first = editSource({ text: 'first\nsecond', start: 6, end: 12 }, 'paragraph:h1')
  assert.equal(first.text, 'first\n# second')
  const second = editSource({ ...first, start: 8, end: 14 }, 'paragraph:h2')
  assert.equal(second.text, 'first\n## second')
})

test('saving an older snapshot keeps edits made during the write dirty', async () => {
  let finish
  let written
  const h = fileHarness({ writeFile: async (_path, content) => {
    written = content
    return new Promise((resolve) => { finish = resolve })
  } })
  const pending = h.files.saveTab(h.tab)
  await new Promise(setImmediate)
  h.tab.content = 'B'
  finish({ mtimeMs: 1 })
  await pending
  assert.equal(written, 'A')
  assert.equal(h.tab.savedContent, 'A')
  assert.equal(h.store.isDirty(h.tab), true)
})

test('reopening a dirty file preserves its unsaved contents', async () => {
  const h = fileHarness({ openFileDialog: async () => [{ filePath: 'E:/docs/a.md', content: 'disk' }] })
  await h.files.openDialog()
  assert.equal(h.tab.content, 'A')
  assert.equal(h.tab.savedContent, 'original')
})

test('overlapping saves run in order and the newest edit reaches disk', async () => {
  let disk = ''
  const h = fileHarness({ writeFile: async (_path, content) => {
    await new Promise((resolve) => setTimeout(resolve, content === 'A' ? 30 : 1))
    disk = content
    return { mtimeMs: 1 }
  } })
  const first = h.files.saveTab(h.tab)
  await new Promise(setImmediate)
  h.tab.content = 'B'
  await Promise.all([first, h.files.saveTab(h.tab)])
  assert.equal(disk, 'B')
  assert.equal(h.tab.savedContent, 'B')
})

test('copying two same-name pictures preserves both originals', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-images-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const doc = path.join(dir, 'note.md')
  fs.mkdirSync(path.join(dir, 'assets'))
  fs.mkdirSync(path.join(dir, 'other'))
  fs.writeFileSync(path.join(dir, 'assets', 'image.png'), 'first-picture')
  const source = path.join(dir, 'other', 'image.png')
  fs.writeFileSync(source, 'second-picture')
  const handlers = ipcHarness()
  const result = await handlers.get('fs:copyImage')({}, doc, source)
  assert.equal(fs.readFileSync(path.join(dir, 'assets', 'image.png'), 'utf8'), 'first-picture')
  assert.notEqual(result, 'assets/image.png')
  assert.equal(fs.readFileSync(path.join(dir, result), 'utf8'), 'second-picture')
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => handlers.get('fs:copyImage')({}, doc, source)))
  assert.equal(new Set(concurrent).size, 5)
})

test('document saves replace complete files and refuse external conflicts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-save-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'note.md')
  fs.writeFileSync(file, 'original\r\n')
  const write = ipcHarness().get('fs:writeFile')
  await write({}, file, 'saved\n', 'original\n')
  assert.equal(fs.readFileSync(file, 'utf8'), 'saved\n')
  assert.deepEqual(fs.readdirSync(dir), ['note.md'])
  fs.writeFileSync(file, 'external changes')
  await assert.rejects(write({}, file, 'overwrite', 'saved\n'), /notice.saveConflict/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'external changes')
})

test('a failed save reports the error and keeps the document dirty', async () => {
  const h = fileHarness({ writeFile: async () => { throw new Error('disk full') } })
  assert.equal(await h.files.saveTab(h.tab), false)
  assert.equal(h.tab.savedContent, 'original')
  assert.equal(h.store.isDirty(h.tab), true)
  assert.ok(h.state.notice)
})

test('recovery keeps dirty named and untitled documents and removes saved drafts', () => {
  const data = new Map()
  const localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }
  const store = load('src/renderer/src/store/index.ts', {
    vue: { reactive: (value) => value, ref: (value) => ({ value }) },
    '../../../shared/i18n': { translate: () => 'Untitled' },
    '../composables/useI18n': { currentLocale: { value: 'en' } }
  }, { localStorage })
  assert.equal(typeof store.persistRecovery, 'function')
  store.createTab({ filePath: 'E:/note.md', content: 'edited', savedContent: 'original' })
  store.createTab({ content: 'untitled edits' })
  store.persistRecovery()
  assert.equal(store.loadRecovery().length, 2)
  for (const tab of store.state.tabs) tab.savedContent = tab.content
  store.persistRecovery()
  assert.equal(store.loadRecovery().length, 0)
})
