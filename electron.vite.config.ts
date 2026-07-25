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
    // Porta fixa 5180 com strictPort: se ocupada, falha em vez de saltar de porta
    // (CLAUDE.md § Portas). Porta que "se conserta sozinha" faz abrir a tela do
    // processo errado sem perceber — falha silenciosa que o projeto trata como pior
    // que falha ruidosa. host 127.0.0.1 explícito porque no Windows `localhost` pode
    // resolver para IPv6 e confundir ferramenta que sonda IPv4 (armadilha da F03a).
    server: { host: '127.0.0.1', port: 5180, strictPort: true },
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
