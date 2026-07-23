import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, ButtonGroup, IconButton, Link } from './index'

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
    it('anuncia por aria-busy e por texto, não só pelo spinner', () => {
      render(<Button carregando>Salvar</Button>)

      const botao = screen.getByRole('button')
      expect(botao).toHaveAttribute('aria-busy', 'true')
      // O texto é o canal que chega a quem não vê o spinner girar.
      expect(botao).toHaveTextContent(/aguarde/i)
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

  it('opções exclusivas viram radiogroup, não fileira de botões', () => {
    // Uma barra de botões independentes não anunciaria qual está ativo — mesma lição da F02 do
    // MVP-001, onde os botões de espaço viraram radiogroup pelo mesmo motivo.
    render(
      <ButtonGroup papel="segmentado" rotulo="Modo de exibição">
        <Button>Lista</Button>
        <Button>Grade</Button>
      </ButtonGroup>
    )
    expect(screen.getByRole('radiogroup', { name: 'Modo de exibição' })).toBeInTheDocument()
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
