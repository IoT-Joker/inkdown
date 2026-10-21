/**
 * 创建 GitHub Release 并上传安装包，让自动更新有源可查。
 *
 * 用法：
 *   node scripts/publish-release.js            # 创建 release 并上传 release/ 下的产物
 *   node scripts/publish-release.js --dry-run  # 只检查，不上传
 *
 * 需要 GITHUB_TOKEN 环境变量（或 DSH 凭据中心里的 token）。
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const root = __dirname.replace(/[\\/]scripts$/, '')
const dryRun = process.argv.includes('--dry-run')
const token = process.env.GITHUB_TOKEN
const owner = process.env.INKDOWN_REPO_OWNER || 'IoT-Joker'
const repo = process.env.INKDOWN_REPO_NAME || 'inkdown'

function api(method, apiPath, body, extraHeaders = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'User-Agent': 'inkdown-release',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {}),
          ...extraHeaders
        }
      },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(d)
          } catch {
            parsed = d
          }
          resolve({ status: res.statusCode, body: parsed })
        })
      }
    )
    req.on('error', (e) => resolve({ status: 0, body: e.message }))
    if (data) req.write(data)
    req.end()
  })
}

/**
 * 上传单个资产（二进制流），带重试。
 *
 * 124 MB 的安装包在跨境链路上容易 ECONNRESET，
 * 单次失败就放弃会留下「latest.yml 有、安装包没有」的半成品 Release，
 * 用户点更新会 404。因此这里失败后重试几次。
 */
function uploadAssetOnce(uploadUrl, filePath, name) {
  return new Promise((resolve) => {
    const stat = fs.statSync(filePath)
    const url = new URL(uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(name)}`))
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'User-Agent': 'inkdown-release',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size
        }
      },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 200) }))
      }
    )
    req.on('error', (e) => resolve({ status: 0, body: e.message }))
    // 大文件上传给足超时，避免慢速链路被提前掐断
    req.setTimeout(10 * 60 * 1000, () => {
      req.destroy(new Error('上传超时'))
    })
    fs.createReadStream(filePath).pipe(req)
  })
}

/** 带重试的上传：最多 3 次，间隔逐次加长。 */
async function uploadAsset(uploadUrl, filePath, name) {
  let last = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await uploadAssetOnce(uploadUrl, filePath, name)
    if (last.status === 201 || last.status === 422) return last
    console.warn(`  第 ${attempt} 次上传失败（${last.status} ${last.body}），准备重试…`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
  return last
}

;(async () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const tag = `v${version}`
  console.log(`仓库: ${owner}/${repo}  版本: ${version}  标签: ${tag}`)

  if (!token) {
    console.error('缺少 GITHUB_TOKEN')
    process.exit(1)
  }

  // 待上传的产物：安装程序 + 更新清单。
  // 文件名必须与 latest.yml 里声明的一致（artifactName 为 Inkdown-Setup-<版本>.exe），
  // 否则 electron-updater 按清单名字下载会 404。
  const relDir = path.join(root, 'release')
  const assets = []
  const candidates = [
    `Inkdown-Setup-${version}.exe`,
    // 兼容旧命名（含空格），GitHub 会把空格转成点号
    `Inkdown Setup ${version}.exe`
  ]
  for (const f of ['latest.yml', ...candidates]) {
    const p = path.join(relDir, f)
    if (fs.existsSync(p)) assets.push({ path: p, name: f })
  }
  if (!assets.some((a) => a.name === 'latest.yml')) {
    console.warn('缺少产物: latest.yml')
  }
  if (assets.length < 2) {
    console.warn('缺少安装包，已找到:', assets.map((a) => a.name).join(', '))
  }
  if (!assets.length) {
    console.error('release/ 下没有可上传的产物，请先执行 pnpm package')
    process.exit(1)
  }
  console.log('待上传:')
  assets.forEach((a) => console.log(`  ${a.name} (${(fs.statSync(a.path).size / 1048576).toFixed(1)} MB)`))

  if (dryRun) {
    console.log('--dry-run：仅检查，不上传')
    process.exit(0)
  }

  // 已存在同名 release 则复用它
  let release = await api('GET', `/repos/${owner}/${repo}/releases/tags/${tag}`)
  if (release.status === 200) {
    console.log('已存在该标签的 release，复用:', release.body.html_url)
  } else {
    const created = await api('POST', `/repos/${owner}/${repo}/releases`, {
      tag_name: tag,
      name: `Inkdown ${version}`,
      body: `Inkdown ${version}\n\n安装包与自动更新清单。`,
      draft: false,
      prerelease: false
    })
    if (created.status !== 201) {
      console.error('创建 release 失败:', created.status, JSON.stringify(created.body).slice(0, 300))
      process.exit(1)
    }
    release = created
    console.log('已创建 release:', created.body.html_url)
  }

  // 上传资产
  for (const a of assets) {
    const up = await uploadAsset(release.body.upload_url, a.path, a.name)
    if (up.status === 201) {
      console.log('  已上传:', a.name)
    } else if (up.status === 422) {
      console.log('  已存在，跳过:', a.name)
    } else {
      console.error('  上传失败:', a.name, up.status, up.body)
      process.exit(1)
    }
  }

  console.log('PASS: Release 就绪，自动更新源可用')
  console.log('页面:', release.body.html_url)
})()
