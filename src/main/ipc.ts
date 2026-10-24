import { app, dialog, ipcMain, shell, clipboard, BrowserWindow } from 'electron'
import { promises as fsp, constants } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { getMainWindow } from './window'
import { buildAppMenu, setShortcutOverrides } from './menu'
import { getLocale, setLocale } from './locale'
import { translate, type LocaleCode } from '../shared/i18n'
import { takePendingFile } from './fileAssociation'
import {
  checkForUpdatesManually,
  downloadUpdate,
  getUpdateStatus,
  restartToUpdate,
  setAutoCheckEnabled
} from './updater'
import { markdownToDocx } from './exportDocx'
import { writeHtmlPdf } from './exportWindow'
import { htmlToVisualDocx } from './exportVisualDocx'
import { searchInFolder, type SearchOptions } from './folderSearch'
import { randomUUID } from 'node:crypto'

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

/** Markdown 文档扩展名。文件树只列出这些文件，避免混入图片、脚本等无关内容。 */
const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx', '.txt'])

/** 判断是否为 Markdown 文档。 */
export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXT.has(extname(name).toLowerCase())
}

/** 递归读取目录树。目录始终保留用于导航，文件只保留 Markdown。 */
async function readDirTree(dir: string, depth: number): Promise<DirEntry[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const result: DirEntry[] = []
  for (const entry of entries) {
    // 跳过隐藏文件与依赖目录
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: full,
        isDirectory: true,
        children: depth > 0 ? await readDirTree(full, depth - 1) : undefined
      })
    } else if (isMarkdownFile(entry.name)) {
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
  // 语言：渲染层启动时读取，切换时写回并重建菜单
  ipcMain.handle('i18n:getLocale', () => getLocale())
  ipcMain.handle('i18n:setLocale', async (_e, locale: LocaleCode) => {
    await setLocale(locale)
    buildAppMenu()
    return true
  })
  /** 快捷键修改后立即重建原生菜单，让菜单显示与键盘加速器同步。 */
  ipcMain.handle('shortcuts:setOverrides', (_e, overrides: Record<string, string>) => {
    const clean: Record<string, string> = {}
    for (const [id, value] of Object.entries(overrides ?? {})) {
      if (typeof value === 'string' && value.length > 0 && value.length <= 80) clean[id] = value
    }
    setShortcutOverrides(clean)
    return true
  })
  /** 渲染层批量取词：避免逐条 IPC 往返。 */
  ipcMain.handle('i18n:translate', (_e, keys: string[]) => {
    const locale = getLocale()
    const out: Record<string, string> = {}
    for (const k of keys) out[k] = translate(locale, k)
    return out
  })

  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    const content = await fsp.readFile(filePath, 'utf8')
    const stat = await fsp.stat(filePath)
    return { filePath, content, mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string, expectedContent?: string) => {
    if (expectedContent !== undefined) {
      const disk = await fsp.readFile(filePath, 'utf8')
      if (disk.replace(/\r\n/g, '\n') !== expectedContent.replace(/\r\n/g, '\n')) {
        throw new Error(translate(getLocale(), 'notice.saveConflict'))
      }
    }
    // 先记录写入时刻，覆盖 fs.watch 事件早于写入完成到达的竞争窗口
    selfWrites.set(filePath, Date.now())
    // Replace only a completely written, flushed sibling file. An interrupted
    // write must not truncate the user's current document.
    const target = await fsp.realpath(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return resolve(filePath)
    })
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    const mode = await fsp.stat(target).then((stat) => stat.mode, () => undefined)
    const handle = await fsp.open(temporary, 'wx', mode)
    try {
      try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
      await fsp.rename(temporary, target)
    } finally {
      await fsp.unlink(temporary).catch(() => {})
    }
    if (watchers.has(filePath)) {
      watchers.get(filePath)!.close()
      watchers.delete(filePath)
      watchDocument(filePath)
    }
    const stat = await fsp.stat(filePath)
    return { filePath, mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('fs:readDir', async (_e, dir: string, depth = 1) => {
    const root = resolve(dir)
    return { path: root, name: basename(root), children: await readDirTree(root, depth) }
  })

  /**
   * 全库搜索：在指定目录下递归搜索所有 Markdown 文件。
   * 纯 Node 实现（见 folderSearch.ts），不引入 ripgrep 等原生依赖。
   */
  ipcMain.handle('fs:searchInFolder', async (_e, rootDir: string, opts: SearchOptions) => {
    return searchInFolder(resolve(rootDir), opts)
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
      const target = await writeUniqueImage(assetsDir, stem, ext, (target) =>
        fsp.writeFile(target, buffer, { flag: 'wx' }))
      if (!docPath) return target
      return `assets/${basename(target)}`.split('\\').join('/')
    }
  )

  ipcMain.handle('fs:copyImage', async (_e, docPath: string | null, src: string) => {
    if (!docPath || !IMAGE_EXT.has(extname(src).toLowerCase())) return src
    const assetsDir = join(dirname(docPath), 'assets')
    await fsp.mkdir(assetsDir, { recursive: true })
    if (resolve(dirname(src)) === resolve(assetsDir)) return `assets/${basename(src)}`
    const ext = extname(src)
    const target = await writeUniqueImage(assetsDir, basename(src, ext), ext, (target) =>
      fsp.copyFile(src, target, constants.COPYFILE_EXCL))
    return `assets/${basename(target)}`.split('\\').join('/')
  })

  ipcMain.handle('fs:watch', async (_e, filePath: string) => watchDocument(filePath))

  ipcMain.handle('fs:unwatch', async (_e, filePath: string) => {
    watchers.get(filePath)?.close()
    watchers.delete(filePath)
    selfWrites.delete(filePath)
    return true
  })

  ipcMain.handle('dialog:openFile', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
        { name: translate(getLocale(), 'dialog.allFiles'), extensions: ['*'] }
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

  ipcMain.handle('dialog:openImage', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
        }
      ]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
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

  /**
   * 导出 Word (.docx)。
   * markdown 为文档内容，defaultName 用于建议文件名，title 用作文档标题。
   */
  ipcMain.handle(
    'app:exportDocx',
    async (_e, markdown: string, defaultName: string, title: string, html?: string) => {
      const win = getMainWindow()
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName,
        filters: [{ name: 'Word 文档', extensions: ['docx'] }]
      })
      if (result.canceled || !result.filePath) return null
      try {
        const buffer = html ? await htmlToVisualDocx(html, title) : await markdownToDocx(markdown, title)
        await fsp.writeFile(result.filePath, buffer)
        return result.filePath
      } catch (err) {
        console.error('[exportDocx] 失败:', err)
        throw err
      }
    }
  )

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

  ipcMain.handle('window:isFullScreen', () => getMainWindow()?.isFullScreen() ?? false)

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
      try {
        await writeHtmlPdf(filePath, html, options?.landscape)
        return true
      } catch (err) {
        console.error('[exportPdf] 失败:', err)
        return false
      }
    }
  )

  ipcMain.handle('app:getPath', (_e, name: 'home' | 'documents' | 'pictures' | 'userData') =>
    app.getPath(name)
  )

  /** 关于对话框用：应用与运行时版本。 */
  ipcMain.handle('app:getVersions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    chromium: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  }))

  /**
   * 启动时由文件关联传入的待打开文件。
   * 渲染层就绪后取一次；取走即清空，避免重复打开。
   */
  ipcMain.handle('app:takePendingFile', () => takePendingFile())

  /** 手动检查更新（帮助菜单）。 */
  ipcMain.handle('app:checkForUpdates', () => checkForUpdatesManually())

  /** 读取当前更新状态（阶段 / 当前版本 / 下载进度）。 */
  ipcMain.handle('app:getUpdateStatus', () => getUpdateStatus())

  /** 下载已发现的更新。 */
  ipcMain.handle('app:downloadUpdate', () => downloadUpdate())

  /** 退出并安装已下载的更新。 */
  ipcMain.handle('app:restartToUpdate', () => restartToUpdate())

  /**
   * 渲染层同步「启动时自动检查更新」开关。
   * 设置存在渲染层 localStorage，主进程启动时读不到，
   * 因此由渲染层就绪后推过来。
   */
  ipcMain.handle('app:setAutoCheckUpdate', (_e, enabled: boolean) => {
    setAutoCheckEnabled(!!enabled)
  })

  ipcMain.handle('app:quit', () => app.quit())
}

async function writeUniqueImage(dir: string, stem: string, ext: string, write: (path: string) => Promise<void>): Promise<string> {
  for (let i = 0; ; i++) {
    const target = join(dir, `${stem}${i ? `-${i}` : ''}${ext}`)
    try {
      await write(target)
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

function watchDocument(filePath: string): boolean {
  if (watchers.has(filePath)) return true
  try {
    const watcher = watch(filePath, { persistent: false }, async () => {
      if (isSelfWrite(filePath)) return
      try {
        const { mtimeMs } = await fsp.stat(filePath)
        getMainWindow()?.webContents.send('fs:fileChanged', filePath, mtimeMs)
      } catch { /* File may have been deleted or moved. */ }
    })
    watcher.on('error', () => {
      watcher.close()
      if (watchers.get(filePath) === watcher) watchers.delete(filePath)
    })
    watchers.set(filePath, watcher)
    return true
  } catch { return false }
}

export function closeAllWatchers(): void {
  watchers.forEach((w) => w.close())
  watchers.clear()
}

export function broadcast(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args))
}
