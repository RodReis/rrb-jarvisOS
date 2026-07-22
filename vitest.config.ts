import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * As três categorias do ADR-003 (docs/TESTING.md §2/§3) são três projects Vitest com
 * `include` distinto. O orquestrador (scripts/test-report.mjs) roda um project por vez
 * para produzir um `--json` e um coverage por categoria.
 *
 * - regras → unidade pura (src/shared, src/main), sem storage/IPC/rede
 * - banco  → integração com storage local; nasce vazia (Fatia 04 traz o SQLite)
 * - tela   → componente React em jsdom (E2E Playwright entra na Fatia 03)
 */
const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'regras',
          environment: 'node',
          include: ['src/{shared,main}/**/*.spec.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'banco',
          environment: 'node',
          include: ['src/main/**/*.int-spec.ts', 'tests/**/*.int-spec.ts'],
          // Integração toca disco e singletons de processo (o logger é um): em paralelo,
          // um arquivo derruba o outro. Serial é o que torna a categoria determinística.
          fileParallelism: false
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'tela',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/setup-tela.ts'],
          include: ['src/renderer/**/*.test.tsx']
        }
      }
    ]
  }
})
