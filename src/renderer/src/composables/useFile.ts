import { state, type Tab } from '../store'
import { closeTab, getActiveTab, isDirty, pushRecent, settings } from '../store'
import { translate } from '../../../shared/i18n'
import { currentLocale } from './useI18n'

/** 取当前语言的文案（useFile 是普通函数，不经过组件上下文）。 */
function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale.value, key, params)
}

const pendingSaves = new Map<Tab, Promise<boolean>>()
const pendingMoves = new Map<Tab, Promise<void>>()
const openingFiles = new Map<string, Promise<void>>()

/**
 * 启动时最多自动恢复多少个标签。
 * 会话可能记录了几十个标签，全部打开会同时读入大量文件、拖慢启动；
 * 超出部分保留在记录里，用户可手动打开。
 */
const MAX_RESTORE_TABS = 20

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized
}

function belongsTo(path: string | null, parent: string): boolean {
  return !!path && (pathKey(path) === pathKey(parent) || pathKey(path).startsWith(pathKey(parent) + '/'))
}

/** 文件读写与标签页管理。所有磁盘操作都经由 preload 桥接。 */
export function useFile() {
  async function openPath(filePath: string, options: { activate?: boolean } = {}): Promise<void> {
    const activate = options.activate !== false
    const existing = state.tabs.find((t) => t.filePath && pathKey(t.filePath) === pathKey(filePath))
    if (existing) {
      if (activate) state.activeId = existing.id
      pushRecent(filePath)
      return
    }
    const key = pathKey(filePath)
    if (openingFiles.has(key)) {
      await openingFiles.get(key)
      const opened = state.tabs.find(tab => tab.filePath && pathKey(tab.filePath) === key)
      if (activate && opened) state.activeId = opened.id
      return
    }
    const opening = (async () => {
      const file = await window.inkdown.readFile(filePath)
      // 超大文件由主进程先询问；用户选择不打开时返回 null，
      // 这里直接放弃，不创建标签、不记入最近打开。
      if (!file) return
      const { content, mtimeMs } = file
      const tab = createTabFromFile(filePath, content, mtimeMs)
      state.tabs.push(tab)
      if (activate) {
        state.activeId = tab.id
        // 打开已有文档默认进入阅读模式（设置里可关）。
        // 只在所见即所得视图下生效：源码/分栏本身就是编辑视图，
        // 阅读态在那种视图下没有意义（会被视图切换逻辑清掉）。
        if (settings.openInReadingMode && state.viewMode === 'wysiwyg') {
          state.readingMode = true
        }
      }
      void window.inkdown.watch(filePath)
      pushRecent(filePath)
    })()
    openingFiles.set(key, opening)
    try { await opening } finally { openingFiles.delete(key) }
  }

  /**
   * Restore tab data first; build only the editor that will actually be shown.
   *
   * 恢复数量有上限：会话记录里可能有几十个标签，一次性全开会把启动拖慢。
   * 超出部分仍保留在记录里（下次手动打开即可），但不自动打开，
   * 并给用户一条提示说明还有多少没恢复。
   */
  async function restoreSessionFiles(session: { files: string[]; activeFile?: string | null }): Promise<void> {
    const activeBefore = state.activeId
    let lastOpened: Tab | undefined
    const files = session.files.slice(0, MAX_RESTORE_TABS)
    const skipped = session.files.length - files.length
    for (const filePath of files) {
      try {
        if (!(await window.inkdown.exists(filePath))) continue
        await openPath(filePath, { activate: false })
        lastOpened = state.tabs.find(tab => tab.filePath && pathKey(tab.filePath) === pathKey(filePath))
      } catch { /* Missing or unavailable files must not prevent restoring others. */ }
    }
    const activeFile = session.activeFile
    const requested = activeFile ? state.tabs.find(tab => tab.filePath && pathKey(tab.filePath) === pathKey(activeFile)) : undefined
    const target = requested ?? (lastOpened && state.tabs.includes(lastOpened) ? lastOpened : state.tabs.at(-1))
    // Do not steal focus if the user has already selected another tab while I/O ran.
    if (target && state.activeId === activeBefore) state.activeId = target.id
    // 告诉用户还有多少标签没自动恢复，避免让人以为会话丢失
    if (skipped > 0) {
      state.notice = { text: t('session.skipped', { count: skipped, limit: MAX_RESTORE_TABS }) }
    }
  }

  async function openDialog(): Promise<void> {
    const files = await window.inkdown.openFileDialog()
    for (const f of files) {
      const existing = state.tabs.find((t) => t.filePath && pathKey(t.filePath) === pathKey(f.filePath))
      if (existing) {
        state.activeId = existing.id
      } else {
        const tab = createTabFromFile(f.filePath, f.content, 0)
        state.tabs.push(tab)
        state.activeId = tab.id
      }
      window.inkdown.watch(f.filePath)
      pushRecent(f.filePath)
    }
  }

  async function saveTab(tab: Tab | undefined = getActiveTab(), forceDialog = false): Promise<boolean> {
    if (!tab) return false
    const pending = Promise.all([pendingSaves.get(tab), pendingMoves.get(tab)])
      .catch(() => false)
      .then(() => writeTab(tab, forceDialog))
    pendingSaves.set(tab, pending)
    try {
      return await pending
    } catch (error) {
      const conflict = String(error).includes(t('notice.saveConflict'))
      state.notice = { text: t('notice.saveFailed', { name: tab.title, error: String(error) }),
        ...(conflict && tab.filePath ? { action: 'reload', filePath: tab.filePath } : {}) }
      return false
    } finally {
      if (pendingSaves.get(tab) === pending) pendingSaves.delete(tab)
    }
  }

  async function writeTab(tab: Tab, forceDialog: boolean): Promise<boolean> {
    let target = tab.filePath
    if (!target || forceDialog) {
      const picked = await window.inkdown.saveAsDialog(tab.title.endsWith('.md') ? tab.title : `${tab.title}.md`)
      if (!picked) return false
      target = picked
    }
    // 显式判空，让类型收窄到 string
    if (!target) return false
    const finalPath: string = target
    // 按设置的行尾符写盘（编辑器内部统一用 \n，仅在存盘时转换）
    const snapshot = tab.content
    const content = settings.lineEnding === 'crlf'
      ? snapshot.replace(/\r?\n/g, '\r\n') : snapshot.replace(/\r\n/g, '\n')
    const expected = tab.filePath && pathKey(tab.filePath) === pathKey(finalPath) ? tab.savedContent : undefined
    const { mtimeMs } = await window.inkdown.writeFile(finalPath, content, expected)
    tab.filePath = finalPath
    tab.title = baseName(finalPath)
    tab.savedContent = snapshot
    tab.mtimeMs = mtimeMs
    void window.inkdown.watch(finalPath)
    return true
  }

  async function saveAll(): Promise<boolean> {
    let ok = true
    for (const tab of state.tabs) {
      if (isDirty(tab)) ok = (await saveTab(tab)) && ok
    }
    return ok
  }

  /**
   * 关闭前的保存确认：保存 / 不保存 / 取消。
   * 返回 false 表示用户取消，调用方应中止关闭动作。
   */
  async function confirmClose(tab: Tab): Promise<boolean> {
    if (!isDirty(tab)) return true
    const answer = await window.inkdown.messageBox(
      t('dialog.saveChanges'),
      t('dialog.saveChangesDetail', { name: tab.title }),
      [t('dialog.save'), t('dialog.dontSave'), t('dialog.cancel')]
    )
    if (answer === 0) return (await saveTab(tab)) && !isDirty(tab)
    if (answer === 1) return true
    return false
  }

  /** 打开文件夹作为工作区，供文件树使用。 */
  async function openFolder(): Promise<void> {
    const dir = await window.inkdown.openFolderDialog()
    if (!dir) return
    state.workspace = dir
    state.sidebarVisible = true
    state.sidebarTab = 'files'
  }

  async function refreshWorkspace(): Promise<void> {
    if (!state.workspace) return
    state.workspace = await window.inkdown.readDir(state.workspace.path, 1)
  }

  async function renamePath(oldPath: string, newPath: string): Promise<void> {
    const affected = state.tabs.filter((tab) => belongsTo(tab.filePath, oldPath))
    const previous = affected.flatMap((tab) => [pendingSaves.get(tab), pendingMoves.get(tab)])
    const moving = (async () => {
      await Promise.all(previous)
      await window.inkdown.rename(oldPath, newPath)
      for (const tab of affected) {
        const oldFile = tab.filePath!
        tab.filePath = newPath + oldFile.slice(oldPath.length)
        tab.title = baseName(tab.filePath)
        await window.inkdown.unwatch(oldFile)
        await window.inkdown.watch(tab.filePath)
      }
    })()
    for (const tab of affected) pendingMoves.set(tab, moving)
    try { await moving } finally {
      for (const tab of affected) if (pendingMoves.get(tab) === moving) pendingMoves.delete(tab)
    }
  }

  async function removePath(target: string): Promise<boolean> {
    const affected = state.tabs.filter((tab) => belongsTo(tab.filePath, target))
    for (const tab of affected) if (!(await confirmClose(tab))) return false
    await Promise.all(affected.map((tab) => pendingSaves.get(tab)))
    await window.inkdown.remove(target)
    for (const tab of affected) closeTab(tab.id)
    return true
  }

  return { openPath, restoreSessionFiles, openDialog, saveTab, saveAll, confirmClose, openFolder, refreshWorkspace, renamePath, removePath }
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function createTabFromFile(filePath: string, content: string, mtimeMs: number): Tab {
  content = content.replace(/\r\n/g, '\n')
  return {
    id: `tab-${Math.random().toString(36).slice(2, 10)}`,
    filePath,
    title: baseName(filePath),
    content,
    savedContent: content,
    mtimeMs,
    cursor: null,
    scrollTop: 0,
    readingHistory: []
  }
}
