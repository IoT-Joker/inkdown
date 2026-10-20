<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { state } from '../store'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
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
    new CustomEvent('inkdown:find', {
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
  window.dispatchEvent(new CustomEvent('inkdown:find-close'))
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
window.addEventListener('inkdown:find-result', ((e: Event) => {
  matchCount.value = (e as CustomEvent).detail?.count ?? 0
}) as EventListener)
</script>

<template>
  <div v-if="state.findVisible" class="find-bar">
    <input
      ref="searchInput"
      v-model="keyword"
      class="find-input"
      :placeholder="t('find.placeholder')"
      @keydown="onKeydown"
    />
    <input
      v-if="isReplace"
      v-model="replacement"
      class="find-input"
      :placeholder="t('find.replacePlaceholder')"
      @keydown="onKeydown"
    />
    <div class="find-tools">
      <label class="find-toggle" :title="t('find.caseSensitive')">
        <input v-model="isCaseSensitive" type="checkbox" /> Aa
      </label>
      <label class="find-toggle" :title="t('find.wholeWord')">
        <input v-model="isWholeWord" type="checkbox" /> {{ t('find.wholeWordShort') }}
      </label>
      <label class="find-toggle" :title="t('find.regexp')">
        <input v-model="isRegexp" type="checkbox" /> .*
      </label>
    </div>
    <div class="find-actions">
      <button class="ty-btn" :title="`${t('find.previous')} (Shift+Enter)`" @click="emitFind('previous')">↑</button>
      <button class="ty-btn" :title="`${t('find.next')} (Enter)`" @click="emitFind('next')">↓</button>
      <button v-if="isReplace" class="ty-btn" @click="emitFind('replace')">{{ t('find.replace') }}</button>
      <button v-if="isReplace" class="ty-btn" @click="emitFind('replaceAll')">{{ t('find.replaceAll') }}</button>
      <span class="find-count">{{ t('find.count', { n: matchCount }) }}</span>
      <button class="ty-btn close" :title="`${t('find.close')} (Esc)`" @click="close">×</button>
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
