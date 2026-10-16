import { defineConfig, devices } from '@playwright/test'

/**
 * Jornada funcional da release (SPEC-Release-05, critério 10): Playwright nas URLs de Preview,
 * Staging e Produção e depois do rollback. Config separada das outras duas: não sobe o app
 * Electron nem a galeria — o padrão roda contra ambientes locais efêmeros e o modo real recebe as
 * URLs do projeto de prova por variável de ambiente (ver `tests/release-journey/jornada.release.ts`).
 */
export default defineConfig({
  testDir: './tests/release-journey',
  testMatch: /.*\.release\.ts/,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: { ...devices['Desktop Chrome'] },
  reporter: [['list']]
})
