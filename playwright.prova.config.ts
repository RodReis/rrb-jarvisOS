import { defineConfig, devices } from '@playwright/test'

/**
 * Prova visual dos controles (SPEC-DesignSystem-03a).
 *
 * Config **separado** do `playwright.config.ts`, que sobe o app Electron. Os dois têm nada em
 * comum além do runner: aquele prova preload/IPC/janela no binário empacotado; este abre uma
 * galeria estática no Chromium para medir o que só existe com layout — altura real, contraste
 * computado, fontes carregadas, anel de foco.
 *
 * Um config único precisaria alternar `_electron` e browser por projeto, e o `webServer`
 * subiria mesmo nas execuções que não o usam. Separar é mais barato de ler e de rodar.
 */
export default defineConfig({
  testDir: './tests/prova',
  testMatch: /.*\.prova\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5181',
    // A galeria é densa; 1280×900 mostra as quatro seções sem rolagem forçada na captura.
    viewport: { width: 1280, height: 900 }
  },
  webServer: {
    command: 'npx vite --config vite.prova.config.ts',
    url: 'http://127.0.0.1:5181',
    // `strictPort` no Vite: se a 5181 estiver ocupada ele falha, em vez de servir outra coisa
    // e a captura registrar a tela de outro processo.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  reporter: [['list']]
})
