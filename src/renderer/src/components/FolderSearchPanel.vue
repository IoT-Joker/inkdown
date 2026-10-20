<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { state } from '../store'
import { useI18n } from '../composables/useI18n'

/**
 * 全库搜索面板。
 *
 * 在已打开的文件夹内递归搜索所有 Markdown 文件，结果按文件分组展示，
 * 点击某条命中即打开该文件并跳到对应行。
 * 后端为纯 Node 实现（src/main/folderSearch.ts），不依赖 ripgrep。
 */

interface SearchHit {
  filePath: string
  relativePath: string
  line: number
  column: number
  lineText: string
  matchStart: number
  matchLength: number
}

interface SearchResult {
  hits: SearchHit[]
  filesScanned: number
  filesMatched: number
  truncated: boolean
}

const { t } = useI18n()
const keyword = ref('')
const isCaseSensitive = ref(false)
const isRegexp = ref(false)
const searching = ref(false)
const result = ref<SearchResult | null>(null)
const errorMsg = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

/** 按文件路径分组，便于折叠展示。 */
const groups = computed(() => {
  const map = new Map<string, SearchHit[]>()
  for (const h of result.value?.hits ?? []) {
    const list = map.get(h.relativePath)
    if (list) list.push(h)
    else map.set(h.relativePath, [h])
  }
  return [...map.entries()].map(([path, hits]) => ({ path, hits }))
})

/** 展开状态：默认全部展开。 */
const collapsed = ref<Set<string>>(new Set())
function toggleGroup(path: string): void {
  const s = new Set(collapsed.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  collapsed.value = s
}

/** 命中行的高亮片段（前缀 / 命中 / 后缀），避免用 v-html。 */
function segments(hit: SearchHit): { before: string; match: string; after: string } {
  const start = Math.max(0, hit.matchStart)
  const end = Math.min(hit.lineText.length, start + hit.matchLength)
  return {
    before: hit.lineText.slice(0, start),
    match: hit.lineText.slice(start, end),
    after: hit.lineText.slice(end)
  }
}

let timer: number | undefined
watch([keyword, isCaseSensitive, isRegexp], () => {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => void runSearch(), 300)
})

watch(
  () => state.folderSearchVisible,
  (visible) => {
    if (visible) nextTick(() => inputRef.value?.focus())
  }
)

/** 执行搜索。 */
async function runSearch(): Promise<void> {
  const root = state.workspace?.path
  errorMsg.value = ''
  if (!root) {
    result.value = null
    return
  }
  if (!keyword.value) {
    result.value = null
    return
  }
  searching.value = true
  try {
    const res = (await window.inkdown.searchInFolder(root, {
      query: keyword.value,
      isCaseSensitive: isCaseSensitive.value,
      isRegexp: isRegexp.value,
      isWholeWord: false,
      maxResults: 500
    })) as SearchResult
    result.value = res
  } catch (err) {
    errorMsg.value = (err as Error).message
    result.value = null
  } finally {
    searching.value = false
  }
}

/** 打开命中的文件，并跳到对应行。 */
async function openHit(hit: SearchHit): Promise<void> {
  const { useFile } = await import('../composables/useFile')
  await useFile().openPath(hit.filePath)
  // 等编辑器载入后再定位行
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('inkdown:goto-line', {
        detail: { filePath: hit.filePath, line: hit.line }
      })
    )
  }, 400)
}

function close(): void {
  state.folderSearchVisible = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
  if (e.key === 'Enter') void runSearch()
}
</script>

<template>
  <aside v-if="state.folderSearchVisible" class="folder-search">
    <header class="fs-head">
      <span class="fs-title">{{ t('search.folder') }}</span>
      <button class="fs-close" :title="t('find.close')" @click="close">×</button>
    </header>

    <div class="fs-scope" :title="state.workspace?.path || ''">
      {{
        state.workspace
          ? t('search.folderScope', { path: state.workspace.name })
          : t('search.folderNoFolder')
      }}
    </div>

    <div class="fs-input-row">
      <span class="fs-icon" aria-hidden="true">
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
        ref="inputRef"
        v-model="keyword"
        class="fs-input"
        :placeholder="t('search.folderPlaceholder')"
        :disabled="!state.workspace"
        @keydown="onKeydown"
      />
    </div>

    <div class="fs-toggles">
      <label class="fs-toggle" :title="t('search.folderCaseSensitive')">
        <input v-model="isCaseSensitive" type="checkbox" /> Aa
      </label>
      <label class="fs-toggle" :title="t('search.folderRegexp')">
        <input v-model="isRegexp" type="checkbox" /> .*
      </label>
    </div>

    <div class="fs-summary">
      <span v-if="searching">{{ t('search.folderSearching') }}</span>
      <span v-else-if="result">
        {{
          t('search.folderSummary', {
            files: result.filesMatched,
            hits: result.hits.length
          })
        }}
      </span>
      <span v-if="result?.truncated" class="fs-trunc">
        {{ t('search.folderTruncated', { max: 500 }) }}
      </span>
    </div>

    <div class="fs-body">
      <p v-if="errorMsg" class="fs-empty">{{ errorMsg }}</p>
      <p v-else-if="result && !result.hits.length" class="fs-empty">
        {{ t('search.folderEmpty') }}
      </p>
      <div v-for="g in groups" :key="g.path" class="fs-group">
        <button class="fs-group-head" :title="g.path" @click="toggleGroup(g.path)">
          <span class="fs-caret">{{ collapsed.has(g.path) ? '▸' : '▾' }}</span>
          <span class="fs-group-name">{{ g.path }}</span>
          <span class="fs-group-count">{{ g.hits.length }}</span>
        </button>
        <template v-if="!collapsed.has(g.path)">
          <button v-for="(hit, i) in g.hits" :key="i" class="fs-hit" @click="openHit(hit)">
            <span class="fs-hit-line">{{ hit.line }}</span>
            <span class="fs-hit-text">
              <span>{{ segments(hit).before }}</span>
              <mark class="fs-hit-mark">{{ segments(hit).match }}</mark>
              <span>{{ segments(hit).after }}</span>
            </span>
          </button>
        </template>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.folder-search {
  display: flex;
  flex-direction: column;
  width: 320px;
  flex: none;
  border-right: 1px solid var(--ty-border);
  background: var(--ty-sidebar-bg);
  overflow: hidden;
}
.fs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  flex: none;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--ty-border);
}
.fs-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ty-text);
}
.fs-close {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ty-muted);
  cursor: pointer;
}
.fs-close:hover {
  background: var(--ty-hover);
  color: var(--ty-text);
}
.fs-scope {
  flex: none;
  padding: 6px 12px;
  color: var(--ty-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 0 10px 6px;
}
.fs-icon {
  display: flex;
  align-items: center;
  flex: none;
  color: var(--ty-muted);
}
.fs-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-bg);
  color: var(--ty-text);
  font-size: 12px;
  outline: none;
}
.fs-input:focus {
  border-color: var(--ty-accent);
}
.fs-toggles {
  display: flex;
  gap: 12px;
  flex: none;
  padding: 0 12px 6px;
}
.fs-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--ty-muted);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.fs-summary {
  flex: none;
  padding: 0 12px 6px;
  color: var(--ty-muted);
  font-size: 11px;
}
.fs-trunc {
  display: block;
  color: var(--ty-accent);
}
.fs-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--ty-border);
}
.fs-empty {
  padding: 14px 12px;
  margin: 0;
  color: var(--ty-muted);
  font-size: 12px;
}
.fs-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.fs-group-head:hover {
  background: var(--ty-hover);
}
.fs-caret {
  flex: none;
  width: 10px;
  color: var(--ty-muted);
  font-size: 10px;
}
.fs-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs-group-count {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--ty-active);
  color: var(--ty-accent);
  font-size: 10px;
}
.fs-hit {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 4px 10px 4px 26px;
  border: 0;
  background: transparent;
  color: var(--ty-text);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.fs-hit:hover {
  background: var(--ty-hover);
}
.fs-hit-line {
  flex: none;
  width: 28px;
  color: var(--ty-muted);
  font-size: 10px;
  text-align: right;
}
.fs-hit-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs-hit-mark {
  padding: 0 1px;
  background: var(--highlight-color, rgba(255, 220, 0, 0.4));
  color: inherit;
  border-radius: 2px;
}
</style>
