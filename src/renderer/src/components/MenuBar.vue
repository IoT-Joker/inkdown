<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { executeCommand, shortcutFor } from '../composables/useCommands'
import { useI18n } from '../composables/useI18n'
import { state, settings, recentFiles } from '../store'

/**
 * 应用内菜单栏。
 *
 * 原生菜单（Electron Menu）在 Windows 上会占用窗口顶部且样式不可控，
 * 这里自绘一条菜单栏，与原生菜单共用同一套命令 id，行为一致。
 * 原生菜单仍保留，供快捷键与系统级集成使用。
 */

const { t } = useI18n()

interface MenuItem {
  labelKey: string
  command?: string
  separator?: boolean
  /** 子菜单：最近打开列表 */
  submenu?: 'recent'
  /** 勾选态（如当前行尾符） */
  checked?: boolean
  /** 直接文本（最近文件的路径，不翻译） */
  rawLabel?: string
  payload?: string
}

interface MenuGroup {
  labelKey: string
  items: MenuItem[]
}

const menus = computed<MenuGroup[]>(() => [
  {
    labelKey: 'menu.file',
    items: [
      { labelKey: 'menu.file.new', command: 'file:new' },
      { labelKey: 'menu.file.open', command: 'file:open' },
      { labelKey: 'menu.file.openFolder', command: 'file:openFolder' },
      { labelKey: 'menu.file.recent', submenu: 'recent' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.file.save', command: 'file:save' },
      { labelKey: 'menu.file.saveAs', command: 'file:saveAs' },
      { labelKey: 'menu.file.closeTab', command: 'file:closeTab' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.file.exportHtml', command: 'file:exportHtml' },
      { labelKey: 'menu.file.exportPdf', command: 'file:exportPdf' },
      { labelKey: 'menu.file.exportDocx', command: 'file:exportDocx' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.file.preferences', command: 'app:preferences' },
      { labelKey: 'menu.file.quit', command: 'file:quit' }
    ]
  },
  {
    labelKey: 'menu.edit',
    items: [
      { labelKey: 'menu.edit.undo', command: 'edit:undo' },
      { labelKey: 'menu.edit.redo', command: 'edit:redo' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.edit.pastePlain', command: 'edit:pastePlain' },
      { labelKey: 'menu.edit.copyMarkdown', command: 'edit:copyMarkdown' },
      { labelKey: 'menu.edit.copyHtml', command: 'edit:copyHtml' },
      { labelKey: 'menu.edit.insertTime', command: 'edit:insertTime' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.edit.duplicate', command: 'edit:duplicate' },
      { labelKey: 'menu.edit.insertParagraphBefore', command: 'edit:insertParagraph' },
      { labelKey: 'menu.edit.deleteParagraph', command: 'edit:deleteParagraph' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.edit.lineEndingLf', command: 'edit:lineEnding', payload: 'lf', checked: settings.lineEnding === 'lf' },
      { labelKey: 'menu.edit.lineEndingCrlf', command: 'edit:lineEnding', payload: 'crlf', checked: settings.lineEnding === 'crlf' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.edit.find', command: 'edit:find' },
      { labelKey: 'menu.edit.replace', command: 'edit:replace' },
      { labelKey: 'search.folder', command: 'edit:findInFolder' }
    ]
  },
  {
    labelKey: 'menu.paragraph',
    items: [
      { labelKey: 'menu.paragraph.h1', command: 'paragraph:h1' },
      { labelKey: 'menu.paragraph.h2', command: 'paragraph:h2' },
      { labelKey: 'menu.paragraph.h3', command: 'paragraph:h3' },
      { labelKey: 'menu.paragraph.h4', command: 'paragraph:h4' },
      { labelKey: 'menu.paragraph.h5', command: 'paragraph:h5' },
      { labelKey: 'menu.paragraph.h6', command: 'paragraph:h6' },
      { labelKey: 'menu.paragraph.p', command: 'paragraph:p' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.paragraph.ul', command: 'paragraph:ul' },
      { labelKey: 'menu.paragraph.ol', command: 'paragraph:ol' },
      { labelKey: 'menu.paragraph.task', command: 'paragraph:task' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.paragraph.quote', command: 'paragraph:quote' },
      { labelKey: 'menu.paragraph.code', command: 'paragraph:code' },
      { labelKey: 'menu.paragraph.math', command: 'paragraph:math' },
      { labelKey: 'menu.paragraph.table', command: 'paragraph:table' },
      { labelKey: 'menu.paragraph.hr', command: 'paragraph:hr' },
      { labelKey: 'menu.paragraph.frontMatter', command: 'paragraph:frontMatter' }
    ]
  },
  {
    labelKey: 'menu.format',
    items: [
      { labelKey: 'menu.format.strong', command: 'format:strong' },
      { labelKey: 'menu.format.emphasis', command: 'format:emphasis' },
      { labelKey: 'menu.format.underline', command: 'format:underline' },
      { labelKey: 'menu.format.strike', command: 'format:strike' },
      { labelKey: 'menu.format.inlineCode', command: 'format:inlineCode' },
      { labelKey: 'menu.format.highlight', command: 'format:highlight' },
      { labelKey: 'menu.format.inlineMath', command: 'format:inlineMath' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.format.link', command: 'format:link' },
      { labelKey: 'menu.format.image', command: 'format:image' },
      { labelKey: 'menu.format.clear', command: 'format:clear' }
    ]
  },
  {
    labelKey: 'menu.view',
    items: [
      { labelKey: 'palette.title', command: 'app:commandPalette' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.toggleSidebar', command: 'view:toggleSidebar' },
      { labelKey: 'menu.view.toggleOutline', command: 'view:toggleOutline' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.toggleSource', command: 'view:toggleSource' },
      { labelKey: 'view.splitPreview', command: 'view:toggleSplit' },
      { labelKey: 'menu.view.toggleFocus', command: 'view:toggleFocus' },
      { labelKey: 'menu.view.toggleTypewriter', command: 'view:toggleTypewriter' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.toggleTheme', command: 'view:toggleTheme' },
      { labelKey: 'menu.view.zoomIn', command: 'view:zoomIn' },
      { labelKey: 'menu.view.zoomOut', command: 'view:zoomOut' },
      { labelKey: 'menu.view.zoomReset', command: 'view:zoomReset' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.fullscreen', command: 'view:fullscreen' },
      { labelKey: 'menu.view.devtools', command: 'view:devtools' }
    ]
  },
  {
    labelKey: 'menu.help',
    items: [
      { labelKey: 'menu.help.shortcuts', command: 'help:shortcuts' },
      { labelKey: 'menu.help.repo', command: 'help:repo' },
      { labelKey: 'menu.help.feedback', command: 'help:feedback' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.help.update', command: 'help:checkUpdate' },
      { labelKey: 'menu.help.about', command: 'help:about' }
    ]
  }
])

const openIndex = ref(-1)
const menuRef = ref<HTMLElement | null>(null)
const updatePending = ref(false)
const updateCheckingPending = ref(false)
const updateActionError = ref('')
const updateChecking = computed(
  () => state.updateStatus.phase === 'checking' || updateCheckingPending.value
)
const updateMessage = computed(() => updateActionError.value || state.updateStatus.message)
const updateLabel = computed(() => {
  const status = state.updateStatus
  switch (status.phase) {
    case 'checking':
      return t('update.checking')
    case 'available':
      return t('update.availableShort', { version: status.version })
    case 'downloading':
      return t('update.downloading', { percent: status.percent })
    case 'ready':
      return t('update.inlineReady')
    case 'up-to-date':
      return t('update.upToDateShort')
    case 'error':
      return t('update.inlineCheckFailed')
    default:
      return ''
  }
})
const updateBusy = computed(
  () => updatePending.value || state.updateStatus.phase === 'checking' || state.updateStatus.phase === 'downloading'
)

async function runUpdateAction(action: 'check' | 'apply' = 'check'): Promise<void> {
  if (updateBusy.value) return
  updatePending.value = true
  updateCheckingPending.value = action === 'check'
  updateActionError.value = ''
  try {
    const phase = state.updateStatus.phase
    if (action === 'apply' && phase === 'available') {
      state.updateStatus = (await window.inkdown.downloadUpdate()) as typeof state.updateStatus
    } else if (action === 'apply' && phase === 'ready') {
      if (!(await window.inkdown.restartToUpdate())) updateActionError.value = t('update.inlineActionFailed')
    } else {
      state.updateStatus = (await window.inkdown.checkForUpdates()) as typeof state.updateStatus
    }
  } catch {
    updateActionError.value = t('update.inlineActionFailed')
  } finally {
    updatePending.value = false
    updateCheckingPending.value = false
  }
}

function toggle(index: number): void {
  openIndex.value = openIndex.value === index ? -1 : index
}

/** 悬停时切换到相邻菜单（符合桌面应用习惯）。 */
function hover(index: number): void {
  if (openIndex.value !== -1) openIndex.value = index
}

function close(): void {
  openIndex.value = -1
}

async function run(item: MenuItem): Promise<void> {
  close()
  if (!item.command) return
  // 点击菜单后把焦点交还编辑器，避免快捷键失效
  await executeCommand(item.command, item.payload)
}

/** 最近打开：只取文件名展示，完整路径作为提示。 */
function recentName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** Show the currently effective shortcut, including user overrides. */
function accelerator(item: MenuItem): string {
  return item.command ? shortcutFor(item.command).replace(/CmdOrCtrl/g, 'Ctrl').replace(/Cmd/g, 'Win') : ''
}

function onGlobalPointerDown(e: PointerEvent): void {
  if (openIndex.value === -1) return
  const el = menuRef.value
  if (el && !el.contains(e.target as Node)) close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

// 点击别处或按 Esc 关闭菜单
if (typeof window !== 'undefined') {
  nextTick(() => {
    window.addEventListener('pointerdown', onGlobalPointerDown)
    window.addEventListener('keydown', onKeydown)
  })
}

defineExpose({ close })
</script>

<template>
  <div ref="menuRef" class="menu-bar">
    <div
      v-for="(group, index) in menus"
      :key="group.labelKey"
      class="menu-root"
      :class="{ open: openIndex === index }"
    >
      <button class="menu-label" @click="toggle(index)" @mouseenter="hover(index)">
        {{ t(group.labelKey) }}
      </button>
      <div v-if="openIndex === index" class="menu-panel" @click.stop>
        <template v-for="(item, i) in group.items" :key="i">
          <div v-if="item.separator" class="menu-sep" />
          <!-- 最近打开子菜单 -->
          <div v-else-if="item.submenu === 'recent'" class="menu-sub">
            <div class="menu-item menu-sub-trigger">
              <span class="menu-item-label">{{ t('menu.file.recent') }}</span>
              <span class="menu-item-accel">›</span>
            </div>
            <div class="menu-panel menu-sub-panel">
              <p v-if="!recentFiles.length" class="menu-empty">{{ t('menu.file.recentEmpty') }}</p>
              <template v-else>
                <button
                  v-for="p in recentFiles"
                  :key="p"
                  class="menu-item"
                  :title="p"
                  @click="run({ labelKey: '', command: 'file:openRecent', payload: p })"
                >
                  <span class="menu-item-label">{{ recentName(p) }}</span>
                </button>
                <div class="menu-sep" />
                <button class="menu-item" @click="run({ labelKey: '', command: 'file:clearRecent' })">
                  <span class="menu-item-label">{{ t('menu.file.clearRecent') }}</span>
                </button>
              </template>
            </div>
          </div>
          <div v-else-if="item.command === 'help:checkUpdate'" class="menu-update">
            <div class="menu-update-row" :class="`phase-${state.updateStatus.phase}`">
              <button
                class="menu-item menu-update-check"
                :disabled="updateBusy"
                :aria-busy="updateBusy"
                @click="runUpdateAction('check')"
              >
                <span class="menu-check" />
                <span class="menu-item-label">{{ t(item.labelKey) }}</span>
                <span class="menu-update-state" role="status" aria-live="polite" aria-atomic="true">
                  <span v-if="updateLabel" class="update-label">{{ updateLabel }}</span>
                  <span v-if="updateChecking" class="update-spinner" aria-hidden="true" />
                </span>
              </button>
              <button
                v-if="state.updateStatus.phase === 'available' || state.updateStatus.phase === 'ready'"
                class="menu-update-action"
                :disabled="updateBusy"
                :aria-label="t(state.updateStatus.phase === 'available' ? 'update.download' : 'update.restart')"
                :title="t(state.updateStatus.phase === 'available' ? 'update.download' : 'update.restart')"
                @click.stop="runUpdateAction('apply')"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path v-if="state.updateStatus.phase === 'available'" d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" />
                  <path v-else d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4M12.8 2v4h-4" />
                </svg>
              </button>
            </div>
            <div
              v-if="state.updateStatus.phase === 'downloading'"
              class="menu-update-progress"
              role="progressbar"
              :aria-label="t('update.downloading', { percent: state.updateStatus.percent })"
              :aria-valuenow="state.updateStatus.percent"
              :aria-valuemin="0"
              :aria-valuemax="100"
            >
              <span :style="{ transform: `scaleX(${state.updateStatus.percent / 100})` }" />
            </div>
            <p v-if="updateMessage" class="menu-update-message" role="status">{{ updateMessage }}</p>
          </div>
          <button v-else class="menu-item" @click="run(item)">
            <span class="menu-check">{{ item.checked ? '✓' : '' }}</span>
            <span class="menu-item-label">{{ t(item.labelKey) }}</span>
            <span v-if="accelerator(item)" class="menu-item-accel">{{ accelerator(item) }}</span>
          </button>
        </template>
      </div>
    </div>
    <div class="menu-spacer" />
    <span class="menu-app-name">{{ t('app.name') }}</span>
  </div>
</template>

<style scoped>
.menu-bar {
  display: flex;
  align-items: stretch;
  height: 30px;
  flex: none;
  background: var(--ty-tabbar-bg);
  border-bottom: 1px solid var(--ty-border);
  user-select: none;
  position: relative;
  z-index: 30;
}
.menu-root {
  position: relative;
  display: flex;
}
.menu-label {
  border: 0;
  padding: 0 10px;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  cursor: pointer;
}
.menu-label:hover,
.menu-root.open .menu-label {
  background: var(--ty-hover);
}
.menu-panel {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 230px;
  padding: 4px;
  border: 1px solid var(--ty-border);
  border-radius: 6px;
  background: var(--ty-bg);
  /* Keep the menu surface crisp; a huge blurred shadow becomes expensive
     while the editor below is repainting during scroll. */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  contain: layout;
  z-index: 40;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--ty-hover);
}
.menu-check {
  flex: none;
  width: 12px;
  color: var(--ty-accent);
  font-size: 11px;
}
.menu-item-label {
  flex: 1;
  white-space: nowrap;
}
.menu-item-accel {
  flex: none;
  color: var(--ty-muted);
  font-size: 11px;
}
.menu-empty {
  margin: 0;
  padding: 6px 10px;
  color: var(--ty-muted);
  font-size: 12px;
}
/* 最近打开的子菜单：默认收起，悬停展开 */
.menu-sub {
  position: relative;
}
.menu-sub-panel {
  display: none;
  top: -5px;
  left: 100%;
  max-height: 60vh;
  overflow-y: auto;
}
.menu-sub:hover > .menu-sub-panel {
  display: block;
}
.menu-sub-trigger {
  cursor: default;
}
.menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--ty-border);
}
.menu-spacer {
  flex: 1;
}
.menu-update-row {
  display: flex;
  align-items: stretch;
  border-radius: 4px;
}
.menu-update-row:hover {
  background: var(--ty-hover);
}
.menu-update-check {
  flex: 1;
  min-width: 0;
}
.menu-update-check:disabled {
  cursor: default;
}
.menu-update-check:disabled:hover {
  background: transparent;
}
.menu-update-state {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  color: var(--ty-muted);
  white-space: nowrap;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.phase-available .menu-update-state,
.phase-ready .menu-update-state {
  color: var(--ty-accent);
}
.menu-update-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  min-height: 28px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ty-accent);
  cursor: pointer;
}
.menu-update-action:hover:not(:disabled) {
  background: var(--ty-active);
}
.menu-update-check:focus-visible,
.menu-update-action:focus-visible {
  outline: 1px solid var(--ty-accent);
  outline-offset: -2px;
}
.menu-update-action:disabled {
  cursor: default;
  opacity: 0.6;
}
.menu-update-action svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.55;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.menu-update-progress {
  height: 2px;
  margin: 0 10px 4px 30px;
  overflow: hidden;
  border-radius: 1px;
  background: var(--ty-border);
}
.menu-update-progress > span {
  display: block;
  height: 100%;
  background: var(--ty-accent);
  transform-origin: left;
}
.menu-update-message {
  max-width: 280px;
  margin: 3px 10px 6px 30px;
  color: var(--ty-muted);
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 1.5;
}
.update-spinner {
  flex: none;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border: 1.3px solid color-mix(in srgb, var(--ty-muted) 38%, transparent);
  border-top-color: var(--ty-accent);
  border-radius: 50%;
  animation: update-spin 0.8s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .update-spinner { animation-duration: 2s; }
}
@keyframes update-spin {
  to { transform: rotate(360deg); }
}
.menu-app-name {
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: var(--ty-muted);
  font-size: 11px;
  letter-spacing: 0.5px;
}
</style>
