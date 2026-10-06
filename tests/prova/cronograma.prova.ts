import { expect, test } from '@playwright/test'

for (const modo of ['dark', 'light'] as const) {
  test(`SPEC-Escuta-04: editor no tema ${modo} e movimento reduzido`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/?galeria=escuta&cena=cronograma&modo=${modo}`)
    const editor = page.getByRole('region', { name: 'Cronograma de atividades' })
    await expect(editor).toBeVisible()
    await expect(editor.getByText('Chegada de trabalho')).toBeVisible()
    await expect(editor.getByText('1. Falar pela persona')).toBeVisible()
    await expect(editor.getByText('2. Tocar mídia local')).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Validar e salvar' })).toBeVisible()
    await page.screenshot({ path: `reports/prova/cronograma-${modo}-reduced.png`, fullPage: true })
  })
}
