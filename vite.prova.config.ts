import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Servidor da galeria de prova (SPEC-DesignSystem-03a).
 *
 * Mora na **raiz**, e não em `src/design/prova/`, porque a fronteira do DS (Fatia 01) proíbe
 * importar `node:*` de dentro de `src/design/` — e um config de build precisa de `node:path`.
 * A regra está certa: este arquivo é ferramental de build, não código de runtime do design
 * system. Quem se move é o arquivo, não a regra.
 *
 * Config **separado** do `electron.vite.config.ts` de propósito: a galeria não é parte do app.
 * Misturá-la ao renderer arrastaria uma rota de teste para dentro do bundle de produção, e a
 * primeira coisa que alguém faria seria protegê-la com um `if (import.meta.env.DEV)` — que é
 * exatamente o tipo de condicional que um dia falha do lado errado.
 *
 * Porta 5181: a 5180 é do app (`strictPort`, CLAUDE.md). Aqui também `strictPort` — se a porta
 * estiver ocupada, é melhor falhar do que capturar a tela de outro processo.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/design/prova'),
  plugins: [react(), tailwindcss()],
  /**
   * O alias `@design`, que os outros três configs (`electron.vite.config.ts`, `tsconfig.web.json`,
   * `vitest.config.ts`) já declaravam e este não.
   *
   * A ausência só apareceu na F06, quando as telas da jornada — um nível mais fundo, em
   * `prova/jornada/` — passaram a usar o alias porque `../../` bate na regra de fronteira da F01.
   * O `typecheck` e o `vitest` continuaram verdes: **cada ferramenta tem o seu próprio mapa de
   * alias**, e três deles concordavam. Quem discordava era justamente o que serve a galeria — e o
   * sintoma foi a prova visual inteira falhando de uma vez, com a página sem carregar.
   */
  resolve: {
    alias: { '@design': resolve(__dirname, 'src/design') }
  },
  server: {
    port: 5181,
    strictPort: true,
    // `127.0.0.1` explícito: no Windows, `localhost` pode resolver para `::1` (IPv6) enquanto
    // o Playwright sonda o endereço IPv4 — o servidor sobe e o `webServer` expira mesmo assim.
    host: '127.0.0.1'
  },
  build: {
    outDir: resolve(__dirname, 'out/prova'),
    emptyOutDir: true
  }
})
