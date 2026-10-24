// Focused updater/menu regression tests. Runs in Node only: no build, Electron, GUI or network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
const { renderToString } = require('vue/server-renderer')
const root = path.resolve(__dirname, '..')
const manifest = require('../package.json')

function evaluate(source, deps, globals = {}) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const exports = {}
  vm.runInNewContext('(function(require,exports){' + code + '\n})', globals)((name) => {
    assert.ok(Object.hasOwn(deps, name), 'Unexpected dependency: ' + name)
    return deps[name]
  }, exports)
  return exports
}

const dictionaries = evaluate(fs.readFileSync(path.join(root, 'src/shared/i18n.ts'), 'utf8'), {})
evaluate(fs.readFileSync(path.join(root, 'src/shared/i18nExtra.ts'), 'utf8'), { './i18n': dictionaries })
const t = (key, params) => dictionaries.translate('zh-CN', key, params)

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function updaterHarness(packaged = false, env = {}) {
  const updater = new EventEmitter()
  const calls = { feeds: [], checks: 0, downloads: 0, installs: 0, timers: [], statuses: [] }
  updater.setFeedURL = (feed) => calls.feeds.push(feed)
  updater.checkForUpdates = async () => {
    calls.checks++
    updater.emit('update-not-available', { version: manifest.version })
    return { isUpdateAvailable: false, updateInfo: { version: manifest.version } }
  }
  updater.downloadUpdate = async () => { calls.downloads++ }
  updater.quitAndInstall = () => { calls.installs++ }
  const api = evaluate(fs.readFileSync(path.join(root, 'src/main/updater.ts'), 'utf8'), {
    electron: {
      app: { isPackaged: packaged, getVersion: () => manifest.version },
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false,
        webContents: { send: (_channel, status) => calls.statuses.push(status) } }] }
    },
    'electron-updater': { autoUpdater: updater },
    '../../package.json': manifest,
    '../shared/i18n': dictionaries,
    './locale': { getLocale: () => 'zh-CN' }
  }, { process: { env }, console: { log() {}, error() {} },
    setTimeout: (fn) => calls.timers.push(fn) })
  api.initUpdater()
  return { api, updater, calls }
}

test('dev checks the configured GitHub release feed and reports checking then up-to-date', async () => {
  const { api, updater, calls } = updaterHarness()
  assert.equal(api.getUpdateStatus().phase, 'idle')
  assert.equal(updater.forceDevUpdateConfig, true)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(calls.feeds[0].provider, 'github')
  assert.equal(calls.feeds[0].owner, manifest.build.publish[0].owner)
  assert.equal(calls.feeds[0].repo, manifest.build.publish[0].repo)
  assert.equal(calls.timers.length, 0, 'development must not start background checks')
  const result = await api.checkForUpdatesManually()
  assert.equal(calls.checks, 1)
  assert.ok(calls.statuses.some((status) => status.phase === 'checking'))
  assert.equal(result.phase, 'up-to-date')
})

test('custom feed remains usable for development checks', async () => {
  const { api, updater, calls } = updaterHarness(false, { INKDOWN_UPDATE_URL: 'https://updates.example.test/' })
  await api.checkForUpdatesManually()
  assert.equal(updater.forceDevUpdateConfig, true)
  assert.equal(calls.feeds[0].provider, 'generic')
  assert.equal(calls.feeds[0].url, 'https://updates.example.test/')
})

test('dev discovers releases but download and restart remain blocked with inline explanation', async () => {
  const { api, updater, calls } = updaterHarness()
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '99.0.0' })
    return { isUpdateAvailable: true, updateInfo: { version: '99.0.0' } }
  }
  assert.equal((await api.checkForUpdatesManually()).phase, 'available')
  const result = await api.downloadUpdate()
  assert.equal(result.phase, 'available')
  assert.equal(result.version, '99.0.0')
  assert.match(result.message, /开发版.*打包版/)
  updater.emit('update-downloaded', { version: '99.0.0' })
  assert.equal(api.restartToUpdate(), false)
  assert.equal(calls.downloads, 0)
  assert.equal(calls.installs, 0)
})

test('packaged updates keep the packaged feed, show progress and preserve ready until restart', async () => {
  const { api, updater, calls } = updaterHarness(true)
  assert.equal(calls.feeds.length, 0, 'packaged app uses electron-builder app-update.yml')
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(calls.timers.length, 1)
  updater.checkForUpdates = async () => {
    calls.checks++
    updater.emit('update-available', { version: '99.0.0' })
    return { isUpdateAvailable: true, updateInfo: { version: '99.0.0' } }
  }
  await api.checkForUpdatesManually()
  const download = deferred()
  updater.downloadUpdate = () => { calls.downloads++; return download.promise }
  const pending = api.downloadUpdate()
  assert.equal(api.getUpdateStatus().phase, 'downloading')
  updater.emit('download-progress', { percent: 41.6 })
  assert.equal(api.getUpdateStatus().percent, 42)
  await api.downloadUpdate()
  await api.checkForUpdatesManually()
  assert.equal(calls.downloads, 1)
  assert.equal(calls.checks, 1)
  updater.emit('update-downloaded', { version: '99.0.0' })
  download.resolve()
  await pending
  assert.equal(api.getUpdateStatus().phase, 'ready')
  assert.equal(api.getUpdateStatus().percent, 100)
  await api.checkForUpdatesManually()
  await api.downloadUpdate()
  assert.equal(api.getUpdateStatus().phase, 'ready')
  assert.equal(calls.checks, 1)
  assert.equal(calls.downloads, 1)
  assert.equal(api.restartToUpdate(), true)
  assert.equal(calls.installs, 1)
})

test('result availability is respected even when updater events are absent', async () => {
  const { api, updater } = updaterHarness(true)
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '99.0.0' } })
  assert.equal((await api.checkForUpdatesManually()).phase, 'available')
})

test('check and download failures become retryable inline states', async () => {
  const { api, updater } = updaterHarness(true)
  updater.checkForUpdates = async () => { throw new Error('ENOTFOUND updates.example.test') }
  assert.equal((await api.checkForUpdatesManually()).message, t('update.errNetwork'))
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '99.0.0' })
    return { isUpdateAvailable: true, updateInfo: { version: '99.0.0' } }
  }
  await api.checkForUpdatesManually()
  updater.downloadUpdate = async () => { throw new Error('ETIMEDOUT') }
  const result = await api.downloadUpdate()
  assert.equal(result.phase, 'error')
  assert.ok(result.message.includes(t('update.downloadFailed')))
  assert.equal((await api.checkForUpdatesManually()).phase, 'available')
})

function menuHarness(api = {}) {
  const file = 'src/renderer/src/components/MenuBar.vue'
  const { descriptor } = parse(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: 'update-inline-test' })
  const state = vue.reactive({ updateStatus: {
    phase: 'idle', current: manifest.version, version: '', percent: 0, message: '', autoCheck: true
  } })
  const component = evaluate(script.content, {
    vue,
    '../composables/useCommands': { executeCommand: async () => {}, shortcutFor: () => '' },
    '../composables/useI18n': { useI18n: () => ({ t }) },
    '../store': { state, settings: { lineEnding: 'lf' }, recentFiles: [] }
  }, { window: { inkdown: api, addEventListener() {} } }).default
  const bindings = component.setup({}, { expose() {} })
  bindings.openIndex.value = 5
  const template = compileTemplate({ source: descriptor.template.content, filename: file,
    id: 'update-inline-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.equal(template.errors.length, 0)
  const { render } = evaluate(template.code, { vue })
  return { state, bindings, html: () => renderToString(vue.createSSRApp({
    render: () => render({}, [], {}, vue.proxyRefs(bindings))
  })) }
}

test('Help row renders the spinner on its right without a separate update pill', async () => {
  const { state, html } = menuHarness()
  state.updateStatus.phase = 'checking'
  const rendered = await html()
  assert.doesNotMatch(rendered, /update-pill/)
  assert.match(rendered, /menu-update[\s\S]*检查更新[\s\S]*update-spinner/)
})

test('Help row renders latest, available arrow, progress and restart inline', async () => {
  const { state, html } = menuHarness()
  state.updateStatus.phase = 'up-to-date'
  assert.match(await html(), /已是最新/)
  state.updateStatus.phase = 'available'
  state.updateStatus.version = '99.0.0'
  assert.match(await html(), /99\.0\.0[\s\S]*aria-label="下载"/)
  state.updateStatus.phase = 'downloading'
  state.updateStatus.percent = 42
  assert.match(await html(), /progressbar[\s\S]*aria-valuenow="42"/)
  state.updateStatus.phase = 'ready'
  assert.match(await html(), /重启安装/)
  state.updateStatus.message = t('update.devDownloadOnly')
  assert.match(await html(), /开发版.*打包版/)
})

test('menu update actions stay open and suppress duplicate clicks', async () => {
  const check = deferred()
  let checks = 0
  const { bindings, html } = menuHarness({ checkForUpdates: () => { checks++; return check.promise } })
  const pending = bindings.runUpdateAction()
  const repeated = bindings.runUpdateAction()
  const count = checks
  const rendered = await html()
  check.resolve({ phase: 'up-to-date', version: manifest.version, percent: 0, message: '' })
  await Promise.all([pending, repeated])
  assert.equal(count, 1)
  assert.equal(bindings.openIndex.value, 5)
  assert.match(rendered, /update-spinner/)
})

test('IPC failures are caught and shown inline while keeping Help open', async () => {
  const { bindings, html } = menuHarness({ checkForUpdates: async () => { throw new Error('IPC unavailable') } })
  await assert.doesNotReject(bindings.runUpdateAction())
  assert.equal(bindings.openIndex.value, 5)
  assert.equal(bindings.updateBusy.value, false)
  assert.match(await html(), /操作失败/)
})

test('available Help row can check again while the arrow downloads', async () => {
  let checks = 0, downloads = 0
  const { state, bindings } = menuHarness({
    checkForUpdates: async () => { checks++; return { ...state.updateStatus } },
    downloadUpdate: async () => { downloads++; return { ...state.updateStatus } }
  })
  state.updateStatus.phase = 'available'
  await bindings.runUpdateAction('check')
  await bindings.runUpdateAction('apply')
  assert.equal(checks, 1)
  assert.equal(downloads, 1)
})

test('installer failures are shown inline with the retry action preserved', () => {
  const { api, updater } = updaterHarness(true)
  updater.emit('update-downloaded', { version: '99.0.0' })
  updater.quitAndInstall = () => { updater.emit('error', new Error('installer launch failed')) }
  assert.equal(api.restartToUpdate(), false)
  assert.equal(api.getUpdateStatus().phase, 'ready')
  assert.match(api.getUpdateStatus().message, /安装失败/)
  updater.quitAndInstall = () => { throw new Error('launch denied') }
  assert.equal(api.restartToUpdate(), false)
  assert.match(api.getUpdateStatus().message, /launch denied/)
})
