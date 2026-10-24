<script setup lang="ts">
import { computed, nextTick, ref, reactive } from 'vue'
import { state } from '../store'
import { executeCommand } from '../composables/useCommands'
import { useI18n } from '../composables/useI18n'
import { useFile } from '../composables/useFile'

interface Entry {
  name: string
  path: string
  isDirectory: boolean
  children?: Entry[]
}

const props = defineProps<{ entry: Entry; depth?: number }>()
const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()
const depth = computed(() => props.depth ?? 0)
const expanded = ref(depth.value < 1)
const renaming = ref(false)
const renameValue = ref('')
const menu = reactive({ visible: false, x: 0, y: 0 })
/** 拖拽悬停到本节点时的状态：'into' 移入目录，'before'/'after' 调序（仅同级文件） */
const dropMode = ref<'' | 'into' | 'before' | 'after'>('')

/* ------------------------------ 拖拽移动 ------------------------------ */

/** 被拖拽的路径放在 dataTransfer 上，跨组件共享（比全局变量更可靠）。 */
const DRAG_MIME = 'application/x-inkdown-path'

function onDragStart(e: DragEvent): void {
  e.dataTransfer?.setData(DRAG_MIME, props.entry.path)
  // 同时写纯文本，便于拖到外部程序时至少有个路径
  e.dataTransfer?.setData('text/plain', props.entry.path)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

/** 判断拖拽源是否是本节点的子孙（禁止把目录拖进自己内部）。 */
function isSelfOrDescendant(sourcePath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const a = norm(sourcePath)
  const b = norm(props.entry.path)
  return a === b || b.startsWith(a + '/')
}

function onDragOver(e: DragEvent): void {
  const source = e.dataTransfer?.getData(DRAG_MIME)
  if (!source) return
  // 不能拖到自己或自己的子孙上
  if (isSelfOrDescendant(source)) {
    dropMode.value = ''
    return
  }
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / rect.height
  if (props.entry.isDirectory) {
    // 目录：上 1/4 调序、下 1/4 调序，中间移入
    if (ratio < 0.25) dropMode.value = 'before'
    else if (ratio > 0.75) dropMode.value = 'after'
    else dropMode.value = 'into'
  } else {
    // 文件：上半插到前面，下半插到后面
    dropMode.value = ratio < 0.5 ? 'before' : 'after'
  }
}

function onDragLeave(): void {
  dropMode.value = ''
}

async function onDrop(e: DragEvent): Promise<void> {
  const source = e.dataTransfer?.getData(DRAG_MIME)
  // 先取出投放意图再清空状态。注意必须显式标注类型：
  // 清空 dropMode 后 TS 会把从它取出的值收窄成 ''，导致后续比较被判为永假。
  const mode: '' | 'into' | 'before' | 'after' = dropMode.value
  dropMode.value = ''
  if (!source || isSelfOrDescendant(source)) return
  e.preventDefault()

  const sep = props.entry.path.includes('\\') ? '\\' : '/'
  const baseName = source.split(/[\\/]/).pop() || ''

  // 计算目标路径：移入目录 → 目录内；调序 → 与目标同级
  let targetDir: string
  if (mode === 'into' && props.entry.isDirectory) {
    targetDir = props.entry.path
  } else {
    targetDir = parentDir()
  }
  const targetPath = `${targetDir}${sep}${baseName}`

  if (targetPath === source) return

  try {
    if (await window.inkdown.exists(targetPath)) {
      window.alert(t('tree.errExists', { name: baseName }))
      return
    }
    await useFile().renamePath(source, targetPath)
    emit('refresh')
  } catch (err) {
    window.alert(t('tree.errMove', { msg: (err as Error).message }))
  }
}

function toggle(): void {
  if (!props.entry.isDirectory) return
  expanded.value = !expanded.value
  if (expanded.value && (!props.entry.children || props.entry.children.length === 0)) {
    void loadChildren()
  }
}

async function loadChildren(): Promise<void> {
  const dir = await window.inkdown.readDir(props.entry.path, 1)
  props.entry.children = dir.children
}

async function open(): Promise<void> {
  if (props.entry.isDirectory) {
    toggle()
    return
  }
  const { useFile } = await import('../composables/useFile')
  await useFile().openPath(props.entry.path)
}

const isActive = computed(() => {
  const tab = state.tabs.find((t) => t.id === state.activeId)
  return tab?.filePath === props.entry.path
})

const icon = computed(() => {
  if (props.entry.isDirectory) return expanded.value ? '▾' : '▸'
  const name = props.entry.name.toLowerCase()
  if (name.endsWith('.md') || name.endsWith('.markdown')) return '▤'
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return '▨'
  return '▢'
})

/** 右键菜单：新建、重命名、删除、在系统中显示。 */
function openMenu(e: MouseEvent): void {
  e.preventDefault()
  menu.visible = true
  menu.x = e.clientX
  menu.y = e.clientY
  const close = () => {
    menu.visible = false
    window.removeEventListener('click', close)
    window.removeEventListener('contextmenu', close)
  }
  nextTick(() => {
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
  })
}

/** 父目录：目录自身取 parent，文件取所在目录。 */
function parentDir(): string {
  const p = props.entry.path
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return p.slice(0, idx)
}

async function createChild(kind: 'file' | 'folder'): Promise<void> {
  const dir = props.entry.isDirectory ? props.entry.path : parentDir()
  const name = window.prompt(kind === 'file' ? t('tree.promptFileName') : t('tree.promptFolderName'))
  if (!name) return
  const sep = props.entry.path.includes('\\') ? '\\' : '/'
  const target = `${dir}${sep}${name}`
  try {
    if (kind === 'file') await window.inkdown.createFile(target)
    else await window.inkdown.createFolder(target)
    emit('refresh')
    if (props.entry.isDirectory) {
      expanded.value = true
      await loadChildren()
    }
  } catch (err) {
    window.alert(t('tree.errCreate', { msg: (err as Error).message }))
  }
}

function startRename(): void {
  renameValue.value = props.entry.name
  renaming.value = true
}

async function commitRename(): Promise<void> {
  const name = renameValue.value.trim()
  renaming.value = false
  if (!name || name === props.entry.name) return
  const sep = props.entry.path.includes('\\') ? '\\' : '/'
  const target = `${parentDir()}${sep}${name}`
  try {
    if (await window.inkdown.exists(target)) {
      window.alert(t('tree.errExists', { name }))
      return
    }
    await useFile().renamePath(props.entry.path, target)
    emit('refresh')
  } catch (err) {
    window.alert(t('tree.errRename', { msg: (err as Error).message }))
  }
}

async function removeEntry(): Promise<void> {
  const ok = window.confirm(t('tree.confirmDelete', { name: props.entry.name }))
  if (!ok) return
  try {
    if (!(await useFile().removePath(props.entry.path))) return
    emit('refresh')
  } catch (err) {
    window.alert(t('tree.errDelete', { msg: (err as Error).message }))
  }
}

function revealInExplorer(): void {
  void window.inkdown.showItemInFolder(props.entry.path)
}
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{
        active: isActive,
        dir: entry.isDirectory,
        'drop-into': dropMode === 'into',
        'drop-before': dropMode === 'before',
        'drop-after': dropMode === 'after'
      }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      :title="entry.path"
      draggable="true"
      @click="open"
      @contextmenu="openMenu"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <span class="tree-icon">{{ icon }}</span>
      <input
        v-if="renaming"
        v-model="renameValue"
        class="rename-input"
        autofocus
        @click.stop
        @keydown.enter="commitRename"
        @keydown.esc="renaming = false"
        @blur="commitRename"
      />
      <span v-else class="tree-name">{{ entry.name }}</span>
    </div>

    <template v-if="entry.isDirectory && expanded && entry.children">
      <FileTreeNode
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        @refresh="emit('refresh')"
      />
    </template>

    <div
      v-if="menu.visible"
      class="context-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <div class="ctx-item" @click="createChild('file')">{{ t('tree.newFile') }}</div>
      <div class="ctx-item" @click="createChild('folder')">{{ t('tree.newFolder') }}</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="startRename">{{ t('tree.rename') }}</div>
      <div class="ctx-item" @click="revealInExplorer">{{ t('tree.reveal') }}</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="removeEntry">{{ t('tree.delete') }}</div>
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding-right: 8px;
  font-size: 13px;
  color: var(--ty-text);
  cursor: pointer;
  white-space: nowrap;
}
.tree-row:hover {
  background: var(--ty-hover);
}
.tree-row.active {
  background: var(--ty-active);
}
.tree-row.dir {
  font-weight: 500;
}
/* 拖拽投放提示：移入用整行高亮，调序用上下指示线 */
.tree-row.drop-into {
  background: var(--ty-active);
  box-shadow: inset 0 0 0 1px var(--ty-accent);
}
.tree-row.drop-before {
  box-shadow: inset 0 2px 0 var(--ty-accent);
}
.tree-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--ty-accent);
}
.tree-icon {
  flex: none;
  width: 12px;
  color: var(--ty-muted);
  font-size: 11px;
}
.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.rename-input {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  border: 1px solid var(--ty-accent);
  border-radius: 3px;
  background: var(--ty-bg);
  color: var(--ty-text);
  font-size: 12px;
  outline: none;
}
.context-menu {
  position: fixed;
  z-index: 200;
  min-width: 170px;
  padding: 4px;
  border: 1px solid var(--ty-border);
  border-radius: 6px;
  background: var(--ty-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}
.ctx-item {
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--ty-text);
  cursor: pointer;
}
.ctx-item:hover {
  background: var(--ty-hover);
}
.ctx-item.danger {
  color: #d1242f;
}
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--ty-border);
}
</style>
