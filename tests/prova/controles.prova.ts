import { expect, test } from '@playwright/test'

/**
 * Prova visual dos controles (SPEC-DesignSystem-03a).
 *
 * Roda num **navegador de verdade** — é o que jsdom não faz. O que se verifica aqui não é o
 * papel ARIA (isso os testes de componente já cobrem), e sim o que só existe quando há layout:
 * altura real dos controles, contraste **computado**, fontes carregadas, anel de foco pintado.
 *
 * Não é regressão visual por baseline: comparar PNG exigiria commitar imagens e conviver com
 * falso vermelho por antialiasing entre máquinas — e regressão visual está suspensa no MVP-003
 * §4. As capturas são **artefato de revisão**; as asserções são medidas, não pixels.
 */

const ROTA = (params: string): string => `/?${params}`

/** As quatro combinações que a fatia precisa mostrar. */
const CENARIOS = [
  { nome: 'jarvis-escuro', query: 'modo=dark&modulo=jarvis' },
  { nome: 'jarvis-claro', query: 'modo=light&modulo=jarvis' },
  { nome: 'noa-escuro', query: 'modo=dark&modulo=noa' },
  { nome: 'noa-claro', query: 'modo=light&modulo=noa' }
] as const

test.describe('galeria de controles', () => {
  for (const cenario of CENARIOS) {
    test(`captura ${cenario.nome}`, async ({ page }) => {
      await page.goto(ROTA(cenario.query))
      await page.waitForSelector('[data-testid="galeria"]')
      // As fontes locais precisam ter carregado antes da captura, senão a imagem registra a
      // fonte de sistema e a prova de tipografia não vale nada.
      await page.evaluate(() => document.fonts.ready)

      await expect(page.locator('[data-testid="galeria"]')).toBeVisible()
      await page.screenshot({
        path: `reports/prova/${cenario.nome}.png`,
        fullPage: true
      })
    })
  }

  test('a família inteira alinha na mesma altura (44px)', async ({ page }) => {
    // A decisão do PI foi altura única. É o tipo de invariante que se desfaz calado: alguém
    // ajusta o padding de um componente e ele passa a destoar por 2px numa linha de formulário.
    await page.goto(ROTA('modo=dark'))
    await page.waitForSelector('[data-testid="galeria"]')

    const medidas = await page.evaluate(() => {
      // Só os controles de **linha de formulário**: botão de texto, campo de texto e senha,
      // gatilho de select e combobox. Checkbox, radio e switch têm caixa própria
      // (`--jos-tamanho-marcador`, 20px) e o alvo clicável deles é o rótulo — medi-los aqui
      // compararia papéis diferentes. Textarea cresce por `rows`, por desenho.
      const eDeLinha = (el: HTMLElement): boolean => {
        if (el.tagName === 'INPUT') {
          const tipo = el.getAttribute('type')
          return tipo === 'text' || tipo === 'password'
        }
        if (el.tagName === 'BUTTON') {
          // Fora: IconButton (quadrado, tem aria-label) e os primitivos Radix, que carregam
          // `role` próprio (checkbox, radio, switch).
          return el.getAttribute('aria-label') === null && el.getAttribute('role') === null
        }
        return false
      }

      return [...document.querySelectorAll<HTMLElement>('button, input')]
        .filter((el) => el.offsetHeight > 0 && eDeLinha(el))
        .map((el) => ({
          descricao: `${el.tagName}[${el.getAttribute('type') ?? '-'}]`,
          altura: el.offsetHeight
        }))
    })

    expect(medidas.length).toBeGreaterThan(5)
    for (const { descricao, altura } of medidas) {
      expect(altura, `${descricao} deveria alinhar em 44px`).toBe(44)
    }
  })

  test('o texto do corpo atinge 4.5:1 nos dois modos (WCAG 2.2 AA)', async ({ page }) => {
    // Contraste **computado** pelo navegador, não o valor que o token declara: é aqui que se
    // pega uma variável que não resolveu e caiu para a cor herdada.
    for (const modo of ['dark', 'light']) {
      await page.goto(ROTA(`modo=${modo}`))
      await page.waitForSelector('[data-testid="galeria"]')

      const razao = await page.evaluate(() => {
        const galeria = document.querySelector('[data-testid="galeria"]') as HTMLElement
        const estilo = getComputedStyle(galeria)

        const canais = (cor: string): number[] => {
          const m = cor.match(/\d+(\.\d+)?/g)
          if (m === null) throw new Error(`Cor não interpretável: ${cor}`)
          return m.slice(0, 3).map(Number)
        }
        const lum = (cor: string): number => {
          const [r, g, b] = canais(cor).map((c) => {
            const s = c / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }

        const a = lum(estilo.color)
        const b = lum(estilo.backgroundColor)
        const [claro, escuro] = a > b ? [a, b] : [b, a]
        return (claro + 0.05) / (escuro + 0.05)
      })

      expect(razao, `contraste do corpo no modo ${modo}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('as fontes do protótipo carregam — não a fonte de sistema', async ({ page }) => {
    // Se o `@font-face` apontasse para caminho errado, a UI cairia em `sans-serif` sem nada
    // falhar. Só um navegador de verdade responde isso.
    await page.goto(ROTA('modo=dark'))
    await page.evaluate(() => document.fonts.ready)

    const carregadas = await page.evaluate(() => {
      const nomes = new Set<string>()
      document.fonts.forEach((f) => {
        if (f.status === 'loaded') nomes.add(f.family)
      })
      return [...nomes]
    })

    expect(carregadas).toContain('Michroma')
    expect(carregadas).toContain('Rajdhani')
    expect(carregadas).toContain('Share Tech Mono')
  })

  test('o anel de foco é pintado ao navegar por teclado', async ({ page }) => {
    // Foco visível é critério de aceite (PRD §14) e é invisível em jsdom: só existe pintado.
    await page.goto(ROTA('modo=dark'))
    await page.waitForSelector('[data-testid="galeria"]')

    await page.keyboard.press('Tab')
    const sombra = await page.evaluate(() => {
      const ativo = document.activeElement as HTMLElement | null
      if (ativo === null || ativo === document.body) return null
      return getComputedStyle(ativo).boxShadow
    })

    expect(sombra, 'o elemento focado tem anel visível').not.toBe('none')
    expect(sombra).not.toBeNull()
  })
})
