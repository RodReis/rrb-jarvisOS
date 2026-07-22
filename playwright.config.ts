import { defineConfig } from '@playwright/test'

/**
 * E2E Playwright-Electron (ADR-003; SPEC-Fundacao-03, critério 9).
 *
 * Complementa a categoria "Tela" do `test-report.config.json`, que já esperava um
 * `tela-playwright.json` — os testes de componente rodam em jsdom pelo Vitest; aqui sobe
 * o **app Electron de verdade**, que é a única forma de provar que preload, IPC e janela
 * funcionam juntos.
 *
 * Fora de escopo deliberadamente: o login real contra o Google. Automatizar a tela de
 * consentimento de um provedor externo produz teste que quebra quando o Google muda o HTML,
 * e o que a spec pede é provar o **fluxo do app** — por isso o provedor é interceptado no
 * loopback (ver `tests/e2e/login.e2e.ts`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.ts/,
  // Electron sobe um processo por teste: paralelismo aqui disputa o mesmo `userData`.
  workers: 1,
  fullyParallel: false,
  // Um retry cobre a flutuação de boot do Electron em máquina carregada, sem mascarar
  // falha real — que reprova nas duas tentativas.
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    // O runner do CI é mais lento que a máquina de dev no primeiro boot do Electron
    // (cold start, disco compartilhado). 15s evita falso vermelho sem esconder trava
    // real — o timeout do teste (60s) continua sendo o limite que importa.
    timeout: 15_000
  },
  reporter: [
    ['list'],
    // Caminho que o `test-report.config.json` já declara para a categoria Tela.
    ['json', { outputFile: 'reports/.raw/tela-playwright.json' }]
  ]
})
