import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ACENTO_PADRAO } from './acento'
import { ProvedorDeTema, useTema, variaveisDoTema } from './provider'
import { modoEfetivo, papeis, SUPERFICIES_DE_MARCA, TELAS_INTERNAS, type ModoUi } from './semantic'

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
      modulo: 'jarvis',
      superficie: 'jarvis'
    })
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: ACENTO_PADRAO.jarvis,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis',
      superficie: 'jarvis'
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
      modulo: 'jarvis',
      superficie: 'jarvis'
    })
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: ACENTO_PADRAO.jarvis,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis',
      superficie: 'jarvis'
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
      modulo: 'jarvis',
      superficie: 'jarvis'
    })
    const claro = variaveisDoTema({
      uiTheme: 'light',
      accentJarvis: acento,
      accentNoa: ACENTO_PADRAO.noa,
      modulo: 'jarvis',
      superficie: 'jarvis'
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
      modulo: 'jarvis',
      superficie: 'jarvis'
    })

    expect(claro['--jos-cor-acento']).toBe('#FFFFE3')
    expect(claro['--jos-cor-acento-leitura']).not.toBe('#FFFFE3')
  })

  it('cada módulo lê o próprio acento', () => {
    const noa = variaveisDoTema({
      uiTheme: 'dark',
      accentJarvis: '#FF5C00',
      accentNoa: '#2323FF',
      modulo: 'noa',
      superficie: 'noa'
    })
    expect(noa['--jos-cor-acento']).toBe('#2323FF')
  })
})

describe('superfícies de marca não invertem (critério 2)', () => {
  const base = {
    accentJarvis: ACENTO_PADRAO.jarvis,
    accentNoa: ACENTO_PADRAO.noa,
    modulo: 'jarvis' as const
  }

  it.each(SUPERFICIES_DE_MARCA)('`%s` fica escura mesmo com uiTheme=light', (superficie) => {
    // README §2.6: "Login, Choice, overlay de transição e Toasts permanecem sempre escuros
    // (identidade de marca)". A prova é o **valor**: as variáveis têm de ser as do escuro,
    // não apenas o provider ter sido omitido nessas telas.
    const comClaro = variaveisDoTema({ ...base, uiTheme: 'light', superficie })
    const escuroReferencia = variaveisDoTema({ ...base, uiTheme: 'dark', superficie: 'jarvis' })

    expect(comClaro['--jos-cor-superficie']).toBe(escuroReferencia['--jos-cor-superficie'])
    expect(comClaro['--jos-cor-texto']).toBe(escuroReferencia['--jos-cor-texto'])
  })

  it('as telas internas — e só elas — respondem ao uiTheme', () => {
    for (const superficie of TELAS_INTERNAS) {
      const claro = variaveisDoTema({ ...base, uiTheme: 'light', superficie })
      const escuro = variaveisDoTema({ ...base, uiTheme: 'dark', superficie })
      expect(claro['--jos-cor-superficie']).not.toBe(escuro['--jos-cor-superficie'])
    }
  })

  it('`modoEfetivo` é o ponto único onde a exceção mora', () => {
    // Cada tela lembrar de aplicar a exceção seria a via para uma esquecer.
    expect(modoEfetivo('login', 'light')).toBe('dark')
    expect(modoEfetivo('toast', 'light')).toBe('dark')
    expect(modoEfetivo('jarvis', 'light')).toBe('light')
    expect(modoEfetivo('noa', 'dark')).toBe('dark')
  })

  it('o DOM carrega o modo efetivo, não a preferência', () => {
    // Se `data-modo` expusesse a preferência, CSS e teste discordariam do que está pintado.
    const { container } = render(
      <ProvedorDeTema uiTheme="light" superficie="login">
        <Sonda />
      </ProvedorDeTema>
    )
    const raiz = container.querySelector('[data-modo]')
    expect(raiz).toHaveAttribute('data-modo', 'dark')
    expect(raiz).toHaveAttribute('data-superficie', 'login')
  })
})
