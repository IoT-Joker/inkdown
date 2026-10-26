const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { inflateRawSync } = require('node:zlib')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const localRequire = createRequire(path.join(root, 'package.json'))

function load(file, deps = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext('(function(require,exports){' + code + '\n})', {
    Buffer, Uint8Array, console, process, setTimeout, clearTimeout, ...globals
  })((name) => {
    if (Object.hasOwn(deps, name)) return deps[name]
    if (name.startsWith('.')) return load(path.join(path.dirname(file), name + '.ts'), deps, globals)
    return localRequire(name)
  }, exports)
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const selected = { pageSize: 'A5', orientation: 'landscape', marginMm: { top: 10, right: 20, bottom: 12, left: 15 }, fontSize: 14, pageNumbers: true }

test('normalization rejects untrusted types, clamps numeric limits and returns isolated defaults', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/shared/exportOptions.ts')), 'shared export normalization is missing')
  const { normalizeExportOptions, DEFAULT_EXPORT_OPTIONS } = load('src/shared/exportOptions.ts')
  for (const input of [undefined, null, [], 'A5', 0]) {
    const normalized = normalizeExportOptions(input)
    assert.deepEqual(plain(normalized), plain(DEFAULT_EXPORT_OPTIONS))
    normalized.marginMm.top = 1
    assert.notEqual(DEFAULT_EXPORT_OPTIONS.marginMm.top, 1)
  }
  assert.deepEqual(plain(normalizeExportOptions(selected)), selected)
  const bad = normalizeExportOptions({ pageSize: '__proto__', orientation: 'sideways', marginMm: { top: -2, right: Infinity, bottom: '12', left: 1000 }, fontSize: NaN, pageNumbers: 'false' })
  assert.equal(bad.pageSize, 'A4')
  assert.equal(bad.orientation, 'portrait')
  assert.equal(bad.marginMm.top, 0)
  assert.equal(bad.marginMm.left, 50)
  assert.equal(bad.marginMm.right, DEFAULT_EXPORT_OPTIONS.marginMm.right)
  assert.equal(bad.marginMm.bottom, DEFAULT_EXPORT_OPTIONS.marginMm.bottom)
  assert.equal(bad.fontSize, DEFAULT_EXPORT_OPTIONS.fontSize)
  assert.equal(bad.pageNumbers, false)
  assert.equal(normalizeExportOptions({ fontSize: 0 }).fontSize, 6)
  assert.equal(normalizeExportOptions({ fontSize: 1000 }).fontSize, 72)
  assert.equal(normalizeExportOptions({ landscape: true }).orientation, 'landscape')
  assert.equal(normalizeExportOptions({ ...selected, orientation: 'portrait', landscape: true }).orientation, 'portrait')
})

test('HTML helper appends trusted screen and print layout, replaces prior settings and keeps content', () => {
  const { applyExportOptionsToHtml } = load('src/shared/exportOptions.ts')
  assert.equal(typeof applyExportOptionsToHtml, 'function', 'HTML option application is missing')
  const input = '<html><head><style>body{font-size:99px!important}</style></head><body><h1 id="chapter">Title</h1></body></html>'
  const html = applyExportOptionsToHtml(input, selected)
  assert.match(html, /14pt\s*!important/)
  assert.match(html, /size:\s*A5 landscape/)
  assert.match(html, /margin:\s*10mm 20mm 12mm 15mm/)
  assert.match(html, /color-scheme:\s*light\s*!important/)
  assert.match(html, /@bottom-center/)
  assert.ok(html.indexOf('14pt') > html.indexOf('99px'))
  assert.ok(html.includes('<h1 id="chapter">Title</h1>'))
  const changed = applyExportOptionsToHtml(html, { ...selected, fontSize: 11, pageNumbers: false })
  assert.doesNotMatch(changed, /14pt|counter\(page\)/)
  assert.match(changed, /11pt/)
  const hostile = applyExportOptionsToHtml('<p>text</p>', { fontSize: '</style><script>bad()</script>' })
  assert.doesNotMatch(hostile, /bad\(\)/)
})

function printerHarness({ images = [], blocks = [], failPrint = false, hangLoad = false, fastTimers = false } = {}) {
  const windows = []
  const printed = []
  const document = { images, fonts: { ready: Promise.resolve() }, querySelectorAll: () => [] }
  const timer = fastTimers ? (fn, ms) => { const handle = setTimeout(fn, Math.min(ms, 10)); return handle } : setTimeout
  class FakeWindow {
    constructor(config) {
      this.config = config
      this.destroyed = false
      this.css = []
      windows.push(this)
      this.webContents = {
        setWindowOpenHandler() {}, on() {}, stop: () => { this.stopped = true },
        insertCSS: async (css, opts) => { this.css.push({ css, opts }); return '' },
        executeJavaScript: async (script) => {
          if (script.includes('const headings = new Map')) return blocks
          if (script.includes('getBoundingClientRect')) return { x: 0, y: 0, width: 100, height: 30 }
          return vm.runInNewContext(script, { document, setTimeout: timer, clearTimeout })
        },
        printToPDF: async (options) => {
          if (failPrint) throw new Error('printer failed')
          printed.push(options)
          return Buffer.from('%PDF-1.7\nfixture')
        },
        capturePage: async () => ({ toPNG: () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') })
      }
    }
    async loadFile(source) { this.source = source; this.html = await fsp.readFile(source, 'utf8'); if (hangLoad) return new Promise(() => {}) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  const deps = { electron: { BrowserWindow: FakeWindow } }
  const module = load('src/main/exportWindow.ts', deps, { setTimeout: timer })
  return { module, windows, printed, deps }
}
const image = (src, ok = false) => ({ complete: true, naturalWidth: ok ? 10 : 0, alt: 'Picture', getAttribute: (key) => key === 'src' ? src : null, closest: () => null })

test('preview and saved PDF share normalized print layout and preview returns bytes plus image issues', async () => {
  const h = printerHarness({ images: [image('file:///missing.png')] })
  assert.equal(typeof h.module.previewHtmlPdf, 'function', 'actual PDF preview is missing')
  const preview = await h.module.previewHtmlPdf('<h1>Heading</h1>', selected)
  assert.ok(preview.pdf instanceof Uint8Array)
  assert.equal(Buffer.from(preview.pdf).subarray(0, 5).toString(), '%PDF-')
  assert.equal(preview.issues.length, 1)
  assert.equal(preview.issues[0].kind, 'image')
  assert.equal(preview.issues[0].source, 'file:///missing.png')
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'inkdown-options-test-'))
  try {
    await h.module.writeHtmlPdf(path.join(dir, 'out.pdf'), '<h1>Heading</h1>', { ...selected, allowResourceFailures: true })
    assert.deepEqual(plain(h.printed[0]), plain(h.printed[1]))
    const options = h.printed[0]
    assert.equal(options.pageSize, 'A5')
    assert.equal(options.landscape, true)
    assert.equal(options.margins.left, 15 / 25.4)
    assert.equal(options.displayHeaderFooter, true)
    assert.match(options.footerTemplate, /class="pageNumber"/)
    assert.equal(options.generateDocumentOutline, true)
    assert.equal(options.generateTaggedPDF, true)
    assert.equal(options.preferCSSPageSize, false, 'untrusted @page size must not control Chromium')
    assert.ok(h.windows[0].html.includes('14pt'))
    assert.ok(h.windows.every((win) => win.destroyed))
    assert.ok(h.windows.every((win) => !fs.existsSync(win.source)))
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

test('strict export refuses missing images without overwriting an existing file', async () => {
  const h = printerHarness({ images: [image('file:///missing.png')] })
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'inkdown-options-test-'))
  try {
    const file = path.join(dir, 'existing.pdf')
    await fsp.writeFile(file, 'existing')
    await assert.rejects(h.module.writeHtmlPdf(file, '<img>'), /图片加载失败/)
    assert.equal(await fsp.readFile(file, 'utf8'), 'existing')
    let ran = false
    await assert.rejects(h.module.withExportWindow('<img>', async () => { ran = true }), /图片加载失败/)
    assert.equal(ran, false)
    assert.equal(h.printed.length, 0)
    assert.ok(h.windows.every((win) => win.destroyed))
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

test('legacy landscape PDF calls and no-page-number default remain supported', async () => {
  const h = printerHarness()
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'inkdown-options-test-'))
  try {
    await h.module.writeHtmlPdf(path.join(dir, 'legacy.pdf'), '<p>Body</p>', true)
    assert.equal(h.printed[0].landscape, true)
    assert.equal(h.printed[0].pageSize, 'A4')
    assert.ok(Math.abs(h.printed[0].margins.top - 0.6) < 1e-12)
    assert.equal(h.printed[0].displayHeaderFooter, false)
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

test('resource deadlines reject strictly and tolerate an unfinished image in preview', async () => {
  const pending = { ...image('http://127.0.0.1/pending.png'), complete: false, addEventListener() {}, removeEventListener() {} }
  const h = printerHarness({ images: [pending], fastTimers: true })
  await assert.rejects(h.module.withExportWindow('<img>', async () => true), /timed out/)
  assert.equal(typeof h.module.previewHtmlPdf, 'function')
  const preview = await h.module.previewHtmlPdf('<img>', selected)
  assert.ok(preview.issues.some((issue) => issue.source === 'http://127.0.0.1/pending.png'))
  assert.ok(h.windows.every((win) => win.destroyed))
})

test('load and printer failures are bounded and always dispose their windows', async () => {
  const h = printerHarness({ hangLoad: true, fastTimers: true })
  await assert.rejects(h.module.withExportWindow('<p>text</p>', async () => true), /loading timed out/)
  const failed = printerHarness({ failPrint: true })
  assert.equal(typeof failed.module.previewHtmlPdf, 'function')
  await assert.rejects(failed.module.previewHtmlPdf('<p>text</p>', selected), /printer failed/)
  assert.ok([...h.windows, ...failed.windows].every((win) => win.destroyed))
})

function zipText(buffer, name) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let cursor = buffer.readUInt32LE(end + 16)
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    const length = buffer.readUInt16LE(cursor + 28)
    if (buffer.subarray(cursor + 46, cursor + 46 + length).toString() === name) {
      const offset = buffer.readUInt32LE(cursor + 42)
      const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
      const bytes = buffer.subarray(start, start + buffer.readUInt32LE(cursor + 20))
      return (buffer.readUInt16LE(cursor + 10) === 8 ? inflateRawSync(bytes) : bytes).toString()
    }
    cursor += 46 + length + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
  }
  throw new Error('Missing ZIP part: ' + name)
}

test('Word uses physical page options, page field footer, editable point size and existing bookmarks', async () => {
  const run = { text: 'Heading', size: 28, font: 'Segoe UI', color: '24292f', bold: true }
  const h = printerHarness({ blocks: [
    { index: 0, kind: 'text', level: 1, bookmark: 'inkdown_h_1', before: 0, after: 0, align: 'left', runs: [run] },
    { index: 1, kind: 'text', level: 0, before: 0, after: 0, align: 'left', runs: [{ ...run, text: 'TOC', anchor: 'inkdown_h_1' }] },
    { index: 2, kind: 'image', level: 2, bookmark: 'inkdown_h_2', before: 0, after: 0, align: 'left', runs: [] }
  ] })
  const { htmlToVisualDocx } = load('src/main/exportVisualDocx.ts', { './exportWindow': h.module })
  const doc = await htmlToVisualDocx('<p>content</p>', 'Test', selected)
  const xml = zipText(doc, 'word/document.xml')
  assert.match(xml, /<w:pgSz[^>]*w:w="11906"[^>]*w:h="8391"[^>]*w:orient="landscape"/)
  assert.match(xml, /<w:pgMar[^>]*w:top="567"[^>]*w:right="1134"[^>]*w:bottom="680"[^>]*w:left="850"/)
  assert.match(xml, /w:bookmarkStart[^>]*w:name="inkdown_h_1"/)
  assert.match(xml, /w:bookmarkStart[^>]*w:name="inkdown_h_2"/)
  assert.match(xml, /w:hyperlink[^>]*w:anchor="inkdown_h_1"/)
  assert.match(xml, /w:pStyle w:val="Heading1"/)
  assert.match(xml, /w:sz w:val="28"/)
  assert.match(xml, /w:footerReference/)
  assert.match(zipText(doc, 'word/footer1.xml'), /PAGE/)
  assert.match(zipText(doc, 'word/styles.xml'), /w:sz w:val="28"/)
  assert.ok(h.windows[0].html.includes('14pt'), 'Word computed layout must receive the same font CSS as PDF')
  assert.ok(h.windows[0].css.some(({ css }) => /661\.4/.test(css)), 'A5 landscape content width is 175mm = 661.417px')
  const noFooter = await htmlToVisualDocx('<p>content</p>', 'Test', { ...selected, pageNumbers: false })
  assert.doesNotMatch(zipText(noFooter, 'word/document.xml'), /w:footerReference/)
})

test('preload and IPC preserve legacy return values while forwarding preview and full options', async () => {
  const handlers = new Map()
  const calls = []
  const opened = []
  let cancel = false
  let rejectPdf = false
  const ipc = load('src/main/ipc.ts', {
    electron: { app: {}, dialog: { showSaveDialog: async () => cancel ? { canceled: true } : { filePath: 'test.docx' } }, shell: { openExternal: async url => opened.push(url) }, clipboard: {}, BrowserWindow: {}, ipcMain: { handle: (key, fn) => handlers.set(key, fn) } },
    'node:fs': { ...require('node:fs'), promises: { writeFile: async () => {} } },
    './window': { getMainWindow: () => null }, './menu': {}, './locale': { getLocale: () => 'en' }, '../shared/i18n': { translate: (_l, key) => key }, './fileAssociation': {}, './updater': {}, './folderSearch': {},
    './exportWindow': {
      releasePdfPreview: async () => { calls.push(['release']) },
      previewPdfPage: async (...args) => { calls.push(['page', ...args]); return { image: 'data:image/png;base64,fixture', page: 2, pageCount: 3 } },
      previewHtmlPdf: async (...args) => { calls.push(['preview', ...args]); return { pdf: new Uint8Array([37, 80, 68, 70]), issues: [] } },
      writeHtmlPdf: async (...args) => { if (rejectPdf) throw new Error('fixture'); calls.push(['pdf', ...args]) }
    },
    './exportVisualDocx': { htmlToVisualDocx: async (...args) => { calls.push(['docx', ...args]); return Buffer.alloc(0) } },
    './exportDocx': { markdownToDocx: async (...args) => { calls.push(['markdown', ...args]); return Buffer.alloc(0) } }
  }, { console: { error() {} } })
  ipc.registerIpc()
  for (const url of ['https://example.test','mailto:reader@example.test','javascript:alert(1)','file:///C:/evil.exe']) await handlers.get('shell:openExternal')(null,url)
  assert.deepEqual(opened,['https://example.test','mailto:reader@example.test'])
  assert.ok(handlers.has('app:previewExport'), 'preview IPC handler is missing')
  let api
  load('src/preload/index.ts', { electron: { contextBridge: { exposeInMainWorld: (_name, value) => { api = value } }, ipcRenderer: { invoke: (key, ...args) => handlers.get(key)(null, ...args) } } })
  const preview = await api.previewExport('<h1>H</h1>', selected)
  assert.ok(preview.pdf instanceof Uint8Array)
  assert.equal(typeof api.previewExportPage, 'function', 'on-demand raster bridge is missing')
  const raster = await api.previewExportPage(preview.pdf, 2)
  assert.equal(raster.page, 2)
  assert.equal(raster.pageCount, 3)
  assert.equal(calls.at(-1)[0], 'page')
  assert.equal(calls.at(-1)[2], 2)
  assert.equal(typeof api.releaseExportPreview, 'function', 'release bridge is missing')
  await api.releaseExportPreview()
  assert.equal(calls.at(-1)[0], 'release')
  const { EventEmitter } = require('node:events')
  const sender = new EventEmitter()
  sender.isDestroyed = () => false
  await handlers.get('app:previewExportPage')({ sender }, preview.pdf, 1)
  sender.emit('destroyed')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.at(-1)[0], 'release', 'destroying the sender must dispose its hidden raster viewer')
  assert.equal(await api.exportPdf('test.pdf', '<p>P</p>', { ...selected, allowResourceFailures: true }), true)
  assert.deepEqual(plain(calls.at(-1)), ['pdf', 'test.pdf', '<p>P</p>', { ...selected, allowResourceFailures: true }])
  assert.equal(await api.exportDocx('md', 'test.docx', 'Title', '<p>Word</p>', selected), 'test.docx')
  assert.deepEqual(plain(calls.at(-1)), ['docx', '<p>Word</p>', 'Title', selected])
  await api.exportDocx('md', 'legacy.docx', 'Title')
  assert.equal(calls.at(-1)[0], 'markdown')
  cancel = true
  assert.equal(await api.exportDocx('md', 'cancel.docx', 'Title'), null)
  rejectPdf = true
  assert.equal(await api.exportPdf('bad.pdf', '<p>P</p>'), false)
})

function rasterHarness({ hangLoad = false, fastTimers = false, pageCount = 3, imageSize = 0 } = {}) {
  const windows = []
  let guard
  const calls = []
  const idleTimers = new Set()
  let captureGate
  let resumeCapture
  let currentPage = 0
  const timer = (fn, ms) => {
    if (ms >= 60000) { const handle = { fn, unref() { handle.unreferenced = true } }; idleTimers.add(handle); return handle }
    return setTimeout(fn, fastTimers ? (ms >= 10000 ? (hangLoad ? 10 : 3000) : Math.min(ms, 3)) : ms)
  }
  const clearTimer = handle => idleTimers.has(handle) ? idleTimers.delete(handle) : clearTimeout(handle)
  const isolatedSession = { webRequest: { onBeforeRequest: (_filter, fn) => { guard = fn } }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }
  const viewport = {
    pageDimensions_: [{}, {}, {}], setSmoothScrolling() {},
    fitToPage: ({ page }) => { calls.push(['fit', page]) },
    goToPage: (page) => { currentPage = page; calls.push(['navigate', page]) },
    getPageScreenRect: () => ({ x: 10, y: 10, width: 700, height: 990 }),
    getMostVisiblePage: () => 1,
    getZoom: () => 1, setZoom() {},
    position: { x: 0, y: 0 }
  }
  const elements = new Map()
  const shadow = { appendChild(element) { elements.set(element.id, element) }, append(element) { elements.set(element.id, element) }, getElementById: (id) => elements.get(id) || { getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 960, height: 1280 }), setAttribute() {} }, querySelector: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 960, height: 1280 }) }) }
  const viewer = { loadProgress_: 100, loadState_: 'success', docLength_: pageCount, viewport_: viewport, shadowRoot: shadow, updateComplete: Promise.resolve(), documentDimensions: { pageDimensions: [{}, {}, {}] } }
  const document = { querySelector: () => viewer, createElement: () => ({ style: {} }) }
  const frame = { url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', executeJavaScript: (script) => vm.runInNewContext(script, { document, setTimeout: timer, clearTimeout, requestAnimationFrame: (cb) => setTimeout(cb, 0), innerWidth: 960, innerHeight: 1280, getComputedStyle: () => ({}) }) }
  class FakeWindow {
    constructor(config) {
      this.config = config; this.destroyed = false; windows.push(this)
      this.webContents = {
        mainFrame: { framesInSubtree: [frame] }, session: isolatedSession,
        setWindowOpenHandler() {}, on() {}, setZoomFactor() {}, setAudioMuted() {}, setBackgroundThrottling() {},
        capturePage: async (rect, options) => {
          calls.push(['capture', rect, options, currentPage]); if (captureGate) await captureGate
          return { isEmpty: () => false, getSize: () => ({ width: 700, height: 990 }), toDataURL: () => 'data:image/png;base64,' + (imageSize ? 'x'.repeat(imageSize) : 'fixture') }
        }
      }
    }
    async loadURL(url) { this.url = url; if (hangLoad) return new Promise(() => {}) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
    getContentSize() { return [960, 1280] }
  }
  const deps = { electron: { BrowserWindow: FakeWindow, webContents: { fromFrame: () => undefined }, session: { fromPartition: (name, options) => { calls.push(['session', name, options]); return isolatedSession } } } }
  const module = load('src/main/exportPdfPreview.ts', deps, { setTimeout: timer, clearTimeout: clearTimer, URL })
  return { module, windows, calls, idleTimers,
    pauseCapture() { captureGate = new Promise(resolve => { resumeCapture = resolve }) },
    resumeCapture() { captureGate = undefined; resumeCapture?.() },
    fireIdle() { for (const handle of [...idleTimers]) { idleTimers.delete(handle); handle.fn() } },
    requestAllowed(url) { let result; guard({ url }, (value) => { result = !value.cancel }); return result } }
}

test('PDF rasterizer navigates requested page in a hidden sandbox and blocks unrelated resources', async () => {
  assert.ok(fs.existsSync(path.join(root, 'src/main/exportPdfPreview.ts')), 'dedicated PDF rasterizer is missing')
  const h = rasterHarness()
  const result = await h.module.renderPdfPreviewPage(new Uint8Array(Buffer.from('%PDF-1.7\nfixture')), 2)
  assert.deepEqual(plain(result), { image: 'data:image/png;base64,fixture', page: 2, pageCount: 3 })
  const win = h.windows[0]
  assert.equal(win.config.show, false)
  assert.equal(win.config.webPreferences.plugins, true)
  assert.equal(win.config.webPreferences.sandbox, true)
  assert.equal(win.config.webPreferences.nodeIntegration, false)
  assert.equal(win.config.webPreferences.contextIsolation, true)
  assert.ok(h.calls.some(([kind, name]) => kind === 'session' && name.startsWith('persist:')))
  assert.ok(h.calls.some(([kind, index]) => kind === 'navigate' && index === 1))
  assert.equal(h.requestAllowed('https://example.test/leak'), false)
  assert.equal(h.requestAllowed('file:///C:/unrelated.txt'), false)
  assert.equal(h.requestAllowed('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/main.js'), true)
  assert.equal(h.requestAllowed('chrome-extension://unrelated/main.js'), false)
  assert.equal(h.requestAllowed(win.url), true, 'the active document remains available for page reuse')
  await h.module.releasePdfPreview()
  assert.equal(h.requestAllowed(win.url), false, 'temporary PDF is no longer permitted after disposal')
  assert.ok(win.destroyed)
  assert.equal(fs.existsSync(require('node:url').fileURLToPath(win.url)), false)
})

test('PDF rasterizer validates bytes, clamps page selection, and bounds load failures', async () => {
  const h = rasterHarness()
  await assert.rejects(h.module.renderPdfPreviewPage(new Uint8Array([1, 2, 3]), 1), /PDF/i)
  assert.equal(h.windows.length, 0)
  const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nfixture'))
  assert.equal((await h.module.renderPdfPreviewPage(pdf, 999)).page, 3)
  assert.equal((await h.module.renderPdfPreviewPage(pdf, NaN)).page, 1)
  assert.equal((await h.module.renderPdfPreviewPage(pdf, -2)).page, 1)
  await h.module.releasePdfPreview()
  const stuck = rasterHarness({ hangLoad: true, fastTimers: true })
  await assert.rejects(stuck.module.renderPdfPreviewPage(pdf, 1), /timed out/i)
  assert.ok(stuck.windows.every((win) => win.destroyed))
})

const testPdf = suffix => new Uint8Array(Buffer.from('%PDF-1.7\n' + suffix))
const waitUntil = async condition => { for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)) } throw new Error('test condition timed out') }

test('same PDF content reuses its viewer and cached pages skip navigation and capture', async () => {
  const h = rasterHarness({ fastTimers: true })
  const pdf = testPdf('reuse')
  try {
    await h.module.renderPdfPreviewPage(pdf, 1)
    await h.module.renderPdfPreviewPage(new Uint8Array(pdf), 2)
    const captures = h.calls.filter(([kind]) => kind === 'capture').length
    const navigations = h.calls.filter(([kind]) => kind === 'navigate').length
    await h.module.renderPdfPreviewPage(new Uint8Array(pdf), 1)
    assert.equal(h.windows.length, 1, 'page navigation must not reload the PDF viewer')
    assert.equal(h.calls.filter(([kind]) => kind === 'capture').length, captures)
    assert.equal(h.calls.filter(([kind]) => kind === 'navigate').length, navigations)
    assert.ok(!h.windows[0].destroyed)
  } finally { await h.module.releasePdfPreview?.() }
})

test('identical pending page requests collapse and different pages paint serially', async () => {
  const h = rasterHarness({ fastTimers: true })
  const pdf = testPdf('serialize')
  try {
    const [first, duplicate, second] = await Promise.all([
      h.module.renderPdfPreviewPage(pdf, 1), h.module.renderPdfPreviewPage(new Uint8Array(pdf), 1), h.module.renderPdfPreviewPage(pdf, 2)
    ])
    assert.deepEqual(plain(first), plain(duplicate))
    assert.equal(second.page, 2)
    assert.equal(h.windows.length, 1)
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'navigate' || kind === 'capture').map(call => [call[0], call[0] === 'navigate' ? call[1] : call[3]]), [
      ['navigate', 0], ['capture', 0], ['capture', 0], ['navigate', 1], ['capture', 1], ['capture', 1]
    ])
  } finally { await h.module.releasePdfPreview?.() }
})

test('release cancels in-flight and queued pages, removes resources, and permits a fresh viewer', async () => {
  const h = rasterHarness({ fastTimers: true })
  assert.equal(typeof h.module.releasePdfPreview, 'function', 'explicit disposal is missing')
  const pdf = testPdf('release')
  h.pauseCapture()
  const running = h.module.renderPdfPreviewPage(pdf, 1)
  const queued = h.module.renderPdfPreviewPage(pdf, 2)
  const rejected = Promise.all([assert.rejects(running, /released|cancelled/i), assert.rejects(queued, /released|cancelled/i)])
  try {
    await waitUntil(() => h.calls.some(([kind]) => kind === 'capture'))
    const old = h.windows[0]
    await h.module.releasePdfPreview()
    await rejected
    assert.ok(old.destroyed)
    assert.equal(fs.existsSync(require('node:url').fileURLToPath(old.url)), false)
    assert.equal(h.requestAllowed(old.url), false)
    h.resumeCapture()
    await h.module.renderPdfPreviewPage(pdf, 2)
    assert.equal(h.windows.length, 2)
    const captures = h.calls.filter(([kind]) => kind === 'capture').length
    await h.module.renderPdfPreviewPage(pdf, 2)
    assert.equal(h.calls.filter(([kind]) => kind === 'capture').length, captures, 'stale completion must not disrupt the new cache')
  } finally { h.resumeCapture(); await h.module.releasePdfPreview() }
})

test('switching PDF content cancels the old painting and disposes the old temp file', async () => {
  const h = rasterHarness({ fastTimers: true })
  assert.equal(typeof h.module.releasePdfPreview, 'function')
  h.pauseCapture()
  const old = h.module.renderPdfPreviewPage(testPdf('old'), 1)
  const rejected = assert.rejects(old, /released|cancelled/i)
  try {
    await waitUntil(() => h.calls.some(([kind]) => kind === 'capture'))
    const next = h.module.renderPdfPreviewPage(testPdf('new'), 2)
    await rejected
    assert.ok(h.windows[0].destroyed)
    h.resumeCapture()
    assert.equal((await next).page, 2)
    assert.equal(h.windows.length, 2)
    assert.equal(fs.existsSync(require('node:url').fileURLToPath(h.windows[0].url)), false)
    assert.equal(h.requestAllowed(h.windows[0].url), false)
    assert.equal(h.requestAllowed(h.windows[1].url), true)
  } finally { h.resumeCapture(); await h.module.releasePdfPreview() }
})

test('page LRU is bounded by both entry count and encoded image bytes', async () => {
  const h = rasterHarness({ fastTimers: true, pageCount: 20 })
  try {
    for (let page = 1; page <= 13; page++) await h.module.renderPdfPreviewPage(testPdf('count'), page)
    let captures = h.calls.filter(([kind]) => kind === 'capture').length
    await h.module.renderPdfPreviewPage(testPdf('count'), 2)
    assert.equal(h.calls.filter(([kind]) => kind === 'capture').length, captures)
    await h.module.renderPdfPreviewPage(testPdf('count'), 1)
    assert.equal(h.calls.filter(([kind]) => kind === 'capture').length, captures + 2, 'the least recently used thirteenth page must be evicted')
  } finally { await h.module.releasePdfPreview?.() }
  const large = rasterHarness({ fastTimers: true, imageSize: 7 * 1024 * 1024 })
  try {
    await large.module.renderPdfPreviewPage(testPdf('bytes'), 1)
    await large.module.renderPdfPreviewPage(testPdf('bytes'), 2)
    const captures = large.calls.filter(([kind]) => kind === 'capture').length
    await large.module.renderPdfPreviewPage(testPdf('bytes'), 1)
    assert.equal(large.calls.filter(([kind]) => kind === 'capture').length, captures + 2, 'two 7 MiB images cannot both remain cached')
  } finally { await large.module.releasePdfPreview?.() }
})

test('idle cleanup is unreferenced and disposes the retained viewer', async () => {
  const h = rasterHarness({ fastTimers: true })
  assert.equal(typeof h.module.releasePdfPreview, 'function')
  await h.module.renderPdfPreviewPage(testPdf('idle'), 1)
  assert.ok([...h.idleTimers].some(timer => timer.unreferenced), 'idle retention must not keep the process alive')
  h.fireIdle()
  await h.module.releasePdfPreview()
  assert.ok(h.windows[0].destroyed)
  assert.equal(fs.existsSync(require('node:url').fileURLToPath(h.windows[0].url)), false)
})
