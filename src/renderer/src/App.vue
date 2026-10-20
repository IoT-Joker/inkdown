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
import { loadSettings, loadRecent, settings, state, getActiveTab, isDirty, createTab, hasUnsavedTabs } from './store'

const { openPath, refreshWorkspace, saveTab, saveAll } = useFile()
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
    }, 1500)
  }
)

const windowTitle = computed(() => {
  const tab = getActiveTab()
  if (!tab) return 'Typra2'
  return `${isDirty(tab) ? '● ' : ''}${tab.title} — Typra2`
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
  // 标题栏/状态栏的未保存改动检查在应用退出前触发
  ;(window as unknown as Record<string, unknown>).__typraQuit = () => executeCommand('file:quit')

  const off = window.typra.onMenuCommand(onMenuCommand)
  window.addEventListener('beforeunload', onBeforeUnload)

  // 外部修改文件时提示重新载入
  const offFs = window.typra.onFileChanged(async (filePath: string) => {
    const tab = state.tabs.find((t) => t.filePath === filePath)
    if (!tab || tab.id !== state.activeId) return
    const info = await window.typra.pathInfo(filePath)
    if (info.mtimeMs === tab.mtimeMs) return
    const answer = await window.typra.messageBox(
      '文件已在外部被修改',
      `「${tab.title}」在 Typra2 之外被改动，是否重新载入？`,
      ['重新载入', '保留当前内容']
    )
    if (answer === 0) {
      const { content, mtimeMs } = await window.typra.readFile(filePath)
      tab.content = content
      tab.savedContent = content
      tab.mtimeMs = mtimeMs
      editorRef.value?.reloadFromTab()
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
</style>
