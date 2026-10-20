<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { state } from '../store'
import { useI18n } from '../composables/useI18n'
import iconUrl from '../assets/icon.png'

/**
 * 关于对话框。
 * 参考常见桌面应用：应用图标 + 名称 + 版本 + 版权与运行时信息，
 * 底部可复制版本信息，便于反馈问题时附带环境。
 */
const { t } = useI18n()

const versions = ref({ app: '', electron: '', chromium: '', node: '' })
const copied = ref(false)

onMounted(async () => {
  try {
    const v = await window.inkdown.getVersions()
    versions.value = v
  } catch {
    /* 读取失败则留空 */
  }
})

function close(): void {
  state.aboutVisible = false
}

async function copyInfo(): Promise<void> {
  const lines = [
    `${t('app.name')} ${versions.value.app}`,
    `Electron ${versions.value.electron}`,
    `Chromium ${versions.value.chromium}`,
    `Node ${versions.value.node}`
  ]
  await window.inkdown.writeClipboardText(lines.join('\n'))
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1800)
}

function openRepo(): void {
  void window.inkdown.openExternal('https://github.com/IoT-Joker/inkdown')
}
</script>

<template>
  <div class="about-mask" @click.self="close">
    <div class="about">
      <button class="about-close" :title="t('about.close')" @click="close">×</button>

      <img class="about-icon" :src="iconUrl" alt="Inkdown" />

      <h2 class="about-name">{{ t('app.name') }}</h2>
      <p class="about-version">{{ t('about.version', { version: versions.app }) }}</p>
      <p class="about-tagline">{{ t('about.tagline') }}</p>

      <div class="about-meta">
        <p>{{ t('about.builtOn') }}</p>
        <p>{{ t('about.license') }}</p>
        <p class="about-runtime">
          {{ t('about.electron', { electron: versions.electron }) }} ·
          {{ t('about.chromium', { chromium: versions.chromium }) }} ·
          {{ t('about.node', { node: versions.node }) }}
        </p>
      </div>

      <div class="about-actions">
        <button class="ty-btn" @click="openRepo">{{ t('menu.help.repo') }}</button>
        <button class="ty-btn" @click="copyInfo">
          {{ copied ? t('about.copied') : t('about.copy') }}
        </button>
        <button class="ty-btn primary" @click="close">{{ t('about.close') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}
.about {
  position: relative;
  width: min(420px, 92vw);
  padding: 32px 28px 24px;
  border: 1px solid var(--ty-border);
  border-radius: 12px;
  background: var(--ty-bg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
  text-align: center;
}
.about-close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ty-muted);
  font-size: 16px;
  cursor: pointer;
}
.about-close:hover {
  background: var(--ty-hover);
  color: var(--ty-text);
}
.about-icon {
  width: 88px;
  height: 88px;
  margin-bottom: 14px;
  border-radius: 20px;
}
.about-name {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--ty-text);
}
.about-version {
  margin: 6px 0 0;
  color: var(--ty-muted);
  font-size: 12px;
}
.about-tagline {
  margin: 10px 0 0;
  color: var(--ty-text);
  font-size: 13px;
}
.about-meta {
  margin: 18px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--ty-border);
  color: var(--ty-muted);
  font-size: 11px;
  line-height: 1.7;
}
.about-meta p {
  margin: 0;
}
.about-runtime {
  margin-top: 6px !important;
  word-break: break-word;
}
.about-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
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
