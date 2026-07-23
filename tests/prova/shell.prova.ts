import { expect, test } from '@playwright/test'

/**
 * Prova visual do shell (SPEC-DesignSystem-04a, critérios 1 e 3).
 *
 * O que só existe aqui é o **grid montado**. Em jsdom, `width: 60px` é a string que o componente
 * escreveu: um rail que colapsasse a zero por um `flex` mal resolvido, ou uma sidebar espremida
 * por conteúdo largo, passariam em todos os testes de componente. O critério 1 fala em "compõe
 * rail + sidebar + topbar + conteúdo", e composição é o que precisa de layout real.
 *
 * As capturas são artefato de revisão, não baseline de regressão visual (MVP-003 §4).
 */

const ROTA = (query: string): string => `/?galeria=shell&${query}`

const CENARIOS = [
  { nome: 'jarvis-escuro', query: 'modo=dark&modulo=jarvis' },
  { nome: 'jarvis-claro', query: 'modo=light&modulo=jarvis' },
  { nome: 'noa-escuro', query: 'modo=dark&modulo=noa' },
  { nome: 'noa-claro', query: 'modo=light&modulo=noa' }
] as const

async function abrir(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(ROTA(query))
  await page.waitForSelector('[data-testid="galeria"]')
  await page.evaluate(() => document.fonts.ready)
}

test.describe('galeria do shell', () => {
  for (const cenario of CENARIOS) {
    test(`captura ${cenario.nome}`, async ({ page }) => {
      await abrir(page, cenario.query)
      await expect(page.locator('[data-testid="galeria"]')).toBeVisible()
      await page.screenshot({ path: `reports/prova/shell-${cenario.nome}.png` })
    })
  }
})

test.describe('critério 1 — o grid do protótipo tem as medidas certas', () => {
  test('rail 60px, sidebar 232px, topbar 52px e rodapé 34px', async ({ page }) => {
    await abrir(page, 'modo=dark&modulo=jarvis')

    // `boundingBox` mede o que foi **renderizado**, não o que foi declarado. É a diferença entre
    // afirmar que o CSS existe e afirmar que ele produziu o layout do protótipo (JARVISOS §2).
    const rail = await page.locator('[data-jos-rail]').boundingBox()
    const sidebar = await page.locator('[data-jos-sidebar]').boundingBox()
    const topbar = await page.locator('[data-jos-topbar]').boundingBox()
    const rodape = await page.locator('[data-jos-rodape]').boundingBox()

    expect(rail?.width).toBe(60)
    expect(sidebar?.width).toBe(232)
    expect(topbar?.height).toBe(52)
    expect(rodape?.height).toBe(34)
  })

  test('as quatro regiões não se sobrepõem e o conteúdo fica à direita da sidebar', async ({
    page
  }) => {
    await abrir(page, 'modo=dark&modulo=jarvis')

    const rail = await page.locator('[data-jos-rail]').boundingBox()
    const sidebar = await page.locator('[data-jos-sidebar]').boundingBox()
    const conteudo = await page.locator('main').boundingBox()

    // Sobreposição é o defeito clássico de shell: o conteúdo passa por baixo da sidebar e some
    // atrás dela. Nenhum teste de papel ARIA veria isso.
    expect(sidebar!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width)
    expect(conteudo!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width)
  })

  test('o grid mantém as medidas no NOA — é a mesma estrutura, não um shell paralelo', async ({
    page
  }) => {
    await abrir(page, 'modo=dark&modulo=noa')

    expect((await page.locator('[data-jos-rail]').boundingBox())?.width).toBe(60)
    expect((await page.locator('[data-jos-sidebar]').boundingBox())?.width).toBe(232)
  })

  test('o toggle sol/lua troca o modo pintado, sem recarregar', async ({ page }) => {
    await abrir(page, 'modo=dark&modulo=jarvis')

    const fundoAntes = await page
      .locator('[data-jos-appshell]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)

    await page.getByRole('button', { name: /alternar entre tema/i }).click()

    const fundoDepois = await page
      .locator('[data-jos-appshell]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)

    // Cor **computada**: a variável resolvida, não a string `var(--jos-cor-superficie)`.
    expect(fundoDepois).not.toBe(fundoAntes)
  })
})

test.describe('critério 3 — o rail dual navega de verdade', () => {
  test('alternar para Agents OS troca a navegação da sidebar', async ({ page }) => {
    await abrir(page, 'modo=dark&modulo=jarvis')

    await expect(page.getByRole('button', { name: 'Operações' })).toBeVisible()

    await page.getByRole('button', { name: /agents os/i }).click()

    await expect(page.getByRole('button', { name: 'Agentes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Operações' })).toHaveCount(0)
  })

  test('o NOA não tem rail dual', async ({ page }) => {
    await abrir(page, 'modo=dark&modulo=noa')
    await expect(page.getByRole('button', { name: /agents os/i })).toHaveCount(0)
  })
})
