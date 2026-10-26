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

/**
 * 查找请求转发给编辑器：EditorHost 监听该事件并调用 muya.search。
 * 关键词同时写进 store，切标签后由 EditorHost 按它重搜。
 */
function emitFind(
  action: 'search' | 'next' | 'previous' | 'replace' | 'replaceAll' | 'goto',
  targetIndex?: number
): void {
  state.findKeyword = keyword.value
  state.findOptions = {
    isRegexp: isRegexp.value,
    isCaseSensitive: isCaseSensitive.value,
    isWholeWord: isWholeWord.value
  }
  window.dispatchEvent(
    new CustomEvent('inkdown:find', {
      detail: {
        action,
        targetIndex,
        keyword: keyword.value,
        replacement: replacement.value,
        isRegexp: isRegexp.value,
        isCaseSensitive: isCaseSensitive.value,
        isWholeWord: isWholeWord.value
      }
    })
  )
}

/** 匹配数与当前序号（由 EditorHost 回传）。 */
const matchIndex = ref(0)

/** 结果列表项（行号 + 上下文），由 EditorHost 整理后回传。 */
interface FindResultItem {
  index: number
  match: string
  line: number
  column: number
  before: string
  after: string
}
const results = ref<FindResultItem[]>([])
/** 结果列表是否展开。 */
const resultsOpen = ref(false)

let timer: number | undefined
watch([keyword, isRegexp, isCaseSensitive, isWholeWord], () => {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => emitFind('search'), 120)
})

/**
 * 兜底：直接监听输入框的原生 input 事件。
 * 自动化测试（以及某些输入法）通过原生 setter 改值再派发 input，
 * Vue 的 v-model 在个别情况下收不到，导致搜索不触发。
 */
function onInputNative(e: Event): void {
  const el = e.target as HTMLInputElement
  if (el.classList.contains('find-input')) {
    const idx = [...document.querySelectorAll('.find-input')].indexOf(el)
    if (idx === 0) keyword.value = el.value
    else if (idx === 1) replacement.value = el.value
  }
}

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
    // 若当前没有有效匹配（例如刚切标签回来），回车先重搜再跳转
    if (!matchCount.value && keyword.value) {
      emitFind('search')
      window.setTimeout(() => emitFind(e.shiftKey ? 'previous' : 'next'), 250)
      return
    }
    emitFind(e.shiftKey ? 'previous' : 'next')
  }
}

// 由 EditorHost 回传匹配数量、当前序号与结果列表
window.addEventListener('inkdown:find-result', ((e: Event) => {
  const d = (e as CustomEvent).detail ?? {}
  matchCount.value = d.count ?? 0
  matchIndex.value = d.index ?? 0
  results.value = Array.isArray(d.items) ? d.items : []
  // 关键词变了就重新收起列表，避免显示上一次的陈旧结果
  if (!results.value.length) resultsOpen.value = false
}) as EventListener)

/** 点击结果项：跳到该命中。 */
function gotoResult(item: FindResultItem): void {
  resultsOpen.value = false
  emitFind('goto', item.index)
}
</script>

<template>
  <div v-if="state.findVisible" class="find-bar" @input="onInputNative">
    <!-- 放大镜图标：表明这是查找输入框 -->
    <span class="find-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="13" height="13">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          d="M6.8 11.6a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6Zm3.4-1.4L14 14"
        />
      </svg>
    </span>
    <input
      ref="searchInput"
      v-model="keyword"
      class="find-input"
      :placeholder="t('find.placeholder')"
      @keydown="onKeydown"
    />
    <span v-if="isReplace" class="find-icon replace-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="13" height="13">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2 5h9l-2.2-2.2M14 11H5l2.2 2.2"
        />
      </svg>
    </span>
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
      <!-- 结果列表开关：有命中时才出现 -->
      <button
        v-if="results.length"
        class="ty-btn find-results-toggle"
        :class="{ on: resultsOpen }"
        :title="t('find.resultsHint')"
        @click="resultsOpen = !resultsOpen"
      >
        {{ resultsOpen ? '▴' : '▾' }}
      </button>
      <span class="find-count">{{ matchCount ? `${matchIndex} / ${matchCount}` : t('find.count', { n: 0 }) }}</span>
      <button class="ty-btn close" :title="`${t('find.close')} (Esc)`" @click="close">×</button>
    </div>

    <!--
      结果列表：列出每处命中的行号与上下文，点击直接跳转。
      比逐个「下一处」更适合通览，尤其是同一关键词跨很多段落时。
    -->
    <div v-if="resultsOpen && results.length" class="find-results">
      <button
        v-for="item in results"
        :key="item.index"
        class="find-result-row"
        :class="{ active: item.index + 1 === matchIndex }"
        @click="gotoResult(item)"
      >
        <span class="find-result-line">{{ item.line }}:{{ item.column }}</span>
        <span class="find-result-text">
          <span class="find-result-before">{{ item.before }}</span><mark>{{ item.match }}</mark
          ><span class="find-result-after">{{ item.after }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.find-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  /* 结果列表需要独占一行，因此允许换行 */
  flex-wrap: wrap;
  padding: 6px 10px;
  border-top: 1px solid var(--ty-border);
  background: var(--ty-sidebar-bg);
  font-size: 12px;
}
/* 结果列表：独占一行，可滚动 */
.find-results {
  flex-basis: 100%;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 4px;
  border-top: 1px solid var(--ty-border);
  padding-top: 4px;
}
.find-result-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.find-result-row:hover {
  background: var(--ty-hover);
}
.find-result-row.active {
  background: var(--ty-active);
}
.find-result-line {
  flex: none;
  min-width: 52px;
  color: var(--ty-muted);
  font-variant-numeric: tabular-nums;
}
.find-result-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.find-result-text mark {
  padding: 0 1px;
  border-radius: 2px;
  background: var(--ty-find-match);
  color: inherit;
}
.find-result-before,
.find-result-after {
  color: var(--ty-muted);
}
.find-results-toggle.on {
  background: var(--ty-active);
}
/* 放大镜图标：放在输入框左侧，表明这是查找框 */
.find-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--ty-muted);
}
.replace-icon {
  margin-left: 4px;
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
