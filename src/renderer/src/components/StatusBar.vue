<script setup lang="ts">
import { computed } from 'vue'
import { getActiveTab, isDirty, state } from '../store'
import { executeCommand } from '../composables/useCommands'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const tab = computed(() => getActiveTab())

const themeLabel = computed(() => t(`theme.${state.theme}`))

const savedLabel = computed(() => {
  const t0 = tab.value
  if (!t0) return ''
  if (!t0.filePath) return t('status.notSavedToFile')
  return isDirty(t0) ? t('status.unsaved') : t('status.saved')
})

const cursorLabel = computed(() => {
  const anchor = tab.value?.cursor?.anchor
  if (!anchor) return t('status.lineNone')
  // cursor 是源码模式的行列坐标，取行号展示（从 1 开始计数更符合直觉）
  return t('status.line', { n: anchor.line + 1 })
})
</script>

<template>
  <footer class="status-bar">
    <div class="status-left">
      <span class="status-item">{{ savedLabel }}</span>
      <span v-if="tab?.filePath" class="status-item path" :title="tab.filePath">
        {{ tab.filePath }}
      </span>
    </div>
    <div class="status-right">
      <button class="status-btn" :class="{ on: state.viewMode === 'source' }" @click="executeCommand('view:toggleSource')">
        {{ state.viewMode === 'source' ? t('status.source') : t('status.wysiwyg') }}
      </button>
      <button class="status-btn" :class="{ on: state.focusMode }" :title="`${t('menu.view.toggleFocus')} F8`" @click="executeCommand('view:toggleFocus')">
        {{ t('status.focus') }}
      </button>
      <button
        class="status-btn"
        :class="{ on: state.typewriterMode }"
        :title="`${t('menu.view.toggleTypewriter')} F9`"
        @click="executeCommand('view:toggleTypewriter')"
      >
        {{ t('status.typewriter') }}
      </button>
      <button class="status-btn" :title="t('status.switchTheme', { theme: themeLabel })" @click="executeCommand('view:toggleTheme')">
        {{ themeLabel }}
      </button>
      <span class="status-item">{{ t('status.words', { n: state.wordCount }) }}</span>
      <span class="status-item">{{ cursorLabel }}</span>
      <span class="status-item zoom">{{ Math.round(state.zoom * 100) }}%</span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
  flex: none;
  padding: 0 10px;
  border-top: 1px solid var(--ty-border);
  background: var(--ty-statusbar-bg);
  font-size: 11px;
  color: var(--ty-muted);
  user-select: none;
}
.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.status-item {
  white-space: nowrap;
}
.status-item.path {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 46vw;
}
.status-btn {
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ty-muted);
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
}
.status-btn:hover {
  background: var(--ty-hover);
  color: var(--ty-text);
}
.status-btn.on {
  color: var(--ty-accent);
  background: var(--ty-active);
}
.zoom {
  min-width: 34px;
  text-align: right;
}
</style>
