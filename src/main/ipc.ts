import { app, dialog, ipcMain, shell, clipboard, BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { getMainWindow } from './window'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'])
const watchers = new Map<string, FSWatcher>()

/**
 * 本进程最近写过的文件：路径 → 写入时刻。
 *
 * fs.watch 无法区分「谁改的文件」，所以应用保存后也会触发变更事件。
 * 记录自写时刻，事件到达时若在该时间窗内就忽略，
 * 避免把「自己保存」误报成「外部修改」。
 *
 * 用时间窗而不是比对 mtime：写入与监听事件之间存在竞争，
 * 且 mtime 精度有限，比对容易产生假阳性。
 */
const selfWrites = new Map<string, number>()

/** 自写保护窗口（毫秒）。窗口外的变更一律视为外部改动。 */
const SELF_WRITE_WINDOW_MS = 2000

/** 判定某次变更是否来自本进程的自写动作。 */
function isSelfWrite(filePath: string): boolean {
  const at = selfWrites.get(filePath)
  if (at === undefined) return false
  const within = Date.now() - at <= SELF_WRITE_WINDOW_MS
  // 超出窗口即清理，避免陈旧记录长期压制真实的外部改动
  if (!within) selfWrites.delete(filePath)
  return within
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: DirEntry[]
}

/** 递归读取目录树，默认只展开两层，避免大目录阻塞。 */
async function readDirTree(dir: string, depth: number): Promise<DirEntry[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const result: DirEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: full,
        isDirectory: true,
        children: depth > 0 ? await readDirTree(full, depth - 1) : undefined
      })
    } else {
      result.push({ name: entry.name, path: full, isDirectory: false })
    }
  }
  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return result
}

export function registerIpc(): void {
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    const content = await fsp.readFile(filePath, 'utf8')
    const stat = await fsp.stat(filePath)
    return { filePath, content, mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    // 先记录写入时刻，覆盖 fs.watch 事件早于写入完成到达的竞争窗口
    selfWrites.set(filePath, Date.now())
    await fsp.writeFile(filePath, content, 'utf8')
    const stat = await fsp.stat(filePath)
    return { filePath, mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('fs:readDir', async (_e, dir: string, depth = 1) => {
    const root = resolve(dir)
    return { path: root, name: basename(root), children: await readDirTree(root, depth) }
  })

  ipcMain.handle('fs:createFile', async (_e, filePath: string) => {
    await fsp.writeFile(filePath, '', { flag: 'wx' })
    return filePath
  })

  ipcMain.handle('fs:createFolder', async (_e, dirPath: string) => {
    await fsp.mkdir(dirPath, { recursive: true })
    return dirPath
  })

  ipcMain.handle('fs:rename', async (_e, oldPath: string, newPath: string) => {
    await fsp.rename(oldPath, newPath)
    return newPath
  })

  ipcMain.handle('fs:delete', async (_e, targetPath: string) => {
    await shell.trashItem(targetPath)
    return true
  })

  ipcMain.handle('fs:exists', async (_e, targetPath: string) => {
    try {
      await fsp.access(targetPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:pathInfo', async (_e, targetPath: string) => {
    const stat = await fsp.stat(targetPath)
    return { isDirectory: stat.isDirectory(), mtimeMs: stat.mtimeMs, size: stat.size }
  })

  /** 把剪贴板/拖入的图片复制到文档同级 assets 目录，返回相对路径。 */
  ipcMain.handle(
    'fs:saveImage',
    async (_e, docPath: string | null, fileName: string, dataUrl: string) => {
      const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
      const baseDir = docPath ? dirname(docPath) : app.getPath('pictures')
      const assetsDir = docPath ? join(baseDir, 'assets') : baseDir
      await fsp.mkdir(assetsDir, { recursive: true })
      const ext = extname(fileName) || '.png'
      const stem = basename(fileName, ext) || 'image'
      let target = join(assetsDir, `${stem}${ext}`)
      let i = 1
      while (true) {
        try {
          await fsp.access(target)
          target = join(assetsDir, `${stem}-${i}${ext}`)
          i += 1
        } catch {
          break
        }
      }
      await fsp.writeFile(target, buffer)
      if (!docPath) return target
      return `assets/${basename(target)}`.split('\\').join('/')
    }
  )

  ipcMain.handle('fs:copyImage', async (_e, docPath: string | null, src: string) => {
    if (!docPath || !IMAGE_EXT.has(extname(src).toLowerCase())) return src
    const assetsDir = join(dirname(docPath), 'assets')
    await fsp.mkdir(assetsDir, { recursive: true })
    const target = join(assetsDir, basename(src))
    if (resolve(src) !== resolve(target)) await fsp.copyFile(src, target)
    return `assets/${basename(target)}`.split('\\').join('/')
  })

  ipcMain.handle('fs:watch', async (_e, filePath: string) => {
    if (watchers.has(filePath)) return true
    try {
      const w = watch(filePath, { persistent: false }, async () => {
        // 自写动作触发的变更不广播，避免误报成外部修改
        if (isSelfWrite(filePath)) return
        let mtimeMs = 0
        try {
          mtimeMs = (await fsp.stat(filePath)).mtimeMs
        } catch {
          return
        }
        getMainWindow()?.webContents.send('fs:fileChanged', filePath, mtimeMs)
      })
      watchers.set(filePath, w)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:unwatch', async (_e, filePath: string) => {
    watchers.get(filePath)?.close()
    watchers.delete(filePath)
    return true
  })

  ipcMain.handle('dialog:openFile', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return Promise.all(
      result.filePaths.map(async (filePath) => ({
        filePath,
        content: await fsp.readFile(filePath, 'utf8')
      }))
    )
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    const dir = result.filePaths[0]
    return { path: dir, name: basename(dir), children: await readDirTree(dir, 1) }
  })

  ipcMain.handle('dialog:saveAs', async (_e, defaultName: string) => {
    const win = getMainWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string, content: string) => {
    const win = getMainWindow()
    const result = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })

  ipcMain.handle('dialog:message', async (_e, message: string, detail: string, buttons: string[]) => {
    const win = getMainWindow()
    const result = await dialog.showMessageBox(win!, {
      type: 'question',
      message,
      detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1
    })
    return result.response
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('shell:showItemInFolder', async (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.handle('clipboard:writeText', (_e, text: string) => {
    clipboard.writeText(text)
    return true
  })
  ipcMain.handle('clipboard:readImage', () => {
    const image = clipboard.readImage()
    return image.isEmpty() ? '' : image.toDataURL()
  })

  ipcMain.handle('window:setTitle', (_e, title: string) => {
    getMainWindow()?.setTitle(title)
  })

  ipcMain.handle('window:setFullScreen', (_e, flag: boolean) => {
    getMainWindow()?.setFullScreen(flag)
    return getMainWindow()?.isFullScreen() ?? false
  })

  ipcMain.handle('window:toggleDevTools', () => {
    getMainWindow()?.webContents.toggleDevTools()
  })

  /**
   * 导出 PDF：把文档 HTML 放进一个隐藏窗口渲染，再 printToPDF。
   * 必须用独立窗口，否则会把侧边栏、标签栏、状态栏一起打进 PDF。
   */
  ipcMain.handle(
    'app:exportPdf',
    async (_e, filePath: string, html: string, options?: { landscape?: boolean }) => {
      const printer = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
      })
      try {
        await printer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        // 等待字体与布局稳定
        await new Promise((r) => setTimeout(r, 600))
        const data = await printer.webContents.printToPDF({
          printBackground: true,
          landscape: options?.landscape ?? false,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
        })
        await fsp.writeFile(filePath, data)
        return true
      } catch (err) {
        console.error('[exportPdf] 失败:', err)
        return false
      } finally {
        if (!printer.isDestroyed()) printer.destroy()
      }
    }
  )

  ipcMain.handle('app:getPath', (_e, name: 'home' | 'documents' | 'pictures' | 'userData') =>
    app.getPath(name)
  )

  ipcMain.handle('app:quit', () => app.quit())
}

export function closeAllWatchers(): void {
  watchers.forEach((w) => w.close())
  watchers.clear()
}

export function broadcast(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args))
}
