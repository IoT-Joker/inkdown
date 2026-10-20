<script setup lang="ts">
import { computed } from 'vue'
import { state } from '../store'
import { useI18n } from '../composables/useI18n'

/**
 * 键盘快捷键面板。
 * 与菜单栏同源，便于用户快速查阅；分组与菜单一致。
 */
const { t } = useI18n()

interface Group {
  labelKey: string
  items: Array<{ labelKey: string; accel: string }>
}

const groups = computed<Group[]>(() => [
  {
    labelKey: 'shortcuts.file',
    items: [
      { labelKey: 'menu.file.new', accel: 'Ctrl+N' },
      { labelKey: 'menu.file.open', accel: 'Ctrl+O' },
      { labelKey: 'menu.file.openFolder', accel: 'Ctrl+Shift+O' },
      { labelKey: 'menu.file.save', accel: 'Ctrl+S' },
      { labelKey: 'menu.file.saveAs', accel: 'Ctrl+Shift+S' },
      { labelKey: 'menu.file.closeTab', accel: 'Ctrl+W' },
      { labelKey: 'menu.file.preferences', accel: 'Ctrl+,' }
    ]
  },
  {
    labelKey: 'shortcuts.edit',
    items: [
      { labelKey: 'menu.edit.undo', accel: 'Ctrl+Z' },
      { labelKey: 'menu.edit.redo', accel: 'Ctrl+Shift+Z' },
      { labelKey: 'menu.edit.pastePlain', accel: 'Ctrl+Shift+V' },
      { labelKey: 'menu.edit.find', accel: 'Ctrl+F' },
      { labelKey: 'menu.edit.replace', accel: 'Ctrl+H' },
      { labelKey: 'menu.edit.insertTime', accel: '—' }
    ]
  },
  {
    labelKey: 'shortcuts.paragraph',
    items: [
      { labelKey: 'menu.paragraph.h1', accel: 'Ctrl+1' },
      { labelKey: 'menu.paragraph.h6', accel: 'Ctrl+6' },
      { labelKey: 'menu.paragraph.p', accel: 'Ctrl+0' },
      { labelKey: 'menu.paragraph.ul', accel: 'Ctrl+Shift+8' },
      { labelKey: 'menu.paragraph.ol', accel: 'Ctrl+Shift+7' },
      { labelKey: 'menu.paragraph.task', accel: 'Ctrl+Shift+9' },
      { labelKey: 'menu.paragraph.quote', accel: 'Ctrl+Shift+Q' },
      { labelKey: 'menu.paragraph.code', accel: 'Ctrl+Shift+K' },
      { labelKey: 'menu.paragraph.math', accel: 'Ctrl+Shift+M' }
    ]
  },
  {
    labelKey: 'shortcuts.format',
    items: [
      { labelKey: 'menu.format.strong', accel: 'Ctrl+B' },
      { labelKey: 'menu.format.emphasis', accel: 'Ctrl+I' },
      { labelKey: 'menu.format.underline', accel: 'Ctrl+U' },
      { labelKey: 'menu.format.strike', accel: 'Alt+Shift+5' },
      { labelKey: 'menu.format.inlineCode', accel: 'Ctrl+Shift+`' },
      { labelKey: 'menu.format.highlight', accel: 'Ctrl+Shift+H' },
      { labelKey: 'menu.format.inlineMath', accel: 'Ctrl+Shift+E' },
      { labelKey: 'menu.format.link', accel: 'Ctrl+L' },
      { labelKey: 'menu.format.image', accel: 'Ctrl+Shift+I' },
      { labelKey: 'menu.format.clear', accel: 'Ctrl+\\' }
    ]
  },
  {
    labelKey: 'shortcuts.view',
    items: [
      { labelKey: 'menu.view.toggleSidebar', accel: 'Ctrl+Shift+L' },
      { labelKey: 'menu.view.toggleOutline', accel: 'Ctrl+Shift+1' },
      { labelKey: 'menu.view.toggleSource', accel: 'Ctrl+/' },
      { labelKey: 'menu.view.toggleFocus', accel: 'F8' },
      { labelKey: 'menu.view.toggleTypewriter', accel: 'F9' },
      { labelKey: 'menu.view.zoomIn', accel: 'Ctrl+=' },
      { labelKey: 'menu.view.zoomOut', accel: 'Ctrl+-' },
      { labelKey: 'menu.view.fullscreen', accel: 'F11' },
      { labelKey: 'menu.view.devtools', accel: 'F12' }
    ]
  }
])

function close(): void {
  state.shortcutsVisible = false
}
</script>

<template>
  <div class="sc-mask" @click.self="close">
    <div class="sc-dialog">
      <header class="sc-head">
        <h2>{{ t('shortcuts.title') }}</h2>
        <button class="ty-btn" @click="close">×</button>
      </header>

      <div class="sc-body">
        <section v-for="g in groups" :key="g.labelKey" class="sc-group">
          <h3>{{ t(g.labelKey) }}</h3>
          <div class="sc-rows">
            <div v-for="it in g.items" :key="it.labelKey" class="sc-row">
              <span class="sc-label">{{ t(it.labelKey) }}</span>
              <kbd class="sc-key">{{ it.accel }}</kbd>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sc-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}
.sc-dialog {
  display: flex;
  flex-direction: column;
  width: min(720px, 94vw);
  max-height: 86vh;
  border: 1px solid var(--ty-border);
  border-radius: 10px;
  background: var(--ty-bg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
  overflow: hidden;
}
.sc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ty-border);
}
.sc-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.sc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 18px;
  column-count: 2;
  column-gap: 28px;
}
.sc-group {
  break-inside: avoid;
  margin-bottom: 14px;
}
.sc-group h3 {
  margin: 12px 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--ty-muted);
}
.sc-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--ty-text);
}
.sc-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-key {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-sidebar-bg);
  color: var(--ty-muted);
  font-family: inherit;
  font-size: 11px;
}
</style>
