import { expect, test } from '@playwright/test'

/**
 * Prova visual da jornada de planejamento (SPEC-Jornada-01, § Testes).
 *
 * **É o gate visual que a spec exige**: *"screenshot da jornada apresentado ao PI — esta fatia
 * existe porque a verificação visual nunca aconteceu no MVP-008"*. Os testes de tela rodam em
 * JSDOM, que não tem layout: eles provam que o botão existe e que o texto certo aparece, mas
 * não que a trilha é legível, que as três posições se distinguem, nem que o contraste fecha.
 *
 * O que só existe aqui:
 *  - **As três posições distinguíveis sem cor** (princípio 2 do PRODUCT.md): a prova mede
 *    forma e peso computados, não a classe CSS que os pediu.
 *  - **Contraste computado nos dois modos.** O modo claro das telas internas é canônico, não
 *    cortesia — e é onde o texto suave costuma falhar 4.5:1.
 *  - **A captura para o PI**, que é o artefato do gate.
 */

const ROTA = (query: string): string => `/?galeria=planejamento&${query}`

const CENAS = ['inicio', 'meio', 'regressao'] as const
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
  cena: string,
  modo: string
): Promise<void> {
  await page.goto(ROTA(`cena=${cena}&modo=${modo}`))
  await page.waitForSelector(`[data-jornada-planejamento="${cena}"]`)
  // Sem esperar a fonte, a medida sai da fallback e o teste avaliaria uma tipografia que o
  // produto não usa.
  await page.evaluate(() => document.fonts.ready)
}

test.describe('captura da trilha para o gate visual', () => {
  for (const cena of CENAS) {
    for (const modo of MODOS) {
      test(`captura ${cena} (${modo})`, async ({ page }) => {
        await abrir(page, cena, modo)
        await page.screenshot({
          path: `reports/prova/planejamento-${cena}-${modo}.png`,
          fullPage: true
        })
      })
    }
  }
})

test.describe('critério 3 — um CTA, e só na etapa atual', () => {
  for (const modo of MODOS) {
    test(`a trilha oferece exatamente uma ação (${modo})`, async ({ page }) => {
      await abrir(page, 'meio', modo)

      // Medido na tela montada, não no JSX: um botão que existisse mas ficasse fora da vista
      // passaria no teste de JSDOM e falharia aqui.
      await expect(page.locator('ol button')).toHaveCount(1)
    })

    test(`o botão está na linha marcada como atual (${modo})`, async ({ page }) => {
      await abrir(page, 'meio', modo)

      // `aria-current="step"` é o que diz "você está aqui" para quem ouve a interface. Se o
      // botão morasse noutra linha, a interface diria uma coisa e mostraria outra.
      await expect(page.locator('li[aria-current="step"] button')).toHaveCount(1)
    })
  }
})

test.describe('princípio 2 — as três posições se distinguem sem depender de cor', () => {
  test('concluída, atual e futura têm marcadores de forma diferente', async ({ page }) => {
    await abrir(page, 'meio', 'dark')

    const formas = await page.evaluate(() => {
      const medir = (posicao: string): { borda: string; fundo: string; filhos: number } => {
        const marcador = document
          .querySelector(`li[data-jos-posicao="${posicao}"]`)
          ?.querySelector('span')
        const estilo = getComputedStyle(marcador as Element)
        return {
          borda: estilo.borderTopWidth,
          fundo: estilo.backgroundColor,
          filhos: (marcador as Element).childElementCount
        }
      }
      return {
        concluida: medir('concluida'),
        atual: medir('atual'),
        futura: medir('futura')
      }
    })

    // A concluída é preenchida e não tem borda; a atual é anel **com núcleo**; a futura é anel
    // vazado. Três formas, e as três continuam distinguíveis em escala de cinza — que é o teste
    // que o princípio exige e que nenhuma asserção de cor faria.
    expect(formas.concluida.borda).toBe('0px')
    expect(formas.atual.borda).not.toBe('0px')
    expect(formas.futura.borda).not.toBe('0px')
    expect(formas.atual.filhos).toBeGreaterThan(0)
    expect(formas.futura.filhos).toBe(0)
  })

  test('a etapa atual tem peso tipográfico maior que as demais', async ({ page }) => {
    await abrir(page, 'meio', 'dark')

    const pesos = await page.evaluate(() => {
      const peso = (posicao: string): number => {
        const rotulo = document
          .querySelector(`li[data-jos-posicao="${posicao}"] div span`)
          ?.closest('span')
        return Number(getComputedStyle(rotulo as Element).fontWeight)
      }
      return { atual: peso('atual'), futura: peso('futura') }
    })

    // Segundo sinal redundante: quem não vê a forma do marcador lê o peso. Se os dois fossem
    // iguais, a posição dependeria só da cor — que é o que o princípio proíbe.
    expect(pesos.atual).toBeGreaterThan(pesos.futura)
  })
})

test.describe('legibilidade nos dois modos', () => {
  for (const modo of MODOS) {
    test(`o rótulo da etapa atual atinge 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, 'meio', modo)

      const { texto, fundo } = await page.evaluate(() => {
        const rotulo = document.querySelector('li[aria-current="step"] div span') as Element
        return {
          texto: getComputedStyle(rotulo).color,
          fundo: getComputedStyle(document.querySelector('[data-jornada-planejamento]') as Element)
            .backgroundColor
        }
      })

      expect(contraste(texto, fundo), `etapa atual em ${modo}`).toBeGreaterThanOrEqual(4.5)
    })

    test(`o "o que falta" da etapa futura atinge 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, 'meio', modo)

      // O texto mais fraco da trilha, e o que mais arrisca falhar: é `texto-suave` em `micro`.
      // Se ele não fechar, o critério 4 entrega uma explicação que ninguém lê.
      const { texto, fundo } = await page.evaluate(() => {
        const futura = document.querySelector('li[data-jos-posicao="futura"] div') as Element
        const explicacao = futura.querySelectorAll('span')
        return {
          texto: getComputedStyle(explicacao[explicacao.length - 1] as Element).color,
          fundo: getComputedStyle(document.querySelector('[data-jornada-planejamento]') as Element)
            .backgroundColor
        }
      })

      expect(contraste(texto, fundo), `o que falta em ${modo}`).toBeGreaterThanOrEqual(4.5)
    })
  }
})

test.describe('critério 7 — a regressão diz o motivo', () => {
  test('o motivo aparece acima da trilha, não dentro dela', async ({ page }) => {
    await abrir(page, 'regressao', 'dark')

    const motivo = page.getByText('O PRD mudou semanticamente depois do aceite do pacote.')
    await expect(motivo).toBeVisible()

    // Acima da lista, medido por posição real: o PI precisa saber **por que** a jornada andou
    // para trás antes de procurar onde ela parou. Enterrado numa linha, o motivo competiria
    // com o próximo passo.
    //
    // `first()`: desde a SPEC-Fases-01 a trilha tem uma `ol` por fase (três blocos), e o que se
    // mede é o motivo estar acima de **onde a trilha começa** — a primeira delas.
    const caixaMotivo = await motivo.boundingBox()
    const caixaTrilha = await page.locator('ol').first().boundingBox()
    expect(caixaMotivo!.y).toBeLessThan(caixaTrilha!.y)
  })
})
