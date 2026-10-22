<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../composables/useI18n'

/**
 * Markdown 调色盘。
 *
 * 悬停中心球展开分类环；悬停有子项的分类，外侧继续展开动作环。
 * 三级环展开后会锁定当前分类，鼠标可以直线穿过去选择，不必沿圆环绕行；
 * 要换分类时在新分类上静止停留或点击。点击动作即插入对应结构。
 * 中心球可拖动，位置会记住；拖动期间不会展开菜单。
 */

const { t } = useI18n()

interface OrbItem {
  id: string
  label: string
  icon?: string
  children?: OrbItem[]
}

interface RingGeometry {
  item: OrbItem
  path: string
  labelX: number
  labelY: number
}

const emit = defineEmits<{ insert: [id: string] }>()

const open = ref(false)
const activeRoot = ref<OrbItem | null>(null)
const dragging = ref(false)
/** 拖动结束后的短冷却，防止松开鼠标时残留的 hover 立刻把菜单弹开。 */
const dragCooldown = ref(false)
const wrapRef = ref<HTMLElement | null>(null)

const RING1_INNER = 42
const RING1_OUTER = 84
const RING2_INNER = 94
const RING2_OUTER = 142
/** 环菜单整体宽高：外圈 142 + 少量阴影余量。 */
const PALETTE_EXTENT = 154
const CLOSE_RADIUS = 176
/** 环菜单展开时略收一点，静止球保持轻巧，展开信息密度也更舒服。 */
const OPEN_SCALE = 0.92
/** 二级分类需要静止停留这么久才切换，避免穿过圆环时误切。 */
const ROOT_SWITCH_DELAY = 260
/** 在候选二级分类上移动超过这个距离，就重新计时。 */
const ROOT_MOVE_RESET_DISTANCE = 4
const POSITION_KEY = 'inkdown-orb-position'

const rootItems = computed<OrbItem[]>(() => [
  {
    id: 'heading',
    label: t('orb.heading'),
    icon: 'H',
    children: [
      { id: 'h1', label: t('orb.h1') },
      { id: 'h2', label: t('orb.h2') },
      { id: 'h3', label: t('orb.h3') },
      { id: 'h4', label: t('orb.h4') },
      { id: 'h5', label: t('orb.h5') },
      { id: 'h6', label: t('orb.h6') }
    ]
  },
  {
    id: 'text',
    label: t('orb.text'),
    icon: 'Aa',
    children: [
      { id: 'strong', label: t('orb.strong') },
      { id: 'emphasis', label: t('orb.emphasis') },
      { id: 'strike', label: t('orb.strike') },
      { id: 'inlineCode', label: t('orb.inlineCode') },
      { id: 'highlight', label: t('orb.highlight') },
      { id: 'inlineMath', label: t('orb.inlineMath') },
      { id: 'superscript', label: t('orb.superscript') },
      { id: 'subscript', label: t('orb.subscript') },
      { id: 'underline', label: t('orb.underline') },
      { id: 'kbd', label: t('orb.kbd') },
      { id: 'link', label: t('orb.link') }
    ]
  },
  {
    id: 'list',
    label: t('orb.list'),
    icon: '≡',
    children: [
      { id: 'ul', label: t('orb.ul') },
      { id: 'ol', label: t('orb.ol') },
      { id: 'task', label: t('orb.task') },
      { id: 'quote', label: t('orb.quote') },
      { id: 'nestedList', label: t('orb.nestedList') }
    ]
  },
  {
    id: 'code',
    label: t('orb.code'),
    icon: '</>',
    children: [
      { id: 'codeJs', label: t('orb.codeJs') },
      { id: 'codePy', label: t('orb.codePy') },
      { id: 'mermaid', label: t('orb.mermaid') },
      { id: 'plantuml', label: t('orb.plantuml') },
      { id: 'math', label: t('orb.math') },
      { id: 'inlineDiffAdd', label: t('orb.inlineDiffAdd') },
      { id: 'inlineDiffDel', label: t('orb.inlineDiffDel') }
    ]
  },
  {
    id: 'table',
    label: t('orb.table'),
    icon: '▦',
    children: [
      { id: 'table-2x2', label: '2 × 2' },
      { id: 'table-2x3', label: '2 × 3' },
      { id: 'table-3x3', label: '3 × 3' },
      { id: 'table-3x4', label: '3 × 4' },
      { id: 'table-4x4', label: '4 × 4' }
    ]
  },
  {
    id: 'structure',
    label: t('orb.structure'),
    icon: '◇',
    children: [
      { id: 'frontmatter', label: t('orb.frontmatter') },
      { id: 'callout', label: t('orb.callout') },
      { id: 'details', label: t('orb.details') },
      { id: 'footnote', label: t('orb.footnote') },
      { id: 'toc', label: t('orb.toc') },
      { id: 'refLink', label: t('orb.refLink') },
      { id: 'hr', label: t('orb.hr') }
    ]
  },
  {
    id: 'media',
    label: t('orb.media'),
    icon: '▣',
    children: [
      { id: 'image', label: t('orb.image') },
      { id: 'link', label: t('orb.link') },
      { id: 'video', label: t('orb.video') },
      { id: 'audio', label: t('orb.audio') },
      { id: 'htmlBlock', label: t('orb.htmlBlock') }
    ]
  },
  {
    id: 'time',
    label: t('orb.timeGroup'),
    icon: '◷',
    children: [
      { id: 'datetime', label: t('orb.time') },
      { id: 'date', label: t('orb.date') },
      { id: 'weekday', label: t('orb.weekday') }
    ]
  }
])

const actionItems = computed<OrbItem[]>(() => activeRoot.value?.children ?? [])

function polar(radius: number, angle: number): { x: number; y: number } {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function sectorPath(inner: number, outer: number, start: number, end: number): string {
  const a = polar(outer, start)
  const b = polar(outer, end)
  const c = polar(inner, end)
  const d = polar(inner, start)
  return [
    `M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`,
    `A ${outer} ${outer} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
    `L ${c.x.toFixed(2)} ${c.y.toFixed(2)}`,
    `A ${inner} ${inner} 0 0 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)}`,
    'Z'
  ].join(' ')
}

function buildRing(items: OrbItem[], inner: number, outer: number): RingGeometry[] {
  if (!items.length) return []
  const step = (Math.PI * 2) / items.length
  const gap = Math.min(step * 0.14, 0.08)
  const labelRadius = (inner + outer) / 2
  return items.map((item, index) => {
    const start = -Math.PI / 2 + index * step + gap / 2
    const end = -Math.PI / 2 + (index + 1) * step - gap / 2
    const label = polar(labelRadius, (start + end) / 2)
    return {
      item,
      path: sectorPath(inner, outer, start, end),
      labelX: label.x,
      labelY: label.y
    }
  })
}

const rootRing = computed(() => buildRing(rootItems.value, RING1_INNER, RING1_OUTER))
const actionRing = computed(() => buildRing(actionItems.value, RING2_INNER, RING2_OUTER))

const pos = ref({ x: 0, y: 0 })

function clampPosition(x: number, y: number): { x: number; y: number } {
  // 环菜单始终以球心为圆心，因此拖动范围也要为完整圆环留出空间。
  const edgeX = Math.min(PALETTE_EXTENT + 14, window.innerWidth / 2)
  const edgeY = Math.min(PALETTE_EXTENT + 14, window.innerHeight / 2)
  return {
    x: Math.min(Math.max(x, edgeX), Math.max(edgeX, window.innerWidth - edgeX)),
    y: Math.min(Math.max(y, edgeY), Math.max(edgeY, window.innerHeight - edgeY))
  }
}

function readSavedPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

function savePosition(): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(pos.value))
  } catch {
    /* 存储不可用时只影响位置记忆 */
  }
}

const wrapStyle = computed(() => {
  const fitScale = Math.min(
    1,
    Math.max(0.62, (window.innerWidth - 24) / (PALETTE_EXTENT * 2))
  )
  const scale = fitScale * OPEN_SCALE
  return {
    left: `${pos.value.x}px`,
    top: `${pos.value.y}px`,
    '--palette-scale': scale.toFixed(3)
  }
})

let closeTimer: number | null = null
let rootSwitchTimer: number | null = null
/** 等待静止确认的二级分类，以及最后一次有效移动的位置。 */
const pendingRootId = ref<string | null>(null)
let pendingRoot: OrbItem | null = null
let rootPointer = { x: 0, y: 0 }
let dragCooldownTimer: number | null = null
let suppressClick = false
/** 按下时菜单已展开：先收起，避免拖动期间闪出菜单；单击时再重新展开。 */
let closedOnPointerDown = false

function cancelClose(): void {
  if (closeTimer != null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

function scheduleClose(delay = 260): void {
  cancelClose()
  closeTimer = window.setTimeout(() => close(), delay)
}

function cancelRootSwitch(): void {
  if (rootSwitchTimer != null) {
    window.clearTimeout(rootSwitchTimer)
    rootSwitchTimer = null
  }
  pendingRoot = null
  pendingRootId.value = null
}

function scheduleRootSwitch(item: OrbItem): void {
  cancelRootSwitch()
  pendingRoot = item
  pendingRootId.value = item.id
  rootSwitchTimer = window.setTimeout(() => {
    rootSwitchTimer = null
    if (pendingRoot?.id !== item.id) return
    activeRoot.value = item
    pendingRoot = null
    pendingRootId.value = null
  }, ROOT_SWITCH_DELAY)
}

function setActiveRoot(item: OrbItem | null): void {
  cancelRootSwitch()
  activeRoot.value = item
}

function startDragCooldown(): void {
  if (dragCooldownTimer != null) window.clearTimeout(dragCooldownTimer)
  dragCooldown.value = true
  dragCooldownTimer = window.setTimeout(() => {
    dragCooldown.value = false
    dragCooldownTimer = null
  }, 180)
}

function openRing(): void {
  if (dragging.value || dragCooldown.value) return
  cancelClose()
  open.value = true
}

function close(): void {
  cancelClose()
  cancelRootSwitch()
  open.value = false
  activeRoot.value = null
}

function toggleRing(): void {
  if (open.value) close()
  else openRing()
}

function onWrapEnter(): void {
  if (dragging.value || dragCooldown.value) return
  openRing()
}

function onWrapLeave(): void {
  scheduleClose(320)
}

function onRootEnter(item: OrbItem, e?: PointerEvent): void {
  if (!open.value || dragging.value || dragCooldown.value) return
  const next = item.children?.length ? item : null
  if (activeRoot.value?.id === next?.id) {
    cancelRootSwitch()
    return
  }

  // 第一次进入分类立即展开；三级环已经展开时，穿过的分类只作为候选，
  // 指针停稳 260ms 才切换。这样可以从中心直线穿过去选对面，不必绕圆环。
  // 键盘 focus 没有指针事件，直接切换；鼠标进入已有外圈时先作为候选。
  if (!activeRoot.value || !e) {
    cancelRootSwitch()
    activeRoot.value = next
    return
  }
  if (!next) {
    cancelRootSwitch()
    return
  }
  rootPointer = { x: e.clientX, y: e.clientY }
  scheduleRootSwitch(next)
}

function onRootMove(item: OrbItem, e: PointerEvent): void {
  if (pendingRoot?.id !== item.id) return
  const step = Math.hypot(e.clientX - rootPointer.x, e.clientY - rootPointer.y)
  if (step < ROOT_MOVE_RESET_DISTANCE) {
    return
  }
  // 持续移动时不断推迟切换，避免横穿圆环途中被路过的分类截走。
  rootPointer = { x: e.clientX, y: e.clientY }
  scheduleRootSwitch(item)
}

function onRootLeave(item: OrbItem): void {
  if (pendingRoot?.id === item.id) cancelRootSwitch()
}

function onRootClick(item: OrbItem): void {
  if (item.children?.length) {
    setActiveRoot(item)
    openRing()
    return
  }
  emit('insert', item.id)
  close()
}

function onActionClick(item: OrbItem): void {
  emit('insert', item.id)
  close()
}

function onActionEnter(): void {
  // 进入三级环表示已经完成穿越，取消二级分类的待切换。
  cancelRootSwitch()
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

let dragState: DragState | null = null

function onDragMove(e: PointerEvent): void {
  if (!dragState) return
  // 只处理发起拖动的那个指针，避免多指/触控板指针把拖动带偏。
  if (dragState.pointerId !== e.pointerId) return
  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY
  if (!dragState.moved && Math.hypot(dx, dy) > 5) {
    dragState.moved = true
    dragging.value = true
    close()
  }
  if (dragState.moved) {
    pos.value = clampPosition(dragState.originX + dx, dragState.originY + dy)
  }
}

function stopDrag(): void {
  if (!dragState) return
  const moved = dragState.moved
  dragState = null
  dragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
  if (moved) {
    savePosition()
    startDragCooldown()
    suppressClick = true
    window.setTimeout(() => {
      suppressClick = false
    }, 0)
  }
}

function onOrbPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  // 球本身也属于展开区域。按下先收起，拖动全程不会闪出菜单；
  // 没有拖动时 click 会重新展开，保持原有的单击切换行为。
  closedOnPointerDown = open.value
  if (open.value) close()
  dragState = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originX: pos.value.x,
    originY: pos.value.y,
    moved: false
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

function onOrbClick(): void {
  if (suppressClick) {
    suppressClick = false
    closedOnPointerDown = false
    return
  }
  if (closedOnPointerDown) {
    closedOnPointerDown = false
    return
  }
  toggleRing()
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!open.value || dragState || dragging.value) return
  const target = e.target
  if (target instanceof Node && wrapRef.value?.contains(target)) {
    cancelClose()
    return
  }
  const distance = Math.hypot(e.clientX - pos.value.x, e.clientY - pos.value.y)
  if (distance <= CLOSE_RADIUS) cancelClose()
  else scheduleClose()
}

function onWindowPointerDown(e: PointerEvent): void {
  if (dragState) return
  const target = e.target
  if (!(target instanceof Node)) return
  if (wrapRef.value?.contains(target)) return
  if (open.value) close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) close()
}

function onResize(): void {
  pos.value = clampPosition(pos.value.x, pos.value.y)
}

onMounted(() => {
  const host = wrapRef.value?.closest('.editor-host') as HTMLElement | null
  const rect = host?.getBoundingClientRect()
  const defaultX = rect ? rect.right - 172 : window.innerWidth - 172
  const defaultY = rect ? rect.top + 158 : 158
  const saved = readSavedPosition()
  pos.value = clampPosition(saved?.x ?? defaultX, saved?.y ?? defaultY)

  window.addEventListener('pointermove', onWindowPointerMove, { passive: true })
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  cancelClose()
  cancelRootSwitch()
  if (dragCooldownTimer != null) window.clearTimeout(dragCooldownTimer)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div
    ref="wrapRef"
    class="orb-wrap"
    :style="wrapStyle"
    :data-dragging="dragging"
    @mouseenter="onWrapEnter"
    @mouseleave="onWrapLeave"
  >
    <div
      class="orb-palette"
      :class="{ open, locked: !!activeRoot }"
      :data-active-root="activeRoot?.id ?? ''"
      :data-pending-root="pendingRootId ?? ''"
      :aria-hidden="!open"
    >
      <div class="orb-aura" :class="{ lit: open }" />
      <svg class="orb-svg" viewBox="-156 -156 312 312">
        <circle class="ring-guide" :r="RING1_INNER" />
        <circle class="ring-guide" :r="RING1_OUTER" />
        <circle class="ring-guide ring-guide-outer" :r="RING2_INNER" />
        <circle class="ring-guide ring-guide-outer" :r="RING2_OUTER" />

        <g class="ring ring-root">
          <g
            v-for="(entry, index) in rootRing"
            :key="entry.item.id"
            class="ring-sector-group"
            :class="{
              active: activeRoot?.id === entry.item.id,
              pending: pendingRootId === entry.item.id
            }"
            :style="{ animationDelay: `${index * 18}ms` }"
            role="button"
            :tabindex="open ? 0 : -1"
            :aria-label="entry.item.label"
            @pointerenter="onRootEnter(entry.item, $event as PointerEvent)"
            @pointermove="onRootMove(entry.item, $event as PointerEvent)"
            @pointerleave="onRootLeave(entry.item)"
            @focus="onRootEnter(entry.item)"
            @click.stop="onRootClick(entry.item)"
            @keydown.enter.prevent="onRootClick(entry.item)"
            @keydown.space.prevent="onRootClick(entry.item)"
          >
            <title>{{ entry.item.label }}</title>
            <path class="ring-sector" :d="entry.path" />
            <text class="ring-icon" :x="entry.labelX" :y="entry.labelY - 7">
              {{ entry.item.icon }}
            </text>
            <text class="ring-label" :x="entry.labelX" :y="entry.labelY + 9">
              {{ entry.item.label }}
            </text>
          </g>
        </g>

        <g v-if="activeRoot && actionRing.length" class="ring ring-actions">
          <g
            v-for="(entry, index) in actionRing"
            :key="`${activeRoot.id}-${entry.item.id}`"
            class="ring-sector-group"
            :style="{ animationDelay: `${index * 22}ms` }"
            role="button"
            :tabindex="open ? 0 : -1"
            :aria-label="entry.item.label"
            @pointerenter="onActionEnter"
            @click.stop="onActionClick(entry.item)"
            @keydown.enter.prevent="onActionClick(entry.item)"
            @keydown.space.prevent="onActionClick(entry.item)"
          >
            <title>{{ entry.item.label }}</title>
            <path class="ring-sector action-sector" :d="entry.path" />
            <text class="ring-label action-label" :x="entry.labelX" :y="entry.labelY">
              {{ entry.item.label }}
            </text>
          </g>
        </g>
      </svg>
    </div>

    <button
      class="orb"
      :class="{ active: open, dragging }"
      :title="dragging ? t('orb.dragging') : `${t('orb.title')} · ${t('orb.hint')}`"
      :aria-expanded="open"
      :aria-label="t('orb.title')"
      aria-haspopup="menu"
      @pointerdown="onOrbPointerDown"
      @click="onOrbClick"
    >
      <span class="orb-halo" />
      <span class="orb-core">
        <span class="orb-glint" />
        <span class="orb-glyph">+</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.orb-wrap {
  position: fixed;
  /* 位于编辑内容之上，但低于偏好设置等模态对话框。 */
  z-index: 90;
  width: 62px;
  height: 62px;
  transform: translate(-50%, -50%);
  touch-action: none;
  user-select: none;
}

/* 环菜单打开时扩大命中区，覆盖球心到外圈的整块区域。
   否则鼠标从球体移向扇区时会先离开 .orb-wrap，菜单在到达前就开始收起。 */
.orb-wrap::before {
  position: absolute;
  inset: -146px;
  border-radius: 50%;
  content: '';
  pointer-events: none;
}

.orb-wrap:has(.orb-palette.open)::before {
  pointer-events: auto;
}

.orb {
  position: relative;
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: grab;
  opacity: 0.5;
  outline: none;
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.2, 0.9, 0.25, 1.25);
}

.orb:hover,
.orb.active {
  opacity: 0.92;
  transform: scale(1.06);
}

.orb.dragging {
  cursor: grabbing;
  opacity: 0.96;
  transform: scale(1.1);
}

.orb-halo {
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  background:
    radial-gradient(circle, color-mix(in srgb, var(--ty-accent) 10%, transparent), transparent 62%);
  opacity: 0.05;
  filter: blur(7px);
  animation: halo-breathe 2.8s ease-in-out infinite;
  transition: opacity 0.25s ease;
}

.orb.active .orb-halo {
  opacity: 0.16;
  animation-duration: 1.4s;
}

.orb-core {
  position: relative;
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ty-border) 78%, transparent);
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.5) 0 4%, rgba(255, 255, 255, 0.14) 12%, transparent 30%),
    radial-gradient(circle at 66% 78%, rgba(0, 0, 0, 0.09), transparent 45%),
    radial-gradient(circle at 42% 38%, color-mix(in srgb, var(--ty-bg) 92%, #ffffff) 0 18%, color-mix(in srgb, var(--ty-accent) 7%, var(--ty-bg)) 52%, color-mix(in srgb, var(--ty-text) 12%, var(--ty-bg)) 100%);
  box-shadow:
    inset -5px -7px 12px rgba(0, 0, 0, 0.08),
    inset 4px 5px 9px rgba(255, 255, 255, 0.28),
    0 3px 9px rgba(0, 0, 0, 0.07),
    0 0 10px color-mix(in srgb, var(--ty-accent) 6%, transparent);
  transform: perspective(140px) rotateX(10deg) rotateY(-12deg);
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
}

.orb:hover .orb-core,
.orb.active .orb-core {
  transform: perspective(140px) rotateX(3deg) rotateY(-4deg) translateY(-1px);
  box-shadow:
    inset -5px -7px 12px rgba(0, 0, 0, 0.1),
    inset 5px 6px 10px rgba(255, 255, 255, 0.4),
    0 5px 12px rgba(0, 0, 0, 0.09),
    0 0 14px color-mix(in srgb, var(--ty-accent) 12%, transparent);
}

.orb-glint {
  position: absolute;
  top: 8px;
  left: 11px;
  width: 16px;
  height: 9px;
  border-radius: 50%;
  background: linear-gradient(150deg, rgba(255, 255, 255, 0.58), transparent 70%);
  filter: blur(1px);
  transform: rotate(-24deg);
}

.orb-glyph {
  position: relative;
  z-index: 1;
  margin-top: -1px;
  color: color-mix(in srgb, var(--ty-accent) 34%, var(--ty-muted));
  font-family: 'Segoe UI Symbol', 'Segoe UI', sans-serif;
  font-size: 24px;
  font-weight: 300;
  line-height: 1;
  text-shadow:
    0 1px 1px rgba(255, 255, 255, 0.28),
    0 0 5px rgba(255, 255, 255, 0.18);
  transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.25, 1.3);
}

.orb.active .orb-glyph {
  transform: rotate(135deg);
}

.orb-palette {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.72) rotate(-7deg);
  transform-origin: 0 0;
  transition:
    opacity 0.2s ease,
    transform 0.3s cubic-bezier(0.18, 0.9, 0.25, 1.15);
}

.orb-palette.open {
  opacity: 1;
  pointer-events: auto;
  transform: scale(var(--palette-scale, 1)) rotate(0deg);
  transform-origin: 0 0;
}

.orb-aura {
  position: absolute;
  top: -150px;
  left: -150px;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background:
    conic-gradient(
      from 20deg,
      transparent 0 8%,
      color-mix(in srgb, var(--ty-accent) 5%, transparent) 13%,
      transparent 21% 55%,
      color-mix(in srgb, var(--ty-accent) 4%, transparent) 62%,
      transparent 72%
    ),
    radial-gradient(circle, color-mix(in srgb, var(--ty-accent) 5%, transparent), transparent 66%);
  opacity: 0;
  filter: blur(13px);
  transition: opacity 0.28s ease;
  animation: aura-spin 9s linear infinite;
}

.orb-aura.lit {
  opacity: 0.16;
}

.orb-svg {
  position: absolute;
  top: -156px;
  left: -156px;
  width: 312px;
  height: 312px;
  overflow: visible;
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.09));
  pointer-events: none;
}

.ring-sector-group {
  pointer-events: auto;
}

.ring-guide {
  fill: none;
  stroke: color-mix(in srgb, var(--ty-border) 64%, transparent);
  stroke-width: 0.7;
  stroke-dasharray: 2 5;
  opacity: 0.42;
  pointer-events: none;
}

.ring-guide-outer {
  opacity: 0.24;
}

.ring-sector-group {
  cursor: pointer;
  outline: none;
  transform-origin: 0 0;
}

.orb-palette.open .ring-root .ring-sector-group {
  animation: sector-in 0.34s cubic-bezier(0.18, 0.9, 0.25, 1.12) both;
}

.ring-sector {
  fill: color-mix(in srgb, var(--ty-bg) 96%, var(--ty-accent));
  stroke: color-mix(in srgb, var(--ty-border) 84%, var(--ty-accent));
  fill-opacity: 0.6;
  stroke-opacity: 0.4;
  stroke-width: 0.65;
  pointer-events: all;
  transition:
    fill 0.16s ease,
    fill-opacity 0.16s ease,
    stroke-opacity 0.16s ease,
    stroke 0.16s ease,
    filter 0.16s ease;
}

.ring-sector-group:hover .ring-sector,
.ring-sector-group:focus-visible .ring-sector,
.ring-sector-group.active .ring-sector {
  fill: color-mix(in srgb, var(--ty-accent) 12%, var(--ty-bg));
  fill-opacity: 1;
  stroke: var(--ty-accent);
  stroke-opacity: 1;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--ty-accent) 26%, transparent));
}

/* 锁定态给出明确但克制的视觉锚点，避免用户不知道当前外圈属于哪一类。 */
.ring-root .ring-sector-group.active .ring-sector {
  stroke-width: 1.35;
  filter:
    drop-shadow(0 0 5px color-mix(in srgb, var(--ty-accent) 22%, transparent));
}

.ring-root .ring-sector-group.active .ring-label {
  fill: color-mix(in srgb, var(--ty-accent) 74%, var(--ty-text));
  font-weight: 700;
}

.ring-root .ring-sector-group.pending .ring-sector {
  fill: color-mix(in srgb, var(--ty-accent) 5%, var(--ty-bg));
  stroke-dasharray: 3 2;
}

.action-sector {
  fill: color-mix(in srgb, var(--ty-bg) 97%, var(--ty-accent));
  stroke: color-mix(in srgb, var(--ty-border) 76%, var(--ty-accent));
  fill-opacity: 0.52;
  stroke-opacity: 0.34;
}

.ring-icon,
.ring-label {
  fill: var(--ty-text);
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}

.ring-icon {
  fill: color-mix(in srgb, var(--ty-accent) 52%, var(--ty-muted));
  font-family: 'Segoe UI Symbol', 'Segoe UI', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.ring-label {
  font-family: var(--ty-font-ui);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0;
}

.action-label {
  font-size: 9px;
  font-weight: 550;
}

.orb-palette.open .ring-actions .ring-sector-group {
  animation: sector-in-outer 0.34s cubic-bezier(0.18, 0.9, 0.25, 1.12) both;
}

@keyframes sector-in {
  from {
    opacity: 0;
    transform: scale(0.78) rotate(-4deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}

@keyframes sector-in-outer {
  from {
    opacity: 0;
    transform: scale(0.84) rotate(4deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}

@keyframes halo-breathe {
  0%,
  100% {
    transform: scale(0.92);
    opacity: 0.18;
  }
  50% {
    transform: scale(1.12);
    opacity: 0.34;
  }
}

@keyframes aura-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .orb-halo,
  .orb-aura,
  .ring-sector-group {
    animation: none;
  }

  .orb,
  .orb-core,
  .orb-glyph,
  .orb-palette {
    transition-duration: 0.01ms;
  }
}
</style>
