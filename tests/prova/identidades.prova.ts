import { expect, test } from '@playwright/test'

/**
 * Prova visual das identidades (SPEC-DesignSystem-05, critérios 4, 5 e 7).
 *
 * Irmã de `controles.prova.ts` e `dados.prova.ts`, com a mesma régua: navegador de verdade,
 * asserções sobre valor **computado**, capturas como artefato de revisão e não baseline.
 *
 * Três dos sete critérios só são verificáveis aqui, e não por preferência de ferramenta:
 *
 * - **Critério 4 (glow):** em jsdom, `background-image` devolve a string que o componente
 *   escreveu. Um `var(--jos-atmosfera)` que apontasse para variável inexistente passaria no teste
 *   de componente e pintaria nada na tela. Aqui o `getComputedStyle` resolve a variável — se ela
 *   não existir, o valor computado vem `none` e a asserção quebra.
 * - **Critério 5 (semânticas idênticas):** o teste de componente compara as *variáveis*. Este
 *   compara a **cor pintada** nos dois espaços, que é o que o usuário compara.
 * - **Critério 7 (tile escuro):** `mix-blend-mode` não é composto por DOM virtual nenhum.
 */

const ROTA = (query: string): string => `/?galeria=identidades&${query}`

const MODOS = ['dark', 'light'] as const

async function abrir(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(ROTA(query))
  await page.waitForSelector('[data-testid="galeria"]')
  await page.evaluate(() => document.fonts.ready)
}

test.describe('galeria de identidades', () => {
  for (const modo of MODOS) {
    test(`captura ${modo}`, async ({ page }) => {
      await abrir(page, `modo=${modo}`)
      await expect(page.locator('[data-testid="galeria"]')).toBeVisible()
      await page.screenshot({ path: `reports/prova/identidades-${modo}.png`, fullPage: true })
    })
  }
})

test.describe('critério 4 — o glow do JARVIS é pintado, e só no JARVIS', () => {
  for (const modo of MODOS) {
    test(`a atmosfera resolve para um gradiente real (${modo})`, async ({ page }) => {
      await abrir(page, `modo=${modo}`)

      const jarvis = await page
        .locator('[data-prova-identidade="jarvis"]')
        .evaluate((el) => getComputedStyle(el).backgroundImage)
      const noa = await page
        .locator('[data-prova-identidade="noa"]')
        .evaluate((el) => getComputedStyle(el).backgroundImage)

      // O navegador expande `radial-gradient(...)` para a forma canônica com as cores já
      // resolvidas. Se a variável não existisse, viria `none` — que é exatamente o que o NOA traz.
      expect(jarvis).toContain('radial-gradient')
      expect(noa).toBe('none')
    })
  }

  test('o glow acompanha o acento escolhido, em vez de uma cor fixa', async ({ page }) => {
    await abrir(page, 'modo=dark')
    const padrao = await page
      .locator('[data-prova-identidade="jarvis"]')
      .evaluate((el) => getComputedStyle(el).backgroundImage)

    // Outro acento da paleta fechada: o gradiente computado tem de mudar junto. Um glow que
    // ignorasse o acento passaria na asserção acima e ainda assim quebraria a identidade — a
    // atmosfera é o acento respirando no topo, não uma textura laranja.
    await abrir(page, 'modo=dark&acento=%232323FF')
    const trocado = await page
      .locator('[data-prova-identidade="jarvis"]')
      .evaluate((el) => getComputedStyle(el).backgroundImage)

    expect(trocado).toContain('radial-gradient')
    expect(trocado).not.toBe(padrao)
  })
})

test.describe('critério 5 — a semântica pintada é a mesma nos dois espaços', () => {
  for (const modo of MODOS) {
    test(`os badges de status têm cor idêntica no NOA e no JARVIS (${modo})`, async ({ page }) => {
      await abrir(page, `modo=${modo}`)

      const cores = async (modulo: string): Promise<string[]> =>
        page
          .locator(`[data-prova-identidade="${modulo}"] [data-prova="semanticas"] > *`)
          .evaluateAll((els) => els.map((el) => getComputedStyle(el).color))

      const jarvis = await cores('jarvis')
      const noa = await cores('noa')

      expect(jarvis.length).toBeGreaterThan(0)
      // Cor **computada**, não a variável: é a comparação que o olho do usuário faz ao trocar
      // de espaço. Aqui um `--jos-cor-err-leitura` divergente entre módulos apareceria como
      // dois vermelhos diferentes — foi esse o defeito que o teste de componente pegou no
      // `violet`, e esta é a asserção que o pegaria caso ele voltasse por outro caminho.
      expect(noa).toEqual(jarvis)
    })
  }
})

test.describe('critério 7 — o tile do mascote não clareia no tema claro', () => {
  for (const modo of MODOS) {
    test(`o fundo do tile permanece escuro (${modo})`, async ({ page }) => {
      await abrir(page, `modo=${modo}`)

      for (const modulo of ['jarvis', 'noa']) {
        const fundo = await page
          .locator(`[data-prova-identidade="${modulo}"] [data-mascote]`)
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor)

        const canais = fundo.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
        expect(canais).toHaveLength(3)
        // Soma bem abaixo de 3×128: os tiles do protótipo somam ~18 e ~22. Um tile que seguisse
        // `--jos-cor-superficie` viria perto de 3×245 no modo claro — e o mascote sumiria, porque
        // `mix-blend-mode: screen` sobre fundo claro devolve fundo claro.
        expect(canais.reduce((t, c) => t + c, 0)).toBeLessThan(60)
      }
    })
  }

  test('a imagem do mascote é composta com `screen`', async ({ page }) => {
    await abrir(page, 'modo=light')
    const blend = await page
      .locator('[data-prova-identidade="jarvis"] [data-mascote] img')
      .first()
      .evaluate((el) => getComputedStyle(el).mixBlendMode)
    // É o `screen` que torna o tile escuro obrigatório — as duas asserções sustentam uma à outra.
    expect(blend).toBe('screen')
  })
})

test.describe('critério 6 — o mascote sem voz não mostra estados de fala', () => {
  test('o NOA não pinta boca nem olhos, mesmo com os estados na galeria', async ({ page }) => {
    await abrir(page, 'modo=dark')

    // A galeria monta os três estados (parado/falando/ouvindo) nas duas colunas. No JARVIS os
    // elementos de fala existem; no NOA não devem existir — a decisão do PI é comportamento,
    // não default cosmético.
    const anunciosJarvis = await page
      .locator('[data-prova-identidade="jarvis"] [data-mascote][data-estado="falando"]')
      .count()
    const anunciosNoa = await page
      .locator('[data-prova-identidade="noa"] [data-mascote][data-estado="falando"]')
      .count()

    expect(anunciosJarvis).toBeGreaterThan(0)
    expect(anunciosNoa).toBe(0)
  })
})
