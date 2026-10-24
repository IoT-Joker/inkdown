<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { state } from '../store'
import {
  commandLabelKey,
  executeCommand,
  listCommandIds
} from '../composables/useCommands'
import { useI18n } from '../composables/useI18n'

/**
 * 命令面板：模糊检索并执行所有已注册命令。
 *
 * 列出命令中心里已注册的全部命令，按名称模糊过滤后回车执行。
 * 命令的显示名复用 i18n 词条：命令 id 形如 'file:new'，
 * 对应词条 'menu.file.new'；取不到时退回 id 本身。
 */

const { t } = useI18n()
const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

interface PaletteItem {
  id: string
  label: string
  /** 搜索用的额外关键字（中文名 + 英文名 + id） */
  haystack: string
}

/** 命令的显示名：优先菜单词条，其次回退映射，最后才是 id。 */
function displayName(id: string): string {
  const key = commandLabelKey(id)
  const label = t(key)
  if (label !== key) return label
  return id
}

/** 全部命令（去掉内部测试用命令）。 */
/**
 * 内部辅助命令，不应出现在用户可见的命令面板里。
 * 它们不面向用户，只是菜单/快捷键实现中复用的中间步骤。
 */
const INTERNAL_COMMANDS = new Set(['view:focusEditor'])

const allItems = computed<PaletteItem[]>(() =>
  listCommandIds()
    .filter((id) => !id.startsWith('test:') && !INTERNAL_COMMANDS.has(id))
    .map((id) => {
      const label = displayName(id)
      return {
        id,
        label,
        haystack: `${id} ${label} ${id.replace(':', ' ')}`.toLowerCase()
      }
    })
)

/** 按关键词过滤；支持空格分隔的多词「与」匹配。 */
const filtered = computed<PaletteItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allItems.value
  const terms = q.split(/\s+/).filter(Boolean)
  return allItems.value.filter((it) => terms.every((term) => it.haystack.includes(term)))
})

watch(filtered, () => {
  activeIndex.value = 0
})

watch(
  () => state.paletteVisible,
  (visible) => {
    if (visible) {
      query.value = ''
      activeIndex.value = 0
      nextTick(() => inputRef.value?.focus())
    }
  }
)

function close(): void {
  state.paletteVisible = false
}

async function run(item: PaletteItem | undefined): Promise<void> {
  if (!item) return
  close()
  await executeCommand(item.id)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1)
    scrollActiveIntoView()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
    scrollActiveIntoView()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    void run(filtered.value[activeIndex.value])
  }
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    const el = listRef.value?.querySelector('.palette-item.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}
</script>

<template>
  <div v-if="state.paletteVisible" class="palette-mask" @click.self="close">
    <div class="palette">
      <div class="palette-input-row">
        <span class="palette-icon" aria-hidden="true">›</span>
        <input
          ref="inputRef"
          v-model="query"
          class="palette-input"
          :placeholder="t('palette.placeholder')"
          @keydown="onKeydown"
        />
      </div>
      <div ref="listRef" class="palette-list">
        <p v-if="!filtered.length" class="palette-empty">{{ t('palette.empty') }}</p>
        <button
          v-for="(item, i) in filtered"
          :key="item.id"
          class="palette-item"
          :class="{ active: i === activeIndex }"
          @mouseenter="activeIndex = i"
          @click="run(item)"
        >
          <span class="palette-label">{{ item.label }}</span>
          <span class="palette-id">{{ item.id }}</span>
        </button>
      </div>
      <div class="palette-hint">{{ t('palette.hint') }}</div>
    </div>
  </div>
</template>

<style scoped>
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.35);
}
.palette {
  display: flex;
  flex-direction: column;
  width: min(560px, 92vw);
  max-height: 60vh;
  border: 1px solid var(--ty-border);
  border-radius: 10px;
  background: var(--ty-bg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.34);
  overflow: hidden;
}
.palette-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ty-border);
}
.palette-icon {
  flex: none;
  color: var(--ty-accent);
  font-size: 16px;
}
.palette-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ty-text);
  font-size: 14px;
}
.palette-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}
.palette-empty {
  margin: 0;
  padding: 16px 12px;
  color: var(--ty-muted);
  font-size: 13px;
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ty-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.palette-item.active {
  background: var(--ty-active);
}
.palette-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-id {
  flex: none;
  color: var(--ty-muted);
  font-size: 11px;
}
.palette-hint {
  flex: none;
  padding: 6px 14px;
  border-top: 1px solid var(--ty-border);
  background: var(--ty-sidebar-bg);
  color: var(--ty-muted);
  font-size: 11px;
}
</style>
