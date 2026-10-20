/**
 * 图标生成：把 build/icon.svg 渲染成各尺寸 PNG 与 Windows ICO。
 *
 * 用 Electron 自带的 Chromium 渲染，不引入额外依赖。
 * 用法：electron . （带 INKDOWN_MAKE_ICONS=1）
 */
import { app, BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

/** 需要生成的 PNG 尺寸（Windows 图标常用集合）。 */
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

/**
 * 把多张 PNG 打包成 ICO。
 * ICO 结构：6 字节文件头 + 每张图 16 字节目录项 + 各图 PNG 数据。
 * 直接用 PNG 作为 ICO 的负载是允许的（Vista 以后的格式）。
 */
function buildIco(pngs: Array<{ size: number; data: Buffer }>): Buffer {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4)

  const entries: Buffer[] = []
  const payloads: Buffer[] = []
  let offset = 6 + count * 16

  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    // 256 要写 0（ICO 的宽高字段是 1 字节）
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // 调色板数
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    payloads.push(data)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...payloads])
}

export async function makeIcons(outDir: string): Promise<boolean> {
  const svgPath = join(process.cwd(), 'build', 'icon.svg')
  let svg: string
  try {
    svg = await fsp.readFile(svgPath, 'utf8')
  } catch (err) {
    console.error('[icon] 读取 SVG 失败:', err)
    return false
  }

  await fsp.mkdir(outDir, { recursive: true })

  // 用一个透明背景的窗口承载 SVG，逐尺寸截图
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    transparent: true,
    frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true }
  })

  const pngs: Array<{ size: number; data: Buffer }> = []
  try {
    for (const size of SIZES) {
      // 让 SVG 填满窗口后按需截取
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:transparent;overflow:hidden}
        svg{display:block;width:${size}px;height:${size}px}
      </style></head><body>${svg}</body></html>`
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      await new Promise((r) => setTimeout(r, 120))
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
      const data = image.toPNG()
      pngs.push({ size, data })
      await fsp.writeFile(join(outDir, `icon-${size}.png`), data)
      console.log(`[icon] 已生成 icon-${size}.png (${data.length} bytes)`)
    }

    // 主图标：256 PNG（Linux/mac 与窗口图标都用它）
    await fsp.writeFile(
      join(outDir, 'icon.png'),
      pngs.find((p) => p.size === 256)?.data ?? pngs[pngs.length - 1].data
    )

    // Windows ICO
    const ico = buildIco(pngs)
    await fsp.writeFile(join(outDir, 'icon.ico'), ico)
    console.log(`[icon] 已生成 icon.ico (${ico.length} bytes, ${pngs.length} 个尺寸)`)

    console.log('[icon] PASS: 图标生成完成')
    return true
  } catch (err) {
    console.error('[icon] 生成失败:', err)
    return false
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
