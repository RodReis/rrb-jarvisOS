import { expect, test } from '@playwright/test'

async function abrir(page: import('@playwright/test').Page, modo: 'dark' | 'light'): Promise<void> {
  await page.goto(`/?galeria=command-center&modo=${modo}`)
  await page.waitForSelector('[data-testid="command-center"]')
  await page.evaluate(() => document.fonts.ready)
}

test.describe('SPEC-Voz-05 — prova visual do Command Center', () => {
  for (const modo of ['dark', 'light'] as const) {
    test(`captura tema ${modo} e mede coluna`, async ({ page }) => {
      await abrir(page, modo)
      const caixa = await page.locator('[data-testid="command-center"]').boundingBox()
      expect(caixa).not.toBeNull()
      expect(caixa?.height).toBeLessThanOrEqual(780)
      await page.screenshot({ path: `reports/prova/command-center-${modo}.png`, fullPage: true })
    })
  }

  test('movimento reduzido mantém conteúdo e remove animação decorativa', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await abrir(page, 'dark')
    await expect(page.getByText('Command Center')).toBeVisible()
    const animacao = await page
      .locator('[data-testid="command-center"] [data-mascote] > span')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName)
    expect(animacao).toBe('none')
    await page.screenshot({
      path: 'reports/prova/command-center-reduced-motion.png',
      fullPage: true
    })
  })
})
