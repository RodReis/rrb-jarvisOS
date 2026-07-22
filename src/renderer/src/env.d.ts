/// <reference types="vite/client" />

import type { JarvisBridge } from '@shared/contracts/ipc'

declare global {
  interface Window {
    /** Ponte exposta pelo preload. É a única superfície main↔renderer. */
    jarvis: JarvisBridge
  }
}

export {}
