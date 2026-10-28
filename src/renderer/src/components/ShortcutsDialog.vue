<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { state } from '../store'
import { useI18n } from '../composables/useI18n'
import {
  DEFAULT_SHORTCUTS,
  captureShortcut,
  commandLabelKey,
  displayShortcutFor,
  persistShortcutOverrides,
  restoreDefaultShortcuts,
  shortcutFor,
  shortcutOverrides
} from '../composables/useCommands'

/**
 * 键盘快捷键面板。
 * 与菜单栏同源；支持直接点击按键重新录制，修改后同步原生菜单。
 */
const { t } = useI18n()

interface Group {
  labelKey: string
  items: Array<{ id: string; labelKey: string }>
}

const groups = computed<Group[]>(() => [
  {
    labelKey: 'shortcuts.file',
    items: [
      { id: 'file:new', labelKey: 'menu.file.new' },
      { id: 'file:open', labelKey: 'menu.file.open' },
      { id: 'file:openFolder', labelKey: 'menu.file.openFolder' },
      { id: 'file:save', labelKey: 'menu.file.save' },
      { id: 'file:saveAs', labelKey: 'menu.file.saveAs' },
      { id: 'file:closeTab', labelKey: 'menu.file.closeTab' },
      { id: 'file:print', labelKey: 'menu.file.print' },
      { id: 'app:preferences', labelKey: 'menu.file.preferences' }
    ]
  },
  {
    labelKey: 'shortcuts.edit',
    items: [
      { id: 'edit:undo', labelKey: 'menu.edit.undo' },
      { id: 'edit:redo', labelKey: 'menu.edit.redo' },
      { id: 'edit:pastePlain', labelKey: 'menu.edit.pastePlain' },
      { id: 'edit:find', labelKey: 'menu.edit.find' },
      { id: 'edit:replace', labelKey: 'menu.edit.replace' },
      { id: 'edit:findInFolder', labelKey: 'search.folder' }
    ]
  },
  {
    labelKey: 'shortcuts.paragraph',
    items: [
      { id: 'paragraph:h1', labelKey: 'menu.paragraph.h1' },
      { id: 'paragraph:h2', labelKey: 'menu.paragraph.h2' },
      { id: 'paragraph:h3', labelKey: 'menu.paragraph.h3' },
      { id: 'paragraph:h4', labelKey: 'menu.paragraph.h4' },
      { id: 'paragraph:h5', labelKey: 'menu.paragraph.h5' },
      { id: 'paragraph:h6', labelKey: 'menu.paragraph.h6' },
      { id: 'paragraph:p', labelKey: 'menu.paragraph.p' },
      { id: 'paragraph:ul', labelKey: 'menu.paragraph.ul' },
      { id: 'paragraph:ol', labelKey: 'menu.paragraph.ol' },
      { id: 'paragraph:task', labelKey: 'menu.paragraph.task' },
      { id: 'paragraph:quote', labelKey: 'menu.paragraph.quote' },
      { id: 'paragraph:code', labelKey: 'menu.paragraph.code' },
      { id: 'paragraph:math', labelKey: 'menu.paragraph.math' }
    ]
  },
  {
    labelKey: 'shortcuts.format',
    items: [
      { id: 'format:strong', labelKey: 'menu.format.strong' },
      { id: 'format:emphasis', labelKey: 'menu.format.emphasis' },
      { id: 'format:underline', labelKey: 'menu.format.underline' },
      { id: 'format:strike', labelKey: 'menu.format.strike' },
      { id: 'format:inlineCode', labelKey: 'menu.format.inlineCode' },
      { id: 'format:highlight', labelKey: 'menu.format.highlight' },
      { id: 'format:inlineMath', labelKey: 'menu.format.inlineMath' },
      { id: 'format:link', labelKey: 'menu.format.link' },
      { id: 'format:image', labelKey: 'menu.format.image' },
      { id: 'format:clear', labelKey: 'menu.format.clear' }
    ]
  },
  {
    labelKey: 'shortcuts.view',
    items: [
      { id: 'view:toggleSidebar', labelKey: 'menu.view.toggleSidebar' },
      { id: 'view:toggleOutline', labelKey: 'menu.view.toggleOutline' },
      { id: 'view:toggleSource', labelKey: 'menu.view.toggleSource' },
      { id: 'view:toggleFocus', labelKey: 'menu.view.toggleFocus' },
      { id: 'view:toggleTypewriter', labelKey: 'menu.view.toggleTypewriter' },
      { id: 'view:zoomIn', labelKey: 'menu.view.zoomIn' },
      { id: 'view:zoomOut', labelKey: 'menu.view.zoomOut' },
      { id: 'view:zoomReset', labelKey: 'menu.view.zoomReset' },
      { id: 'view:fullscreen', labelKey: 'menu.view.fullscreen' },
      { id: 'view:devtools', labelKey: 'menu.view.devtools' }
    ]
  }
])

const recordingId = ref<string | null>(null)
const conflict = ref('')
const dialogRef = ref<HTMLElement | null>(null)

function displayShortcut(id: string): string {
  return displayShortcutFor(id)
}

function startRecording(id: string): void {
  recordingId.value = recordingId.value === id ? null : id
  conflict.value = ''
  if (recordingId.value) nextTick(() => dialogRef.value?.focus())
}

function onCaptureKeydown(event: KeyboardEvent, id: string): void {
  if (event.key === 'Escape') {
    recordingId.value = null
    conflict.value = ''
    return
  }
  const captured = captureShortcut(event)
  if (!captured) return
  event.preventDefault()
  event.stopPropagation()

  const duplicate = DEFAULT_SHORTCUTS.find(
    (item) => item.id !== id && shortcutFor(item.id) === captured.accelerator
  )
  if (duplicate) {
    conflict.value = t('shortcuts.conflict', {
      action: t(commandLabelKey(duplicate.id))
    })
    return
  }

  shortcutOverrides[id] = captured.accelerator
  persistShortcutOverrides()
  recordingId.value = null
  conflict.value = ''
}

function resetDefaults(): void {
  restoreDefaultShortcuts()
  recordingId.value = null
  conflict.value = ''
}

function close(): void {
  recordingId.value = null
  conflict.value = ''
  state.shortcutsVisible = false
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (recordingId.value) {
      recordingId.value = null
      conflict.value = ''
    } else {
      close()
    }
    return
  }
  if (recordingId.value) onCaptureKeydown(event, recordingId.value)
}

watch(
  () => state.shortcutsVisible,
  (visible) => {
    if (!visible) {
      recordingId.value = null
      conflict.value = ''
    }
  }
)

onBeforeUnmount(() => {
  recordingId.value = null
})
</script>

<template>
  <div class="sc-mask" @click.self="close">
    <div
      ref="dialogRef"
      class="sc-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      tabindex="-1"
      @keydown="onDialogKeydown"
    >
      <header class="sc-head">
        <div class="sc-title-block">
          <h2 id="shortcuts-title">{{ t('shortcuts.title') }}</h2>
          <p>{{ t('shortcuts.editableHint') }}</p>
        </div>
        <div class="sc-head-actions">
          <button class="sc-reset" type="button" @click="resetDefaults">
            {{ t('shortcuts.reset') }}
          </button>
          <button class="sc-close" type="button" :aria-label="t('shortcuts.done')" @click="close">×</button>
        </div>
      </header>

      <div v-if="conflict" class="sc-conflict" role="alert">{{ conflict }}</div>

      <div class="sc-body">
        <section v-for="g in groups" :key="g.labelKey" class="sc-group">
          <h3>{{ t(g.labelKey) }}</h3>
          <div class="sc-rows">
            <div v-for="it in g.items" :key="it.id" class="sc-row">
              <span class="sc-label">{{ t(it.labelKey) }}</span>
              <button
                type="button"
                class="sc-key"
                :class="{ recording: recordingId === it.id }"
                :title="recordingId === it.id ? t('shortcuts.pressKeys') : t('shortcuts.clickToEdit')"
                @click="startRecording(it.id)"
              >
                {{ recordingId === it.id ? t('shortcuts.pressKeys') : displayShortcut(it.id) }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer class="sc-foot">
        <span class="sc-foot-hint">{{ t('shortcuts.footerHint') }}</span>
        <button class="sc-done" type="button" @click="close">{{ t('shortcuts.done') }}</button>
      </footer>
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
  width: min(820px, 94vw);
  max-height: min(760px, 88vh);
  border: 1px solid var(--ty-border);
  border-radius: 12px;
  background: var(--ty-bg);
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  outline: none;
}
.sc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--ty-border);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--ty-accent) 7%, transparent), transparent 55%),
    var(--ty-tabbar-bg);
}
.sc-title-block {
  min-width: 0;
}
.sc-title-block h2 {
  margin: 0;
  color: var(--ty-text);
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0.2px;
}
.sc-title-block p {
  margin: 5px 0 0;
  color: var(--ty-muted);
  font-size: 11px;
  line-height: 1.5;
}
.sc-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.sc-reset,
.sc-close {
  height: 28px;
  border: 1px solid var(--ty-border);
  border-radius: 6px;
  background: var(--ty-bg);
  color: var(--ty-muted);
  cursor: pointer;
}
.sc-reset {
  padding: 0 10px;
  font-size: 11px;
}
.sc-close {
  width: 28px;
  padding: 0;
  font-size: 17px;
  line-height: 1;
}
.sc-reset:hover,
.sc-close:hover {
  border-color: color-mix(in srgb, var(--ty-accent) 45%, var(--ty-border));
  background: var(--ty-hover);
  color: var(--ty-text);
}
.sc-conflict {
  flex: none;
  padding: 8px 18px;
  border-bottom: 1px solid color-mix(in srgb, #d65c5c 28%, var(--ty-border));
  background: color-mix(in srgb, #d65c5c 9%, var(--ty-bg));
  color: color-mix(in srgb, #d65c5c 78%, var(--ty-text));
  font-size: 11px;
}
.sc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 18px 18px;
  column-count: 2;
  column-gap: 32px;
  scrollbar-gutter: stable;
}
.sc-group {
  break-inside: avoid;
  margin-bottom: 12px;
  padding: 2px 0 6px;
}
.sc-group h3 {
  margin: 10px 0 5px;
  padding-bottom: 5px;
  border-bottom: 1px solid color-mix(in srgb, var(--ty-border) 68%, transparent);
  color: var(--ty-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.9px;
}
.sc-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 27px;
  padding: 1px 2px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--ty-text);
}
.sc-row:hover {
  background: color-mix(in srgb, var(--ty-hover) 58%, transparent);
}
.sc-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-key {
  flex: none;
  min-width: 72px;
  height: 23px;
  padding: 0 7px;
  border: 1px solid var(--ty-border);
  border-radius: 5px;
  background: var(--ty-sidebar-bg);
  color: var(--ty-muted);
  font-family: inherit;
  font-size: 11px;
  line-height: 21px;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease,
    color 0.12s ease;
}
.sc-key:hover {
  border-color: color-mix(in srgb, var(--ty-accent) 45%, var(--ty-border));
  background: var(--ty-bg);
  color: var(--ty-text);
}
.sc-key.recording {
  border-color: var(--ty-accent);
  background: var(--ty-active);
  color: var(--ty-accent);
  animation: key-recording 1.1s ease-in-out infinite;
}
@keyframes key-recording {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ty-accent) 18%, transparent);
  }
  50% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ty-accent) 12%, transparent);
  }
}
.sc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex: none;
  padding: 10px 18px;
  border-top: 1px solid var(--ty-border);
}
.sc-foot-hint {
  min-width: 0;
  overflow: hidden;
  color: var(--ty-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-done {
  flex: none;
  height: 28px;
  padding: 0 16px;
  border: 1px solid var(--ty-accent);
  border-radius: 6px;
  background: var(--ty-accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.sc-done:hover {
  filter: brightness(1.06);
}
@media (max-width: 680px) {
  .sc-body {
    column-count: 1;
  }
  .sc-foot-hint {
    display: none;
  }
  .sc-foot {
    justify-content: flex-end;
  }
}
</style>
