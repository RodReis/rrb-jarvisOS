import { expect, test } from '@playwright/test'

for (const modo of ['dark', 'light'] as const) {
  test(`M28-F03: painel da tarefa no tema ${modo}`, async ({ page }) => {
    await page.goto(`/?galeria=painel-tarefa&cena=snapshot&modo=${modo}`)
    await page.waitForSelector('[data-testid="galeria-painel-tarefa"]')
    const painel = page.getByRole('complementary', { name: 'Painel da tarefa' })
    await expect(painel).toBeVisible()
    await expect(painel.getByRole('status')).toContainText('Snapshots incompletos')
    await expect(painel.getByRole('button', { name: 'Escritor' })).toBeVisible()
    await expect(painel.getByText('Plano do Squad')).toBeVisible()
    await page.screenshot({ path: `reports/prova/painel-tarefa-${modo}.png`, fullPage: true })
  })

  test(`M28-F03: visualizador read-only e busca no tema ${modo}`, async ({ page }) => {
    await page.goto(`/?galeria=painel-tarefa&cena=snapshot&modo=${modo}`)
    await page.waitForSelector('[data-testid="galeria-painel-tarefa"]')
    const painel = page.getByRole('complementary', { name: 'Painel da tarefa' })
    await painel.getByRole('button', { name: 'Arquivos' }).click()
    await painel.getByRole('button', { name: /src\/main\/pipeline\/painel\.ts/ }).click()
    await expect(painel.getByLabel('Conteúdo do arquivo')).toContainText('maximoPorArquivo')
    await painel.getByRole('textbox', { name: 'Buscar no arquivo' }).fill('maximoPorRun')
    await expect(painel.locator('mark')).toContainText('maximoPorRun')
    await expect(painel.getByLabel('Conteúdo do arquivo').locator('input, textarea')).toHaveCount(0)
    await page.screenshot({
      path: `reports/prova/painel-tarefa-arquivo-${modo}.png`,
      fullPage: true
    })
  })
}
