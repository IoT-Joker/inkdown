<script setup lang="ts">
import { computed, ref } from 'vue'
import { state } from '../store'
import { executeCommand } from '../composables/useCommands'
import FileTreeNode from './FileTreeNode.vue'

const filter = ref('')

const filteredChildren = computed(() => {
  const children = state.workspace?.children ?? []
  if (!filter.value.trim()) return children
  const q = filter.value.toLowerCase()
  const match = (e: any): any => {
    if (e.name.toLowerCase().includes(q)) return e
    if (e.children) {
      const kids = e.children.map(match).filter(Boolean)
      if (kids.length) return { ...e, children: kids }
    }
    return null
  }
  return children.map(match).filter(Boolean)
})

/** 点击大纲跳转到对应标题。muya 的标题块没有 slug 属性，
 *  因此按标题块在文档中的出现顺序定位，再交给编辑器滚动显示。 */
function onOutlineClick(index: number): void {
  const headings = document.querySelectorAll('.muya-container .mu-atx-heading, .muya-container .mu-setext-heading')
  const el = headings[index] as HTMLElement | undefined
  if (!el) return
  const muya = (window as unknown as { __typraMuya?: { revealElement(e: Element): void } }).__typraMuya
  muya?.revealElement(el)
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 大纲缩进：按标题层级左移，形成树状观感。 */
function outlineIndent(level: number): string {
  return `${8 + (level - 1) * 14}px`
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: !state.sidebarVisible }">
    <div class="sidebar-tabs">
      <button
        class="sidebar-tab"
        :class="{ active: state.sidebarTab === 'files' }"
        @click="state.sidebarTab = 'files'"
      >
        文件
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: state.sidebarTab === 'outline' }"
        @click="state.sidebarTab = 'outline'"
      >
        大纲
      </button>
      <button class="sidebar-hide" title="隐藏侧边栏" @click="state.sidebarVisible = false">«</button>
    </div>

    <div v-show="state.sidebarTab === 'files'" class="sidebar-body">
      <div class="sidebar-actions">
        <button class="mini-btn" title="打开文件夹" @click="executeCommand('file:openFolder')">
          打开文件夹
        </button>
        <button
          class="mini-btn"
          title="刷新"
          :disabled="!state.workspace"
          @click="$emit('refresh')"
        >
          刷新
        </button>
      </div>
      <input v-if="state.workspace" v-model="filter" class="sidebar-filter" placeholder="按名称筛选…" />
      <div class="tree">
        <template v-if="state.workspace">
          <div class="workspace-name">{{ state.workspace.name }}</div>
          <FileTreeNode
            v-for="child in filteredChildren"
            :key="child.path"
            :entry="child"
            :depth="0"
            @refresh="$emit('refresh')"
          />
        </template>
        <p v-else class="sidebar-empty">尚未打开文件夹</p>
      </div>
    </div>

    <div v-show="state.sidebarTab === 'outline'" class="sidebar-body">
      <div class="tree">
        <p v-if="!state.outline.length" class="sidebar-empty">当前文档没有标题</p>
        <div
          v-for="(item, index) in state.outline"
          :key="item.slug + index"
          class="outline-row"
          :class="`lvl-${item.level}`"
          :style="{ paddingLeft: outlineIndent(item.level) }"
          :title="item.text"
          @click="onOutlineClick(index)"
        >
          {{ item.text }}
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 250px;
  flex: none;
  border-right: 1px solid var(--ty-border);
  background: var(--ty-sidebar-bg);
  overflow: hidden;
}
.sidebar.collapsed {
  display: none;
}
.sidebar-tabs {
  display: flex;
  align-items: center;
  height: 34px;
  border-bottom: 1px solid var(--ty-border);
  flex: none;
}
.sidebar-tab {
  flex: 1;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--ty-muted);
  font-size: 12px;
  cursor: pointer;
}
.sidebar-tab.active {
  color: var(--ty-text);
  box-shadow: inset 0 -2px 0 var(--ty-accent);
}
.sidebar-hide {
  flex: none;
  width: 26px;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--ty-muted);
  cursor: pointer;
}
.sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sidebar-actions {
  display: flex;
  gap: 6px;
  padding: 8px;
  flex: none;
}
.mini-btn {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) {
  background: var(--ty-hover);
}
.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.sidebar-filter {
  margin: 0 8px 6px;
  padding: 4px 8px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-bg);
  color: var(--ty-text);
  font-size: 12px;
  outline: none;
  flex: none;
}
.tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 12px;
}
.workspace-name {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ty-muted);
}
.outline-row {
  height: 24px;
  line-height: 24px;
  padding-right: 8px;
  font-size: 13px;
  color: var(--ty-text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outline-row:hover {
  background: var(--ty-hover);
}
.sidebar-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--ty-muted);
}
</style>
