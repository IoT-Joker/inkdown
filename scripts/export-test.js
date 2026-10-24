const { spawn } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^INKDOWN_/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key]
Object.assign(env, { INKDOWN_EXPORT_CHECK: '1', INKDOWN_NO_SESSION_RESTORE: '1', INKDOWN_NO_SESSION_PERSIST: '1' })
const profile = mkdtempSync(path.join(tmpdir(), 'inkdown-export-profile-'))
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), ['.', '--user-data-dir=' + profile], { cwd: root, env, stdio: 'inherit' })
const timer = setTimeout(() => { child.kill(); process.exitCode = 1 }, 180000)
child.on('error', (error) => { clearTimeout(timer); console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { clearTimeout(timer); process.exitCode = code ?? 1 })
