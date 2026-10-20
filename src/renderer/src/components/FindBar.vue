<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { state } from '../store'
import { executeCommand } from '../composables/useCommands'

const searchInput = ref<HTMLInputElement | null>(null)
const keyword = ref('')
const replacement = ref('')
const isRegexp = ref(false)
const isCaseSensitive = ref(false)
const isWholeWord = ref(false)
const matchCount = ref(0)

const isReplace = computed(() => state.findMode === 'replace')

/** 查找请求转发给编辑器：EditorHost 监听该事件并调用 muya.search。 */
function emitFind(action: 'search' | 'next' | 'previous' | 'replace' | 'replaceAll'): void {
  window.dispatchEvent(
    new CustomEvent('typra:find', {
      detail: {
        action,
        keyword: keyword.value,
        replacement: replacement.value,
        isRegexp: isRegexp.value,
        isCaseSensitive: isCaseSensitive.value,
        isWholeWord: isWholeWord.value
      }
    })
  )
}

let timer: number | undefined
watch([keyword, isRegexp, isCaseSensitive, isWholeWord], () => {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => emitFind('search'), 120)
})

watch(
  () => state.findVisible,
  (visible) => {
    if (visible) nextTick(() => searchInput.value?.focus())
    else keyword.value = ''
  }
)

function close(): void {
  state.findVisible = false
  window.dispatchEvent(new CustomEvent('typra:find-close'))
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    emitFind(e.shiftKey ? 'previous' : 'next')
  }
}

// 由 EditorHost 回传匹配数量
window.addEventListener('typra:find-result', ((e: Event) => {
  matchCount.value = (e as CustomEvent).detail?.count ?? 0
}) as EventListener)
</script>

<template>
  <div v-if="state.findVisible" class="find-bar">
    <input
      ref="searchInput"
      v-model="keyword"
      class="find-input"
      placeholder="查找"
      @keydown="onKeydown"
    />
    <input
      v-if="isReplace"
      v-model="replacement"
      class="find-input"
      placeholder="替换为"
      @keydown="onKeydown"
    />
    <div class="find-tools">
      <label class="find-toggle" title="区分大小写">
        <input v-model="isCaseSensitive" type="checkbox" /> Aa
      </label>
      <label class="find-toggle" title="全词匹配">
        <input v-model="isWholeWord" type="checkbox" /> 全词
      </label>
      <label class="find-toggle" title="正则表达式">
        <input v-model="isRegexp" type="checkbox" /> .*
      </label>
    </div>
    <div class="find-actions">
      <button class="ty-btn" title="上一个 (Shift+Enter)" @click="emitFind('previous')">↑</button>
      <button class="ty-btn" title="下一个 (Enter)" @click="emitFind('next')">↓</button>
      <button v-if="isReplace" class="ty-btn" @click="emitFind('replace')">替换</button>
      <button v-if="isReplace" class="ty-btn" @click="emitFind('replaceAll')">全部替换</button>
      <span class="find-count">{{ matchCount }} 处</span>
      <button class="ty-btn close" title="关闭 (Esc)" @click="close">×</button>
    </div>
  </div>
</template>

<style scoped>
.find-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 6px 10px;
  border-top: 1px solid var(--ty-border);
  background: var(--ty-sidebar-bg);
  font-size: 12px;
}
.find-input {
  width: 180px;
  padding: 4px 8px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-bg);
  color: var(--ty-text);
  font-size: 12px;
  outline: none;
}
.find-input:focus {
  border-color: var(--ty-accent);
}
.find-tools,
.find-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.find-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--ty-muted);
  cursor: pointer;
  user-select: none;
}
.find-count {
  color: var(--ty-muted);
  min-width: 42px;
  text-align: right;
}
.close {
  margin-left: 4px;
}
</style>
