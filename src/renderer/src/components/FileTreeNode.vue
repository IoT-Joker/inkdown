<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue'
import { state } from '../store'
import { baseName } from '../composables/useFile'
import { executeCommand } from '../composables/useCommands'

interface Entry {
  name: string
  path: string
  isDirectory: boolean
  children?: Entry[]
}

const props = defineProps<{ entry: Entry; depth?: number }>()
const emit = defineEmits<{ refresh: [] }>()
const depth = computed(() => props.depth ?? 0)
const expanded = ref(depth.value < 1)
const renaming = ref(false)
const renameValue = ref('')
const menu = reactive({ visible: false, x: 0, y: 0 })

import { computed } from 'vue'

function toggle(): void {
  if (!props.entry.isDirectory) return
  expanded.value = !expanded.value
  if (expanded.value && (!props.entry.children || props.entry.children.length === 0)) {
    void loadChildren()
  }
}

async function loadChildren(): Promise<void> {
  const dir = await window.typra.readDir(props.entry.path, 1)
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
  const name = window.prompt(kind === 'file' ? '新建文件名（含 .md）' : '新建文件夹名')
  if (!name) return
  const sep = props.entry.path.includes('\\') ? '\\' : '/'
  const target = `${dir}${sep}${name}`
  try {
    if (kind === 'file') await window.typra.createFile(target)
    else await window.typra.createFolder(target)
    emit('refresh')
    if (props.entry.isDirectory) {
      expanded.value = true
      await loadChildren()
    }
  } catch (err) {
    window.alert(`创建失败：${(err as Error).message}`)
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
    await window.typra.rename(props.entry.path, target)
    emit('refresh')
  } catch (err) {
    window.alert(`重命名失败：${(err as Error).message}`)
  }
}

async function removeEntry(): Promise<void> {
  const ok = window.confirm(`确定删除「${props.entry.name}」？文件会移入系统回收站。`)
  if (!ok) return
  try {
    await window.typra.remove(props.entry.path)
    emit('refresh')
  } catch (err) {
    window.alert(`删除失败：${(err as Error).message}`)
  }
}

function revealInExplorer(): void {
  void window.typra.showItemInFolder(props.entry.path)
}
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{ active: isActive, dir: entry.isDirectory }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      :title="entry.path"
      @click="open"
      @contextmenu="openMenu"
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
      <div class="ctx-item" @click="createChild('file')">新建文件</div>
      <div class="ctx-item" @click="createChild('folder')">新建文件夹</div>
      <div class="ctx-sep" />
      <div class="ctx-item" @click="startRename">重命名</div>
      <div class="ctx-item" @click="revealInExplorer">在资源管理器中显示</div>
      <div class="ctx-sep" />
      <div class="ctx-item danger" @click="removeEntry">删除</div>
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
