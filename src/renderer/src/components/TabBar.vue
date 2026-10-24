<script setup lang="ts">
import { computed, ref } from 'vue'
import { getActiveTab, isDirty, state, closeTab, tabLabel, moveTab } from '../store'
import { displayShortcutFor, executeCommand } from '../composables/useCommands'
import { useFile } from '../composables/useFile'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const tabs = computed(() => state.tabs)

/** 正在拖拽的标签 id；null 表示没有拖拽。 */
const draggingId = ref<string | null>(null)
/** 拖拽悬停到的目标标签 id，用于显示插入位置。 */
const overId = ref<string | null>(null)
/** 插入到目标的左侧还是右侧。 */
const dropBefore = ref(true)

function selectTab(id: string): void {
  state.activeId = id
}

/** 关闭标签：先按惯例询问是否保存，用户取消则中止。 */
async function onClose(id: string, e: MouseEvent): Promise<void> {
  e.stopPropagation()
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return
  const { confirmClose } = useFile()
  if (!(await confirmClose(tab))) return
  closeTab(id)
}

/* ------------------------------ 标签拖拽排序 ------------------------------ */

function onDragStart(id: string, e: DragEvent): void {
  draggingId.value = id
  // 必须设置 data，否则部分平台上拖拽不会触发
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(id: string, e: DragEvent): void {
  if (!draggingId.value || draggingId.value === id) return
  // 允许投放
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  overId.value = id
  // 指针落在目标左半 → 插到前面，右半 → 插到后面
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropBefore.value = e.clientX < rect.left + rect.width / 2
}

function onDrop(id: string, e: DragEvent): void {
  e.preventDefault()
  const from = draggingId.value
  resetDrag()
  if (!from || from === id) return
  moveTab(from, id, dropBefore.value)
}

function onDragEnd(): void {
  resetDrag()
}

function resetDrag(): void {
  draggingId.value = null
  overId.value = null
}
</script>

<template>
  <div class="tab-bar">
    <div class="tab-list">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{
          active: tab.id === state.activeId,
          dragging: tab.id === draggingId,
          'drop-before': tab.id === overId && dropBefore,
          'drop-after': tab.id === overId && !dropBefore
        }"
        :title="(tab.filePath || tab.title) + (isDirty(tab) ? t('tab.unsaved') : '')"
        draggable="true"
        @click="selectTab(tab.id)"
        @mousedown.middle="onClose(tab.id, $event)"
        @dragstart="onDragStart(tab.id, $event)"
        @dragover="onDragOver(tab.id, $event)"
        @drop="onDrop(tab.id, $event)"
        @dragend="onDragEnd"
      >
        <span class="tab-title">{{ tabLabel(tab) }}</span>
        <button class="tab-close" :title="`${t('tab.close')} (${displayShortcutFor('file:closeTab')})`" @click="onClose(tab.id, $event)">×</button>
      </div>
    </div>
    <button class="tab-new" :title="`${t('tab.new')} (${displayShortcutFor('file:new')})`" @click="executeCommand('file:new')">+</button>
    <button
      class="tab-settings"
      :title="`${t('tab.settings')} (${displayShortcutFor('app:preferences')})`"
      @click="executeCommand('app:preferences')"
    >
      ⚙
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: stretch;
  height: 34px;
  background: var(--ty-tabbar-bg);
  border-bottom: 1px solid var(--ty-border);
  user-select: none;
  overflow: hidden;
}
.tab-list {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-list::-webkit-scrollbar {
  display: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 190px;
  min-width: 90px;
  padding: 0 8px 0 12px;
  border-right: 1px solid var(--ty-border);
  font-size: 12px;
  color: var(--ty-muted);
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover {
  background: var(--ty-hover);
}
.tab.active {
  color: var(--ty-text);
  background: var(--ty-bg);
  box-shadow: inset 0 2px 0 var(--ty-accent);
}
/* 拖拽中：半透明，并给出插入位置的指示线 */
.tab.dragging {
  opacity: 0.45;
}
.tab.drop-before {
  box-shadow: inset 2px 0 0 var(--ty-accent);
}
.tab.drop-after {
  box-shadow: inset -2px 0 0 var(--ty-accent);
}
.tab.active.drop-before {
  box-shadow: inset 2px 0 0 var(--ty-accent), inset 0 2px 0 var(--ty-accent);
}
.tab.active.drop-after {
  box-shadow: inset -2px 0 0 var(--ty-accent), inset 0 2px 0 var(--ty-accent);
}
.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-close {
  flex: none;
  width: 16px;
  height: 16px;
  line-height: 14px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  opacity: 0;
}
.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 0.7;
}
.tab-close:hover {
  background: var(--ty-hover-strong);
  opacity: 1;
}
.tab-new {
  flex: none;
  width: 32px;
  border: 0;
  border-left: 1px solid var(--ty-border);
  background: transparent;
  color: var(--ty-muted);
  font-size: 16px;
  cursor: pointer;
}
.tab-new:hover {
  background: var(--ty-hover);
  color: var(--ty-text);
}
.tab-settings {
  flex: none;
  width: 32px;
  border: 0;
  border-left: 1px solid var(--ty-border);
  background: transparent;
  color: var(--ty-muted);
  font-size: 14px;
  cursor: pointer;
}
.tab-settings:hover {
  background: var(--ty-hover);
  color: var(--ty-text);
}
</style>
