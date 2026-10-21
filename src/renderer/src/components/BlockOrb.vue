<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '../composables/useI18n'

/**
 * 分栏预览右上角的悬浮球：环形菜单，用于在光标处快速插入块。
 *
 * 交互设计：
 *   鼠标移到球上 → 扇出第一圈（分类：标题/列表/代码/表格/公式/其它）
 *   点某个分类   → 换到第二圈（该分类下的具体块）
 *   点表格       → 第三圈列出常见规格（1×3、2×2、3×3…）
 *   点具体项     → 在光标处插入对应块
 *
 * 用纯 CSS 定位到圆周上，避免引入额外依赖。
 */

const { t } = useI18n()

/** 当前展开的层级与分类。 */
const open = ref(false)
const level = ref<1 | 2>(1)
const category = ref<string | null>(null)

/** 一圈菜单项。 */
interface RingItem {
  id: string
  label: string
  /** 有 children 表示还要再展开一层。 */
  children?: RingItem[]
}

/** 第一圈：分类。 */
const rootItems: RingItem[] = [
  {
    id: 'heading',
    label: t('orb.heading'),
    children: [
      { id: 'h1', label: t('orb.h1') },
      { id: 'h2', label: t('orb.h2') },
      { id: 'h3', label: t('orb.h3') }
    ]
  },
  {
    id: 'list',
    label: t('orb.list'),
    children: [
      { id: 'ul', label: t('orb.ul') },
      { id: 'ol', label: t('orb.ol') },
      { id: 'task', label: t('orb.task') }
    ]
  },
  { id: 'code', label: t('orb.code') },
  { id: 'math', label: t('orb.math') },
  {
    id: 'table',
    label: t('orb.table'),
    children: [
      { id: 'table-1x3', label: '1 × 3' },
      { id: 'table-2x2', label: '2 × 2' },
      { id: 'table-2x3', label: '2 × 3' },
      { id: 'table-3x3', label: '3 × 3' },
      { id: 'table-4x4', label: '4 × 4' }
    ]
  },
  {
    id: 'other',
    label: t('orb.other'),
    children: [
      { id: 'quote', label: t('orb.quote') },
      { id: 'hr', label: t('orb.hr') },
      { id: 'image', label: t('orb.image') },
      { id: 'link', label: t('orb.link') }
    ]
  }
]

/** 当前显示的一圈。 */
const currentItems = computed<RingItem[]>(() => {
  if (level.value === 1) return rootItems
  const parent = rootItems.find((r) => r.id === category.value)
  return parent?.children ?? []
})

/** 悬浮球在屏幕上的中心坐标（fixed 定位的环形菜单以此为圆心）。 */
const center = ref({ x: 0, y: 0 })

/**
 * 量出球心位置，并把圆心收敛到「整个圆环都能看见」的范围内。
 *
 * 悬浮球位于预览区右上角，贴着窗口右边缘；若直接以它为圆心，
 * 向右/向上展开的菜单项会跑到窗口外（实测只能看到左侧两三项）。
 */
function measure(): void {
  const el = orbRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // 圆环最大半径 + 项宽度的一半 + 余量
  const radius = level.value === 1 ? 82 : 96
  const margin = radius + 46
  const w = window.innerWidth
  const h = window.innerHeight
  center.value = {
    x: Math.min(Math.max(r.left + r.width / 2, margin), w - margin),
    y: Math.min(Math.max(r.top + r.height / 2, margin), h - margin)
  }
}

/** 环形菜单容器的位置：以球心为原点。 */
const ringStyle = computed(() => ({
  left: `${center.value.x}px`,
  top: `${center.value.y}px`
}))

const orbRef = ref<HTMLButtonElement | null>(null)

/** 把第 i 项放到圆周上的位置。 */
function itemStyle(index: number, total: number): Record<string, string> {
  const radius = level.value === 1 ? 82 : 96
  // 从正上方开始顺时针分布
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2
  const x = Math.cos(angle) * radius
  const y = Math.sin(angle) * radius
  // 用 calc 把「元素自身中心」对齐到圆周点：
  // translate(-50%, -50%) 负责居中，再平移圆周位移。
  return {
    left: '0px',
    top: '0px',
    transform: `translate(calc(${x}px - 50%), calc(${y}px - 50%))`
  }
}

const emit = defineEmits<{ insert: [id: string] }>()

/** 点击某一项。 */
function onPick(item: RingItem): void {
  if (item.children?.length) {
    category.value = item.id
    level.value = 2
    return
  }
  emit('insert', item.id)
  close()
}

/** 返回上一圈。 */
function back(): void {
  level.value = 1
  category.value = null
}

function openRing(): void {
  measure()
  open.value = true
}

function close(): void {
  open.value = false
  level.value = 1
  category.value = null
}

/** 鼠标离开整体区域时收起（留一点延迟，避免移动过程中误关）。 */
let closeTimer: number | null = null
function onLeave(): void {
  if (closeTimer) window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => close(), 380)
}
function onEnter(): void {
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
  openRing()
}

onBeforeUnmount(() => {
  if (closeTimer) window.clearTimeout(closeTimer)
})
</script>

<template>
  <div class="orb-wrap" @mouseenter="onEnter" @mouseleave="onLeave">
    <!-- 悬浮球本体 -->
    <button
      ref="orbRef"
      class="orb"
      :class="{ active: open }"
      :title="t('orb.title')"
      @click="open ? close() : openRing()"
    >
      <span class="orb-dot" />
    </button>

    <!-- 环形菜单（fixed 定位，脱离父级裁剪） -->
    <div v-if="open" class="orb-ring" :style="ringStyle" @click.stop>
      <button
        v-for="(item, i) in currentItems"
        :key="item.id"
        class="orb-item"
        :style="itemStyle(i, currentItems.length)"
        :title="item.label"
        @click="onPick(item)"
      >
        {{ item.label }}
      </button>
      <!-- 二级时提供返回 -->
      <button v-if="level === 2" class="orb-back" :title="t('orb.back')" @click="back">←</button>
    </div>
  </div>
</template>

<style scoped>
.orb-wrap {
  position: relative;
  width: 22px;
  height: 22px;
  flex: none;
}

/* 悬浮球 */
.orb {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--ty-border);
  border-radius: 50%;
  background: var(--ty-bg);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background 0.18s ease;
}
.orb:hover,
.orb.active {
  transform: scale(1.08);
  background: var(--ty-active);
}
.orb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ty-accent);
}

/* 环形菜单容器：以球为中心。
   用 fixed 定位脱离父级 overflow:hidden 的裁剪 ——
   .split-preview 有 overflow:hidden，absolute 定位的菜单会被切掉。 */
.orb-ring {
  position: fixed;
  width: 0;
  height: 0;
  z-index: 400;
}

.orb-item {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--ty-border);
  border-radius: 13px;
  background: var(--ty-bg);
  color: var(--ty-text);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  /* 位置由内联 transform 提供（含 translate(-50%,-50%) 居中） */
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  animation: orb-in 0.16s ease both;
}
.orb-item:hover {
  background: var(--ty-active);
  border-color: var(--ty-accent);
}

/* 返回按钮固定在中心 */
.orb-back {
  position: absolute;
  top: -11px;
  left: -11px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--ty-border);
  border-radius: 50%;
  background: var(--ty-bg);
  color: var(--ty-muted);
  font-size: 12px;
  cursor: pointer;
}
.orb-back:hover {
  background: var(--ty-active);
}

@keyframes orb-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
