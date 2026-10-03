import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Prova visual da escuta contínua (SPEC-Escuta-01, critérios 8 e 9).
 *
 * O que só existe com layout real: o indicador cabendo ao lado do botão dentro da barra de 52px,
 * o contraste do estado **medido no fundo efetivo**, o anel de foco pintado e o alvo de ponteiro.
 * As capturas são artefato de revisão, não baseline de regressão (MVP-003 §4).
 */

const MODOS = ['dark', 'light'] as const
const CENAS = [
  { cena: 'ligada', texto: /escuta ligada/i },
  { cena: 'desligada', texto: /escuta desligada/i },
  { cena: 'indisponivel', texto: /escuta indisponível/i },
  { cena: 'sem-microfone', texto: /microfone não abriu/i }
] as const

async function abrir(page: Page, cena: string, modo: string): Promise<void> {
  await page.goto(`/?galeria=escuta&cena=${cena}&modo=${modo}`)
  await page.waitForSelector('[data-testid="galeria-escuta"]')
  await page.evaluate(() => document.fonts.ready)
}

type Rgba = readonly [number, number, number, number]

function rgba(cor: string): Rgba {
  const n = (cor.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number)
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1]
}

/** Compõe `frente` (com alfa) sobre `fundo` opaco. */
function compor(frente: Rgba, fundo: Rgba): Rgba {
  const a = frente[3]
  return [
    frente[0] * a + fundo[0] * (1 - a),
    frente[1] * a + fundo[1] * (1 - a),
    frente[2] * a + fundo[2] * (1 - a),
    1
  ]
}

function luminancia([r, g, b]: Rgba): number {
  const canal = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

function contraste(a: Rgba, b: Rgba): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro! + 0.05) / (escuro! + 0.05)
}

/**
 * A cor **efetiva** do texto: `color` sozinho ignora `opacity`, que o navegador aplica por cima.
 * Medir só a propriedade deixa passar texto esmaecido por opacidade — foi o que o contrafactual
 * desta prova mostrou na primeira versão.
 */
async function corEfetiva(localizador: Locator): Promise<Rgba> {
  const { cor, opacidade } = await localizador.evaluate((el) => {
    let acumulada = 1
    for (let atual: Element | null = el; atual; atual = atual.parentElement) {
      acumulada *= Number(getComputedStyle(atual).opacity)
    }
    return { cor: getComputedStyle(el).color, opacidade: acumulada }
  })
  const [r, g, b, a] = rgba(cor)
  return [r, g, b, a * opacidade]
}

/**
 * O fundo **efetivo** de um elemento: a pilha de ancestrais composta até uma camada opaca. Medir o
 * contêiner, e não quem pinta a cor, é como um contraste ruim passa por bom.
 */
async function fundoEfetivo(page: Page, seletor: string): Promise<Rgba> {
  const camadas = await page.evaluate((sel) => {
    const achadas: string[] = []
    for (let el = document.querySelector(sel); el; el = el.parentElement) {
      achadas.push(getComputedStyle(el).backgroundColor)
    }
    return achadas
  }, seletor)

  let fundo: Rgba = [255, 255, 255, 1]
  for (const camada of camadas.reverse()) {
    const c = rgba(camada)
    if (c[3] > 0) fundo = compor(c, fundo)
  }
  return fundo
}

test.describe('captura para o gate visual', () => {
  for (const { cena } of CENAS) {
    for (const modo of MODOS) {
      test(`captura ${cena} (${modo})`, async ({ page }) => {
        await abrir(page, cena, modo)
        await page.screenshot({ path: `reports/prova/escuta-${cena}-${modo}.png` })
      })
    }
  }

  for (const modo of MODOS) {
    test(`captura a seção de Settings (${modo})`, async ({ page }) => {
      await abrir(page, 'settings', modo)
      await page.waitForSelector('section[aria-label]')
      await page.screenshot({ path: `reports/prova/escuta-settings-${modo}.png`, fullPage: true })
    })
  }
})

test.describe('o estado é dito em texto, nos dois temas', () => {
  for (const { cena, texto } of CENAS) {
    for (const modo of MODOS) {
      test(`${cena} (${modo}): o indicador diz o estado e cabe na barra`, async ({ page }) => {
        await abrir(page, cena, modo)
        const grupo = page.getByRole('group', { name: /escuta contínua/i })
        await expect(grupo.getByRole('status')).toHaveText(texto)

        // A barra tem 52px (critério 1 da 04a); o grupo não pode crescer além dela nem vazar.
        const barra = await page.locator('[data-jos-topbar]').boundingBox()
        const caixa = await grupo.boundingBox()
        expect(barra?.height).toBe(52)
        expect(caixa).not.toBeNull()
        expect(caixa!.y).toBeGreaterThanOrEqual(barra!.y)
        expect(caixa!.y + caixa!.height).toBeLessThanOrEqual(barra!.y + barra!.height)
        expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(barra!.x + barra!.width)
      })
    }
  }
})

test.describe('legibilidade no fundo efetivo', () => {
  for (const { cena } of CENAS) {
    for (const modo of MODOS) {
      test(`o texto do estado atinge 4.5:1 — ${cena} (${modo})`, async ({ page }) => {
        await abrir(page, cena, modo)

        const cor = await corEfetiva(
          page.getByRole('group', { name: /escuta contínua/i }).getByRole('status')
        )
        const fundo = await fundoEfetivo(page, '[data-jos-topbar]')

        expect(contraste(compor(cor, fundo), fundo), `${cena} em ${modo}`).toBeGreaterThanOrEqual(
          4.5
        )
      })
    }
  }

  for (const modo of MODOS) {
    test(`o rótulo do interruptor atinge 4.5:1 (${modo})`, async ({ page }) => {
      await abrir(page, 'ligada', modo)

      const cor = await corEfetiva(page.getByRole('switch', { name: /escuta/i }))
      const fundo = await fundoEfetivo(page, '[data-jos-topbar]')

      expect(contraste(compor(cor, fundo), fundo)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

test.describe('interação', () => {
  test('o interruptor tem alvo de ponteiro de pelo menos 24px e anel de foco pintado', async ({
    page
  }) => {
    await abrir(page, 'ligada', 'dark')
    const interruptor = page.getByRole('switch', { name: /escuta/i })

    const caixa = await interruptor.boundingBox()
    expect(caixa!.height).toBeGreaterThanOrEqual(24)
    expect(caixa!.width).toBeGreaterThanOrEqual(24)

    await page.keyboard.press('Tab')
    await expect(interruptor).toBeFocused()
    const anel = await interruptor.evaluate((el) => getComputedStyle(el).boxShadow)
    // Sem o anel, quem navega por teclado não vê onde está o kill switch.
    expect(anel).not.toBe('none')
  })

  test('com movimento reduzido o ponto do estado ligado não anima', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await abrir(page, 'ligada', 'dark')

    const animacao = await page
      .getByRole('group', { name: /escuta contínua/i })
      .getByRole('status')
      .locator('span[aria-hidden]')
      .evaluate((el) => getComputedStyle(el).animationName)

    expect(animacao).toBe('none')
  })

  test('em janela estreita o grupo continua dentro da barra', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 600 })
    await abrir(page, 'sem-microfone', 'dark')

    const barra = await page.locator('[data-jos-topbar]').boundingBox()
    const caixa = await page.getByRole('group', { name: /escuta contínua/i }).boundingBox()

    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(barra!.x + barra!.width)
  })
})
