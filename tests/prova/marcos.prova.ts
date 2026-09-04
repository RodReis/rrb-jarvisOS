import { expect, test } from '@playwright/test'

/**
 * Prova visual do painel de marcos (SPEC-Fases-04, § Testes).
 *
 * O painel tem **quatro estados por linha**, e três deles são de aviso. Os testes de tela afirmam
 * que o texto "commit desatualizado" existe; nenhum deles consegue afirmar que ele se distingue
 * de "sem commit" ao lado, nem que o hash curto continua legível no modo claro — jsdom não
 * computa cor, não carrega fonte e não mede largura.
 *
 * O que estes testes medem é o que só existe com layout:
 *  - **Contraste real** do texto e dos badges nos dois modos, composto sobre o fundo opaco.
 *  - **O hash em tabular**, porque `tabular-nums` é a diferença entre uma coluna que alinha e uma
 *    que dança entre linhas — e é justamente a coluna que o PI compara com o `git log`.
 *  - **A distinção entre os estados**, que uma paleta só de cor não garante.
 */

const ROTA = (query: string): string => `/?galeria=marcos&${query}`

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
 * Sem isto o teste mediria o alfa como se fosse opaco, e um texto a 60% passaria como se tivesse
 * contraste pleno: afirmaria uma legibilidade que ninguém tem.
 */
function compor(frente: string, fundo: string): string {
  const f = (frente.match(/[\d.]+/g) ?? []).map(Number)
  const b = (fundo.match(/[\d.]+/g) ?? []).map(Number)
  const alfa = f[3] ?? 1
  const canal = (i: number): number => Math.round(f[i]! * alfa + b[i]! * (1 - alfa))
  return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`
}

/**
 * Cor e fundo **efetivo** de um elemento: a pilha de camadas até a primeira opaca.
 *
 * Medir contra `document.body` dá o número errado sempre que o elemento está sobre uma superfície
 * própria — o `InlineAlert` tem a dele, e o teste acusaria 1,44:1 num texto perfeitamente
 * legível. Aqui as camadas voltam da mais externa para a mais interna e são compostas na ordem.
 */
async function medirContraste(
  page: import('@playwright/test').Page,
  seletor: string
): Promise<number> {
  const medida = await page.evaluate((sel) => {
    const alvo = document.querySelector(sel)
    if (alvo === null) return null

    const camadas: string[] = []
    let atual: Element | null = alvo
    while (atual !== null) {
      const cor = getComputedStyle(atual).backgroundColor
      const alfa = Number((cor.match(/[\d.]+/g) ?? [])[3] ?? 1)
      if (alfa > 0) camadas.push(cor)
      if (alfa === 1) break
      atual = atual.parentElement
    }

    return { cor: getComputedStyle(alvo).color, camadas: camadas.reverse() }
  }, seletor)

  if (medida === null) throw new Error(`Elemento não encontrado: ${seletor}`)

  const fundo = medida.camadas.reduce((acumulado, camada) => compor(camada, acumulado))
  return contraste(compor(medida.cor, fundo), fundo)
}

async function abrir(
  page: import('@playwright/test').Page,
  cena: string,
  modo: string,
  acento = '%23D3AF37'
): Promise<void> {
  await page.goto(ROTA(`cena=${cena}&modo=${modo}&acento=${acento}`))
  await page.waitForSelector(`[data-jos-marcos="${cena}"]`)
  // O painel é um `<details>` fechado por padrão: abrir é o que revela as linhas a medir.
  const resumo = page.locator('summary').first()
  if (await resumo.isVisible()) await resumo.click()
  // Sem esperar a fonte, a medida sai da fallback e o teste avaliaria uma tipografia que o
  // produto não usa.
  await page.evaluate(() => document.fonts.ready)
}

for (const modo of ['dark', 'light'] as const) {
  test.describe(`painel de marcos (${modo})`, () => {
    test('captura das três cenas para o gate visual', async ({ page }) => {
      for (const cena of ['em-dia', 'pendente', 'sem-git'] as const) {
        await abrir(page, cena, modo)
        await page.screenshot({ path: `reports/prova/marcos-${cena}-${modo}.png` })
      }
    })

    /**
     * O hash curto é a coluna que o PI compara com o `git log`, e `l`/`1` e `O`/`0` importam
     * nela. Sem `tabular-nums` os dígitos têm largura própria e a coluna dança entre linhas —
     * o mesmo defeito de forma que o gate visual da F03 achou no rótulo em maiúsculas.
     */
    test('o hash curto usa numerais tabulares e a fonte mono', async ({ page }) => {
      await abrir(page, 'pendente', modo)

      const hash = page.locator('code').first()
      const estilo = await hash.evaluate((el) => {
        const c = getComputedStyle(el)
        return { variant: c.fontVariantNumeric, familia: c.fontFamily }
      })

      expect(estilo.variant).toContain('tabular-nums')
      expect(estilo.familia.toLowerCase()).toMatch(/mono/)
    })

    /**
     * **A coluna do hash alinha entre as linhas.**
     *
     * Foi a captura que achou: com `flex-1` no caminho, cada linha punha o hash onde sobrava
     * espaço — x≈613 numa, x≈358 na seguinte. É a coluna que o PI compara com o `git log`, e uma
     * que dança obriga a procurar o dado em vez de varrer. Nenhum teste de tela mede posição: o
     * papel ARIA é o mesmo nos dois layouts.
     */
    test('a coluna do hash tem a mesma origem em todas as linhas', async ({ page }) => {
      await abrir(page, 'pendente', modo)

      const origens = await page
        .locator('li code')
        .evaluateAll((codes) => codes.map((c) => Math.round(c.getBoundingClientRect().x)))

      expect(origens.length).toBeGreaterThan(1)
      expect(new Set(origens).size).toBe(1)
    })

    /**
     * Contraste do corpo: o caminho do documento é o texto que o PI lê primeiro, e ele fica sobre
     * a superfície do painel. A régua é 4.5:1 (WCAG AA, PRD §14) nos **dois** modos — o modo
     * claro das telas internas é canônico, não cortesia.
     */
    test('o caminho do documento passa a régua de 4.5:1', async ({ page }) => {
      await abrir(page, 'pendente', modo)

      // Seletor próprio, e não "o primeiro `span` do `li`": a posição do elemento é detalhe de
      // composição, e medir por ela faria o teste avaliar outra coisa na primeira reordenação.
      expect(await medirContraste(page, '[data-jos-marco-caminho]')).toBeGreaterThanOrEqual(4.5)
    })

    /**
     * **Estado nunca é comunicado só por cor** (PRD §14, princípio 2). O badge carrega o rótulo
     * em palavra, e é ele que sobrevive ao daltonismo e ao alto contraste. O teste mede que os
     * quatro estados têm **texto distinto** — não que têm cores distintas.
     */
    test('os quatro estados se distinguem por palavra, não só por cor', async ({ page }) => {
      await abrir(page, 'pendente', modo)

      const rotulos = await page.locator('li').evaluateAll((itens) =>
        itens.map((item) => {
          const badge = [...item.querySelectorAll('span')]
            .map((s) => s.textContent?.trim() ?? '')
            .filter((t) =>
              ['versionado', 'sem commit', 'commit desatualizado', 'sem revisão'].includes(t)
            )
          return badge[0] ?? ''
        })
      )

      // Quatro linhas, quatro estados, quatro palavras diferentes.
      expect(new Set(rotulos.filter((r) => r !== ''))).toEqual(
        new Set(['versionado', 'sem commit', 'commit desatualizado', 'sem revisão'])
      )
    })

    /**
     * A explicação do pendente é **texto**, não `title`: tooltip de mouse não existe para quem
     * navega por teclado, e é justo o estado pendente que precisa ser entendido. O teste mede
     * que ela está visível no DOM renderizado, e não escondida num atributo.
     */
    test('a explicação do pendente é texto visível, não tooltip', async ({ page }) => {
      await abrir(page, 'pendente', modo)

      await expect(
        page.getByText('O commit guarda uma versão anterior à que foi aceita.')
      ).toBeVisible()
    })

    /**
     * Git indisponível não pode virar lista vazia: o usuário leria "nenhum documento", que é o
     * oposto do que aconteceu. A mensagem precisa estar legível — com a ação concreta.
     */
    test('sem Git, a explicação aparece legível em vez de uma lista vazia', async ({ page }) => {
      await abrir(page, 'sem-git', modo)

      await expect(page.getByText(/Terminal Controlado/)).toBeVisible()

      /*
        O `InlineAlert` tem superfície própria: o contraste é contra o fundo **dele**, não contra
        o `body`. Foi este teste que trocou o `<p>` colorido pelo componente do DS — o texto solto
        em `warn-leitura` media 3,90:1 no modo claro, abaixo da régua.

        E mede o **título**, não o `[role="alert"]`: o contêiner não pinta cor de texto própria, e
        medir nele daria a cor herdada sobre o fundo do alerta — 1,16:1 num texto que se lê
        perfeitamente. Medir o elemento errado inventa defeito tão bem quanto esconde.
      */
      const titulo = await page.evaluate(() => {
        const alerta = document.querySelector('[role="alert"]')
        const alvo = alerta?.querySelector('strong, h1, h2, h3, h4, p, span')
        return alvo === null || alvo === undefined ? null : true
      })
      expect(titulo).toBe(true)

      expect(
        await medirContraste(page, '[role="alert"] :is(strong, h1, h2, h3, h4, p, span)')
      ).toBeGreaterThanOrEqual(4.5)
    })
  })
}
