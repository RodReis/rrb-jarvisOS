import { expect, test } from '@playwright/test'

const ROTA = (query: string): string => `/?galeria=mascote&${query}`
const VISEMES = [
  'silencio',
  'pbm',
  'fv',
  'th',
  'dnt',
  'kg',
  'ch',
  'sz',
  'rr',
  'aa',
  'ee',
  'ih',
  'oh',
  'ou',
  'nasal'
] as const

async function abrir(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(ROTA(query))
  await page.waitForSelector('[data-testid="galeria-mascote"]')
  await page.evaluate(() => document.fonts.ready)
}

test.describe('SPEC-Voz-04 — prova visual do mascote', () => {
  test('captura as 15 poses e os 4 estados', async ({ page }) => {
    await abrir(page, 'modo=dark')

    await expect(page.locator('[data-prova="estados"] [data-mascote]')).toHaveCount(4)
    await expect(page.locator('[data-prova="visemes"] [data-viseme]')).toHaveCount(15)
    await page.screenshot({ path: 'reports/prova/mascote-visemes-estados.png', fullPage: true })
  })

  test('cada viseme pinta a pose declarada no mapa', async ({ page }) => {
    await abrir(page, 'modo=dark')

    for (const viseme of VISEMES) {
      const item = page.locator(`[data-viseme="${viseme}"]`)
      const esperado = JSON.parse((await item.getAttribute('data-pose')) ?? '{}') as {
        abertura: number
        largura: number
        intensidade: number
      }
      const atual = await item.locator('[data-boca]').evaluate((el) => {
        const style = (el as HTMLElement).style
        return {
          abertura: Number(style.getPropertyValue('--jos-boca-abertura')),
          largura: Number(style.getPropertyValue('--jos-boca-largura')),
          intensidade: Number(style.getPropertyValue('--jos-boca-intensidade'))
        }
      })

      expect(atual).toEqual(esperado)
    }
  })

  test('reduced motion desliga decoração e mantém lip-sync', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await abrir(page, 'modo=dark')

    const animacaoDoAnel = await page
      .locator('[data-prova="estados"] [data-mascote] > span')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName)
    const aberturaAa = await page.locator('[data-viseme="aa"] [data-boca]').evaluate((el) => {
      return (el as HTMLElement).style.getPropertyValue('--jos-boca-abertura')
    })

    expect(animacaoDoAnel).toBe('none')
    expect(Number(aberturaAa)).toBeGreaterThan(0.9)
    await page.screenshot({ path: 'reports/prova/mascote-reduced-motion.png', fullPage: true })
  })
})
