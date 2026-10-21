<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { executeCommand } from '../composables/useCommands'
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
  accel?: string
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
      { labelKey: 'menu.file.new', command: 'file:new', accel: 'Ctrl+N' },
      { labelKey: 'menu.file.open', command: 'file:open', accel: 'Ctrl+O' },
      { labelKey: 'menu.file.openFolder', command: 'file:openFolder', accel: 'Ctrl+Shift+O' },
      { labelKey: 'menu.file.recent', submenu: 'recent' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.file.save', command: 'file:save', accel: 'Ctrl+S' },
      { labelKey: 'menu.file.saveAs', command: 'file:saveAs', accel: 'Ctrl+Shift+S' },
      { labelKey: 'menu.file.closeTab', command: 'file:closeTab', accel: 'Ctrl+W' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.file.exportHtml', command: 'file:exportHtml' },
      { labelKey: 'menu.file.exportPdf', command: 'file:exportPdf' },
      { labelKey: 'menu.file.exportDocx', command: 'file:exportDocx' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.file.preferences', command: 'app:preferences', accel: 'Ctrl+,' },
      { labelKey: 'menu.file.quit', command: 'file:quit' }
    ]
  },
  {
    labelKey: 'menu.edit',
    items: [
      { labelKey: 'menu.edit.undo', command: 'edit:undo', accel: 'Ctrl+Z' },
      { labelKey: 'menu.edit.redo', command: 'edit:redo', accel: 'Ctrl+Shift+Z' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.edit.pastePlain', command: 'edit:pastePlain', accel: 'Ctrl+Shift+V' },
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
      { labelKey: 'menu.edit.find', command: 'edit:find', accel: 'Ctrl+F' },
      { labelKey: 'menu.edit.replace', command: 'edit:replace', accel: 'Ctrl+H' },
      { labelKey: 'search.folder', command: 'edit:findInFolder', accel: 'Ctrl+Shift+F' }
    ]
  },
  {
    labelKey: 'menu.paragraph',
    items: [
      { labelKey: 'menu.paragraph.h1', command: 'paragraph:h1', accel: 'Ctrl+1' },
      { labelKey: 'menu.paragraph.h2', command: 'paragraph:h2', accel: 'Ctrl+2' },
      { labelKey: 'menu.paragraph.h3', command: 'paragraph:h3', accel: 'Ctrl+3' },
      { labelKey: 'menu.paragraph.h4', command: 'paragraph:h4', accel: 'Ctrl+4' },
      { labelKey: 'menu.paragraph.h5', command: 'paragraph:h5', accel: 'Ctrl+5' },
      { labelKey: 'menu.paragraph.h6', command: 'paragraph:h6', accel: 'Ctrl+6' },
      { labelKey: 'menu.paragraph.p', command: 'paragraph:p', accel: 'Ctrl+0' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.paragraph.ul', command: 'paragraph:ul', accel: 'Ctrl+Shift+8' },
      { labelKey: 'menu.paragraph.ol', command: 'paragraph:ol', accel: 'Ctrl+Shift+7' },
      { labelKey: 'menu.paragraph.task', command: 'paragraph:task', accel: 'Ctrl+Shift+9' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.paragraph.quote', command: 'paragraph:quote', accel: 'Ctrl+Shift+Q' },
      { labelKey: 'menu.paragraph.code', command: 'paragraph:code', accel: 'Ctrl+Shift+K' },
      { labelKey: 'menu.paragraph.math', command: 'paragraph:math', accel: 'Ctrl+Shift+M' },
      { labelKey: 'menu.paragraph.table', command: 'paragraph:table' },
      { labelKey: 'menu.paragraph.hr', command: 'paragraph:hr' },
      { labelKey: 'menu.paragraph.frontMatter', command: 'paragraph:frontMatter' }
    ]
  },
  {
    labelKey: 'menu.format',
    items: [
      { labelKey: 'menu.format.strong', command: 'format:strong', accel: 'Ctrl+B' },
      { labelKey: 'menu.format.emphasis', command: 'format:emphasis', accel: 'Ctrl+I' },
      { labelKey: 'menu.format.underline', command: 'format:underline', accel: 'Ctrl+U' },
      { labelKey: 'menu.format.strike', command: 'format:strike', accel: 'Alt+Shift+5' },
      { labelKey: 'menu.format.inlineCode', command: 'format:inlineCode', accel: 'Ctrl+Shift+`' },
      { labelKey: 'menu.format.highlight', command: 'format:highlight', accel: 'Ctrl+Shift+H' },
      { labelKey: 'menu.format.inlineMath', command: 'format:inlineMath', accel: 'Ctrl+Shift+E' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.format.link', command: 'format:link', accel: 'Ctrl+L' },
      { labelKey: 'menu.format.image', command: 'format:image', accel: 'Ctrl+Shift+I' },
      { labelKey: 'menu.format.clear', command: 'format:clear', accel: 'Ctrl+\\' }
    ]
  },
  {
    labelKey: 'menu.view',
    items: [
      { labelKey: 'palette.title', command: 'app:commandPalette', accel: 'Ctrl+Shift+P' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.toggleSidebar', command: 'view:toggleSidebar', accel: 'Ctrl+Shift+L' },
      { labelKey: 'menu.view.toggleOutline', command: 'view:toggleOutline', accel: 'Ctrl+Shift+1' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.toggleSource', command: 'view:toggleSource', accel: 'Ctrl+/' },
      { labelKey: 'view.splitPreview', command: 'view:toggleSplit' },
      { labelKey: 'menu.view.toggleFocus', command: 'view:toggleFocus', accel: 'F8' },
      { labelKey: 'menu.view.toggleTypewriter', command: 'view:toggleTypewriter', accel: 'F9' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.toggleTheme', command: 'view:toggleTheme' },
      { labelKey: 'menu.view.zoomIn', command: 'view:zoomIn', accel: 'Ctrl+=' },
      { labelKey: 'menu.view.zoomOut', command: 'view:zoomOut', accel: 'Ctrl+-' },
      { labelKey: 'menu.view.zoomReset', command: 'view:zoomReset', accel: 'Ctrl+Shift+0' },
      { labelKey: '', separator: true },
      { labelKey: 'menu.view.fullscreen', command: 'view:fullscreen' },
      { labelKey: 'menu.view.devtools', command: 'view:devtools', accel: 'F12' }
    ]
  },
  {
    labelKey: 'menu.help',
    items: [
      { labelKey: 'menu.help.shortcuts', command: 'help:shortcuts', accel: 'Ctrl+Shift+/' },
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
          <button v-else class="menu-item" @click="run(item)">
            <span class="menu-check">{{ item.checked ? '✓' : '' }}</span>
            <span class="menu-item-label">{{ t(item.labelKey) }}</span>
            <span v-if="item.accel" class="menu-item-accel">{{ item.accel }}</span>
          </button>
        </template>
      </div>
    </div>
    <!-- 右侧：主题与语言快捷入口 -->
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
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.26);
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
.menu-app-name {
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: var(--ty-muted);
  font-size: 11px;
  letter-spacing: 0.5px;
}
</style>
