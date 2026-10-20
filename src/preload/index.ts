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
  onFileChanged: (fn: (filePath: string) => void) => {
    const listener = (_e: unknown, filePath: string) => fn(filePath)
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
  toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),

  exportPdf: (filePath: string, html: string, options?: { landscape?: boolean }) =>
    ipcRenderer.invoke('app:exportPdf', filePath, html, options),
  getPath: (name: 'home' | 'documents' | 'pictures' | 'userData') =>
    ipcRenderer.invoke('app:getPath', name),
  quit: () => ipcRenderer.invoke('app:quit'),

  /** 拖拽文件时把 File 对象解析为磁盘路径（Electron 33 的 webUtils）。 */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  onMenuCommand: (fn: (id: string) => void) => {
    const listener = (_e: unknown, id: string) => fn(id)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.off('menu:command', listener)
  }
}

export type TypraApi = typeof api

contextBridge.exposeInMainWorld('typra', api)
