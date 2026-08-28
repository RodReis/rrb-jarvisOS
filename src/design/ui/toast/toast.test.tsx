import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Alias `@design` e não `../../tokens/provider`: a fronteira da F01 bane `../../*` por padrão,
// porque é a forma como um import escaparia de `src/design/`. O alias diz a mesma coisa sem
// depender de quantos níveis o arquivo está — e a regra segue intacta, como na F02.
import { ProvedorDeTema } from '@design/tokens/provider'
import { ToastProvider } from './ToastProvider'
import { DURACAO_PADRAO, MAX_TOASTS, useToast, type EntradaToast } from './useToast'

/**
 * Toast (SPEC-DesignSystem-03b, critério 2; README §5).
 *
 * O critério enumera cinco garantias: variante correta, pausa em hover/foco, máx. 5, dedupe e
 * **permanecer escuro** sob `uiTheme='light'`. Todas são de comportamento observável — nenhuma
 * pede asserção sobre estilo computado, que em jsdom seria medir a própria string que o
 * componente escreveu.
 *
 * O relógio é injetado (`agora`) e os timers são falsos: um teste de auto-dismiss que esperasse
 * 4200 ms de verdade seria lento e flaky. `advanceTimersByTime` torna a passagem do tempo um
 * fato do teste, não uma aposta — e é o que permite afirmar sobre o **resto** do timer na pausa,
 * não só sobre "pausou".
 */

/** Gatilho de disparo — dá ao teste um botão para acionar o `useToast` de dentro da árvore. */
function Disparador({
  entrada,
  rotulo = 'Disparar'
}: {
  readonly entrada: EntradaToast
  readonly rotulo?: string
}): React.JSX.Element {
  const { disparar } = useToast()
  return (
    <button type="button" onClick={() => disparar(entrada)}>
      {rotulo}
    </button>
  )
}

const AGORA_FIXO = (): Date => new Date(2026, 6, 23, 14, 5, 9)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Aciona um gatilho pelo nome acessível.
 *
 * `fireEvent` e não `userEvent` de propósito: o `userEvent` mantém o próprio relógio e, sob
 * `vi.useFakeTimers()`, suas esperas internas nunca resolvem — todo clique estoura o timeout do
 * teste. Aqui o alvo é o **motor** (fila, timers, dedupe), não a fidelidade da sequência de
 * eventos do ponteiro; um `click` sintético entrega o disparo sem depender do tempo.
 */
function acionar(nome: string): void {
  fireEvent.click(screen.getByRole('button', { name: nome }))
}

describe('variante e conteúdo (critério 2)', () => {
  it('anuncia o tom em texto e carimba o horário — estado nunca só por cor (critério 4)', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'ok', titulo: 'Workflow concluído' }} />
      </ToastProvider>
    )

    acionar('Disparar')

    // `status` e não `alert`: sucesso informa sem cortar a leitura em curso.
    const toast = screen.getByRole('status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
    // O nome do tom em pt-BR é lido; a sigla visual (`OK`) é `aria-hidden`. Sem o texto, o
    // toast seria distinguível **só pela cor** da barra lateral.
    expect(toast).toHaveTextContent(/sucesso:/i)
    expect(toast).toHaveTextContent('Workflow concluído')
    expect(toast).toHaveTextContent('14:05:09')
  })

  it('warn e err são assertivos; ok e info não interrompem', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'err', titulo: 'Falhou' }} rotulo="Erro" />
        <Disparador entrada={{ tom: 'info', titulo: 'Sincronizado' }} rotulo="Info" />
      </ToastProvider>
    )

    acionar('Erro')
    acionar('Info')

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('nenhum toast rouba o foco — anunciar não pode arrancar o usuário do que faz', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'err', titulo: 'Falhou' }} />
      </ToastProvider>
    )

    const gatilho = screen.getByRole('button', { name: 'Disparar' })
    gatilho.focus()
    acionar('Disparar')

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(gatilho).toHaveFocus()
  })
})

describe('auto-dismiss e pausa (critério 2)', () => {
  it('some sozinho após a duração padrão', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'info', titulo: 'Sincronizado' }} />
      </ToastProvider>
    )

    acionar('Disparar')
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(DURACAO_PADRAO - 1)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hover pausa o timer e sair retoma **o resto**, não a duração inteira', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'info', titulo: 'Sincronizado' }} />
      </ToastProvider>
    )

    acionar('Disparar')
    const toast = screen.getByRole('status')

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    fireEvent.mouseEnter(toast)

    // Pausado: o tempo passa e o toast fica. Sem a pausa, sumiria aqui — que é exatamente o
    // problema de a11y que ela existe para resolver (quem lê devagar perde a mensagem).
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.mouseLeave(toast)
    // Restavam 200 ms. Se retomar reiniciasse a duração cheia, este avanço não bastaria.
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('foco no botão de fechar também pausa', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'info', titulo: 'Sincronizado' }} />
      </ToastProvider>
    )

    acionar('Disparar')
    // Quem navega por teclado não gera `mouseenter`. Sem a pausa no foco, a mensagem sumiria
    // debaixo do cursor de quem estava prestes a agir sobre ela.
    fireEvent.focus(screen.getByRole('button', { name: 'Fechar notificação' }))

    act(() => {
      vi.advanceTimersByTime(DURACAO_PADRAO * 2)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('o botão de fechar descarta na hora', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'info', titulo: 'Sincronizado' }} />
      </ToastProvider>
    )

    acionar('Disparar')
    acionar('Fechar notificação')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('fila: máximo e dedupe (critério 2)', () => {
  it(`mantém no máximo ${MAX_TOASTS}, descartando o mais antigo`, () => {
    function Rajada(): React.JSX.Element {
      const { disparar } = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            for (let i = 1; i <= MAX_TOASTS + 2; i++) {
              disparar({ tom: 'info', titulo: `Evento ${i}` })
            }
          }}
        >
          Rajada
        </button>
      )
    }
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Rajada />
      </ToastProvider>
    )

    acionar('Rajada')

    expect(screen.getAllByRole('status')).toHaveLength(MAX_TOASTS)
    // Mais novo no topo, mais antigo cai fora. Os dois primeiros saíram.
    expect(screen.queryByText('Evento 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Evento 2')).not.toBeInTheDocument()
    expect(screen.getByText(`Evento ${MAX_TOASTS + 2}`)).toBeInTheDocument()
  })

  it('o timer do excedente é limpo — descartar um id inexistente não pode derrubar a fila', () => {
    function Rajada(): React.JSX.Element {
      const { disparar } = useToast()
      return (
        <button
          type="button"
          onClick={() => {
            for (let i = 1; i <= MAX_TOASTS + 2; i++) {
              disparar({ tom: 'info', titulo: `Evento ${i}`, duracao: 1000 * i })
            }
          }}
        >
          Rajada
        </button>
      )
    }
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Rajada />
      </ToastProvider>
    )

    acionar('Rajada')
    // Os excedentes tinham as durações mais curtas (1000 e 2000 ms). Se seus timers ficassem
    // vivos, disparariam `descartar` para ids já removidos — sem limpeza isso é lixo que
    // acumula, e o teste registra a intenção de limpá-los.
    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(screen.getAllByRole('status')).toHaveLength(MAX_TOASTS)
  })

  it('dedupe: tom + título + mensagem idênticos não empilham', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'err', titulo: 'Sem rede', mensagem: 'Tentando de novo' }} />
      </ToastProvider>
    )

    acionar('Disparar')
    acionar('Disparar')
    acionar('Disparar')

    // Uma falha em rajada não deve virar três cópias da mesma frase ocupando a tela.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('dedupe não engole mensagem diferente com o mesmo título', () => {
    render(
      <ToastProvider agora={AGORA_FIXO}>
        <Disparador entrada={{ tom: 'err', titulo: 'Falhou', mensagem: 'workflow A' }} rotulo="A" />
        <Disparador entrada={{ tom: 'err', titulo: 'Falhou', mensagem: 'workflow B' }} rotulo="B" />
      </ToastProvider>
    )

    acionar('A')
    acionar('B')

    // O contorno do dedupe importa tanto quanto ele: dois workflows distintos falhando são
    // dois fatos. Colapsá-los esconderia um erro real.
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })
})

describe('toast permanece escuro no tema claro (critério 2, README §2.6)', () => {
  it('não lê as variáveis de tema — usa as de toast, que não invertem', () => {
    const { container } = render(
      <ProvedorDeTema uiTheme="light" modulo="jarvis">
        <ToastProvider agora={AGORA_FIXO}>
          <Disparador entrada={{ tom: 'ok', titulo: 'Concluído' }} />
        </ToastProvider>
      </ProvedorDeTema>
    )

    acionar('Disparar')
    const toast = screen.getByRole('status')

    // A garantia é estrutural, não de pixel: o card referencia `--jos-toast-*` (superfície de
    // marca, sempre escura) e **nunca** `--jos-cor-superficie*`, que inverte com o tema. Uma
    // asserção sobre cor computada em jsdom mediria a string que o próprio componente escreveu.
    const marcacao = toast.outerHTML
    expect(marcacao).toContain('--jos-toast-fundo')
    expect(marcacao).toContain('--jos-toast-texto')
    expect(marcacao).not.toContain('--jos-cor-superficie')
    expect(marcacao).not.toContain('--jos-cor-texto)')

    // E o provider de fato pintou o modo claro — sem isto, o teste passaria mesmo se o
    // `uiTheme` fosse ignorado, medindo o default escuro. `data-modo` carrega o modo
    // **efetivo**, que é o que está na tela.
    expect(container.querySelector('[data-modo="light"]')).not.toBeNull()
  })
})

describe('contrato do motor', () => {
  it('useToast fora do provider lança em vez de silenciar', () => {
    function Solto(): React.JSX.Element {
      useToast()
      return <span />
    }
    // Um `disparar` inerte faria o feedback do sistema sumir sem rastro — o oposto do que um
    // sistema de notificação existe para garantir. Falhar alto é a escolha correta.
    expect(() => render(<Solto />)).toThrow(/ToastProvider/)
  })
})
