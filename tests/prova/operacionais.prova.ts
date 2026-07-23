import { expect, test } from '@playwright/test'

/**
 * Prova visual dos padrões operacionais (SPEC-DesignSystem-04b, critérios 3 e 4).
 *
 * Estes componentes carregam a informação mais crítica da interface — *"isto é perigoso"*,
 * *"isto falhou"* — e leem justamente as semânticas que a F03a mediu falhando 4.5:1 como texto no
 * modo claro. Um risco alto ilegível é pior que um risco alto sem estilo: ele parece informação.
 *
 * O critério 3 também ganha aqui a sua prova mais direta: o segredo **não está no DOM
 * renderizado**. O teste de componente afirma sobre o texto do elemento; este afirma sobre a
 * página inteira, depois do CSS, do portal e de tudo mais que possa reintroduzi-lo.
 */

const ROTA = (query: string): string => `/?galeria=operacionais&${query}`

const CENARIOS = [
  { nome: 'jarvis-escuro', query: 'modo=dark&modulo=jarvis' },
  { nome: 'jarvis-claro', query: 'modo=light&modulo=jarvis' },
  { nome: 'noa-escuro', query: 'modo=dark&modulo=noa' },
  { nome: 'noa-claro', query: 'modo=light&modulo=noa' }
] as const

const MODOS = ['dark', 'light'] as const

async function abrir(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(ROTA(query))
  await page.waitForSelector('[data-testid="galeria"]')
  await page.evaluate(() => document.fonts.ready)
}

/** Luminância relativa WCAG a partir de `rgb(r, g, b)`. */
function luminancia(cor: string): number {
  const [r, g, b] = (cor.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
  const canal = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(r!) + 0.7152 * canal(g!) + 0.0722 * canal(b!)
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro! + 0.05) / (escuro! + 0.05)
}

test.describe('galeria de operacionais', () => {
  for (const cenario of CENARIOS) {
    test(`captura ${cenario.nome}`, async ({ page }) => {
      await abrir(page, cenario.query)
      await expect(page.locator('[data-testid="galeria"]')).toBeVisible()
      await page.screenshot({
        path: `reports/prova/operacionais-${cenario.nome}.png`,
        fullPage: true
      })
    })
  }

  for (const cena of ['aprovacao', 'remocao'] as const) {
    test(`captura overlay ${cena}`, async ({ page }) => {
      await abrir(page, `modo=dark&cena=${cena}`)
      // `fullPage: false`: o overlay é `position: fixed` e a captura de página inteira o
      // renderizaria no topo do documento, longe de onde ele aparece.
      await page.screenshot({ path: `reports/prova/operacionais-${cena}.png` })
    })
  }
})

test.describe('critério 4 — risco e status são legíveis nos dois modos', () => {
  for (const modo of MODOS) {
    test(`os indicadores de risco atingem 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, `modo=${modo}&modulo=jarvis`)

      const medidas = await page
        .locator('[data-prova="risco"] [data-jos-risco]')
        .evaluateAll((els) =>
          els.map((el) => ({
            nivel: el.getAttribute('data-jos-risco') ?? '?',
            cor: getComputedStyle(el).color,
            fundo: getComputedStyle(document.body).backgroundColor
          }))
        )

      expect(medidas.length).toBe(4)
      for (const m of medidas) {
        // O fundo do body é transparente em alguns casos; usa-se a superfície do container.
        const fundo = await page
          .locator('[data-testid="galeria"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor)
        expect(contraste(m.cor, fundo), `risco ${m.nivel} em ${modo}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    test(`o texto de sincronização atinge 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, `modo=${modo}&modulo=jarvis`)

      const fundo = await page
        .locator('[data-testid="galeria"]')
        .evaluate((el) => getComputedStyle(el).backgroundColor)

      const cores = await page
        .locator('[data-prova="status"] [data-jos-sync] span')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).color))

      expect(cores.length).toBeGreaterThan(0)
      for (const cor of cores) {
        expect(contraste(cor, fundo)).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('`offline` e `pendente` têm o mesmo tom e rótulos diferentes', async ({ page }) => {
    await abrir(page, 'modo=dark&modulo=jarvis')

    const offline = page.locator('[data-jos-sync="offline"]')
    const pendente = page.locator('[data-jos-sync="pendente"]')

    // A cor **computada** é a mesma nos dois — é o caso que prova o critério 4: se ela fosse o
    // único sinal, os dois estados seriam indistinguíveis na tela.
    const corOffline = await offline
      .locator('span')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    const corPendente = await pendente
      .locator('span')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    expect(corPendente).toBe(corOffline)

    await expect(offline).toContainText('Offline')
    await expect(pendente).toContainText('Pendente')
  })
})

test.describe('critério 3 — o segredo não sobrevive à renderização', () => {
  for (const modo of MODOS) {
    test(`nenhum segredo do log aparece na página (${modo})`, async ({ page }) => {
      await abrir(page, `modo=${modo}&modulo=jarvis`)

      // A galeria injeta segredos de propósito no log e no diagnóstico. Aqui a asserção é sobre
      // o **documento inteiro** — não sobre o texto de um elemento —, então cobre também o que
      // um portal ou um atributo pudesse reintroduzir.
      const conteudo = await page.evaluate(() => document.body.innerText)
      expect(conteudo).not.toContain('sk-ant-naodeveaparecer123')
      expect(conteudo).not.toContain('segredo-invisivel')
      expect(conteudo).toContain('[redigido]')

      // E o log continua útil: as linhas limpas sobrevivem.
      expect(conteudo).toContain('runtime iniciado')
    })
  }

  test('o segredo também não fica em atributo do DOM', async ({ page }) => {
    await abrir(page, 'modo=dark&modulo=jarvis')
    // `innerText` não vê `title`, `aria-label` nem `value`. O HTML cru vê.
    const html = await page.content()
    expect(html).not.toContain('sk-ant-naodeveaparecer123')
    expect(html).not.toContain('segredo-invisivel')
  })
})
