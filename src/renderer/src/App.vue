<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import EditorHost from './components/EditorHost.vue'
import SideBar from './components/SideBar.vue'
import TabBar from './components/TabBar.vue'
import StatusBar from './components/StatusBar.vue'
import FindBar from './components/FindBar.vue'
import PreferencesDialog from './components/PreferencesDialog.vue'
import { executeCommand, registerGlobalCommands } from './composables/useCommands'
import { useFile } from './composables/useFile'
import { loadSettings, loadRecent, settings, state, getActiveTab, isDirty, createTab, hasUnsavedTabs, tabLabel } from './store'

const { openPath, refreshWorkspace, saveTab, saveAll, openFolder } = useFile()
const editorRef = ref<InstanceType<typeof EditorHost> | null>(null)

/** 自动保存：仅对已有磁盘路径的标签生效，避免频繁弹保存对话框。 */
let autoSaveTimer: number | undefined
watch(
  () => state.tabs.map((t) => `${t.id}:${t.content.length}:${t.content === t.savedContent}`).join('|'),
  () => {
    if (!settings.autoSave) return
    if (autoSaveTimer) window.clearTimeout(autoSaveTimer)
    autoSaveTimer = window.setTimeout(async () => {
      for (const tab of state.tabs) {
        if (isDirty(tab) && tab.filePath) await saveTab(tab)
      }
    }, settings.autoSaveDelay)
  }
)

const windowTitle = computed(() => {
  const tab = getActiveTab()
  if (!tab) return 'Typra2'
  return `${tabLabel(tab)} — Typra2`
})

watch(windowTitle, (t) => window.typra.setTitle(t), { immediate: true })

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
watch(
  () => JSON.stringify(state.viewMode),
  () => editorRef.value?.focus()
)

function onMenuCommand(id: string): void {
  void executeCommand(id)
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (hasUnsavedTabs()) {
    e.preventDefault()
    e.returnValue = ''
  }
}

onMounted(async () => {
  registerGlobalCommands()
  loadSettings()
  loadRecent()
  // 暴露应用级文件 API 与退出入口，供主进程端到端文件测试使用
  ;(window as unknown as Record<string, unknown>).__typraApp = {
    openPath,
    saveTab,
    saveAll,
    openFolder,
    refreshWorkspace,
    activeTab: () => getActiveTab(),
    tabs: () => state.tabs,
    notice: null as null | { text: string },
    clearNotice: () => {
      state.notice = null
    }
  }
  // notice 需要实时反映 state，用 getter 代理
  Object.defineProperty((window as unknown as Record<string, unknown>).__typraApp, 'notice', {
    get: () => state.notice
  })
  ;(window as unknown as Record<string, unknown>).__typraQuit = () => executeCommand('file:quit')

  const off = window.typra.onMenuCommand(onMenuCommand)
  window.addEventListener('beforeunload', onBeforeUnload)

  // 外部修改文件时给出非阻塞提示（不再用模态对话框打断写作）。
  // 主进程已过滤掉应用自身的写盘动作，这里只负责提示。
  const offFs = window.typra.onFileChanged((filePath: string) => {
    const tab = state.tabs.find((t) => t.filePath === filePath)
    if (!tab) return
    state.notice = {
      text: `「${tab.title}」已在 Typra2 之外被修改`,
      action: 'reload',
      filePath
    }
  })

  // 支持命令行传入文件路径
  const argv = (window as any).process?.argv as string[] | undefined
  const fileArg = argv?.find((a) => /\.(md|markdown|txt)$/i.test(a))
  if (fileArg) await openPath(fileArg)
  else if (!state.tabs.length) createTab({ content: '' })

  onBeforeUnmount(() => {
    off()
    offFs()
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
      const { content, mtimeMs } = await window.typra.readFile(notice.filePath)
      tab.content = content
      tab.savedContent = content
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
    <TabBar />
    <div class="app-body">
      <SideBar @refresh="refreshWorkspace" />
      <div class="main-column">
        <button
          v-if="!state.sidebarVisible"
          class="sidebar-show"
          title="显示侧边栏 (Ctrl+Shift+L)"
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
      <button v-if="state.notice.action" class="ty-btn" @click="onNoticeAction">重新载入</button>
      <button class="ty-btn" @click="state.notice = null">忽略</button>
    </div>
    <StatusBar />
    <PreferencesDialog v-if="state.preferencesVisible" />
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
