import { describe, expect, it, vi } from 'vitest'
import {
  SessaoDeGravacao,
  TIMEOUT_PADRAO_MS,
  type DepsDaSessao,
  type MotivoDoFim
} from './sessao-de-gravacao'

/**
 * Um relógio de mentira: nada espera de verdade, e `disparar()` faz o tempo passar.
 *
 * Sem isto, testar o timeout custaria 60 segundos por caso — e um teste que espera um minuto é
 * um teste que ninguém roda.
 */
function relogioFalso(): {
  deps: (extra?: Partial<DepsDaSessao>) => DepsDaSessao
  disparar: () => void
  fechamentos: MotivoDoFim[]
  cancelados: number
} {
  let pendente: (() => void) | undefined
  const fechamentos: MotivoDoFim[] = []
  let cancelados = 0

  return {
    fechamentos,
    get cancelados() {
      return cancelados
    },
    disparar: () => {
      const acao = pendente
      pendente = undefined
      acao?.()
    },
    deps: (extra = {}) => ({
      agendar: (acao) => {
        pendente = acao
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      cancelar: () => {
        cancelados += 1
        pendente = undefined
      },
      aoFechar: (motivo) => void fechamentos.push(motivo),
      ...extra
    })
  }
}

describe('sessão de gravação — o botão (segurar e soltar)', () => {
  it('abrir deixa gravando; soltar fecha', () => {
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.abrir()
    expect(s.gravando).toBe(true)

    s.fechar('soltou')
    expect(s.gravando).toBe(false)
    expect(r.fechamentos).toEqual(['soltou'])
  })

  it('soltar sem ter apertado é silêncio, não erro', () => {
    // Acontece de verdade: a tela recarrega com o botão apertado, e o evento de soltar chega
    // sem o de apertar. Estourar aqui viraria erro na tela por um estado que ninguém criou.
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.fechar('soltou')

    expect(r.fechamentos).toEqual([])
  })
})

describe('sessão de gravação — a hotkey (toggle)', () => {
  it('um toque abre, outro fecha', () => {
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.alternar()
    expect(s.gravando).toBe(true)

    s.alternar()
    expect(s.gravando).toBe(false)
    expect(r.fechamentos).toEqual(['toggle'])
  })

  it('a hotkey fecha uma sessão que o botão abriu', () => {
    // Duas formas de acionar, um estado só: dois estados separados divergiriam no primeiro uso
    // misto, e o microfone ficaria aberto sem nada na tela dizendo isso.
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.abrir()
    s.alternar()

    expect(s.gravando).toBe(false)
    expect(r.fechamentos).toEqual(['toggle'])
  })

  it('o botão fecha uma sessão que a hotkey abriu', () => {
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.alternar()
    s.fechar('soltou')

    expect(s.gravando).toBe(false)
    expect(r.fechamentos).toEqual(['soltou'])
  })
})

describe('sessão de gravação — o timeout duro (critério 5)', () => {
  it('encerra a sessão esquecida', () => {
    // O toggle não tem fim natural: quem toca a hotkey e esquece deixa o microfone aberto.
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.alternar()
    r.disparar()

    expect(s.gravando).toBe(false)
    expect(r.fechamentos).toEqual(['timeout'])
  })

  it('o default é o da spec: 60 segundos', () => {
    const agendar = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const r = relogioFalso()

    new SessaoDeGravacao(r.deps({ agendar })).abrir()

    expect(agendar).toHaveBeenCalledWith(expect.any(Function), TIMEOUT_PADRAO_MS)
    expect(TIMEOUT_PADRAO_MS).toBe(60_000)
  })

  it('é configurável', () => {
    const agendar = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const r = relogioFalso()

    new SessaoDeGravacao(r.deps({ agendar, timeoutMs: 5_000 })).abrir()

    expect(agendar).toHaveBeenCalledWith(expect.any(Function), 5_000)
  })

  it('fechar antes do tempo cancela o relógio', () => {
    // Sem o cancelamento, o timeout dispararia depois de a sessão já ter terminado e fecharia
    // a **seguinte** — o usuário perderia uma gravação que acabou de começar.
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.abrir()
    s.fechar('soltou')

    expect(r.cancelados).toBe(1)
  })

  it('depois do timeout, fechar de novo não avisa duas vezes', () => {
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.abrir()
    r.disparar()
    s.fechar('soltou')

    expect(r.fechamentos).toEqual(['timeout'])
  })

  it('abrir uma sessão já aberta não reinicia o timeout', () => {
    // Reiniciar deixaria o toggle esquecido vivo para sempre se algo reabrisse em loop — e o
    // timeout existe justamente para quando ninguém está olhando.
    const agendar = vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps({ agendar }))

    s.abrir()
    s.abrir()
    s.abrir()

    expect(agendar).toHaveBeenCalledTimes(1)
  })
})

describe('sessão de gravação — descarte no desligamento', () => {
  it('encerra sem avisar ninguém', () => {
    // No desligamento não há tela para reagir; avisar dispararia um fluxo de transcrição
    // enquanto o app fecha.
    const r = relogioFalso()
    const s = new SessaoDeGravacao(r.deps())

    s.abrir()
    s.descartar()

    expect(s.gravando).toBe(false)
    expect(r.fechamentos).toEqual([])
    expect(r.cancelados).toBe(1)
  })

  it('descartar sem sessão aberta não estoura', () => {
    const r = relogioFalso()

    expect(() => new SessaoDeGravacao(r.deps()).descartar()).not.toThrow()
  })
})
