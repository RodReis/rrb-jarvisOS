import { expect, test } from '@playwright/test'

/**
 * Prova visual do prompt e do gate do brief (SPEC-Jornada-02, § Testes).
 *
 * **É o gate visual que a spec exige.** A M25-F01 mostrou o que os testes em JSDOM deixam
 * passar: marcadores de 20px renderizando a 2px, com toda a suíte verde. `getByRole` acha um
 * elemento invisível tão bem quanto um legível.
 *
 * O que só existe aqui:
 *  - **Contraste computado nos dois modos**, inclusive do texto mais fraco da tela — o rótulo de
 *    origem em micro, que é justamente onde o critério 4 vive.
 *  - **A origem legível sem cor**: a prova mede que o rótulo é **texto**, presente no DOM, e não
 *    um badge que dependesse de pintura.
 *  - **A captura para o PI**, que é o artefato do gate.
 */

const ROTA = (query: string): string => `/?galeria=brief&${query}`

const CENAS = ['prompt-vazio', 'refinamento-bloqueado', 'brief-propostos', 'brief-travado'] as const
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
  await page.waitForSelector(`[data-jos-brief="${cena}"]`)
  // Sem esperar a fonte, a medida sai da fallback e o teste avaliaria uma tipografia que o
  // produto não usa.
  await page.evaluate(() => document.fonts.ready)
}

test.describe('captura para o gate visual', () => {
  for (const cena of CENAS) {
    for (const modo of MODOS) {
      test(`captura ${cena} (${modo})`, async ({ page }) => {
        await abrir(page, cena, modo)
        await page.screenshot({ path: `reports/prova/brief-${cena}-${modo}.png`, fullPage: true })
      })
    }
  }
})

/**
 * O critério 6 vive no **refinamento** desde a #281.
 *
 * A geração do brief migrou da tela do prompt para o fim do refinamento, e o bloqueio migrou
 * com ela: salvar o prompt não chama o modelo, então bloquear aquela tela anunciaria um custo
 * que ali não existe. O que a prova mede é o mesmo — o bloqueio antes do clique, com a ação
 * junto —, na tela onde a chamada de fato acontece.
 */
test.describe('critério 6 — o bloqueio aparece antes do clique', () => {
  for (const modo of MODOS) {
    test(`o aviso traz a ação concreta (${modo})`, async ({ page }) => {
      await abrir(page, 'refinamento-bloqueado', modo)

      // Bloqueio sem saída é beco: o PI precisa saber o que fazer, não só que não deu.
      await expect(page.getByText(/Conecte a assinatura do Claude/)).toBeVisible()
    })

    test(`o botão de gerar está desabilitado (${modo})`, async ({ page }) => {
      await abrir(page, 'refinamento-bloqueado', modo)

      await expect(page.getByRole('button', { name: /Gerar as perguntas/ })).toBeDisabled()
    })
  }
})

test.describe('critério 4 — a origem é legível, e os propostos são um conjunto', () => {
  test('cada afirmação diz a origem em texto, não em cor', async ({ page }) => {
    await abrir(page, 'brief-propostos', 'dark')

    // Medido no DOM: é texto que sobrevive ao daltonismo e ao leitor de tela. Um badge pintado
    // por origem passaria num teste de papel e falharia para quem lê em escala de cinza.
    await expect(page.getByText('do seu prompt').first()).toBeVisible()
    await expect(page.getByText('da sua decisão').first()).toBeVisible()
    await expect(page.getByText('proposto pela IA').first()).toBeVisible()
  })

  test('os propostos aparecem em painel próprio, acima do brief', async ({ page }) => {
    await abrir(page, 'brief-propostos', 'dark')

    const painel = page.locator('[data-jos-propostos]')
    await expect(painel).toBeVisible()

    // Acima, medido por posição real: descobrir os propostos lendo dez blocos seria pedir ao PI
    // a varredura que o painel faz por ele.
    const caixaPainel = await painel.boundingBox()
    const primeiroBloco = await page.locator('[data-jos-bloco]').first().boundingBox()
    expect(caixaPainel!.y).toBeLessThan(primeiroBloco!.y)
  })

  test('só o proposto oferece corte', async ({ page }) => {
    await abrir(page, 'brief-propostos', 'dark')

    const cortaveis = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-jos-afirmacao]')).map((li) => ({
        origem: li.getAttribute('data-jos-origem'),
        temBotao: li.querySelector('button') !== null
      }))
    )

    // O que veio do PI não tem botão: o critério 5 protege exatamente isso.
    for (const item of cortaveis) {
      expect(item.temBotao).toBe(item.origem === 'proposto')
    }
  })
})

test.describe('legibilidade nos dois modos', () => {
  for (const modo of MODOS) {
    test(`o rótulo de origem atinge 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, 'brief-propostos', modo)

      // O texto mais fraco da tela — micro, cor suave — e o que carrega o critério 4. Se ele
      // não fechar, a origem por afirmação existe no DOM e não na prática.
      const { texto, fundo } = await page.evaluate(() => {
        const li = document.querySelector('[data-jos-afirmacao]')!
        const rotulo = li.querySelectorAll('span')
        return {
          texto: getComputedStyle(rotulo[rotulo.length - 1]!).color,
          fundo: getComputedStyle(document.querySelector('[data-jos-brief]')!).backgroundColor
        }
      })

      expect(contraste(texto, fundo), `origem em ${modo}`).toBeGreaterThanOrEqual(4.5)
    })

    test(`o texto da afirmação atinge 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, 'brief-propostos', modo)

      const { texto, fundo } = await page.evaluate(() => ({
        texto: getComputedStyle(document.querySelector('[data-jos-afirmacao] p')!).color,
        fundo: getComputedStyle(document.querySelector('[data-jos-brief]')!).backgroundColor
      }))

      expect(contraste(texto, fundo), `afirmação em ${modo}`).toBeGreaterThanOrEqual(4.5)
    })
  }
})

test.describe('aceite travado por pendência material', () => {
  test('o aviso diz quais faltam, não só quantas', async ({ page }) => {
    await abrir(page, 'brief-travado', 'dark')

    // Um número sem os itens obrigaria o PI a caçar os buracos pelos dez blocos.
    await expect(page.getByText('Onde os dados de leitura ficam guardados?')).toBeVisible()
  })
})

test.describe('a etapa do prompt', () => {
  test('é um campo e nada mais — sem contador nem estrutura sugerida', async ({ page }) => {
    await abrir(page, 'prompt-vazio', 'dark')

    // Qualquer moldura empurraria o PI a preencher um formulário em vez de descrever.
    await expect(page.locator('textarea')).toHaveCount(1)
    await expect(page.locator('input')).toHaveCount(0)
  })

  /*
   * Os exemplos existem para resolver a página em branco — o campo vazio chega quando o PI tem
   * menos ideia do que escrever. Mas eles são para **ler**: um cartão que preenchesse o campo
   * faria o PI partir do texto da IA em vez do problema dele, e é contra isso que a decisão de
   * "um campo, e nada mais" existe. O teste trava a fronteira entre ajudar e preencher.
   */
  test('os exemplos são para ler, não para clicar', async ({ page }) => {
    await abrir(page, 'prompt-vazio', 'dark')

    const exemplo = page.getByText(/Organiza minhas leituras/)
    await expect(exemplo).toBeVisible()

    // Nenhum ancestral clicável: o exemplo não é botão, link nem alvo de clique.
    const clicavel = await exemplo.evaluate(
      (el) => el.closest('button, a, [role="button"], [onclick]') !== null
    )
    expect(clicavel).toBe(false)

    // E o campo continua vazio depois de clicar nele — nada preenche por engano.
    await exemplo.click()
    await expect(page.locator('textarea')).toHaveValue('')
  })

  test('o campo tem altura para um parágrafo, não para uma linha', async ({ page }) => {
    await abrir(page, 'prompt-vazio', 'dark')

    // Um campo de uma linha convida a uma frase; o prompt pede um parágrafo.
    const caixa = await page.locator('textarea').boundingBox()
    expect(caixa!.height).toBeGreaterThan(150)
  })
})

/*
 * Por onde a geração sai, dito **antes** do clique (decisão do PI, 2026-09-03).
 *
 * As telas mostravam o bloqueio quando **não havia** rota, mas ficavam mudas quando havia: o PI
 * clicava sem saber se aquilo consumia a assinatura dele ou o provedor pago do workspace. As
 * duas rotas não são o mesmo fato — uma gasta dinheiro —, e a forma acompanha o peso.
 */
test.describe('a rota é dita antes do clique', () => {
  test('assinatura é uma linha, não um alerta', async ({ page }) => {
    await abrir(page, 'refinamento-vazio', 'dark')

    await expect(page.locator('[data-jos-rota="assinatura"]')).toBeVisible()
    // Alerta que aparece sempre para de ser lido: o caso normal não grita.
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('a rota paga vira alerta, porque o clique passa a custar', async ({ page }) => {
    await abrir(page, 'refinamento-rota-paga', 'dark')

    await expect(page.getByText('Esta geração usa a rota paga')).toBeVisible()
    await expect(page.locator('[data-jos-rota="paga"]')).toBeVisible()
  })

  test('bloqueada, nenhum selo anuncia rota — o botão não gera', async ({ page }) => {
    await abrir(page, 'refinamento-bloqueado', 'dark')

    // Anunciar por onde a geração sairia descreveria algo que não vai acontecer.
    await expect(page.locator('[data-jos-rota]')).toHaveCount(0)
  })
})

/**
 * A coluna de julgamento (SPEC-Jornada-02, § Superfície).
 *
 * Estes testes existem porque os 24 de tela passaram verdes sobre o defeito: papel ARIA não mede
 * largura, e a captura mostrou o documento usando 366px de uma coluna de 536px — duas medidas
 * empilhadas cortando pelo menor.
 */
test.describe('a coluna de julgamento', () => {
  test('o documento usa a largura da coluna, sem teto próprio herdado', async ({ page }) => {
    await abrir(page, 'brief-propostos', 'dark')

    const medida = await page.evaluate(() => {
      // Uma afirmação **sem botão**: com o "Cortar" ao lado, o texto divide a linha por desenho,
      // e medir essa cortaria pelo motivo errado.
      const semBotao = [...document.querySelectorAll('[data-jos-afirmacao]')].find(
        (li) => li.querySelector('button') === null
      )
      const p = semBotao?.querySelector('p')
      const coluna = document.querySelector('[data-jos-aceite="brief"]')?.previousElementSibling

      return {
        texto: p?.getBoundingClientRect().width ?? 0,
        coluna: coluna?.getBoundingClientRect().width ?? 0
      }
    })

    expect(medida.coluna).toBeGreaterThan(0)
    // Sem folga: o parágrafo ocupa a coluna. Antes eram 366 de 536.
    expect(medida.texto).toBeCloseTo(medida.coluna, 0)
  })

  test('o painel acompanha a rolagem quando há espaço para duas colunas', async ({ page }) => {
    await abrir(page, 'brief-travado', 'dark')

    const posicao = await page.evaluate(() => {
      const painel = document.querySelector('[data-jos-aceite="brief"]')
      return painel === null ? null : getComputedStyle(painel).position
    })

    // Com o aceite no rodapé, a razão do bloqueio ficava a uma tela de distância do botão.
    expect(posicao).toBe('sticky')
  })

  test('o botão de aceite e a pendência que o trava ficam no mesmo painel', async ({ page }) => {
    await abrir(page, 'brief-travado', 'dark')

    const painel = page.locator('[data-jos-aceite="brief"]')
    await expect(painel.getByRole('button', { name: /Aceitar o brief/ })).toBeDisabled()
    await expect(painel.getByText(/Onde os dados de leitura/)).toBeVisible()
  })
})
