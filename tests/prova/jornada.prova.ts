import { expect, test } from '@playwright/test'

/**
 * Prova visual da jornada (SPEC-DesignSystem-06, critérios 1, 2 e 4).
 *
 * **A prova de fechamento do MVP-003.** As oito fatias produziram peças que passam nos seus
 * próprios testes; o que só aparece aqui é o sistema montado numa tela real, com layout, fontes
 * carregadas e contraste computado.
 *
 * A régua vale para as **duas identidades × dois modos**, porque é exatamente essa matriz que a
 * tese "base única, 2 identidades" promete. Uma tela que ficasse ilegível no NOA claro invalidaria
 * o corte inteiro, por mais verdes que estivessem os testes de componente.
 */

const ROTA = (query: string): string => `/?galeria=jornada&${query}`

/** As três telas, com o marcador que cada uma pinta na raiz. */
const TELAS = [
  { cena: 'choice', marcador: '[data-jornada="choice"]', temModoClaro: false },
  { cena: 'noa', marcador: '[data-jornada="noa-hoje"]', temModoClaro: true },
  { cena: 'jarvis', marcador: '[data-jornada="jarvis-hud"]', temModoClaro: true }
] as const

const MODOS = ['dark', 'light'] as const

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

async function abrir(
  page: import('@playwright/test').Page,
  query: string,
  marcador: string
): Promise<void> {
  await page.goto(ROTA(query))
  await page.waitForSelector(marcador)
  await page.evaluate(() => document.fonts.ready)
}

test.describe('jornada — capturas das 3 telas', () => {
  for (const tela of TELAS) {
    for (const modo of MODOS) {
      // A CHOICE é superfície de marca: não tem modo claro. Capturá-la duas vezes produziria
      // dois arquivos idênticos com nomes diferentes — uma mentira silenciosa sobre cobertura.
      if (!tela.temModoClaro && modo === 'light') continue

      test(`captura ${tela.cena} (${modo})`, async ({ page }) => {
        await abrir(page, `cena=${tela.cena}&modo=${modo}`, tela.marcador)
        await page.screenshot({
          path: `reports/prova/jornada-${tela.cena}-${modo}.png`,
          fullPage: true
        })
      })
    }
  }
})

test.describe('critério 2 — as telas internas são legíveis nos dois modos', () => {
  for (const tela of TELAS.filter((t) => t.temModoClaro)) {
    for (const modo of MODOS) {
      test(`o corpo de ${tela.cena} atinge 4.5:1 (${modo})`, async ({ page }) => {
        await abrir(page, `cena=${tela.cena}&modo=${modo}`, tela.marcador)

        const { texto, fundo } = await page.locator(tela.marcador).evaluate((el) => ({
          texto: getComputedStyle(el).color,
          fundo: getComputedStyle(el).backgroundColor
        }))

        expect(contraste(texto, fundo), `${tela.cena} em ${modo}`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  test('a CHOICE não inverte no tema claro', async ({ page }) => {
    await abrir(page, 'cena=choice&modo=light', '[data-jornada="choice"]')

    // O fundo pintado tem de ser escuro mesmo com `modo=light` — é o conceito de superfície de
    // marca da F02 sobrevivendo à composição real.
    const fundo = await page
      .locator('[data-jornada="choice"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(luminancia(fundo)).toBeLessThan(0.1)
  })
})

test.describe('critério 4 — foco visível e alcançável em tela real', () => {
  test('o anel de foco é pintado ao navegar por teclado na CHOICE', async ({ page }) => {
    await abrir(page, 'cena=choice&modo=dark', '[data-jornada="choice"]')

    await page.keyboard.press('Tab')
    const sombra = await page.evaluate(() => {
      const alvo = document.activeElement
      return alvo === null ? '' : getComputedStyle(alvo).boxShadow
    })

    // `focus-visible` só pinta em navegação por teclado — em jsdom isto seria a string da classe,
    // não o anel computado.
    expect(sombra).not.toBe('none')
    expect(sombra).not.toBe('')
  })

  test('os swatches são alcançáveis por Tab', async ({ page }) => {
    await abrir(page, 'cena=choice&modo=dark', '[data-jornada="choice"]')

    let achouSwatch = false
    for (let i = 0; i < 25 && !achouSwatch; i++) {
      await page.keyboard.press('Tab')
      achouSwatch = await page.evaluate(
        () => document.activeElement?.closest('[data-jos-swatches]') !== null
      )
    }
    expect(achouSwatch).toBe(true)
  })
})
