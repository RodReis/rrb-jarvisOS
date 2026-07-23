import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A estrutura segue docs/ARCHITECTURE.md (src/main, src/renderer, src/shared), não a
// convenção padrão do electron-vite (que espera o preload em src/preload) — por isso
// os entry points são explícitos.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/preload/index.ts') },
        // Preload sai como CommonJS (.cjs) de propósito: um preload ESM (.mjs) exigiria
        // `sandbox: false`, e o sandbox é critério de aceite da SPEC-Fundacao-01.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        // Só o renderer resolve `@design`: main e preload não têm o que fazer com o design
        // system, e é a mesma fronteira que a regra de lint guarda do outro lado.
        '@design': resolve(__dirname, 'src/design')
      }
    }
  }
})
