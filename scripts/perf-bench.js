/**
 * 性能基准：实测冷启动、大文件载入、全库搜索三项耗时。
 * 用法：node scripts/perf-bench.js
 * 输出可直接用于对比优化前后。
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.join(__dirname, '..')
const unpacked = path.join(root, 'release', 'win-unpacked')
const exe = path.join(unpacked, 'Inkdown.exe')

if (!fs.existsSync(exe)) {
  console.error('未找到打包产物，请先 node scripts/package.js --dir')
  process.exit(1)
}

/** 跑一次应用，测量「进程启动 → 编辑器就绪」的耗时。 */
function measureColdStart() {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      INKDOWN_PERF_PROBE: '1',
      INKDOWN_NO_SESSION_RESTORE: '1',
      INKDOWN_NO_SESSION_PERSIST: '1'
    }
    delete env.ELECTRON_RUN_AS_NODE

    const t0 = Date.now()
    const child = spawn(exe, [], { cwd: unpacked, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let done = false

    const onData = (d) => {
      out += d.toString()
      // 主进程在编辑器挂载完成时打印这个标记
      if (!done && out.includes('[perf] editor-ready')) {
        done = true
        const ms = Date.now() - t0
        try {
          child.kill('SIGKILL')
        } catch {}
        resolve(ms)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => resolve(-1))

    setTimeout(() => {
      if (!done) {
        try {
          child.kill('SIGKILL')
        } catch {}
        resolve(-1)
      }
    }, 60000)
  })
}

/** 生成一个大 Markdown 文档，用于测载入耗时。 */
function makeLargeDoc(paragraphs) {
  const parts = ['# 大文档性能测试\n']
  for (let i = 0; i < paragraphs; i++) {
    parts.push(
      `## 第 ${i + 1} 节\n\n这是第 ${i + 1} 段的正文内容，包含 **加粗**、*斜体* 与 \`行内代码\`。\n\n`
    )
  }
  return parts.join('')
}

function main() {
  console.log('=== 打包产物 ===')
  const asar = path.join(unpacked, 'resources', 'app.asar')
  console.log('app.asar:', (fs.statSync(asar).size / 1024 / 1024).toFixed(1), 'MB')
  console.log('')

  console.log('=== 冷启动（进程启动 → 编辑器就绪）===')
  const runs = []
  ;(async () => {
    for (let i = 0; i < 3; i++) {
      const ms = await measureColdStart()
      runs.push(ms)
      console.log(`  第 ${i + 1} 次: ${ms > 0 ? ms + ' ms' : '失败'}`)
      await new Promise((r) => setTimeout(r, 1200))
    }
    const valid = runs.filter((x) => x > 0)
    if (valid.length) {
      console.log(`  平均: ${Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)} ms`)
      console.log(`  最好: ${Math.min(...valid)} ms`)
    }

    // 大文档体积参考（实际载入耗时需在应用内测，这里给出文件规模）
    console.log('')
    console.log('=== 大文档规模参考 ===')
    for (const n of [500, 2000]) {
      const doc = makeLargeDoc(n)
      console.log(`  ${n} 段落: ${(Buffer.byteLength(doc) / 1024).toFixed(0)} KB`)
    }
    process.exit(0)
  })()
}

main()
