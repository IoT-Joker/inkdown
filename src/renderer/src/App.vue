<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import EditorHost from './components/EditorHost.vue'
import MenuBar from './components/MenuBar.vue'
import SideBar from './components/SideBar.vue'
import TabBar from './components/TabBar.vue'
import StatusBar from './components/StatusBar.vue'
import FindBar from './components/FindBar.vue'
import PreferencesDialog from './components/PreferencesDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import FolderSearchPanel from './components/FolderSearchPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import { executeCommand, registerGlobalCommands } from './composables/useCommands'
import { useFile } from './composables/useFile'
import { useI18n, initLocale } from './composables/useI18n'
import { loadSettings, loadRecent, loadSession, persistSession, loadRecovery, persistRecovery, clearRecovery, settings, state, getActiveTab, isDirty, createTab, hasUnsavedTabs, tabLabel } from './store'

const { openPath, refreshWorkspace, saveTab, saveAll, openFolder } = useFile()
const editorRef = ref<InstanceType<typeof EditorHost> | null>(null)
const { t } = useI18n()

/** 自动保存：仅对已有磁盘路径的标签生效，避免频繁弹保存对话框。 */
let autoSaveTimer: number | undefined
let recoveryTimer: number | undefined
watch(
  () => [settings.autoSave, settings.autoSaveDelay, ...state.tabs.flatMap((t) => [t.id, t.content, t.savedContent])],
  () => {
    if (autoSaveTimer) window.clearTimeout(autoSaveTimer)
    if (!settings.autoSave) return
    autoSaveTimer = window.setTimeout(async () => {
      if (!settings.autoSave) return
      for (const tab of state.tabs) {
        if (isDirty(tab) && tab.filePath) await saveTab(tab)
      }
    }, settings.autoSaveDelay)
  }
)

watch(() => state.tabs.map((tab) => tab.filePath), (paths, previous = []) => {
  for (const path of previous) if (path && !paths.includes(path)) void window.inkdown.unwatch(path)
})

onBeforeUnmount(() => {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer)
  if (recoveryTimer) window.clearTimeout(recoveryTimer)
})

const windowTitle = computed(() => {
  const tab = getActiveTab()
  if (!tab) return t('app.name')
  return `${tabLabel(tab)} — ${t('app.name')}`
})

watch(windowTitle, (t) => window.inkdown.setTitle(t), { immediate: true })

/** 应用主题类到 body，主题切换即时生效。 */
watch(
  () => state.theme,
  (theme) => {
    document.body.className = document.body.className.replace(/theme-[a-z]+/g, '').trim()
    document.body.classList.add(`theme-${theme}`)
  },
  { immediate: true }
)

/** 首选项变化后实时应用到编辑器并持久化。 */
watch(() => JSON.stringify(state.viewMode), () => editorRef.value?.focus())

/**
 * 「启动时自动检查更新」开关同步给主进程。
 *
 * 设置存在渲染层 localStorage，主进程启动时读不到，
 * 因此立即推一次（让本次运行生效），之后随设置变化再推。
 */
watch(
  () => settings.autoCheckUpdate,
  (enabled) => void window.inkdown.setAutoCheckUpdate(!!enabled),
  { immediate: true }
)

function onMenuCommand(id: string): void {
  void executeCommand(id)
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (state.quitConfirmed) {
    if (!window.inkdown.skipSessionPersist) clearRecovery()
    return
  }
  if (!window.inkdown.skipSessionPersist) persistRecovery()
  if (hasUnsavedTabs()) {
    e.preventDefault()
    e.returnValue = ''
  }
}

onMounted(async () => {
  // 语言需尽早载入：窗口标题与界面文案都依赖它
  await initLocale()
  registerGlobalCommands()
  loadSettings()
  loadRecent()
  // 暴露应用级文件 API 与退出入口，供主进程端到端文件测试使用
  ;(window as unknown as Record<string, unknown>).__inkdownApp = {
    openPath,
    saveTab,
    saveAll,
    openFolder,
    refreshWorkspace,
    activeTab: () => getActiveTab(),
    tabs: () => state.tabs,
    setActive: (id: string) => {
      state.activeId = id
    },
    /** 设置工作区目录（供端到端测试驱动文件树）。 */
    setWorkspace: (ws: unknown) => {
      state.workspace = ws as typeof state.workspace
    },
    settings: () => settings,
    findVisible: () => state.findVisible,
    /** 当前视图模式（供测试判断三态切换结果）。 */
    viewMode: () => state.viewMode,
    persistSession,
    persistRecovery,
    loadSession,
    clearNotice: () => {
      state.notice = null
    }
  }
  // notice 需要实时反映 state，用 getter 代理（不能与上面的字面量属性重名）
  Object.defineProperty((window as unknown as Record<string, unknown>).__inkdownApp, 'notice', {
    get: () => state.notice
  })
  ;(window as unknown as Record<string, unknown>).__inkdownQuit = () => executeCommand('file:quit')

  const off = window.inkdown.onMenuCommand(onMenuCommand)
  window.addEventListener('beforeunload', onBeforeUnload)

  // 外部修改文件时给出非阻塞提示（不再用模态对话框打断写作）。
  // 主进程已过滤掉应用自身的写盘动作，这里只负责提示。
  const offFs = window.inkdown.onFileChanged((filePath: string) => {
    const tab = state.tabs.find((t) => t.filePath === filePath)
    if (!tab) return
    state.notice = {
      text: t('notice.externalChange', { name: tab.title }),
      action: 'reload',
      filePath
    }
  })

  // 文件关联：双击 .md 时系统把路径作为启动参数传给主进程，
  // 主进程解析后由这里取用（不能读 window.process.argv —— 打包后渲染层是隔离的）
  const fileArg = await window.inkdown.takePendingFile()
  // 自动化测试需要干净的初始状态，此时不恢复上次会话
  const skipRestore = !!window.inkdown.skipSessionRestore
  if (fileArg) {
    await openPath(fileArg)
  } else if (skipRestore) {
    if (!state.tabs.length) createTab({ content: '' })
  } else {
    // 会话恢复：重启后自动重开上次的标签页（文件已被删除或移动的跳过）
    const session = loadSession()
    if (session?.files.length) {
      for (const p of session.files) {
        try {
          if (await window.inkdown.exists(p)) await openPath(p)
        } catch {
          /* 文件不可用则跳过 */
        }
      }
      if (session.activeFile) {
        const target = state.tabs.find((t) => t.filePath === session.activeFile)
        if (target) state.activeId = target.id
      }
    }
    if (!state.tabs.length) createTab({ content: '' })
  }

  if (!skipRestore) {
    let recovered = 0
    for (const draft of loadRecovery()) {
      let tab = state.tabs.find((tab) => tab.filePath && tab.filePath === draft.filePath)
      if (!tab && draft.filePath) {
        try { await openPath(draft.filePath); tab = getActiveTab() } catch { /* Recover missing files as untitled. */ }
      }
      if (tab?.content === draft.content) continue
      if (tab && tab.content.replace(/\r\n/g, '\n') === draft.savedContent.replace(/\r\n/g, '\n')) {
        tab.content = draft.content
        state.activeId = tab.id
        editorRef.value?.reloadFromTab()
      } else {
        // Never overwrite a file changed on disk since the crash.
        createTab({ title: t('recovery.title', { name: draft.title }), content: draft.content })
      }
      recovered++
    }
    if (recovered) state.notice = { text: t('notice.recoveredDrafts', { count: recovered }) }
  }
  if (!window.inkdown.skipSessionPersist) {
    watch(() => state.tabs.flatMap((tab) => [tab.filePath, tab.content, tab.savedContent]), () => {
      if (recoveryTimer) window.clearTimeout(recoveryTimer)
      recoveryTimer = window.setTimeout(persistRecovery, 750)
    }, { immediate: true })
  }

  // 应用已在运行时用户又双击了文件：主进程转发过来，直接打开
  const offOpenFile = window.inkdown.onOpenFile((filePath) => {
    void openPath(filePath)
  })

  // 会话内容变化时记录，供下次启动恢复（测试可选择不记录，避免污染）
  if (!window.inkdown.skipSessionPersist) {
    watch(
      () => state.tabs.map((t) => t.filePath).join('|') + '#' + state.activeId,
      () => persistSession(),
      { immediate: true }
    )
  }

  onBeforeUnmount(() => {
    off()
    offFs()
    offOpenFile()
    window.removeEventListener('beforeunload', onBeforeUnload)
  })
})

/** 处理提示条上的操作。 */
async function onNoticeAction(): Promise<void> {
  const notice = state.notice
  if (!notice) return
  if (notice.action === 'reload' && notice.filePath) {
    const tab = state.tabs.find((t) => t.filePath === notice.filePath)
    if (tab) {
      if (isDirty(tab)) {
        const answer = await window.inkdown.messageBox(t('notice.reloadDirty'), tab.title, [t('notice.reload'), t('dialog.cancel')])
        if (answer !== 0) return
      }
      const { content, mtimeMs } = await window.inkdown.readFile(notice.filePath)
      tab.content = content.replace(/\r\n/g, '\n')
      tab.savedContent = tab.content
      tab.mtimeMs = mtimeMs
      if (tab.id === state.activeId) editorRef.value?.reloadFromTab()
    }
  }
  state.notice = null
}

/** 未保存改动时先询问，避免直接关窗丢内容。 */
async function tryQuit(): Promise<void> {
  await executeCommand('file:quit')
}
</script>

<template>
  <div class="app-shell">
    <MenuBar />
    <TabBar />
    <div class="app-body">
      <SideBar @refresh="refreshWorkspace" />
      <!-- 全库搜索面板：打开时占一列，关闭时不影响布局 -->
      <FolderSearchPanel />
      <div class="main-column">
        <button
          v-if="!state.sidebarVisible"
          class="sidebar-show"
          :title="`${t('sidebar.show')} (Ctrl+Shift+L)`"
          @click="state.sidebarVisible = true"
        >
          »
        </button>
        <EditorHost ref="editorRef" />
      </div>
    </div>
    <FindBar />
    <!-- 非阻塞提示条：告知外部改动等，不打断写作 -->
    <div v-if="state.notice" class="notice-bar">
      <span class="notice-text">{{ state.notice.text }}</span>
      <button v-if="state.notice.action" class="ty-btn" @click="onNoticeAction">{{ t('notice.reload') }}</button>
      <button class="ty-btn" @click="state.notice = null">{{ t('notice.ignore') }}</button>
    </div>
    <StatusBar />
    <PreferencesDialog v-if="state.preferencesVisible" />
    <AboutDialog v-if="state.aboutVisible" />
    <ShortcutsDialog v-if="state.shortcutsVisible" />
    <CommandPalette v-if="state.paletteVisible" />
  </div>
</template>

<style scoped>
.main-column {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
}
.sidebar-show {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 20;
  width: 24px;
  height: 24px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-sidebar-bg);
  color: var(--ty-muted);
  cursor: pointer;
  font-size: 12px;
}
.sidebar-show:hover {
  color: var(--ty-text);
  background: var(--ty-hover);
}
.notice-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 6px 12px;
  border-top: 1px solid var(--ty-border);
  background: var(--ty-active);
  font-size: 12px;
  color: var(--ty-text);
}
.notice-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
