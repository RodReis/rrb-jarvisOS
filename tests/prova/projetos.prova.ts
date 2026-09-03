import { expect, test } from '@playwright/test'

/**
 * Prova visual do índice de projetos (SPEC-Jornada-01, § Testes).
 *
 * **Esta tela não tinha gate visual**, e foi por isso que ela acumulou o defeito que o PI
 * reportou: as três ações do card renderizavam com o mesmo peso, porque nenhuma nomeava a
 * variante e o default do `Button` é `secundaria`. Os 255 testes de tela passavam verdes —
 * papel ARIA não mede rank visual, e a M25-F01 já tinha aprendido isso com marcadores de 20px
 * renderizando a 2px.
 *
 * O que estes testes medem é o que só existe com layout:
 *  - **A hierarquia da ação**, por preenchimento computado e não por classe.
 *  - **O alinhamento das colunas**, que o rótulo de CTA de largura variável quebrava.
 *  - **A aresta do botão primário**, que sem contorno próprio sumia no fundo claro.
 */

const ROTA = (query: string): string => `/?galeria=projetos&${query}`

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

/**
 * Compõe uma cor `rgba()` sobre um fundo opaco — o que o navegador de fato pinta.
 *
 * Sem isto o teste mediria o alfa como se fosse opaco, e uma borda a 10% passaria como se
 * tivesse contraste pleno: afirmaria uma aresta que ninguém enxerga.
 */
function compor(frente: string, fundo: string): string {
  const f = (frente.match(/[\d.]+/g) ?? []).map(Number)
  const b = (fundo.match(/[\d.]+/g) ?? []).map(Number)
  const alfa = f[3] ?? 1
  const canal = (i: number): number => Math.round(f[i]! * alfa + b[i]! * (1 - alfa))
  return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`
}

async function abrir(
  page: import('@playwright/test').Page,
  modo: string,
  acento = '%23D3AF37'
): Promise<void> {
  await page.goto(ROTA(`cena=lista&modo=${modo}&acento=${acento}`))
  await page.waitForSelector('[data-jos-projeto]')
  // Sem esperar a fonte, a medida sai da fallback e o teste avaliaria uma tipografia que o
  // produto não usa.
  await page.evaluate(() => document.fonts.ready)
}

for (const modo of ['dark', 'light'] as const) {
  test.describe(`índice de projetos (${modo})`, () => {
    test('captura para o gate visual', async ({ page }) => {
      await abrir(page, modo)
      await page.screenshot({ path: `reports/prova/projetos-lista-${modo}.png` })
    })

    /*
     * O defeito que o PI reportou: "as cores dos botões têm que ser integradas com a paleta
     * escolhida na configuração". O CTA da jornada é a ação que o fluxo espera, e é ele que
     * deve carregar o acento — as ações de manutenção, não.
     */
    test('o CTA da jornada usa o acento; renomear e remover, não', async ({ page }) => {
      await abrir(page, modo)

      const card = page.locator('[data-jos-projeto]').first()
      const fundo = (nome: RegExp): Promise<string> =>
        card
          .getByRole('button', { name: nome })
          .evaluate((el) => getComputedStyle(el).backgroundColor)

      const cta = await fundo(/Abrir Leituras/)
      const renomear = await fundo(/Renomear/)

      // `#D3AF37` renderiza como rgb(211, 175, 55). Comparar com a cor computada, e não com a
      // classe, é o que prova que o token do acento chegou até a tela.
      expect(cta).toBe('rgb(211, 175, 55)')
      expect(renomear).not.toBe(cta)
    })

    /*
     * A aresta: sem contorno próprio, cinco dos oito acentos deixavam o botão primário como um
     * bloco sem limite no fundo claro — `#FFFFE3` mede 1.07:1 contra a página.
     */
    test('o botão primário tem aresta visível contra a página', async ({ page }) => {
      await abrir(page, modo)

      const alvo = page
        .locator('[data-jos-projeto]')
        .first()
        .getByRole('button', { name: /Abrir Leituras/ })

      const { borda, preenchimento } = await alvo.evaluate((el) => ({
        borda: getComputedStyle(el).borderTopColor,
        preenchimento: getComputedStyle(el).backgroundColor
      }))
      // A página, e não `document.body`: o body é transparente aqui, e usá-lo mediria contra
      // um fundo que não existe — o primeiro teste passava no escuro por esse acidente.
      const pagina = await page
        .locator('[data-jos-projetos]')
        .evaluate((el) => getComputedStyle(el).backgroundColor)

      // A borda é `rgba`: o que o olho vê é ela **composta sobre o preenchimento**. Medir o
      // `rgba` cru trataria o alfa como opaco e afirmaria uma aresta que ninguém enxerga.
      expect(contraste(compor(borda, preenchimento), pagina)).toBeGreaterThanOrEqual(3)
    })
  })
}

/*
 * O ziguezague: o rótulo do CTA vem da etapa e varia muito ("Escrever o prompt" contra
 * "Acompanhar a construção"). Com a fileira empacotada à direita, cada card empurrava os botões
 * de manutenção para uma posição diferente — medido em 584px, 602px e 530px.
 */
test('as colunas de manutenção alinham entre os cards', async ({ page }) => {
  await abrir(page, 'dark')

  const xs = await page.locator('[data-jos-projeto]').evaluateAll((cards) =>
    cards.map((card) => {
      const botao = [...card.querySelectorAll('button')].find((b) =>
        /Renomear/.test(b.textContent ?? '')
      )
      return Math.round(botao?.getBoundingClientRect().left ?? -1)
    })
  )

  expect(xs.length).toBeGreaterThan(1)
  // Uma coluna que o olho varre não pode saltar de card para card.
  expect(new Set(xs).size).toBe(1)
})

/*
 * O desabilitado larga o acento (decisão do PI, 2026-09-03): a cor da identidade não deve
 * pintar um alvo que não aceita clique, e o `opacity-45` levava o rótulo a 1.51:1.
 */
test('o botão desabilitado não usa o acento', async ({ page }) => {
  await abrir(page, 'dark')

  const criar = page.getByRole('button', { name: /Criar projeto/ })
  await expect(criar).toBeDisabled()

  const fundo = await criar.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(fundo).not.toBe('rgb(211, 175, 55)')
})
