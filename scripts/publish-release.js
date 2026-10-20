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

/** 上传单个资产（二进制流）。 */
function uploadAsset(uploadUrl, filePath, name) {
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
    fs.createReadStream(filePath).pipe(req)
  })
}

;(async () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const tag = `v${version}`
  console.log(`仓库: ${owner}/${repo}  版本: ${version}  标签: ${tag}`)

  if (!token) {
    console.error('缺少 GITHUB_TOKEN')
    process.exit(1)
  }

  // 待上传的产物：安装程序 + 更新清单
  const relDir = path.join(root, 'release')
  const assets = []
  for (const f of ['latest.yml', `Inkdown Setup ${version}.exe`]) {
    const p = path.join(relDir, f)
    if (fs.existsSync(p)) assets.push({ path: p, name: f })
    else console.warn('缺少产物:', f)
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
