import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/** muya 内核以源码形式引入（packages/muya/src），需要把 TS/CSS 交给 Vite 处理。 */
const muyaSrc = resolve(__dirname, 'packages/muya/src')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@muyajs/core': muyaSrc
      }
    },
    // muya 源码目录允许被 Vite 处理（不在默认的 node_modules 排除规则内）
    server: {
      fs: { allow: [resolve(__dirname)] }
    },
    optimizeDeps: {
      // 内核是源码，不需要预打包
      exclude: ['@muyajs/core']
    },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
