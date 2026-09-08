import { resolve } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin, type Plugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A estrutura segue docs/ARCHITECTURE.md (src/main, src/renderer, src/shared), não a
// convenção padrão do electron-vite (que espera o preload em src/preload) — por isso
// os entry points são explícitos.
/**
 * O sidecar de voz é **script Python**, não módulo do bundle (SPEC-Voz-01).
 *
 * O Rollup não o enxerga: nada o importa — quem o executa é o runtime Python, por caminho. Sem
 * copiá-lo, `out/main/` sai sem o arquivo e a transcrição falha em produção com "arquivo não
 * encontrado", enquanto passa em desenvolvimento, onde o caminho ainda alcança `src/`.
 */
function copiarSidecarDeVoz(): Plugin {
  return {
    name: 'copiar-sidecar-de-voz',
    writeBundle(): void {
      const destino = resolve(__dirname, 'out/main')
      mkdirSync(destino, { recursive: true })
      copyFileSync(
        resolve(__dirname, 'src/main/voz/sidecar-stt.py'),
        resolve(destino, 'sidecar-stt.py')
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copiarSidecarDeVoz()],
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
