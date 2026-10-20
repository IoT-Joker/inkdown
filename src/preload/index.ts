import { contextBridge, ipcRenderer, webUtils } from 'electron'

/** 暴露给渲染进程的桥接 API。渲染层只通过它访问文件系统与原生能力。 */
const api = {
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  readDir: (dir: string, depth?: number) => ipcRenderer.invoke('fs:readDir', dir, depth),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
  createFolder: (dirPath: string) => ipcRenderer.invoke('fs:createFolder', dirPath),
  rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  remove: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  exists: (targetPath: string) => ipcRenderer.invoke('fs:exists', targetPath),
  pathInfo: (targetPath: string) => ipcRenderer.invoke('fs:pathInfo', targetPath),
  saveImage: (docPath: string | null, fileName: string, dataUrl: string) =>
    ipcRenderer.invoke('fs:saveImage', docPath, fileName, dataUrl),
  copyImage: (docPath: string | null, src: string) =>
    ipcRenderer.invoke('fs:copyImage', docPath, src),
  watch: (filePath: string) => ipcRenderer.invoke('fs:watch', filePath),
  unwatch: (filePath: string) => ipcRenderer.invoke('fs:unwatch', filePath),
  onFileChanged: (fn: (filePath: string, mtimeMs: number) => void) => {
    const listener = (_e: unknown, filePath: string, mtimeMs: number) => fn(filePath, mtimeMs)
    ipcRenderer.on('fs:fileChanged', listener)
    return () => ipcRenderer.off('fs:fileChanged', listener)
  },

  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  saveAsDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveAs', defaultName),
  saveFileDialog: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, content),
  messageBox: (message: string, detail: string, buttons: string[]) =>
    ipcRenderer.invoke('dialog:message', message, detail, buttons),

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (targetPath: string) => ipcRenderer.invoke('shell:showItemInFolder', targetPath),

  readClipboardText: () => ipcRenderer.invoke('clipboard:readText'),
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  setTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),
  setFullScreen: (flag: boolean) => ipcRenderer.invoke('window:setFullScreen', flag),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),

  exportPdf: (filePath: string, html: string, options?: { landscape?: boolean }) =>
    ipcRenderer.invoke('app:exportPdf', filePath, html, options),
  getPath: (name: 'home' | 'documents' | 'pictures' | 'userData') =>
    ipcRenderer.invoke('app:getPath', name),
  /** 关于对话框用：应用与运行时版本。 */
  getVersions: () => ipcRenderer.invoke('app:getVersions'),
  quit: () => ipcRenderer.invoke('app:quit'),

  /** 界面语言：由主进程持有（菜单需在渲染层就绪前确定语言）。 */
  getLocale: () => ipcRenderer.invoke('i18n:getLocale'),
  setLocale: (locale: 'zh-CN' | 'en') => ipcRenderer.invoke('i18n:setLocale', locale),

  /** 拖拽文件时把 File 对象解析为磁盘路径（Electron 33 的 webUtils）。 */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  /**
   * 启动时由文件关联传入的待打开文件（双击 .md 触发）。
   * 渲染层就绪后取一次，取走即清空，避免重复打开。
   */
  takePendingFile: () => ipcRenderer.invoke('app:takePendingFile'),

  /**
   * 应用已在运行时用户又双击了文件 —— 主进程转发过来。
   * 返回取消订阅函数。
   */
  onOpenFile: (fn: (filePath: string) => void) => {
    const listener = (_e: unknown, filePath: string) => fn(filePath)
    ipcRenderer.on('app:openFile', listener)
    return () => ipcRenderer.off('app:openFile', listener)
  },

  /** 手动检查更新（帮助菜单）。 */
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),

  /**
   * 自动化测试标记：跳过启动时的会话恢复，保证测试初始状态干净。
   * 与下面「禁用会话记录」相互独立——会话恢复测试需要
   * 「不恢复旧会话，但要记录新会话」的组合。
   */
  skipSessionRestore: process.env.INKDOWN_NO_SESSION_RESTORE === '1',
  /** 自动化测试标记：不记录会话，避免测试数据污染真实使用。 */
  skipSessionPersist: process.env.INKDOWN_NO_SESSION_PERSIST === '1',

  onMenuCommand: (fn: (id: string) => void) => {
    const listener = (_e: unknown, id: string) => fn(id)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.off('menu:command', listener)
  }
}

export type InkdownApi = typeof api

contextBridge.exposeInMainWorld('inkdown', api)
