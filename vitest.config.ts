import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * As três categorias do ADR-003 (docs/TESTING.md §2/§3) são três projects Vitest com
 * `include` distinto. O orquestrador (scripts/test-report.mjs) roda um project por vez
 * para produzir um `--json` e um coverage por categoria.
 *
 * - regras → unidade pura (src/shared, src/main, src/design/tokens), sem storage/IPC/rede
 * - banco  → integração com storage local (e com ferramental que toca disco, como o teste
 *            da fronteira ESLint do design system)
 * - tela   → componente React em jsdom (src/renderer e src/design/{ui,patterns});
 *            E2E Playwright entra pelo relatório, não por este arquivo
 */
const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
  '@design': resolve(__dirname, 'src/design')
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
          // `src/design/tokens` entra aqui (e não em `tela`) porque é regra pura: a camada
          // não depende de React, e o ambiente `node` é o que **prova** isso — um teste em
          // jsdom passaria mesmo se o token importasse React por engano.
          //
          // `src/renderer` também entra, e a omissão dele era um **bug**: o padrão anterior
          // (`src/{shared,main,design}`) deixava `workspace/navegacao.spec.ts` fora de toda
          // categoria — 75 linhas de teste do isolamento de rota por espaço (SPEC-Fundacao-02,
          // critérios 1 e 5) que nunca rodaram desde que foram escritas. A regra da categoria é
          // *"unidade pura"*, não *"não fica no renderer"*: `navegacao.ts` é estado sem React,
          // exatamente o que `regras` mede. Componente React continua fora — ele é `.test.tsx`,
          // que este padrão não alcança. Ver o card [FIX] correspondente.
          include: ['src/{shared,main,design,renderer}/**/*.spec.ts']
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
          setupFiles: ['./src/renderer/tests/setup-tela.ts'],
          include: ['src/{renderer,design}/**/*.test.tsx']
        }
      }
    ]
  }
})
