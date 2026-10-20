<script setup lang="ts">
import { computed, ref } from 'vue'
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
const depth = computed(() => props.depth ?? 0)
const expanded = ref(depth.value < 1)

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
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{ active: isActive, dir: entry.isDirectory }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      :title="entry.path"
      @click="open"
    >
      <span class="tree-icon">{{ icon }}</span>
      <span class="tree-name">{{ entry.name }}</span>
    </div>
    <template v-if="entry.isDirectory && expanded && entry.children">
      <FileTreeNode
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
      />
    </template>
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
</style>
