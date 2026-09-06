import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, ButtonGroup, IconButton, Link } from './index'
import { contraste, PALETA_ACENTO } from '../tokens/acento'
import { bordaRgb, papeis } from '../tokens/semantic'
import type { ModoUi, Modulo } from '../tokens/semantic'

/**
 * Ações (SPEC-DesignSystem-03a, critérios 1, 2 e 6; PRD §11.1).
 *
 * Tudo é consultado **por papel** (`getByRole`), nunca por classe: o critério é o que o leitor
 * de tela anuncia, não a marcação interna. Um teste que casasse por `className` passaria com o
 * componente inacessível.
 */

describe('Button', () => {
  it('é acionável por teclado e por clique', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Salvar</Button>)

    const botao = screen.getByRole('button', { name: 'Salvar' })
    botao.focus()
    expect(botao).toHaveFocus()

    // Enter **e** Espaço: é o contrato de `<button>`, e é o que o distingue de um `<div>`
    // clicável. Se alguém trocar por div com onClick, este teste cai.
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)

    await userEvent.click(botao)
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('desabilitado não dispara e é anunciado como desabilitado', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} desabilitado>
        Salvar
      </Button>
    )

    const botao = screen.getByRole('button', { name: 'Salvar' })
    expect(botao).toBeDisabled()
    await userEvent.click(botao)
    expect(onClick).not.toHaveBeenCalled()
  })

  describe('carregando (critério 2 — estado nunca só por cor)', () => {
    it('anuncia por aria-busy e **preserva o rótulo** da ação', () => {
      render(<Button carregando>Salvar</Button>)

      const botao = screen.getByRole('button')
      expect(botao).toHaveAttribute('aria-busy', 'true')
      // A primeira versão trocava o texto por "Aguarde": num console com várias ações em voo,
      // o usuário deixava de saber *qual* estava rodando, e a largura do botão saltava.
      // `aria-busy` já leva o estado à tecnologia assistiva — a palavra nunca foi o que
      // informava. Achado do `/impeccable critique` da F03a.
      expect(botao).toHaveAccessibleName('Salvar')
      expect(botao).not.toHaveTextContent(/aguarde/i)
    })

    it('não aceita segundo clique enquanto carrega', async () => {
      const onClick = vi.fn()
      render(
        <Button onClick={onClick} carregando>
          Salvar
        </Button>
      )
      await userEvent.click(screen.getByRole('button'))
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  it('o tipo submit existe para formulário — o default não submete por acidente', () => {
    render(<Button>Ação</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it.each(['primaria', 'secundaria', 'perigo'] as const)(
    'a variante %s continua sendo um button acessível',
    (variante) => {
      render(<Button variante={variante}>Ação</Button>)
      expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument()
    }
  )
})

describe('IconButton', () => {
  it('tem nome acessível obrigatório — ícone sozinho não nomeia', () => {
    render(
      <IconButton rotulo="Fechar painel">
        <span>×</span>
      </IconButton>
    )
    // O ícone é `aria-hidden`; quem nomeia é o rótulo. Sem isso o leitor anuncia só "botão".
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument()
  })

  it('estado ativo é exposto por aria-pressed, não só por cor (critério 2)', () => {
    const { rerender } = render(
      <IconButton rotulo="Filtrar" ativo={false}>
        <span>f</span>
      </IconButton>
    )
    expect(screen.getByRole('button', { name: 'Filtrar' })).toHaveAttribute('aria-pressed', 'false')

    rerender(
      <IconButton rotulo="Filtrar" ativo>
        <span>f</span>
      </IconButton>
    )
    expect(screen.getByRole('button', { name: 'Filtrar' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Button — gesto de segurar (SPEC-Voz-01)', () => {
  it('dispara ao pressionar e ao soltar, não só no clique', async () => {
    const pressionou = vi.fn()
    const soltou = vi.fn()
    render(
      <Button onPointerDown={pressionou} onPointerUp={soltou}>
        Segure para falar
      </Button>
    )

    const botao = screen.getByRole('button', { name: 'Segure para falar' })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    // Um botão de falar que só reagisse ao clique gravaria sempre zero segundo: `onClick`
    // dispara uma vez, no fim, e o contrato aqui é a **duração**.
    expect(pressionou).toHaveBeenCalled()
    expect(soltou).toHaveBeenCalled()
  })

  it('sair com o ponteiro também encerra o gesto', async () => {
    const saiu = vi.fn()
    render(<Button onPointerLeave={saiu}>Segure</Button>)

    // Soltar **fora** do botão é comum; sem este par a ação ficaria aberta — no microfone,
    // gravando até o timeout duro.
    await userEvent.pointer([
      { target: screen.getByRole('button', { name: 'Segure' }) },
      { target: document.body }
    ])

    expect(saiu).toHaveBeenCalled()
  })
})

describe('ButtonGroup', () => {
  it('agrupa ações independentes como group', () => {
    render(
      <ButtonGroup rotulo="Ações do registro">
        <Button>Cancelar</Button>
        <Button variante="primaria">Salvar</Button>
      </ButtonGroup>
    )
    expect(screen.getByRole('group', { name: 'Ações do registro' })).toBeInTheDocument()
  })

  it('não promete radiogroup — os filhos são botões, não rádios', () => {
    // A variante `segmentado` aplicava `role="radiogroup"` sobre filhos `<button>`: o leitor de
    // tela anunciaria um grupo de rádio **sem rádios dentro**, pior que a fileira de botões que
    // ela tentava corrigir. Removida na F03a (achado do `/impeccable critique`); o controle
    // segmentado de verdade — com estado e navegação por setas — é escopo da F04a.
    render(
      <ButtonGroup rotulo="Modo de exibição">
        <Button>Lista</Button>
        <Button>Grade</Button>
      </ButtonGroup>
    )
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Modo de exibição' })).toBeInTheDocument()
  })
})

describe('Link', () => {
  it('é um link de verdade, com href', () => {
    render(<Link href="/settings">Configurações</Link>)
    const link = screen.getByRole('link', { name: 'Configurações' })
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('link externo abre com rel seguro e avisa o destino em texto', () => {
    render(
      <Link href="https://exemplo.com" externo>
        Documentação
      </Link>
    )
    const link = screen.getByRole('link', { name: /documenta/i })
    expect(link).toHaveAttribute('target', '_blank')
    // `noopener` não é opcional: sem ele a página aberta ganha acesso a `window.opener`.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // O aviso é texto, não só a setinha — ícone sozinho não chega a quem não o vê.
    expect(link).toHaveTextContent(/abre em nova aba/i)
  })
})

/**
 * A aresta da ação primária (WCAG 2.2 — limite de componente, 3:1).
 *
 * Nasceu de um defeito real, achado na captura clara do gate do brief: a borda repetia o
 * acento, e repetindo não acrescentava aresta nenhuma. Cinco dos oito swatches deixavam o
 * botão primário como um bloco sem contorno sobre a página clara — `#FFFFE3` mede 1.07:1
 * contra o fundo, `#2CFF05` 1.25:1 e `#C4C4C4`, **o default de fábrica**, 1.60:1. O
 * desabilitado ficava indistinguível do ativo.
 *
 * O teste mede a borda **composta sobre o acento**, que é o que o olho vê: `rgba()` sobre o
 * preenchimento, e o resultado contra o fundo da página. Afirmar a string da classe passaria
 * verde com qualquer alfa — inclusive um que voltasse a apagar a aresta.
 */
describe('borda da ação primária', () => {
  const ALFA = 0.6
  const MODULOS: readonly Modulo[] = ['jarvis', 'noa']
  const MODOS: readonly ModoUi[] = ['dark', 'light']

  /** O fundo real do app, lido do token — aproximá-lo por um literal mediria outra tela. */
  const fundo = (modulo: Modulo, modo: ModoUi): string => papeis(modulo, modo).surface

  /** Compõe `rgba(rgb, alfa)` sobre uma cor sólida — o que o navegador pinta. */
  function compor(rgb: string, alfa: number, sobre: string): string {
    const [r, g, b] = rgb.split(',').map(Number)
    const base = [1, 3, 5].map((i) => Number.parseInt(sobre.slice(i, i + 2), 16))
    const canal = (v: number, i: number): string =>
      Math.round(v * alfa + base[i] * (1 - alfa))
        .toString(16)
        .padStart(2, '0')
    return `#${canal(r, 0)}${canal(g, 1)}${canal(b, 2)}`
  }

  for (const modulo of MODULOS) {
    for (const modo of MODOS) {
      it(`tem aresta visível em ${modulo} ${modo}, nos 8 acentos`, () => {
        for (const acento of PALETA_ACENTO) {
          const borda = compor(bordaRgb(modulo, modo), ALFA, acento)
          expect(contraste(borda, fundo(modulo, modo))).toBeGreaterThanOrEqual(3)
        }
      })
    }
  }

  it('o alfa escolhido tem margem — abaixo de 0.55 a aresta some', () => {
    // Trava o motivo do número: 0.5 falha, e o teste falharia junto se alguém o baixasse.
    const claroDemais = PALETA_ACENTO[5]
    const pior = compor(bordaRgb('noa', 'light'), 0.5, claroDemais)
    expect(contraste(pior, fundo('noa', 'light'))).toBeLessThan(3)
    expect(ALFA).toBeGreaterThanOrEqual(0.55)
  })
})
