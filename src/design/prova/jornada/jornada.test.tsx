import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ACENTO_PADRAO, PALETA_ACENTO } from '@design/tokens'
import { Jornada } from './Jornada'
import { NoaHoje } from './NoaHoje'
import { JarvisHud } from './JarvisHud'

/**
 * Jornada de prova (SPEC-DesignSystem-06, critérios 2–5).
 *
 * Esta suíte é diferente das anteriores: ela não testa componentes, testa **o sistema montado**.
 * As oito fatias produziram peças que passam nos seus próprios testes; o que só se descobre aqui
 * é se elas se compõem — se o acento escolhido numa tela chega à outra, se as duas identidades
 * convivem sem vazar, se a navegação por teclado atravessa a jornada inteira.
 *
 * O critério 1 (só componentes públicos) não tem teste próprio: quem o prova é o **lint** — a
 * regra do critério 5 da F03a barra cor e medida literais em `src/design`, e a fronteira da F01
 * barra import de fora. Um teste que "verificasse composição" mediria o que eu escrevi, não o que
 * a regra impõe.
 */

describe('critério 2 — as telas internas funcionam em claro e escuro', () => {
  for (const uiTheme of ['dark', 'light'] as const) {
    it(`NOA Hoje monta e responde no tema ${uiTheme}`, () => {
      render(<NoaHoje uiTheme={uiTheme} />)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/bom dia/i)
      // `data-modo` carrega o modo **efetivo** (F02): tela interna segue a preferência.
      expect(document.querySelector('[data-modo]')).toHaveAttribute('data-modo', uiTheme)
    })

    it(`JARVIS HUD monta e responde no tema ${uiTheme}`, () => {
      render(<JarvisHud uiTheme={uiTheme} />)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('HUD')
      expect(document.querySelector('[data-modo]')).toHaveAttribute('data-modo', uiTheme)
    })
  }

  it('a CHOICE permanece escura mesmo com o tema claro — é superfície de marca', () => {
    // Não é omissão da matriz: a CHOICE **não tem** modo claro (README §2.6). Se ela invertesse,
    // o conceito de superfície de marca da F02 estaria furado justamente na tela que o motivou.
    render(<Jornada telaInicial="choice" uiTheme="light" />)
    for (const marcado of document.querySelectorAll('[data-superficie="choice"]')) {
      expect(marcado).toHaveAttribute('data-modo', 'dark')
    }
  })
})

describe('critério 3 — as duas identidades aparecem e não vazam', () => {
  it('a CHOICE mostra os dois espaços, cada um com o seu mascote', () => {
    render(<Jornada telaInicial="choice" />)

    expect(screen.getByAltText('NOA')).toBeInTheDocument()
    expect(screen.getByAltText('JARVIS OS')).toBeInTheDocument()
  })

  it('cada card tem a sua paleta, e escolher num não move o outro', async () => {
    render(<Jornada telaInicial="choice" />)

    const paletaNoa = screen.getByRole('radiogroup', { name: 'Acento de NOA' })
    const paletaJarvis = screen.getByRole('radiogroup', { name: 'Acento de JARVIS OS' })

    // Estado inicial: cada módulo no seu default de fábrica.
    expect(within(paletaNoa).getByRole('radio', { name: ACENTO_PADRAO.noa })).toBeChecked()
    expect(within(paletaJarvis).getByRole('radio', { name: ACENTO_PADRAO.jarvis })).toBeChecked()

    // Escolhe outra cor **só** no NOA.
    const outra = PALETA_ACENTO.find((c) => c !== ACENTO_PADRAO.noa)!
    await userEvent.click(within(paletaNoa).getByRole('radio', { name: outra }))

    expect(within(paletaNoa).getByRole('radio', { name: outra })).toBeChecked()
    // O JARVIS permanece onde estava — o vazamento que o critério 3 proíbe.
    expect(within(paletaJarvis).getByRole('radio', { name: ACENTO_PADRAO.jarvis })).toBeChecked()
  })

  it('o acento escolhido na CHOICE chega à tela interna', async () => {
    // É o que uma tela isolada não provaria: a escolha atravessa a jornada.
    render(<Jornada telaInicial="choice" />)

    const outra = PALETA_ACENTO.find((c) => c !== ACENTO_PADRAO.jarvis)!
    const paletaJarvis = screen.getByRole('radiogroup', { name: 'Acento de JARVIS OS' })
    await userEvent.click(within(paletaJarvis).getByRole('radio', { name: outra }))

    await userEvent.click(screen.getByRole('button', { name: /entrar em jarvis os/i }))

    const raiz = document.querySelector('[data-modulo="jarvis"]')
    expect(raiz).toBeInTheDocument()
    expect((raiz as HTMLElement).style.getPropertyValue('--jos-cor-acento')).toBe(outra)
  })

  it('entrar no NOA não traz nada do JARVIS', async () => {
    render(<Jornada telaInicial="choice" />)
    await userEvent.click(screen.getByRole('button', { name: /entrar em noa/i }))

    expect(document.querySelector('[data-modulo="noa"]')).toBeInTheDocument()
    expect(document.querySelector('[data-modulo="jarvis"]')).not.toBeInTheDocument()
    expect(screen.queryByText('HUD')).not.toBeInTheDocument()
  })
})

describe('critério 4 — navegação completa por teclado', () => {
  it('a CHOICE é atravessável por Tab, e o foco é visível em cada parada', async () => {
    render(<Jornada telaInicial="choice" />)

    // Percorre a tela inteira contando os focáveis. O que se prova não é a ordem exata — ela é
    // decisão de layout — mas que **nenhum controle é inalcançável**: um swatch ou um botão fora
    // da ordem de tabulação seria invisível para quem não usa mouse.
    const focaveis = new Set<Element>()
    for (let i = 0; i < 30; i++) {
      await userEvent.tab()
      if (document.activeElement !== null && document.activeElement !== document.body) {
        focaveis.add(document.activeElement)
      }
    }

    // 8 swatches × 2 módulos + 2 botões de entrar = 18 controles.
    expect(focaveis.size).toBeGreaterThanOrEqual(18)
  })

  it('o swatch é acionável por teclado, não só por clique', async () => {
    render(<Jornada telaInicial="choice" />)

    const paletaNoa = screen.getByRole('radiogroup', { name: 'Acento de NOA' })
    const outra = PALETA_ACENTO.find((c) => c !== ACENTO_PADRAO.noa)!
    const alvo = within(paletaNoa).getByRole('radio', { name: outra })

    alvo.focus()
    await userEvent.keyboard('{Enter}')

    // Um swatch que só respondesse a `onClick` de mouse deixaria a escolha de acento fora do
    // alcance de quem navega por teclado — e o acento é a única personalização do MVP.
    expect(alvo).toBeChecked()
  })

  it('os hábitos do NOA são alternáveis por teclado', async () => {
    render(<NoaHoje uiTheme="dark" />)

    const leitura = screen.getByRole('checkbox', { name: 'Leitura 30 min' })
    expect(leitura).not.toBeChecked()

    leitura.focus()
    await userEvent.keyboard(' ')
    expect(leitura).toBeChecked()
  })

  it('todo controle tem nome acessível — nenhum "botão" anônimo', () => {
    render(<Jornada telaInicial="choice" />)

    for (const controle of screen.getAllByRole('radio')) {
      expect(controle).toHaveAccessibleName()
    }
    for (const controle of screen.getAllByRole('button')) {
      expect(controle).toHaveAccessibleName()
    }
  })
})

describe('critério 5 — nenhum estado essencial só por cor', () => {
  it('o swatch selecionado é anunciado por `aria-checked`, não só pela borda', async () => {
    render(<Jornada telaInicial="choice" />)

    const paleta = screen.getByRole('radiogroup', { name: 'Acento de NOA' })
    const outra = PALETA_ACENTO.find((c) => c !== ACENTO_PADRAO.noa)!
    await userEvent.click(within(paleta).getByRole('radio', { name: outra }))

    // O swatch **é** uma cor: destacá-lo com outra cor competiria com o valor que ele mostra.
    // A seleção vive em `aria-checked` (leitor de tela) e na escala (daltonismo).
    expect(within(paleta).getByRole('radio', { name: outra })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('o hábito marcado é anunciado por estado, não por risco no texto', async () => {
    render(<NoaHoje uiTheme="dark" />)
    // O protótipo risca o texto (`line-through`); o risco é reforço visual. O que informa a
    // tecnologia assistiva é o `checked` do próprio checkbox.
    expect(screen.getByRole('checkbox', { name: 'Treino de força' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Meditação' })).not.toBeChecked()
  })

  it('a telemetria do HUD tem o número em texto ao lado da barra', () => {
    render(<JarvisHud uiTheme="dark" />)

    // Uma barra sozinha não informa o valor a quem não a enxerga — e num HUD o valor é o dado.
    for (const medidor of screen.getAllByRole('meter')) {
      expect(medidor).toHaveAttribute('aria-valuenow')
    }
    // O número **em texto**, ao lado da barra. Sem `formatar`, o `Meter` escreve o valor cru —
    // escrevi `82%` na primeira versão e o teste corrigiu: a unidade é decisão de quem usa o
    // componente, e aqui não foi passada.
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
  })

  it('cada barra do HUD tem o nome da medida **visível**, não só em `aria-label`', () => {
    render(<JarvisHud uiTheme="dark" />)

    // A captura mostrou quatro barras com números à direita e nenhuma forma de saber qual era
    // CPU, RAM, GPU ou DISK: o rótulo vivia só no `aria-label`. Acessível a quem usa leitor de
    // tela, **invisível** para quem enxerga — o inverso do critério 5.
    //
    // `getByText` não vê `aria-label`, e é isso que torna a asserção honesta: ela falha se o
    // rótulo voltar a ser só atributo.
    for (const medida of ['CPU', 'RAM', 'GPU', 'DISK']) {
      expect(screen.getByText(medida)).toBeInTheDocument()
    }
  })
})
