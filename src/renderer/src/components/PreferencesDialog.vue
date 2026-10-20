<script setup lang="ts">
import { reactive } from 'vue'
import { settings, state, persistSettings, persistView, type ViewMode } from '../store'

const draft = reactive({ ...settings })

const themeOptions: Array<{ value: typeof state.theme; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'github', label: 'GitHub' },
  { value: 'newsprint', label: '报刊' },
  { value: 'night', label: '夜间' }
]

function save(): void {
  Object.assign(settings, draft)
  persistSettings()
  window.dispatchEvent(new CustomEvent('typra:settings-changed'))
  state.preferencesVisible = false
}

function cancel(): void {
  state.preferencesVisible = false
}

function setTheme(theme: typeof state.theme): void {
  state.theme = theme
  persistView()
}
</script>

<template>
  <div class="dialog-mask" @click.self="cancel">
    <div class="dialog">
      <header class="dialog-head">
        <h2>偏好设置</h2>
        <button class="ty-btn" @click="cancel">×</button>
      </header>

      <div class="dialog-body">
        <section class="group">
          <h3>外观</h3>
          <div class="row">
            <label>主题</label>
            <div class="theme-list">
              <button
                v-for="t in themeOptions"
                :key="t.value"
                class="theme-chip"
                :class="{ on: state.theme === t.value }"
                @click="setTheme(t.value)"
              >
                {{ t.label }}
              </button>
            </div>
          </div>
          <div class="row">
            <label>编辑器字号</label>
            <input v-model.number="draft.fontSize" type="range" min="12" max="28" step="1" />
            <span class="value">{{ draft.fontSize }} px</span>
          </div>
          <div class="row">
            <label>行高</label>
            <input v-model.number="draft.lineHeight" type="range" min="1.2" max="2.4" step="0.1" />
            <span class="value">{{ draft.lineHeight.toFixed(1) }}</span>
          </div>
          <div class="row">
            <label>代码字号</label>
            <input v-model.number="draft.codeFontSize" type="range" min="10" max="22" step="1" />
            <span class="value">{{ draft.codeFontSize }} px</span>
          </div>
          <div class="row">
            <label>代码折行</label>
            <input v-model="draft.wrapCodeBlocks" type="checkbox" />
          </div>
        </section>

        <section class="group">
          <h3>编辑</h3>
          <div class="row">
            <label>自动配对括号</label>
            <input v-model="draft.autoPairBracket" type="checkbox" />
          </div>
          <div class="row">
            <label>自动配对 Markdown 语法</label>
            <input v-model="draft.autoPairMarkdownSyntax" type="checkbox" />
          </div>
          <div class="row">
            <label>自动配对引号</label>
            <input v-model="draft.autoPairQuote" type="checkbox" />
          </div>
          <div class="row">
            <label>Tab 宽度</label>
            <input v-model.number="draft.tabSize" type="number" min="1" max="8" class="num" />
          </div>
          <div class="row">
            <label>列表缩进</label>
            <input v-model.number="draft.listIndentation" type="number" min="1" max="4" class="num" />
          </div>
          <div class="row">
            <label>松散列表项</label>
            <input v-model="draft.preferLooseListItem" type="checkbox" />
          </div>
        </section>

        <section class="group">
          <h3>Markdown 语法</h3>
          <div class="row">
            <label>YAML 前言</label>
            <input v-model="draft.frontMatter" type="checkbox" />
          </div>
          <div class="row">
            <label>上下标</label>
            <input v-model="draft.superSubScript" type="checkbox" />
          </div>
          <div class="row">
            <label>脚注</label>
            <input v-model="draft.footnote" type="checkbox" />
          </div>
          <div class="row">
            <label>行内公式（$…$）</label>
            <input v-model="draft.texMathDollars" type="checkbox" />
          </div>
          <div class="row">
            <label>GFM 公式（```math）</label>
            <input v-model="draft.texMathGfm" type="checkbox" />
          </div>
          <div class="row">
            <label>代码块行号</label>
            <input v-model="draft.codeBlockLineNumbers" type="checkbox" />
          </div>
          <div class="row">
            <label>GitHub 告警块</label>
            <input v-model="draft.githubAlerts" type="checkbox" />
          </div>
          <div class="row">
            <label>多行引用</label>
            <input v-model="draft.multilineBlockquote" type="checkbox" />
          </div>
        </section>

        <section class="group">
          <h3>视图</h3>
          <div class="row">
            <label>拼写检查</label>
            <input v-model="draft.spellcheckEnabled" type="checkbox" />
          </div>
          <div class="row">
            <label>隐藏快捷插入提示</label>
            <input v-model="draft.hideQuickInsertHint" type="checkbox" />
          </div>
          <div class="row">
            <label>隐藏链接浮层</label>
            <input v-model="draft.hideLinkPopup" type="checkbox" />
          </div>
          <div class="row">
            <label>禁用 HTML</label>
            <input v-model="draft.disableHtml" type="checkbox" />
          </div>
        </section>
      </div>

      <footer class="dialog-foot">
        <button class="ty-btn" @click="cancel">取消</button>
        <button class="ty-btn primary" @click="save">保存</button>
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
