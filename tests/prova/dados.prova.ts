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

/**
 * Espera as animações de entrada terminarem antes de medir.
 *
 * `waitForSelector` devolve o nó assim que ele entra no DOM — no meio do `entrar-direita`, que
 * anima `translate`. Um elemento em transformação mede a posição **do quadro corrente**, não a
 * final: o Drawer aparecia em `x=1201` numa execução e `x=1239` na seguinte, e só depois
 * assentava em `864`.
 *
 * Enquanto o portal montava no `<body>` a corrida não aparecia (a árvore já estava pronta
 * quando o seletor resolvia). Dentro do provider (FIX #107) a montagem custa um tick a mais e
 * a medida caía no meio da animação — teste sensível a tempo, que falharia sozinho numa
 * máquina lenta. Medir depois de `finished` é o que torna a asserção sobre **layout**.
 */
async function esperarAnimacoes(
  page: import('@playwright/test').Page,
  seletor: string
): Promise<void> {
  await page.waitForSelector(seletor)
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      if (el === null) return false
      return el.getAnimations().every((a) => a.playState === 'finished')
    },
    seletor,
    { timeout: 5000 }
  )
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
    // Medir com `entrar-direita` ainda rodando lê a posição do quadro corrente, não a final.
    await esperarAnimacoes(page, '[role="dialog"]')
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

/**
 * Tokens no overlay portado (FIX #107).
 *
 * O defeito que estes testes existem para impedir: os tokens `--jos-*` são `style` inline no nó
 * do `ProvedorDeTema`; o Radix montava o portal no `<body>`, fora dessa subárvore, e todo
 * `var(--jos-…)` resolvia para vazio. O painel saía transparente, sem raio, sem sombra e sem
 * `z-index` — o conteúdo da página aparecia através dele.
 *
 * A régua tem de ser **computada**: as classes sempre estiveram no `className` (o teste de
 * componente as vê e passa), e o que faltava era o valor. É a terceira vez que este modo de
 * falha aparece no projeto — depois de #57 e #58 — e é o motivo de a asserção morar aqui, num
 * navegador de verdade, e não em jsdom.
 */
test.describe('overlay em portal recebe os tokens do tema (FIX issue 107)', () => {
  /** Um `rgba(…, 0)` é o fundo que o defeito produzia: transparente, sem token resolvido. */
  const transparente = (cor: string): boolean => cor.replace(/\s/g, '').endsWith(',0)')

  // `temRaio` distingue o que é token faltando do que é desenho: o Drawer é uma gaveta colada
  // na borda e **não tem** `rounded-*` — cobrar raio dele reprovaria o componente correto.
  for (const [cena, seletor, temRaio] of [
    ['dialog', '[role="dialog"]', true],
    ['alert', '[role="alertdialog"]', true],
    ['drawer', '[role="dialog"]', false]
  ] as const) {
    test(`o painel do ${cena} tem fundo opaco, sombra e z-index do tema`, async ({ page }) => {
      await abrir(page, `modo=dark&cena=${cena}`)
      await esperarAnimacoes(page, seletor)

      const estilo = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el === null) throw new Error(`Painel não encontrado: ${sel}`)
        const s = getComputedStyle(el)
        return {
          fundo: s.backgroundColor,
          raio: s.borderRadius,
          sombra: s.boxShadow,
          zIndex: s.zIndex,
          // O token lido no próprio nó: vazio significa que ele está fora da subárvore do tema.
          token: s.getPropertyValue('--jos-cor-superficie-elevada').trim()
        }
      }, seletor)

      // O token tem de **existir** naquele ponto da árvore. Foi exatamente isto que a inspeção
      // por CDP mediu como `""` na issue.
      expect(estilo.token, `token no painel do ${cena}`).not.toBe('')
      // …e o navegador tem de tê-lo aplicado. Um painel transparente deixa o texto da página
      // atravessar o modal.
      expect(transparente(estilo.fundo), `fundo do ${cena}: ${estilo.fundo}`).toBe(false)
      if (temRaio) expect(estilo.raio, `raio do ${cena}`).not.toBe('0px')
      expect(estilo.sombra, `sombra do ${cena}`).not.toBe('none')
      // Sem `z-index` o painel empilha pela ordem do documento — e o conteúdo da página pode
      // ficar por cima do modal.
      expect(estilo.zIndex, `z-index do ${cena}`).not.toBe('auto')
    })
  }

  test('o título do modal é legível — cor de texto declarada, não herdada', async ({ page }) => {
    await abrir(page, 'modo=dark&cena=dialog')
    await esperarAnimacoes(page, '[role="dialog"]')

    // O portal não herda a cor de texto do `FundoDaIdentidade` como o resto do app. Sem
    // `text-[var(--jos-cor-texto)]` no painel, o título cai no preto padrão do navegador sobre a
    // superfície escura — e o contraste denuncia (1.x:1). Era o segundo defeito que a mesma causa
    // raiz escondia: enquanto o painel também era transparente, ninguém via qual dos dois falhava.
    // Medida inline: `medirContraste` é local do describe de contraste. Repetir a fórmula aqui é
    // mais barato que expor um helper compartilhado para dois chamadores.
    const razao = await page.evaluate(() => {
      const lum = (cor: string): number => {
        const m = cor.match(/[\d.]+/g)
        if (m === null) throw new Error(`Cor não interpretável: ${cor}`)
        const [r, g, b] = m
          .slice(0, 3)
          .map(Number)
          .map((c) => {
            const v = c / 255
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const painel = document.querySelector('[role="dialog"]') as HTMLElement
      const titulo = painel.querySelector('h2') as HTMLElement | null
      if (titulo === null) throw new Error('Título do modal não encontrado.')
      const a = lum(getComputedStyle(titulo).color)
      const b = lum(getComputedStyle(painel).backgroundColor)
      const [claro, escuro] = a > b ? [a, b] : [b, a]
      return (claro + 0.05) / (escuro + 0.05)
    })
    expect(razao, 'contraste do título do modal').toBeGreaterThanOrEqual(4.5)
  })

  test('o painel do modal é mais claro que a página — a superfície elevada elevou', async ({
    page
  }) => {
    await abrir(page, 'modo=dark&cena=dialog')
    await esperarAnimacoes(page, '[role="dialog"]')

    // Fundo opaco sozinho não basta: um painel que herdasse a cor da página passaria a régua
    // acima e continuaria invisível. `superficie-elevada` só cumpre o nome se destacar.
    const { painel, pagina } = await page.evaluate(() => {
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
      const modal = document.querySelector('[role="dialog"]') as HTMLElement
      const galeria = document.querySelector('[data-testid="galeria"]') as HTMLElement
      return {
        painel: lum(getComputedStyle(modal).backgroundColor),
        pagina: lum(getComputedStyle(galeria).backgroundColor)
      }
    })

    expect(painel).toBeGreaterThan(pagina)
  })
})

/**
 * O `Disclosure` (SPEC-Fases-03), medido renderizado.
 *
 * O gate visual desta fatia achou o que 27 testes de tela não pegaram: o rótulo saía em
 * MAIÚSCULAS, porque o modo compacto usava `LABEL_MONO` — que carrega `uppercase`. Num rótulo
 * que é **conteúdo** (o caminho do arquivo que a ferramenta leu) isso destrói a legibilidade
 * justamente onde a distinção entre `l`/`1` e `O`/`0` importa. jsdom não vê `text-transform`.
 */
test.describe('divulgação progressiva', () => {
  test('o rótulo não é transformado em maiúsculas — ele é conteúdo, não label', async ({
    page
  }) => {
    await abrir(page, 'modo=dark')

    const transform = await page.evaluate(() => {
      const grade = document.querySelector('[data-prova="superficies"] .grid-cols-2')
      const rotulo = grade?.querySelector('details details summary span') as HTMLElement
      return getComputedStyle(rotulo).textTransform
    })

    expect(transform).toBe('none')
  })

  test('o marcador nativo do navegador não aparece', async ({ page }) => {
    await abrir(page, 'modo=dark')

    // O triângulo padrão não pertence a design system nenhum. `list-style: none` cobre o
    // Firefox; no Chromium quem o remove é o `display: flex` do próprio `<summary>` — o
    // `::-webkit-details-marker` só existe enquanto o display for `list-item`.
    //
    // A medida é o **conteúdo** do pseudo-elemento e não o seu `display`: um marcador removido
    // por não ser gerado reporta o display do elemento, não `none`, e afirmar `none` reprovaria
    // a solução que funciona. O que importa é que nada seja desenhado antes do chevron.
    const estilo = await page.evaluate(() => {
      const resumo = document.querySelector(
        '[data-prova="superficies"] .grid-cols-2 summary'
      ) as HTMLElement
      return {
        listStyle: getComputedStyle(resumo).listStyleType,
        display: getComputedStyle(resumo).display,
        conteudo: getComputedStyle(resumo, '::-webkit-details-marker').content
      }
    })

    expect(estilo.listStyle).toBe('none')
    // `flex` (ou qualquer coisa que não seja `list-item`) é o que impede o marcador de nascer.
    expect(estilo.display).not.toBe('list-item')
    expect(estilo.conteudo === 'none' || estilo.conteudo === 'normal' || estilo.conteudo === '').toBe(true)
  })

  test('o chevron gira ao abrir — o estado tem sinal de forma, não só de cor', async ({ page }) => {
    await abrir(page, 'modo=dark')

    const grade = page.locator('[data-prova="superficies"] .grid-cols-2')
    const chevron = grade.locator('summary svg').first()

    // `rotate` e **não** `transform`: o Tailwind v4 emite a propriedade CSS `rotate` para
    // `rotate-90`, e `transform` fica em `none` mesmo com a rotação aplicada. Medir `transform`
    // reprovaria um componente que gira corretamente — foi o que a primeira versão deste teste
    // fez, e a investigação custou uma hora antes de a medição errada aparecer.
    const fechado = await chevron.evaluate((el) => getComputedStyle(el).rotate)
    expect(fechado).toBe('none')

    await grade.locator('summary').first().click()

    // `toPass` e não uma leitura direta: `rotate` é animado por `transition-transform`, e ler
    // no instante do clique pega o valor de partida. O teste espera o estado final, que é o que
    // o usuário vê — sem `waitForTimeout` fixo, que seria mais lento e mais frágil.
    await expect(async () => {
      expect(await chevron.evaluate((el) => getComputedStyle(el).rotate)).toBe('90deg')
    }).toPass({ timeout: 2_000 })
  })

  test('o rótulo aberto ganha contraste — o segundo sinal do mesmo estado', async ({ page }) => {
    await abrir(page, 'modo=dark')

    const grade = page.locator('[data-prova="superficies"] .grid-cols-2')
    const rotulo = grade.locator('summary span').first()

    const fechado = await rotulo.evaluate((el) => getComputedStyle(el).color)
    await grade.locator('summary').first().click()

    // Mesma razão do chevron: a cor entra por transição, e a leitura imediata pega a de partida.
    await expect(async () => {
      expect(await rotulo.evaluate((el) => getComputedStyle(el).color)).not.toBe(fechado)
    }).toPass({ timeout: 2_000 })
  })
})
