import type { TypraApi } from './index'

declare global {
  interface Window {
    typra: TypraApi
  }
}

export {}
