import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles/app.css'
import './assets/styles/themes.css'
// muya 内核样式由其源码自行引入（muya.ts 顶部 import 各样式文件），
// 这里无需再单独 import 构建产物里的 core.css

window.addEventListener('error', (event) => {
  if (event.error) console.error('[renderer-exception]', event.error.stack || event.error.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer-rejection]', event.reason instanceof Error ? event.reason.stack : String(event.reason))
})

createApp(App).mount('#app')
