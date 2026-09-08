import { resolve } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A estrutura segue docs/ARCHITECTURE.md (src/main, src/renderer, src/shared), não a
// convenção padrão do electron-vite (que espera o preload em src/preload) — por isso
// os entry points são explícitos.
/**
 * Os sidecares de voz são **scripts Python**, não módulos do bundle (SPEC-Voz-01 e SPEC-Voz-02).
 *
 * O Rollup não os enxerga: nada os importa — quem os executa é o runtime Python, por caminho. Sem
 * copiá-los, `out/main/` sai sem os arquivos e a voz falha em produção com "arquivo não
 * encontrado", enquanto passa em desenvolvimento, onde o caminho ainda alcança `src/`.
 *
 * São dois porque os processos são separados (SPEC-Voz-02, decisão 3 do PI): transcrever e falar
 * não podem se derrubar, e o Whisper quer a GPU enquanto o Piper roda em CPU.
 */
const SIDECARES_DE_VOZ = ['sidecar-stt.py', 'sidecar-tts.py'] as const

function copiarSidecarDeVoz(): Plugin {
  return {
    name: 'copiar-sidecar-de-voz',
    writeBundle(): void {
      const destino = resolve(__dirname, 'out/main')
      mkdirSync(destino, { recursive: true })
      for (const arquivo of SIDECARES_DE_VOZ) {
        copyFileSync(resolve(__dirname, 'src/main/voz', arquivo), resolve(destino, arquivo))
      }
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
