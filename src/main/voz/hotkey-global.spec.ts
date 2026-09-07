import { describe, expect, it, vi } from 'vitest'
import { HotkeyDaVoz, HOTKEY_PADRAO, type DepsDaHotkey } from './hotkey-global'

function deps(
  extra: Partial<DepsDaHotkey> = {},
  { aceitar = true }: { aceitar?: boolean | ((atalho: string) => boolean) } = {}
): DepsDaHotkey & { registrados: string[]; liberados: string[]; eventos: string[] } {
  const registrados: string[] = []
  const liberados: string[] = []
  const eventos: string[] = []

  return {
    registrados,
    liberados,
    eventos,
    registrador: {
      registrar: (atalho) => {
        const ok = typeof aceitar === 'function' ? aceitar(atalho) : aceitar
        if (ok) registrados.push(atalho)
        return ok
      },
      liberar: (atalho) => void liberados.push(atalho)
    },
    aoAcionar: vi.fn(),
    auditar: (evento) => void eventos.push(evento.type),
    ...extra
  }
}

describe('hotkey global — registro (critério 5)', () => {
  it('o default é registrado quando nenhum atalho é pedido', () => {
    const d = deps()

    const r = new HotkeyDaVoz(d).registrar()

    expect(r).toEqual({ estado: 'ok', atalho: HOTKEY_PADRAO })
    expect(d.registrados).toEqual([HOTKEY_PADRAO])
  })

  it('o toque chama a ação — é o toggle da sessão', () => {
    const acionar = vi.fn()
    const registrar = vi.fn((_atalho: string, _acao: () => void) => true)
    const d = deps({ aoAcionar: acionar })

    new HotkeyDaVoz({ ...d, registrador: { registrar, liberar: vi.fn() } }).registrar()

    // A ação é passada ao registrador, não guardada aqui: quem dispara é o sistema.
    expect(registrar.mock.calls[0][1]).toBe(acionar)
  })

  it('antes de registrar, nenhuma hotkey está em vigor', () => {
    expect(new HotkeyDaVoz(deps()).registrada).toBeUndefined()
  })
})

describe('hotkey global — atalho tomado não é erro do app', () => {
  it('recusa vira desfecho nomeado, não exceção', () => {
    // `Ctrl+Shift+Espaço` é disputado; a tela precisa dizer "escolha outra", e não mostrar uma
    // falha genérica sobre algo que o usuário conserta num clique.
    const d = deps({}, { aceitar: false })

    const r = new HotkeyDaVoz(d).registrar('Control+Shift+Q')

    expect(r).toEqual({ estado: 'ja-em-uso', atalho: 'Control+Shift+Q' })
  })

  it('depois da recusa, o app fica sem hotkey — e diz isso', () => {
    const d = deps({}, { aceitar: false })
    const h = new HotkeyDaVoz(d)

    h.registrar('Control+Shift+Q')

    expect(h.registrada).toBeUndefined()
  })

  it('a recusa é auditada, porque ficar sem hotkey é estado', () => {
    const d = deps({}, { aceitar: false })

    new HotkeyDaVoz(d).registrar('Control+Shift+Q')

    expect(d.eventos).toEqual(['voz.hotkey.recusada'])
  })
})

describe('hotkey global — trocar libera o anterior', () => {
  it('o atalho velho para de valer', () => {
    const d = deps()
    const h = new HotkeyDaVoz(d)

    h.registrar('Control+Shift+A')
    h.registrar('Control+Shift+B')

    expect(d.liberados).toEqual(['Control+Shift+A'])
    expect(h.registrada).toBe('Control+Shift+B')
  })

  it('registrar o mesmo atalho de novo não falha por conflito consigo mesmo', () => {
    // Sem liberar antes de tentar, o sistema recusaria o próprio atalho e o usuário veria
    // "já em uso" sobre a combinação que ele mesmo escolheu.
    const emUso = new Set<string>()
    const d = deps(
      {},
      {
        aceitar: (atalho) => {
          if (emUso.has(atalho)) return false
          emUso.add(atalho)
          return true
        }
      }
    )
    const h = new HotkeyDaVoz({
      ...d,
      registrador: {
        registrar: d.registrador.registrar,
        liberar: (atalho) => {
          emUso.delete(atalho)
          d.registrador.liberar(atalho)
        }
      }
    })

    h.registrar('Control+Shift+A')
    const r = h.registrar('Control+Shift+A')

    expect(r.estado).toBe('ok')
  })

  it('uma troca recusada não deixa o anterior ativo por baixo', () => {
    // Reregistrar o anterior na falha deixaria a tela dizendo "não deu" com o atalho antigo
    // ainda escutando — e o usuário sem saber qual das duas combinações vale.
    let aceita = true
    const d = deps({}, { aceitar: () => aceita })
    const h = new HotkeyDaVoz(d)

    h.registrar('Control+Shift+A')
    aceita = false
    h.registrar('Control+Shift+B')

    expect(h.registrada).toBeUndefined()
    expect(d.liberados).toEqual(['Control+Shift+A'])
  })
})

describe('hotkey global — auditoria da mudança', () => {
  it('registrar audita, porque o atalho intercepta o sistema inteiro', () => {
    const d = deps()

    new HotkeyDaVoz(d).registrar()

    expect(d.eventos).toEqual(['voz.hotkey.registrada'])
  })

  it('a troca registra o anterior no evento, não só o novo', () => {
    const eventos: { type: string; payload: Record<string, unknown> }[] = []
    const d = deps({ auditar: (e) => void eventos.push(e) })
    const h = new HotkeyDaVoz(d)

    h.registrar('Control+Shift+A')
    h.registrar('Control+Shift+B')

    expect(eventos.at(-1)?.payload).toEqual({
      atalho: 'Control+Shift+B',
      anterior: 'Control+Shift+A'
    })
  })

  it('o primeiro registro diz que não havia anterior, em vez de omitir', () => {
    const eventos: { type: string; payload: Record<string, unknown> }[] = []
    const d = deps({ auditar: (e) => void eventos.push(e) })

    new HotkeyDaVoz(d).registrar('Control+Shift+A')

    expect(eventos[0].payload.anterior).toBeNull()
  })
})

describe('hotkey global — liberar no desligamento', () => {
  it('para de escutar e audita', () => {
    const d = deps()
    const h = new HotkeyDaVoz(d)

    h.registrar('Control+Shift+A')
    h.liberar()

    expect(h.registrada).toBeUndefined()
    expect(d.liberados).toEqual(['Control+Shift+A'])
    expect(d.eventos).toEqual(['voz.hotkey.registrada', 'voz.hotkey.liberada'])
  })

  it('liberar sem nada registrado é silêncio, não evento', () => {
    const d = deps()

    new HotkeyDaVoz(d).liberar()

    expect(d.liberados).toEqual([])
    expect(d.eventos).toEqual([])
  })
})
