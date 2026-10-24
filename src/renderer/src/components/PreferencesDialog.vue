<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { settings, state, persistSettings, persistView } from '../store'
import { useI18n } from '../composables/useI18n'

const { t, locale, localeOptions, setAppLocale } = useI18n()
const draft = reactive({ ...settings })

const themeOptions = computed(() => [
  { value: 'light' as const, label: t('theme.light') },
  { value: 'dark' as const, label: t('theme.dark') },
  { value: 'github' as const, label: t('theme.github') },
  { value: 'newsprint' as const, label: t('theme.newsprint') },
  { value: 'night' as const, label: t('theme.night') }
])

function save(): void {
  Object.assign(settings, draft)
  persistSettings()
  window.dispatchEvent(new CustomEvent('inkdown:settings-changed'))
  state.preferencesVisible = false
}

function cancel(): void {
  state.preferencesVisible = false
}

function setTheme(theme: typeof state.theme): void {
  state.theme = theme
  persistView()
}

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
      return t('update.readyShort', { version: status.version })
    case 'up-to-date':
      return t('update.upToDateShort')
    case 'error':
      return t('update.failedShort')
    case 'dev':
      return t('update.devModeShort')
    default:
      return t('update.idle')
  }
})

const updateBusy = computed(
  () => state.updateStatus.phase === 'checking' || state.updateStatus.phase === 'downloading'
)

const updateDetail = computed(() => {
  const status = state.updateStatus
  if (status.message) return status.message
  if (status.phase === 'up-to-date' && status.current) {
    return t('update.upToDateDetail', { current: status.current })
  }
  if (status.phase === 'available') {
    return t('update.availableDetail', {
      current: status.current,
      version: status.version
    })
  }
  return ''
})

async function runUpdateAction(): Promise<void> {
  const phase = state.updateStatus.phase
  if (phase === 'available') {
    state.updateStatus = (await window.inkdown.downloadUpdate()) as typeof state.updateStatus
    return
  }
  if (phase === 'ready') {
    await window.inkdown.restartToUpdate()
    return
  }
  state.updateStatus = (await window.inkdown.checkForUpdates()) as typeof state.updateStatus
}

onMounted(async () => {
  try {
    state.updateStatus = (await window.inkdown.getUpdateStatus()) as typeof state.updateStatus
  } catch {
    /* 偏好设置仍应可用。 */
  }
})
</script>

<template>
  <div class="dialog-mask" @click.self="cancel">
    <div class="dialog">
      <header class="dialog-head">
        <h2>{{ t('pref.title') }}</h2>
        <button class="ty-btn" @click="cancel">×</button>
      </header>

      <div class="dialog-body">
        <section class="group">
          <h3>{{ t('pref.appearance') }}</h3>
          <div class="row">
            <label>{{ t('pref.language') }}</label>
            <select
              class="sel"
              :value="locale"
              @change="setAppLocale(($event.target as HTMLSelectElement).value as 'zh-CN' | 'en')"
            >
              <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="row">
            <label>{{ t('pref.theme') }}</label>
            <div class="theme-list">
              <button
                v-for="opt in themeOptions"
                :key="opt.value"
                class="theme-chip"
                :class="{ on: state.theme === opt.value }"
                @click="setTheme(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <div class="row">
            <label>{{ t('pref.fontSize') }}</label>
            <input v-model.number="draft.fontSize" type="range" min="12" max="28" step="1" />
            <span class="value">{{ draft.fontSize }} px</span>
          </div>
          <div class="row">
            <label>{{ t('pref.lineHeight') }}</label>
            <input v-model.number="draft.lineHeight" type="range" min="1.2" max="2.4" step="0.1" />
            <span class="value">{{ draft.lineHeight.toFixed(1) }}</span>
          </div>
          <div class="row">
            <label>{{ t('pref.codeFontSize') }}</label>
            <input v-model.number="draft.codeFontSize" type="range" min="10" max="22" step="1" />
            <span class="value">{{ draft.codeFontSize }} px</span>
          </div>
          <div class="row">
            <label>{{ t('pref.wrapCode') }}</label>
            <input v-model="draft.wrapCodeBlocks" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.orbOpacity') }}</label>
            <input v-model.number="draft.orbMenuOpacity" type="range" min="0.75" max="1" step="0.01" />
            <span class="value">{{ Math.round(draft.orbMenuOpacity * 100) }}%</span>
          </div>
          <div class="row">
            <label>{{ t('pref.orbFontSize') }}</label>
            <input v-model.number="draft.orbFontSize" type="range" min="11" max="14" step="0.5" />
            <span class="value">{{ draft.orbFontSize }} px</span>
          </div>
          <div class="row">
            <label>{{ t('pref.orbAnimations') }}</label>
            <input v-model="draft.orbAnimations" type="checkbox" />
          </div>
        </section>

        <section class="group">
          <h3>{{ t('pref.file') }}</h3>
          <div class="row">
            <label>{{ t('pref.autoSave') }}</label>
            <input v-model="draft.autoSave" type="checkbox" />
            <span class="hint">{{ t('pref.autoSaveHint') }}</span>
          </div>
          <div class="row">
            <label>{{ t('pref.autoSaveDelay') }}</label>
            <input v-model.number="draft.autoSaveDelay" type="range" min="500" max="5000" step="100" />
            <span class="value">{{ draft.autoSaveDelay }} ms</span>
          </div>
          <div class="row">
            <label>{{ t('pref.bulletMarker') }}</label>
            <select v-model="draft.bulletListMarker" class="sel">
              <option value="-">{{ t('pref.bulletDash') }}</option>
              <option value="*">{{ t('pref.bulletStar') }}</option>
              <option value="+">{{ t('pref.bulletPlus') }}</option>
            </select>
          </div>
        </section>

        <section class="group">
          <h3>{{ t('pref.editing') }}</h3>
          <div class="row">
            <label>{{ t('pref.autoPairBracket') }}</label>
            <input v-model="draft.autoPairBracket" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.autoPairMarkdown') }}</label>
            <input v-model="draft.autoPairMarkdownSyntax" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.autoPairQuote') }}</label>
            <input v-model="draft.autoPairQuote" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.tabSize') }}</label>
            <input v-model.number="draft.tabSize" type="number" min="1" max="8" class="num" />
          </div>
          <div class="row">
            <label>{{ t('pref.listIndentation') }}</label>
            <input v-model.number="draft.listIndentation" type="number" min="1" max="4" class="num" />
          </div>
          <div class="row">
            <label>{{ t('pref.looseListItem') }}</label>
            <input v-model="draft.preferLooseListItem" type="checkbox" />
          </div>
        </section>

        <section class="group">
          <h3>{{ t('pref.markdown') }}</h3>
          <div class="row">
            <label>{{ t('pref.frontMatter') }}</label>
            <input v-model="draft.frontMatter" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.superSubScript') }}</label>
            <input v-model="draft.superSubScript" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.footnote') }}</label>
            <input v-model="draft.footnote" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.texMathDollars') }}</label>
            <input v-model="draft.texMathDollars" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.texMathGfm') }}</label>
            <input v-model="draft.texMathGfm" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.codeLineNumbers') }}</label>
            <input v-model="draft.codeBlockLineNumbers" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.githubAlerts') }}</label>
            <input v-model="draft.githubAlerts" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.multilineBlockquote') }}</label>
            <input v-model="draft.multilineBlockquote" type="checkbox" />
          </div>
        </section>

        <section class="group">
          <h3>{{ t('pref.update') }}</h3>
          <div class="row">
            <label>{{ t('pref.autoCheckUpdate') }}</label>
            <input v-model="draft.autoCheckUpdate" type="checkbox" />
          </div>
          <div class="row">
            <span class="hint">{{ t('pref.autoCheckUpdateHint') }}</span>
          </div>
          <div class="update-row">
            <div class="update-copy">
              <span class="update-title">{{ updateLabel }}</span>
              <span v-if="updateDetail" class="update-detail">{{ updateDetail }}</span>
              <span v-if="state.updateStatus.phase === 'downloading'" class="update-progress">
                <span :style="{ width: `${state.updateStatus.percent}%` }" />
              </span>
            </div>
            <button
              class="update-action"
              :class="{ ready: state.updateStatus.phase === 'ready' }"
              :disabled="updateBusy || state.updateStatus.phase === 'dev'"
              :title="updateLabel"
              :aria-label="updateLabel"
              @click="runUpdateAction"
            >
              <span v-if="state.updateStatus.phase === 'checking'" class="update-spinner" />
              <svg v-else-if="state.updateStatus.phase === 'up-to-date'" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3 8.4 3.1 3.1L13 4.8" />
              </svg>
              <svg v-else-if="state.updateStatus.phase === 'ready' || state.updateStatus.phase === 'available'" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" />
              </svg>
              <svg v-else-if="state.updateStatus.phase === 'error'" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4M12.8 2v4h-4" />
              </svg>
              <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                <path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4M12.8 2v4h-4" />
              </svg>
              <span class="update-action-text">{{ t('update.retry') }}</span>
            </button>
          </div>
        </section>

        <section class="group">
          <h3>{{ t('pref.view') }}</h3>
          <div class="row">
            <label>{{ t('pref.spellcheck') }}</label>
            <input v-model="draft.spellcheckEnabled" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.hideQuickInsert') }}</label>
            <input v-model="draft.hideQuickInsertHint" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.hideLinkPopup') }}</label>
            <input v-model="draft.hideLinkPopup" type="checkbox" />
          </div>
          <div class="row">
            <label>{{ t('pref.disableHtml') }}</label>
            <input v-model="draft.disableHtml" type="checkbox" />
          </div>
        </section>
      </div>

      <footer class="dialog-foot">
        <button class="ty-btn" @click="cancel">{{ t('pref.cancel') }}</button>
        <button class="ty-btn primary" @click="save">{{ t('pref.save') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.dialog {
  display: flex;
  flex-direction: column;
  width: min(640px, 92vw);
  max-height: 86vh;
  border-radius: 8px;
  background: var(--ty-bg);
  border: 1px solid var(--ty-border);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ty-border);
}
.dialog-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 16px;
}
.group {
  padding: 12px 0;
  border-bottom: 1px solid var(--ty-border);
}
.group:last-child {
  border-bottom: 0;
}
.group h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--ty-muted);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 13px;
}
.row > label {
  flex: none;
  width: 190px;
  color: var(--ty-text);
}
.row input[type='range'] {
  flex: 1;
  accent-color: var(--ty-accent);
}
.row input[type='checkbox'] {
  accent-color: var(--ty-accent);
}
.row input.num {
  width: 64px;
  padding: 3px 6px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-bg);
  color: var(--ty-text);
}
.value {
  flex: none;
  width: 52px;
  color: var(--ty-muted);
  font-size: 12px;
}
.hint {
  color: var(--ty-muted);
  font-size: 11px;
}
.update-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 10px 11px;
  border: 1px solid var(--ty-border);
  border-radius: 7px;
  background: var(--ty-sidebar-bg);
}
.update-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.update-title {
  color: var(--ty-text);
  font-size: 12px;
  font-weight: 600;
}
.update-detail {
  overflow: hidden;
  color: var(--ty-muted);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
}
.update-progress {
  display: block;
  height: 3px;
  margin-top: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ty-border);
}
.update-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ty-accent);
  transition: width 0.2s ease;
}
.update-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: none;
  min-width: 34px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--ty-border);
  border-radius: 6px;
  background: var(--ty-bg);
  color: var(--ty-text);
  cursor: pointer;
}
.update-action:hover:not(:disabled) {
  border-color: var(--ty-accent);
  color: var(--ty-accent);
  background: var(--ty-active);
}
.update-action:disabled {
  cursor: default;
  opacity: 0.62;
}
.update-action.ready {
  border-color: var(--ty-accent);
  background: var(--ty-accent);
  color: #fff;
}
.update-action svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.update-action-text {
  font-size: 11px;
}
.update-spinner {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 1.5px solid var(--ty-border);
  border-top-color: var(--ty-accent);
  border-radius: 50%;
  animation: update-spin 0.8s linear infinite;
}
@keyframes update-spin {
  to { transform: rotate(360deg); }
}
.sel {
  padding: 3px 6px;
  border: 1px solid var(--ty-border);
  border-radius: 4px;
  background: var(--ty-bg);
  color: var(--ty-text);
  font-size: 12px;
}
.theme-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.theme-chip {
  padding: 4px 12px;
  border: 1px solid var(--ty-border);
  border-radius: 14px;
  background: transparent;
  color: var(--ty-text);
  font-size: 12px;
  cursor: pointer;
}
.theme-chip.on {
  border-color: var(--ty-accent);
  color: var(--ty-accent);
  background: var(--ty-active);
}
.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--ty-border);
}
.primary {
  border-color: var(--ty-accent);
  background: var(--ty-accent);
  color: #fff;
}
.primary:hover {
  opacity: 0.9;
  background: var(--ty-accent);
}
</style>
