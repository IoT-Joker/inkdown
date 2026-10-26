<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { exportPreview as model, updateExportOptions, closeExportPreview, saveExportPreview, showExportPage, retryExportPreview } from '../composables/useExport'
import { DEFAULT_EXPORT_OPTIONS, normalizeExportOptions, type ExportOptions } from '../../../shared/exportOptions'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const busy = computed(() => model.phase !== 'ready' || model.pageBusy)
const formatLabel = computed(() => model.format === 'docx' ? 'Word' : model.format.toUpperCase())
const preset = ref('custom')
const fontDraft = ref<number | string>(model.options.fontSize)
watch(() => model.options.fontSize, value => { fontDraft.value = value })
let previousFocus: HTMLElement | null = null

function change(key: keyof ExportOptions, event: Event): void {
  const target = event.target as HTMLInputElement
  const value = target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value
  preset.value = 'custom'
  updateExportOptions({ ...model.options, [key]: value })
  if (key === 'fontSize') fontDraft.value = model.options.fontSize
}
function margin(side: keyof ExportOptions['marginMm'], event: Event): void {
  preset.value = 'custom'
  updateExportOptions({ ...model.options, marginMm: { ...model.options.marginMm, [side]: Number((event.target as HTMLInputElement).value) } })
}
function applyPreset(event: Event): void {
  preset.value = (event.target as HTMLSelectElement).value
  if (preset.value === 'custom') return
  const compact = preset.value === 'compact', reading = preset.value === 'reading'
  updateExportOptions(normalizeExportOptions({ ...DEFAULT_EXPORT_OPTIONS, fontSize: compact ? 10 : reading ? 14 : 12,
    marginMm: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, compact ? 10 : reading ? 20 : 15])) }))
}
function keyboard(event: KeyboardEvent): void {
  if (!model.visible) return
  // Keep application editing shortcuts from running behind the modal.
  event.stopImmediatePropagation()
  if (event.key === 'Escape') { event.preventDefault(); closeExportPreview(); return }
  if (event.key !== 'Tab') return
  const controls = [...(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])]
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || !root.value?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
watch(() => model.visible, visible => {
  if (visible) {
    fontDraft.value = model.options.fontSize
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    preset.value = 'custom'
    window.addEventListener('keydown', keyboard, true)
    nextTick(() => closeButton.value?.focus())
  } else {
    window.removeEventListener('keydown', keyboard, true)
    previousFocus?.focus({ preventScroll: true })
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', keyboard, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="model.visible" class="export-overlay">
      <section ref="root" class="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header class="export-header">
          <div><h2 id="export-title">{{ t('export.title') }} <span>{{ formatLabel }}</span></h2><p :title="model.title">{{ model.title }}</p></div>
          <button ref="closeButton" class="export-close" :disabled="model.phase === 'saving'" :aria-label="t('export.close')" @click="closeExportPreview()">×</button>
        </header>
        <div class="export-body">
          <aside class="export-settings">
            <label>{{ t('export.preset') }}<select :value="preset" :disabled="model.phase === 'saving'" @change="applyPreset">
              <option value="custom">{{ t('export.lastUsed') }}</option><option value="standard">{{ t('export.standard') }}</option><option value="compact">{{ t('export.compact') }}</option><option value="reading">{{ t('export.reading') }}</option>
            </select></label>
            <div class="export-two-fields">
              <label>{{ t('export.paper') }}<select data-export="pageSize" :value="model.options.pageSize" :disabled="model.phase === 'saving'" @change="change('pageSize', $event)"><option>A4</option><option>A5</option><option>Letter</option></select></label>
              <label>{{ t('export.orientation') }}<select :value="model.options.orientation" :disabled="model.phase === 'saving'" @change="change('orientation', $event)"><option value="portrait">{{ t('export.portrait') }}</option><option value="landscape">{{ t('export.landscape') }}</option></select></label>
            </div>
            <fieldset :disabled="model.phase === 'saving'"><legend>{{ t('export.margins') }} <span>mm</span></legend><div class="export-two-fields">
              <label v-for="side in (['top','bottom','left','right'] as const)" :key="side">{{ t(`export.${side}`) }}<input type="number" min="0" max="50" step="1" :value="model.options.marginMm[side]" @change="margin(side, $event)" /></label>
            </div></fieldset>
            <label>{{ t('export.fontSize') }} <span>pt</span><input data-export="fontSize" type="number" min="8" max="24" step="1" v-model="fontDraft" :disabled="model.phase === 'saving'" @change="change('fontSize', $event)" @keydown.enter.prevent="change('fontSize', $event)" /></label>
            <label class="export-checkbox"><input type="checkbox" :checked="model.options.pageNumbers" :disabled="model.phase === 'saving'" @change="change('pageNumbers', $event)" />{{ t('export.pageNumbers') }}</label>
            <p class="export-remember">{{ t('export.remember') }}</p>
            <p class="export-format-note">{{ model.format === 'pdf' ? t('export.pdfNote') : model.format === 'docx' ? t('export.wordNote') : t('export.htmlNote') }}</p>
          </aside>
          <div class="export-preview-pane" :aria-busy="busy">
            <div v-if="model.pageImage" class="export-page-stage"><img class="export-pdf-preview" :src="model.pageImage" :alt="t('export.preview')" /><div class="export-page-nav"><button :disabled="busy || model.page <= 1" :aria-label="t('export.previousPage')" @click="showExportPage(model.page - 1)">‹</button><span>{{ model.page }} / {{ model.pageCount }}</span><button :disabled="busy || model.page >= model.pageCount" :aria-label="t('export.nextPage')" @click="showExportPage(model.page + 1)">›</button></div></div>
            <div v-else class="export-preview-placeholder" role="status"><span v-if="busy" class="export-spinner" />{{ busy ? t('export.generating') : t('export.noPreview') }}</div>
            <div v-if="busy && model.pageImage" class="export-updating" role="status"><span class="export-spinner" />{{ t('export.updating') }}</div>
            <div v-else-if="model.pageImage && !model.imageReady" class="export-updating" role="status">{{ t('export.outdated') }}</div>
          </div>
        </div>
        <div v-if="model.error" class="export-error" role="alert"><span>{{ model.error }}</span><button class="ty-btn" :disabled="busy" @click="retryExportPreview">{{ t('export.retry') }}</button></div>
        <footer class="export-footer"><span role="status">{{ busy ? t('export.generating') : model.imageReady ? t('export.ready') : t('export.noPreview') }}</span><button class="ty-btn" :disabled="model.phase === 'saving'" @click="closeExportPreview()">{{ t('export.cancel') }}</button><button class="ty-btn export-save" :disabled="busy || !model.imageReady || !model.pageImage || !model.pdfUrl" @click="saveExportPreview">{{ model.phase === 'saving' ? t('export.saving') : t('export.save') }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.export-overlay{position:fixed;inset:0;z-index:10000;background:rgb(0 0 0 / 35%);display:grid;place-items:center;padding:16px;color:var(--ty-text);font-size:13px}
.export-dialog{display:flex;flex-direction:column;width:min(1200px,96vw);height:min(870px,94vh);min-height:400px;border:1px solid var(--ty-border);border-radius:12px;background:var(--ty-bg);box-shadow:0 18px 65px rgb(0 0 0 / 22%);overflow:hidden}
.export-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--ty-border)}
.export-header h2{font-size:17px;margin:0;display:flex;gap:10px;align-items:center}.export-header h2 span{font-size:11px;font-weight:500;padding:3px 7px;border-radius:5px;color:var(--ty-accent);background:var(--ty-active)}.export-header p{margin:5px 0 0;color:var(--ty-muted);max-width:65vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.export-close{width:32px;height:32px;background:transparent;border:0;border-radius:6px;color:var(--ty-text);font-size:24px;cursor:pointer}.export-close:hover{background:var(--ty-hover)}
.export-body{display:flex;flex:1;min-height:0}.export-settings{width:260px;flex:none;padding:20px;overflow:auto;border-right:1px solid var(--ty-border);background:var(--ty-sidebar-bg)}
.export-settings label{display:flex;flex-direction:column;gap:7px;margin-bottom:16px}.export-settings label span,legend span{color:var(--ty-muted)}
.export-settings input[type=number],.export-settings select{width:100%;box-sizing:border-box;height:33px;padding:4px 8px;border:1px solid var(--ty-border);border-radius:5px;background:var(--ty-bg);color:var(--ty-text);font:inherit}
.export-two-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.export-settings fieldset{border:0;padding:0;margin:0 0 2px;min-width:0}.export-settings legend{margin-bottom:9px;padding:0}.export-settings fieldset label{font-size:12px;color:var(--ty-muted)}
.export-checkbox{display:flex!important;flex-direction:row!important;align-items:center;gap:8px!important;font-size:12px;line-height:1.5}.export-checkbox input{accent-color:var(--ty-accent);flex:none}
.export-remember,.export-format-note{color:var(--ty-muted);font-size:12px;line-height:1.65}.export-format-note{padding-top:12px;border-top:1px solid var(--ty-border)}
.export-preview-pane{position:relative;flex:1;min-width:0;background:var(--ty-hover);display:grid;place-items:center}.export-page-stage{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;align-items:center;padding:16px;box-sizing:border-box}.export-pdf-preview{display:block;flex:1;min-height:0;max-height:calc(100% - 40px);max-width:100%;object-fit:contain}.export-page-nav{display:flex;gap:16px;align-items:center;margin-top:10px;height:30px;flex:none;color:var(--ty-text)}.export-page-nav button{border:1px solid var(--ty-border);background:var(--ty-bg);color:var(--ty-text);border-radius:5px;width:30px;height:28px;font-size:20px;cursor:pointer}.export-preview-placeholder{color:var(--ty-muted);display:flex;align-items:center;gap:10px}
.export-updating{position:absolute;top:12px;right:12px;display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--ty-border);border-radius:6px;background:var(--ty-bg);color:var(--ty-muted);font-size:12px;box-shadow:0 2px 8px rgb(0 0 0 / 8%)}
.export-spinner{width:17px;height:17px;border:2px solid var(--ty-border);border-top-color:var(--ty-accent);border-radius:50%;animation:export-spin .8s linear infinite}
.export-error{display:flex;align-items:center;gap:12px;padding:9px 20px;background:var(--ty-active);border-top:1px solid var(--ty-border);overflow-wrap:anywhere;max-height:90px;overflow:auto}
.export-error>span{flex:1}.export-error button{flex:none}
.export-footer{display:flex;gap:10px;align-items:center;padding:12px 20px;border-top:1px solid var(--ty-border)}.export-footer>span{flex:1;font-size:12px;color:var(--ty-muted)}.export-save{background:var(--ty-accent);color:#fff;border-color:transparent;min-width:100px}.export-dialog :focus-visible{outline:2px solid var(--ty-accent);outline-offset:2px}.export-dialog button:disabled{opacity:.5;cursor:default}
@keyframes export-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.export-spinner{animation:none}}@media(max-width:780px){.export-settings{width:210px;padding:12px}.export-dialog{height:95vh}.export-header,.export-footer{padding:12px}}
</style>
