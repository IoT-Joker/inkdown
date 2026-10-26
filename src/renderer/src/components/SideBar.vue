<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { state } from '../store'
import { executeCommand } from '../composables/useCommands'
import { useI18n } from '../composables/useI18n'
import FileTreeNode from './FileTreeNode.vue'

const { t } = useI18n()
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
  if (state.viewMode === 'wysiwyg') {
    window.dispatchEvent(new CustomEvent('inkdown:reading-heading', { detail: { id: state.activeId, index } }))
    return
  }
  const headings = document.querySelectorAll('.muya-container .mu-atx-heading, .muya-container .mu-setext-heading')
  const el = headings[index] as HTMLElement | undefined
  if (!el) return
  const muya = (window as unknown as { __inkdownMuya?: { revealElement(e: Element): void } }).__inkdownMuya
  muya?.revealElement(el)
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 大纲缩进：按标题层级左移，形成树状观感。 */
function outlineIndent(level: number): string {
  return `${8 + (level - 1) * 14}px`
}

/* ------------------------------ 大纲折叠 ------------------------------ */

/**
 * 折叠状态按「标签 + 标题 slug」记录。
 *
 * 按标签分组的原因：不同文档可能有同名标题，
 * 若只按 slug 存，切文档后会出现「上一份的折叠带到这里」。
 */
const collapsed = ref<Set<string>>(new Set())

/** 折叠键：同一文档内唯一标识一个标题。 */
function outlineKey(item: { slug: string; level: number }, index: number): string {
  return `${state.activeId}::${index}::${item.slug}`
}

/** 换文档时清空折叠，避免串到别的文档。 */
watch(
  () => state.activeId,
  () => collapsed.value.clear()
)

/**
 * 每个大纲项是否有子标题。
 *
 * 判定方式：向后扫，直到遇到层级 <= 当前层级的标题；
 * 中途若出现层级更深的，说明有子节点。
 */
const outlineHasChildren = computed<boolean[]>(() => {
  const list = state.outline
  const result: boolean[] = new Array(list.length).fill(false)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[j].level <= list[i].level) break
      result[i] = true
      break
    }
  }
  return result
})

/**
 * 实际渲染的大纲项下标。
 *
 * 被折叠节点之后的、层级更深的项全部隐藏 —— 这正是「折叠」的含义。
 */
const visibleOutline = computed<number[]>(() => {
  const list = state.outline
  const visible: number[] = []
  // 记录当前生效的折叠层级：一旦某个祖先被折叠，所有更深的都跳过
  let hideDepth: number | null = null
  for (let i = 0; i < list.length; i++) {
    const level = list[i].level
    // 遇到层级不深于折叠点的标题，说明已离开该折叠区间
    if (hideDepth !== null && level <= hideDepth) hideDepth = null
    if (hideDepth !== null) continue
    visible.push(i)
    if (outlineHasChildren.value[i] && collapsed.value.has(outlineKey(list[i], i))) {
      hideDepth = level
    }
  }
  return visible
})

/** 切换某个标题的折叠状态。 */
function toggleOutline(index: number): void {
  const item = state.outline[index]
  if (!item) return
  const key = outlineKey(item, index)
  // Set 的变更不会被 Vue 追踪，必须换一个新 Set
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

/** 一键收起所有有子节点的标题。 */
function collapseAll(): void {
  const next = new Set<string>()
  for (let i = 0; i < state.outline.length; i++) {
    if (outlineHasChildren.value[i]) {
      next.add(outlineKey(state.outline[i], i))
    }
  }
  collapsed.value = next
}

/** 一键展开。 */
function expandAll(): void {
  collapsed.value = new Set()
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
        {{ t('sidebar.files') }}
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: state.sidebarTab === 'outline' }"
        @click="state.sidebarTab = 'outline'"
      >
        {{ t('sidebar.outline') }}
      </button>
      <button class="sidebar-hide" :title="t('sidebar.hide')" @click="state.sidebarVisible = false">«</button>
    </div>

    <div v-show="state.sidebarTab === 'files'" class="sidebar-body">
      <div class="sidebar-actions">
        <button class="mini-btn" :title="t('sidebar.openFolder')" @click="executeCommand('file:openFolder')">
          {{ t('sidebar.openFolder') }}
        </button>
        <button
          class="mini-btn"
          :title="t('sidebar.refresh')"
          :disabled="!state.workspace"
          @click="$emit('refresh')"
        >
          {{ t('sidebar.refresh') }}
        </button>
      </div>
      <input v-if="state.workspace" v-model="filter" class="sidebar-filter" :placeholder="t('sidebar.filter')" />
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
        <p v-else class="sidebar-empty">{{ t('sidebar.noFolder') }}</p>
      </div>
    </div>

    <div v-show="state.sidebarTab === 'outline'" class="sidebar-body">
      <!-- 大纲工具条：一键折叠/展开，长文档时按层级收起更易浏览 -->
      <div v-if="state.outline.length" class="outline-tools">
        <button class="mini-btn" :title="t('sidebar.collapseAll')" @click="collapseAll">
          {{ t('sidebar.collapseAllShort') }}
        </button>
        <button class="mini-btn" :title="t('sidebar.expandAll')" @click="expandAll">
          {{ t('sidebar.expandAllShort') }}
        </button>
      </div>
      <div class="tree">
        <p v-if="!state.outline.length" class="sidebar-empty">{{ t('sidebar.noHeadings') }}</p>
        <div
          v-for="index in visibleOutline"
          :key="state.outline[index].slug + index"
          class="outline-row"
          :class="[
            `lvl-${state.outline[index].level}`,
            { active: state.viewMode === 'wysiwyg' && state.readingHeadingIndex === index }
          ]"
          :aria-current="state.viewMode === 'wysiwyg' && state.readingHeadingIndex === index ? 'location' : undefined"
          :style="{ paddingLeft: outlineIndent(state.outline[index].level) }"
          :title="state.outline[index].text"
          @click="onOutlineClick(index)"
        >
          <!-- 有子标题才画折叠箭头；叶子节点留出等宽占位以保持对齐 -->
          <button
            v-if="outlineHasChildren[index]"
            class="outline-toggle"
            :title="collapsed.has(outlineKey(state.outline[index], index)) ? t('sidebar.expand') : t('sidebar.collapse')"
            @click.stop="toggleOutline(index)"
          >
            <span :class="{ collapsed: collapsed.has(outlineKey(state.outline[index], index)) }">▾</span>
          </button>
          <span v-else class="outline-toggle placeholder" />
          <span class="outline-text">{{ state.outline[index].text }}</span>
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
  display: flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  line-height: 24px;
  padding-right: 8px;
  font-size: 13px;
  color: var(--ty-text);
  cursor: pointer;
  overflow: hidden;
}
/* 折叠箭头：有子标题时显示，叶子节点用占位保持对齐 */
.outline-toggle {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ty-muted);
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
}
.outline-toggle:hover {
  background: var(--ty-hover);
  color: var(--ty-text);
}
.outline-toggle.placeholder {
  visibility: hidden;
  cursor: default;
}
.outline-toggle > span {
  display: inline-block;
  transition: transform 0.12s ease;
}
/* 折叠时箭头转向右 */
.outline-toggle > span.collapsed {
  transform: rotate(-90deg);
}
.outline-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 大纲工具条 */
.outline-tools {
  display: flex;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--ty-border);
}
.outline-row.active { background: var(--ty-active); color: var(--ty-accent); font-weight: 600; }
.outline-row:hover {
  background: var(--ty-hover);
}
.sidebar-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--ty-muted);
}
</style>
