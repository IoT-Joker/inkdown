import { state, type Tab } from '../store'
import { getActiveTab, isDirty, pushRecent, settings } from '../store'
import { translate } from '../../../shared/i18n'
import { currentLocale } from './useI18n'

/** 取当前语言的文案（useFile 是普通函数，不经过组件上下文）。 */
function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale.value, key, params)
}

/** 文件读写与标签页管理。所有磁盘操作都经由 preload 桥接。 */
export function useFile() {
  async function openPath(filePath: string): Promise<void> {
    const existing = state.tabs.find((t) => t.filePath === filePath)
    if (existing) {
      state.activeId = existing.id
      pushRecent(filePath)
      return
    }
    const { content, mtimeMs } = await window.inkdown.readFile(filePath)
    const tab = createTabFromFile(filePath, content, mtimeMs)
    state.tabs.push(tab)
    state.activeId = tab.id
    void window.inkdown.watch(filePath)
    pushRecent(filePath)
  }

  async function openDialog(): Promise<void> {
    const files = await window.inkdown.openFileDialog()
    for (const f of files) {
      const existing = state.tabs.find((t) => t.filePath === f.filePath)
      if (existing) {
        existing.content = f.content
        existing.savedContent = f.content
        state.activeId = existing.id
      } else {
        const tab = createTabFromFile(f.filePath, f.content, 0)
        state.tabs.push(tab)
        state.activeId = tab.id
      }
      window.inkdown.watch(f.filePath)
    }
  }

  async function saveTab(tab: Tab | undefined = getActiveTab(), forceDialog = false): Promise<boolean> {
    if (!tab) return false
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
    const content =
      settings.lineEnding === 'crlf' ? tab.content.replace(/\r?\n/g, '\r\n') : tab.content
    const { mtimeMs } = await window.inkdown.writeFile(finalPath, content)
    tab.filePath = finalPath
    tab.title = baseName(finalPath)
    tab.savedContent = tab.content
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
    if (answer === 0) return await saveTab(tab)
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

  return { openPath, openDialog, saveTab, saveAll, confirmClose, openFolder, refreshWorkspace }
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function createTabFromFile(filePath: string, content: string, mtimeMs: number): Tab {
  return {
    id: `tab-${Math.random().toString(36).slice(2, 10)}`,
    filePath,
    title: baseName(filePath),
    content,
    savedContent: content,
    mtimeMs,
    cursor: null,
    scrollTop: 0
  }
}
