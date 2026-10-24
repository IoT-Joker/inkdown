<script setup lang="ts">
import { computed } from 'vue'
import { getActiveTab, isDirty, state } from '../store'
import { displayShortcutFor, executeCommand } from '../composables/useCommands'
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

const viewLabel = computed(() => {
  if (state.viewMode === 'source') return t('status.source')
  if (state.viewMode === 'split') return t('view.splitPreview')
  return t('status.wysiwyg')
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
      <div class="view-switch" role="group" :aria-label="t('menu.view')">
        <button class="status-btn" :class="{ on: state.viewMode === 'wysiwyg' }"
          @click="state.viewMode = 'wysiwyg'">{{ t('status.wysiwyg') }}</button>
        <button class="status-btn source-preview-toggle" :class="{ on: state.viewMode === 'split' }"
          @click="state.viewMode = 'split'">{{ t('view.splitPreview') }}</button>
        <button class="status-btn" :class="{ on: state.viewMode === 'source' }"
          @click="state.viewMode = 'source'">{{ t('status.source') }}</button>
      </div>
      <button v-if="state.viewMode === 'wysiwyg'" class="status-btn columns-toggle"
        :class="{ on: state.wysiwygColumns }" :aria-pressed="state.wysiwygColumns"
        :title="t('view.continuousColumnsHint')" @click="executeCommand('view:toggleColumns')">
        <svg viewBox="0 0 16 14" aria-hidden="true">
          <rect x="1.2" y="1.2" width="13.6" height="11.6" rx="2" />
          <path d="M8 1.8v10.4M3.2 4.4h2.6M3.2 6.5h2.6M10.2 4.4h2.6M10.2 6.5h2.6" />
        </svg>
        {{ t('view.continuousColumns') }}
      </button>
      <button class="status-btn" :class="{ on: state.focusMode }" :title="`${t('menu.view.toggleFocus')} ${displayShortcutFor('view:toggleFocus')}`" @click="executeCommand('view:toggleFocus')">
        {{ t('status.focus') }}
      </button>
      <button
        class="status-btn"
        :class="{ on: state.typewriterMode }"
        :title="`${t('menu.view.toggleTypewriter')} ${displayShortcutFor('view:toggleTypewriter')}`"
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.columns-toggle svg {
  width: 15px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.split-toggle span {
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zoom {
  min-width: 34px;
  text-align: right;
}
</style>

<style scoped>
.view-switch { display: flex; gap: 1px; padding: 2px; border: 1px solid var(--ty-border); border-radius: 5px; }
.view-switch .status-btn { padding: 1px 6px; }
@media (max-width: 800px) { .status-right { gap: 3px; } .status-item.path { max-width: 25vw; } }
</style>
