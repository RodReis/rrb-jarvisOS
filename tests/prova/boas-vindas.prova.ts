import { expect, test } from '@playwright/test'

for (const modo of ['dark', 'light'] as const) {
  test(`preferências das boas-vindas no tema ${modo}`, async ({ page }) => {
    await page.goto(`/?galeria=escuta&cena=boas-vindas&modo=${modo}`)
    const secao = page.getByRole('region', { name: /boas-vindas/i })
    await expect(secao).toBeVisible()
    await expect(secao.getByRole('switch', { name: /ativar/i })).not.toBeChecked()
    await expect(secao.getByRole('textbox', { name: /manhã/i })).toBeVisible()
    const largura = await page.evaluate(() => ({
      documento: document.documentElement.scrollWidth,
      janela: window.innerWidth
    }))
    expect(largura.documento).toBeLessThanOrEqual(largura.janela)
    await page.screenshot({ path: `reports/prova/boas-vindas-${modo}.png`, fullPage: true })
  })
}
