const { spawn } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const userData = mkdtempSync(path.join(tmpdir(), 'inkdown-stability-'))
const mode = process.argv[2] || '--stability'
if (!['--stability', '--smoke', '--shots'].includes(mode)) throw new Error('Unknown check: ' + mode)
const env = { ...process.env, INKDOWN_NO_SESSION_RESTORE: '1', INKDOWN_NO_SESSION_PERSIST: '1' }
for (const key of Object.keys(env)) {
  if (/^INKDOWN_.*(CHECK|TEST|SCREENSHOT|SHOT_)/.test(key)) delete env[key]
}
if (mode === '--smoke') env.INKDOWN_SELF_CHECK = '1'
else if (mode === '--shots') env.INKDOWN_SHOT_FIND = path.join(root, 'screenshots')
else env.INKDOWN_STABILITY_CHECK = '1'
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), ['.', '--user-data-dir=' + userData], { cwd: root, env, stdio: 'inherit' })
const timer = setTimeout(() => { child.kill(); process.exitCode = 1 }, mode === '--smoke' ? 240000 : 90000)
child.on('error', (err) => { clearTimeout(timer); console.error(err); process.exitCode = 1 })
child.on('exit', (code) => { clearTimeout(timer); process.exitCode = code ?? 1 })
