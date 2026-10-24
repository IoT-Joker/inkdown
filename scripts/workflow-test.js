const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const mode = process.argv[2] || 'files'
if (!['files', 'session', 'recovery'].includes(mode)) throw new Error('Unknown workflow: ' + mode)

async function run(profile, envArgs) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^INKDOWN_/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key]
  Object.assign(env, envArgs)
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), ['.', '--user-data-dir=' + profile], {
      cwd: root, env, stdio: 'inherit'
    })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Workflow timed out')) }, 120000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Workflow exited: ' + code)) })
  })
}

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-workflow-'))
  if (mode === 'files') {
    await run(path.join(dir, 'profile'), { INKDOWN_FILE_TEST: dir, INKDOWN_NO_SESSION_RESTORE: '1', INKDOWN_NO_SESSION_PERSIST: '1' })
  } else if (mode === 'session') {
    await run(path.join(dir, 'profile'), { INKDOWN_SESSION_TEST: dir, INKDOWN_SESSION_PHASE: 'first', INKDOWN_NO_SESSION_RESTORE: '1' })
    await run(path.join(dir, 'profile'), { INKDOWN_SESSION_TEST: dir, INKDOWN_SESSION_PHASE: 'second' })
  } else {
    for (const scenario of ['restore', 'conflict']) {
      const work = path.join(dir, scenario)
      fs.mkdirSync(work)
      const profile = path.join(work, 'profile')
      await run(profile, { INKDOWN_RECOVERY_TEST: work, INKDOWN_RECOVERY_PHASE: 'prepare', INKDOWN_NO_SESSION_RESTORE: '1' })
      if (scenario === 'conflict') fs.writeFileSync(path.join(work, 'draft.md'), 'external edit')
      await run(profile, { INKDOWN_RECOVERY_TEST: work, INKDOWN_RECOVERY_PHASE: scenario })
    }
  }
  console.log('[workflow] PASS:', mode)
})().catch((error) => { console.error(error); process.exitCode = 1 })
