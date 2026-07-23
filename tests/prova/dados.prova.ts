import { expect, test } from '@playwright/test'

/**
 * Prova visual de dados, overlays e feedback (SPEC-DesignSystem-03b).
 *
 * Irmã de `controles.prova.ts` e com a mesma régua: roda num **navegador de verdade** e mede o
 * que jsdom não mede — contraste **computado**, layout real, o glass do toast, o anel de foco
 * pintado. Os testes de componente já cobrem papel ARIA; repeti-los aqui seria caro e redundante.
 *
 * As capturas são **artefato de revisão**, não baseline de regressão visual (suspensa no
 * MVP-003 §4): as asserções são medidas, não pixels.
 *
 * A diferença de forma para a F03a vem do assunto: metade desta fatia só existe **aberta**, e
 * por isso a galeria aceita `cena` na query — cada cena monta um overlay diferente.
 */

const ROTA = (params: string): string => `/?galeria=dados&${params}`

/**
 * O card do toast, ancorado no viewport.
 *
 * `[role="status"]` sozinho não serve: o `Spinner` da própria página também o usa, e a busca
 * encontraria o primeiro do DOM — que não é um toast. Custou uma investigação; o container
 * ganhou `data-jos-toasts` para que o alvo seja inequívoco.
 */
const TOAST = '[data-jos-toasts] [role="status"], [data-jos-toasts] [role="alert"]'

/** Combinações de tema, como na F03a. */
const CENARIOS = [
  { nome: 'jarvis-escuro', query: 'modo=dark&modulo=jarvis' },
  { nome: 'jarvis-claro', query: 'modo=light&modulo=jarvis' },
  { nome: 'noa-escuro', query: 'modo=dark&modulo=noa' },
  { nome: 'noa-claro', query: 'modo=light&modulo=noa' }
] as const

/** Os estados que só existem abertos. */
const CENAS = ['dialog', 'alert', 'drawer', 'toasts'] as const

/** Espera a galeria montar com as fontes carregadas — senão a captura registra fonte de sistema. */
async function abrir(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(ROTA(query))
  await page.waitForSelector('[data-testid="galeria"]')
  await page.evaluate(() => document.fonts.ready)
}

test.describe('galeria de dados', () => {
  for (const cenario of CENARIOS) {
    test(`captura ${cenario.nome}`, async ({ page }) => {
      await abrir(page, cenario.query)
      await expect(page.locator('[data-testid="galeria"]')).toBeVisible()
      await page.screenshot({ path: `reports/prova/dados-${cenario.nome}.png`, fullPage: true })
    })
  }

  for (const cena of CENAS) {
    test(`captura overlay ${cena}`, async ({ page }) => {
      await abrir(page, `modo=dark&cena=${cena}`)
      // `fullPage: false`: o overlay é `position: fixed` e a captura de página inteira o
      // renderiza no topo do documento, longe de onde ele aparece. O viewport é o que o
      // usuário vê.
      await page.screenshot({ path: `reports/prova/dados-${cena}.png` })
    })
  }
})

test.describe('contraste computado (WCAG 2.2 AA)', () => {
  /**
   * Razão de contraste entre a cor e o fundo **efetivos** de um elemento.
   *
   * Sobe a árvore atrás do primeiro fundo opaco: `background-color` de um `<span>` costuma ser
   * `rgba(0,0,0,0)`, e medir contra transparente daria um número inventado. É o mesmo motivo de
   * medir aqui e não no token: um `var()` que não resolveu cai na cor herdada em silêncio, e só
   * o navegador denuncia.
   */
  /** Roda no navegador: recebe o seletor e devolve a razão de contraste. */
  const medirContraste = (seletor: string): number => {
    const el = document.querySelector(seletor)
    if (el === null) throw new Error(`Elemento não encontrado: ${seletor}`)

    const lum = (cor: string): number => {
      const m = cor.match(/[\d.]+/g)
      if (m === null) throw new Error(`Cor não interpretável: ${cor}`)
      const [r, g, b] = m
        .slice(0, 3)
        .map(Number)
        .map((c) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const opaco = (cor: string): boolean => !cor.startsWith('rgba(') || !cor.endsWith(', 0)')

    let no = el as HTMLElement
    let fundo = getComputedStyle(no).backgroundColor
    while (!opaco(fundo) && no.parentElement !== null) {
      no = no.parentElement
      fundo = getComputedStyle(no).backgroundColor
    }

    const a = lum(getComputedStyle(el).color)
    const b = lum(fundo)
    const [claro, escuro] = a > b ? [a, b] : [b, a]
    return (claro + 0.05) / (escuro + 0.05)
  }

  for (const modo of ['dark', 'light'] as const) {
    test(`o texto do corpo atinge 4.5:1 no modo ${modo}`, async ({ page }) => {
      await abrir(page, `modo=${modo}`)
      const razao = await page.evaluate(medirContraste, '[data-testid="galeria"]')
      expect(razao, `contraste do corpo no modo ${modo}`).toBeGreaterThanOrEqual(4.5)
    })

    test(`o valor do Meter atinge 4.5:1 no modo ${modo}`, async ({ page }) => {
      await abrir(page, `modo=${modo}`)
      // O número ao lado da barra é o que torna o Meter legível sem cor (critério 4). Se ele
      // não passar a régua, o componente volta a depender da barra — que é só cor.
      const razao = await page.evaluate(medirContraste, '[data-prova="indicadores"] .text-right')
      expect(razao, `contraste do valor do Meter no modo ${modo}`).toBeGreaterThanOrEqual(4.5)
    })
  }
})

test.describe('o toast permanece escuro no tema claro (critério 2, README §2.6)', () => {
  test('o card do toast não inverte com `uiTheme=light`', async ({ page }) => {
    await abrir(page, 'modo=light&cena=toasts')
    await page.waitForSelector(TOAST)

    const { fundoToast, fundoPagina } = await page.evaluate((seletor) => {
      const toast = document.querySelector(seletor) as HTMLElement
      const galeria = document.querySelector('[data-testid="galeria"]') as HTMLElement
      return {
        fundoToast: getComputedStyle(toast).backgroundColor,
        fundoPagina: getComputedStyle(galeria).backgroundColor
      }
    }, TOAST)

    const luminancia = (cor: string): number => {
      const m = cor.match(/[\d.]+/g)
      if (m === null) throw new Error(`Cor não interpretável: ${cor}`)
      const [r, g, b] = m
        .slice(0, 3)
        .map(Number)
        .map((c) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    // Aqui a medida é possível de verdade — em jsdom o teste de componente só pôde afirmar
    // sobre **quais variáveis** o card referencia. O navegador resolve o `var()` e diz a cor.
    // O toast tem de ser mais escuro que a página clara: é superfície de marca e não inverte.
    expect(luminancia(fundoToast)).toBeLessThan(luminancia(fundoPagina))
    expect(luminancia(fundoToast)).toBeLessThan(0.2)
  })

  test('o texto do toast é legível sobre o próprio fundo', async ({ page }) => {
    await abrir(page, 'modo=light&cena=toasts')
    await page.waitForSelector(TOAST)

    // O risco do toast escuro no tema claro é herdar a cor de texto do tema — preto sobre
    // fundo escuro. A régua pega isso; a inspeção a olho, não necessariamente.
    const razao = await page.evaluate((seletor) => {
      const toast = document.querySelector(seletor) as HTMLElement
      // `p:not(:last-child)` seria frágil; o título é o `<p>` de peso forte. Buscar pelo texto
      // conhecido é o que não quebra quando a estrutura interna mudar.
      const titulo = [...toast.querySelectorAll('p')].find(
        (p) => p.textContent !== null && p.textContent.trim().length > 0
      )
      if (titulo === undefined) throw new Error('Título do toast não encontrado.')
      const lum = (cor: string): number => {
        const m = cor.match(/[\d.]+/g)
        if (m === null) throw new Error(`Cor não interpretável: ${cor}`)
        const [r, g, b] = m
          .slice(0, 3)
          .map(Number)
          .map((c) => {
            const s = c / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const a = lum(getComputedStyle(titulo).color)
      const b = lum(getComputedStyle(toast).backgroundColor)
      const [claro, escuro] = a > b ? [a, b] : [b, a]
      return (claro + 0.05) / (escuro + 0.05)
    }, TOAST)

    expect(razao, 'contraste do título do toast').toBeGreaterThanOrEqual(4.5)
  })
})

test.describe('overlays: o que só existe com layout', () => {
  test('o backdrop cobre a viewport inteira', async ({ page }) => {
    await abrir(page, 'modo=dark&cena=dialog')
    await page.waitForSelector('[role="dialog"]')

    const { backdrop, viewport } = await page.evaluate(() => {
      // O backdrop é o `fixed inset-0` que não é o painel — o painel tem `role`.
      const fixos = [...document.querySelectorAll<HTMLElement>('div')].filter((el) => {
        const s = getComputedStyle(el)
        return s.position === 'fixed' && el.getAttribute('role') === null && el.offsetWidth > 0
      })
      const maior = fixos.sort(
        (a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight
      )[0]
      return {
        backdrop: maior ? { w: maior.offsetWidth, h: maior.offsetHeight } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight }
      }
    })

    // Um backdrop que não cobre tudo deixa uma faixa clicável do conteúdo atrás — o modal
    // parece modal e não é.
    expect(backdrop).not.toBeNull()
    expect(backdrop!.w).toBeGreaterThanOrEqual(viewport.w)
    expect(backdrop!.h).toBeGreaterThanOrEqual(viewport.h)
  })

  test('o painel do modal cabe na viewport', async ({ page }) => {
    await abrir(page, 'modo=dark&cena=dialog')
    const painel = page.locator('[role="dialog"]')
    const caixa = await painel.boundingBox()

    // `w-[min(92vw,32rem)]` só é verdade quando alguém mede. Um painel maior que a viewport
    // esconde o rodapé — e o rodapé é onde ficam Cancelar e Confirmar.
    expect(caixa).not.toBeNull()
    expect(caixa!.width).toBeLessThanOrEqual(1280)
    expect(caixa!.height).toBeLessThanOrEqual(900)
  })

  test('o Drawer encosta na borda direita', async ({ page }) => {
    await abrir(page, 'modo=dark&cena=drawer')
    const caixa = await page.locator('[role="dialog"]').boundingBox()

    expect(caixa).not.toBeNull()
    // `right-0` é posicionamento, e posicionamento não existe em jsdom. Uma gaveta que não
    // encosta na borda parece um modal deslocado.
    expect(caixa!.x + caixa!.width).toBeCloseTo(1280, 0)
    expect(caixa!.height).toBeCloseTo(900, 0)
  })

  test('o AlertDialog recebe o foco no botão seguro, não no destrutivo', async ({ page }) => {
    await abrir(page, 'modo=dark&cena=alert')
    await page.waitForSelector('[role="alertdialog"]')

    // Foco inicial é comportamento de navegador real. Se ele caísse no botão destrutivo, um
    // Enter reflexo executaria a exclusão — o oposto do que o critério 3 protege.
    const focado = await page.evaluate(() => document.activeElement?.textContent?.trim())
    expect(focado).toBe('Cancelar')
  })

  test('o anel de foco é pintado ao navegar por teclado', async ({ page }) => {
    await abrir(page, 'modo=dark')
    await page.keyboard.press('Tab')

    const visivel = await page.evaluate(() => {
      const ativo = document.activeElement as HTMLElement | null
      if (ativo === null || ativo === document.body) return null
      const s = getComputedStyle(ativo)
      // Foco pode ser desenhado por `box-shadow` **ou** por `outline` — os componentes usam
      // os dois conforme o caso. Exigir só um daria falso vermelho.
      return s.boxShadow !== 'none' || s.outlineStyle !== 'none'
    })

    expect(visivel, 'o elemento focado tem anel visível').toBe(true)
  })
})

test.describe('tipografia e números', () => {
  test('as fontes do protótipo carregam — não a fonte de sistema', async ({ page }) => {
    await abrir(page, 'modo=dark')

    const carregadas = await page.evaluate(() => {
      const nomes = new Set<string>()
      document.fonts.forEach((f) => {
        if (f.status === 'loaded') nomes.add(f.family)
      })
      return [...nomes]
    })

    expect(carregadas).toContain('Rajdhani')
    expect(carregadas).toContain('Share Tech Mono')
  })

  test('a coluna numérica da tabela usa algarismos tabulares', async ({ page }) => {
    await abrir(page, 'modo=dark')

    // `tabular-nums` é exigência da spec para números (§Escopo). Sem ela, `12` e `340` não
    // alinham pela unidade e a coluna fica visualmente torta — defeito que só aparece renderizado.
    const variante = await page.evaluate(() => {
      const celula = document.querySelector('[data-prova="estrutura"] td.text-right') as HTMLElement
      return getComputedStyle(celula).fontVariantNumeric
    })

    expect(variante).toContain('tabular-nums')
  })
})
