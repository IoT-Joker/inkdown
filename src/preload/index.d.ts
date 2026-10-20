import type { InkdownApi } from './index'

declare global {
  interface Window {
    inkdown: InkdownApi
  }
}

export {}
