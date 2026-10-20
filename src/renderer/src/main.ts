import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles/app.css'
import './assets/styles/themes.css'
// muya 内核样式：包含编辑器结构、浮动工具与 KaTeX 字体
import '@muyajs/core/lib/core.css'

createApp(App).mount('#app')
