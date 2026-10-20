<script setup lang="ts">
import { computed } from 'vue'
import { getActiveTab, isDirty, state, closeTab, tabLabel } from '../store'
import { executeCommand } from '../composables/useCommands'
import { useFile } from '../composables/useFile'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const tabs = computed(() => state.tabs)

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
</script>

<template>
  <div class="tab-bar">
    <div class="tab-list">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === state.activeId }"
        :title="(tab.filePath || tab.title) + (isDirty(tab) ? t('tab.unsaved') : '')"
        @click="selectTab(tab.id)"
        @mousedown.middle="onClose(tab.id, $event)"
      >
        <span class="tab-title">{{ tabLabel(tab) }}</span>
        <button class="tab-close" :title="`${t('tab.close')} (Ctrl+W)`" @click="onClose(tab.id, $event)">×</button>
      </div>
    </div>
    <button class="tab-new" :title="`${t('tab.new')} (Ctrl+N)`" @click="executeCommand('file:new')">+</button>
    <button
      class="tab-settings"
      :title="`${t('tab.settings')} (Ctrl+,)`"
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
