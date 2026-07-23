import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ACENTO_PADRAO } from './acento'
import { ProvedorDeTema, useTema, variaveisDoTema } from './provider'
import { papeis, type ModoUi } from './semantic'

/**
 * Provider de tema (SPEC-DesignSystem-02, critérios 1, 2 e 3).
 *
 * O que se prova aqui é o **comportamento** da troca: sem reload, global, default escuro, e a
 * fronteira do que inverte (telas internas) contra o que não inverte (marca e semânticas).
 */

function Sonda(): React.JSX.Element {
  const tema = useTema()
  return <span data-testid="sonda">{`${tema.uiTheme}/${tema.modulo}`}</span>
}

describe('ProvedorDeTema', () => {
  it('nasce no escuro (critério 1) — o `system` do PRD §9.4 não entra no MVP', () => {
    render(
      <ProvedorDeTema>
        <Sonda />
      </ProvedorDeTema>
    )
    expect(screen.getByTestId('sonda')).toHaveTextContent('dark/jarvis')
  })

  it('alterna dark⇄light sem reload (critério 1)', async () => {
    function Alternavel(): React.JSX.Element {
      const [modo, setModo] = useState<ModoUi>('dark')
      return (
        <ProvedorDeTema uiTheme={modo}>
          <button type="button" onClick={() => setModo(modo === 'dark' ? 'light' : 'dark')}>
            alternar
          </button>
          <Sonda />
        </ProvedorDeTema>
      )
    }

    render(<Alternavel />)
    expect(screen.getByTestId('sonda')).toHaveTextContent('dark/')

    await userEvent.click(screen.getByRole('button', { name: 'alternar' }))
    expect(screen.getByTestId('sonda')).toHaveTextContent('light/')

    // Ida e volta: o estado não fica preso depois da primeira troca.
    await userEvent.click(screen.getByRole('button', { name: 'alternar' }))
    expect(screen.getByTestId('sonda')).toHaveTextContent('dark/')
  })

  it('o modo vai para o DOM como atributo, não como classe', () => {
    // `data-modo` permite ao CSS reagir sem prop drilling — e ao teste afirmar o modo ativo
    // sem depender de cor calculada, que jsdom não resolve.
    const { container } = render(
      <ProvedorDeTema uiTheme="light" modulo="noa">
        <Sonda />
      </ProvedorDeTema>
    )
    const raiz = container.querySelector('[data-modo]')
    expect(raiz).toHaveAttribute('data-modo', 'light')
    expect(raiz).toHaveAttribute('data-modulo', 'noa')
  })

  it('usar o tema fora do provider falha alto', () => {
    // Um default silencioso renderizaria com tema errado — pior de diagnosticar que não
    // renderizar.
    expect(() => render(<Sonda />)).toThrow(/ProvedorDeTema/)
  })
})

describe('variáveis do tema', () => {
  it('a troca de modo troca variável, não classe (critério 1)', () => {
    const escuro = variaveisDoTema({
      uiTheme: 'dark',
      accentJarvis: ACENTO_PADRAO.jarvis,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: ACENTO_PADRAO.jarvis,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })

    expect(escuro['--jos-cor-superficie']).toBe(papeis('jarvis', 'dark').surface)
    expect(claro['--jos-cor-superficie']).toBe(papeis('jarvis', 'light').surface)
    expect(escuro['--jos-cor-superficie']).not.toBe(claro['--jos-cor-superficie'])
  })

  it('as semânticas NÃO invertem (critério 3)', () => {
    const chaves = ['--jos-cor-ok', '--jos-cor-warn', '--jos-cor-err', '--jos-cor-info'] as const
    const escuro = variaveisDoTema({
      uiTheme: 'dark',
      accentJarvis: ACENTO_PADRAO.jarvis,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: ACENTO_PADRAO.jarvis,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })

    for (const chave of chaves) {
      expect(claro[chave]).toBe(escuro[chave])
    }
  })

  it('o acento de marca preserva o tom nos dois modos (critério 3)', () => {
    // A identidade escolhida pelo usuário não muda com o modo — só a variável **de leitura**
    // pode mudar, e isso é o outro teste.
    const acento = '#2CFF05'
    const escuro = variaveisDoTema({
      uiTheme: 'dark',
      accentJarvis: acento,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: acento,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })

    expect(escuro['--jos-cor-acento']).toBe(acento)
    expect(claro['--jos-cor-acento']).toBe(acento)
  })

  it('a variável de leitura é separada da de marca (critério 3)', () => {
    // Duas variáveis, de propósito: uma só forçaria escolher entre identidade e legibilidade.
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: '#FFFFE3',
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis'
    })

    expect(claro['--jos-cor-acento']).toBe('#FFFFE3')
    expect(claro['--jos-cor-acento-leitura']).not.toBe('#FFFFE3')
  })

  it('cada módulo lê o próprio acento', () => {
    const noa = variaveisDoTema({
      uiTheme: 'dark',
      accentJarvis: '#FF5C00',
      accentNoa: '#2323FF',
      modulo: 'noa'
    })
    expect(noa['--jos-cor-acento']).toBe('#2323FF')
  })
})
