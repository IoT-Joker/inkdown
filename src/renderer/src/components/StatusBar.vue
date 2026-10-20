<script setup lang="ts">
import { computed } from 'vue'
import { getActiveTab, isDirty, state, settings } from '../store'
import { executeCommand } from '../composables/useCommands'

const tab = computed(() => getActiveTab())

const themeLabel = computed(
  () =>
    ({
      light: '浅色',
      dark: '深色',
      github: 'GitHub',
      newsprint: '报刊',
      night: '夜间'
    })[state.theme] ?? state.theme
)

const savedLabel = computed(() => {
  const t = tab.value
  if (!t) return ''
  if (!t.filePath) return '未保存到文件'
  return isDirty(t) ? '未保存' : '已保存'
})

const cursorLabel = computed(() => {
  const t = tab.value
  if (!t?.cursor) return '行 —'
  // cursor 是源码模式的行列坐标，取行号展示（从 1 开始计数更符合直觉）
  return `行 ${t.cursor.anchor.line + 1}`
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
        {{ state.viewMode === 'source' ? '源码' : '所见即所得' }}
      </button>
      <button class="status-btn" :class="{ on: state.focusMode }" title="专注模式 F8" @click="executeCommand('view:toggleFocus')">
        专注
      </button>
      <button
        class="status-btn"
        :class="{ on: state.typewriterMode }"
        title="打字机模式 F9"
        @click="executeCommand('view:toggleTypewriter')"
      >
        打字机
      </button>
      <button class="status-btn" :title="`切换主题（当前 ${themeLabel}）`" @click="executeCommand('view:toggleTheme')">
        {{ themeLabel }}
      </button>
      <span class="status-item">{{ state.wordCount }} 字</span>
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
