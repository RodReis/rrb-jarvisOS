import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Prova visual do pacote de arquitetura em abas (issue #333).
 *
 * **O que só existe aqui.** O problema que abriu esta issue é altura de página, e jsdom não tem
 * layout: `scrollHeight` ali é sempre zero. A suíte de tela afirma que as abas existem e que o
 * contador aparece; ela não tem como discordar de *"scroll muito grande vertical"*.
 *
 * Medidas de referência, na cena `pacote-cheio` (quatro documentos, doze seções, oito ajustes),
 * numa janela de 900px de altura:
 *
 *  - antes das abas, a etapa inteira: **4.941px**, cinco telas e meia
 *  - depois: nenhuma aba passa de **1.665px**
 */

const MODOS = ['dark', 'light'] as const
const JANELA = { width: 1280, height: 900 }

async function abrir(page: Page, cena: string, modo: string): Promise<void> {
  await page.setViewportSize(JANELA)
  await page.goto(`/?galeria=arquitetura&cena=${cena}&modo=${modo}`)
  await page.waitForSelector('[role="tab"]')
}

test.describe('a altura da etapa (o pedido do PI)', () => {
  test('nenhuma aba passa de duas telas de rolagem', async ({ page }) => {
    await abrir(page, 'pacote-cheio', 'dark')

    const nomes = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent ?? '')
    )

    for (const nome of nomes) {
      await page.getByRole('tab', { name: nome, exact: true }).click()
      const altura = await page.evaluate(() => document.documentElement.scrollHeight)
      // Duas telas é o teto declarado. A etapa inteira media 5,5 antes das abas.
      expect(altura, `a aba "${nome}" cresceu`).toBeLessThan(JANELA.height * 2)
    }
  })

  test('o conteúdo da aba inativa não fica no fluxo', async ({ page }) => {
    await abrir(page, 'pacote-cheio', 'dark')

    /*
     * **O invólucro fica, o conteúdo não.** O Radix mantém os cinco elementos `tabpanel` no
     * documento — é assim que ele preserva a relação ARIA entre gatilho e painel —, mas os
     * inativos ficam `hidden`, com zero filhos e altura zero.
     *
     * Isso é o que importa para o pedido do PI: esconder com `display:none` mantendo o conteúdo
     * também zeraria a altura, mas manteria o custo de render e o texto acessível a buscas de
     * página. Medir os filhos separa "não é exibido" de "não existe".
     */
    const paineis = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tabpanel"]')].map((el) => ({
        ativo: el.getAttribute('data-state') === 'active',
        filhos: el.childElementCount,
        altura: Math.round(el.getBoundingClientRect().height)
      }))
    )

    expect(paineis.filter((p) => p.ativo)).toHaveLength(1)
    for (const inativo of paineis.filter((p) => !p.ativo)) {
      expect(inativo.filhos).toBe(0)
      expect(inativo.altura).toBe(0)
    }
  })
})

test.describe('a medida de leitura dentro da coluna', () => {
  for (const modo of MODOS) {
    test(`a afirmação usa a coluna, sem teto próprio herdado (${modo})`, async ({ page }) => {
      await abrir(page, 'pacote-cheio', modo)
      await page.getByRole('tab', { name: /Decisões/ }).click()

      const medida = await page.evaluate(() => {
        const p = document.querySelector('[data-jos-afirmacao] p')
        // O painel **ativo**: os inativos continuam no DOM com largura zero, e medir o primeiro
        // do documento devolveria 0 sem que nada estivesse errado.
        const painel = document.querySelector('[role="tabpanel"][data-state="active"]')
        return {
          texto: p?.getBoundingClientRect().width ?? 0,
          coluna: painel?.getBoundingClientRect().width ?? 0
        }
      })

      /*
       * O defeito que esta prova trava: `max-w-[58ch]` a 14px vale 437px, e dentro da coluna de
       * conteúdo ele sufocava o texto duas vezes — 438px medidos numa coluna de 832px, com
       * metade vazia à direita, e cada afirmação ocupando duas linhas onde cabia uma.
       *
       * O brief já tinha esta correção; a arquitetura e o PRD não a receberam na época.
       */
      expect(medida.coluna).toBeGreaterThan(0)
      expect(medida.texto).toBeGreaterThan(medida.coluna * 0.9)
    })
  }
})

test.describe('o que pede decisão fica visível de fora', () => {
  test('o contador vive no rótulo da aba, não num badge', async ({ page }) => {
    await abrir(page, 'pacote-cheio', 'dark')

    // Número é texto: atravessa leitor de tela, daltonismo e escala de cinza. Um badge colorido
    // seria forma sozinha, e o princípio 2 do PRODUCT.md não aceita isso como único sinal.
    await expect(page.getByRole('tab', { name: /A revisar \(18\)/ })).toBeVisible()
  })

  test('a aba que pede decisão é a que abre', async ({ page }) => {
    await abrir(page, 'pacote-cheio', 'dark')

    await expect(page.getByRole('tab', { name: /A revisar/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('sem pendência, abre no primeiro documento e o rótulo não anuncia zero', async ({
    page
  }) => {
    await abrir(page, 'pacote-magro', 'dark')

    await expect(page.getByRole('tab', { name: 'Nada a revisar' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Arquitetura' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})

test.describe('teclado', () => {
  test('as abas andam pela seta, e o painel acompanha', async ({ page }) => {
    await abrir(page, 'pacote-cheio', 'dark')

    await page.getByRole('tab', { name: /A revisar/ }).focus()
    await page.keyboard.press('ArrowRight')

    await expect(page.getByRole('tab', { name: 'Arquitetura' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})

/**
 * A barra de andamento durante a geração (issue #337).
 *
 * **Por que ela só pode ser medida aqui.** A barra nasceu na #287 e nunca teve gate visual. Ela
 * distingue os estados das etapas por **forma**, não por cor — cheio para concluída, anel para a
 * que acontece agora, vazado para o que não começou — porque o acento é escolhido pelo usuário
 * entre oito cores e três delas destroem o sinal. Forma de 8px é exatamente o que a M25-F01
 * pegou renderizando a 2px com todos os testes de tela verdes.
 *
 * A cena `gerando` congela quatro estados numa captura: duas concluídas, uma em curso, uma
 * falhada com o motivo.
 */
test.describe('o andamento da geração (issue #337)', () => {
  async function abrirGerando(page: Page, modo: string, cena = 'gerando'): Promise<void> {
    await page.setViewportSize(JANELA)
    await page.goto(`/?galeria=arquitetura&cena=${cena}&modo=${modo}`)
    await page.waitForSelector('[data-jos-progresso]')
  }

  for (const modo of MODOS) {
    test(`os marcadores de estado têm tamanho de verdade — ${modo}`, async ({ page }) => {
      await abrirGerando(page, modo)

      /*
       * O marcador é o que carrega o estado sem depender de cor. Um marcador que renderiza a
       * 2px continua passando em todo teste de tela — ele existe, tem o `data-jos-estado` certo
       * e o texto ao lado. Só a medida real reprova.
       */
      const marcadores = page.locator('[data-jos-etapa] span[aria-hidden="true"]')
      const total = await marcadores.count()
      expect(total).toBe(5)

      for (let i = 0; i < total; i += 1) {
        const caixa = await marcadores.nth(i).boundingBox()
        expect(caixa?.width, `o marcador ${i} sumiu`).toBeGreaterThanOrEqual(7)
        expect(caixa?.height, `o marcador ${i} sumiu`).toBeGreaterThanOrEqual(7)
      }
    })
  }

  test('a etapa em curso se distingue da concluída sem usar cor', async ({ page }) => {
    await abrirGerando(page, 'dark')

    /*
     * O princípio 2 do produto na forma medível: em escala de cinza os dois marcadores ainda
     * precisam ser diferentes. A concluída é preenchida e a em curso é um anel, então a
     * espessura de borda os separa — não o matiz.
     */
    const borda = async (etapa: string): Promise<string> =>
      page.evaluate((sel) => {
        const el = document.querySelector(`[data-jos-etapa="${sel}"] span[aria-hidden="true"]`)
        return el === null ? '' : getComputedStyle(el).borderTopWidth
      }, etapa)

    const concluida = await borda('prototipos')
    const emCurso = await borda('coerencia')

    expect(emCurso).not.toBe(concluida)
    expect(parseFloat(emCurso)).toBeGreaterThan(0)
  })

  test('a barra fica acima da dobra, junto do topo da etapa', async ({ page }) => {
    await abrirGerando(page, 'dark')

    /*
     * A regra da SPEC-Jornada-03 § Emenda E2: o andamento fica **junto do botão que dispara**.
     * Ela existe porque a barra nasceu no fim de uma página longa (#318) e o PI, olhando o topo
     * depois de clicar, rolava a tela inteira para saber onde a rodada estava.
     */
    const caixa = await page.locator('[data-jos-progresso]').boundingBox()

    expect(caixa?.y, 'a barra caiu abaixo da dobra').toBeLessThan(JANELA.height)
  })

  test('a etapa que falhou diz "falhou" em texto, e o motivo aparece', async ({ page }) => {
    await abrirGerando(page, 'dark', 'gerando-falhou')

    // Cor sozinha não atravessa daltonismo nem escala de cinza. O texto atravessa.
    const linha = page.locator('[data-jos-etapa="coerencia"]')

    await expect(linha).toContainText('falhou')
    await expect(page.locator('[data-jos-progresso]')).toContainText('a análise não devolveu saída')
  })
})
