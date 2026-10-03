import { describe, expect, it } from 'vitest'
import type { EventoWakeWordDetectado, WakeWordEngine } from './wake-word-engine'
import type { DepsDaEscuta, EstadoPersistidoDaEscuta, EventoDeEscuta } from './escuta-service'
import { EscutaService } from './escuta-service'

const PCM = new Int16Array(1280)
const DETECCAO: EventoWakeWordDetectado = { confianca: 0.91, fimDaFraseMs: 1234 }

/** O engine real é um sidecar Python; aqui só importa o contrato `alimentar`/`definirLimiar`. */
function engineFalso(resposta: EventoWakeWordDetectado | null = null) {
  const alimentados: Int16Array[] = []
  const limiares: number[] = []
  let limiar = 0.5
  const engine: WakeWordEngine = {
    alimentar: async (pcm) => {
      alimentados.push(pcm)
      return resposta
    },
    disponivel: async () => true,
    definirLimiar: (v) => {
      limiar = v
      limiares.push(v)
    },
    obterLimiar: () => limiar,
    encerrar: async () => undefined
  }
  return { engine, alimentados, limiares }
}

function montar(
  sobrescrever: {
    resposta?: EventoWakeWordDetectado | null
    persistido?: EstadoPersistidoDaEscuta | undefined
    palmas?: boolean
    bloqueada?: boolean
    turnoAtivo?: boolean
    modeloPronto?: boolean
    tetoDoTurnoMs?: number
  } = {}
) {
  const { engine, alimentados, limiares } = engineFalso(sobrescrever.resposta ?? null)
  const auditados: { type: string; payload: Record<string, unknown> }[] = []
  const capturas: boolean[] = []
  const disparos: EventoDeEscuta[] = []
  const gravados: EstadoPersistidoDaEscuta[] = []
  let palmasAlimentadas = 0
  let persistido = sobrescrever.persistido
  let bloqueada = sobrescrever.bloqueada ?? false
  let turnoAtivo = sobrescrever.turnoAtivo ?? false
  const agendados: { acao: () => void; ms: number; cancelado: boolean }[] = []

  const deps: DepsDaEscuta = {
    engine,
    palmas: {
      alimentar: () => {
        palmasAlimentadas += 1
        return sobrescrever.palmas ?? false
      },
      limpar: () => undefined
    },
    estado: {
      ler: () => persistido,
      gravar: (e) => {
        persistido = e
        gravados.push(e)
      }
    },
    modeloPronto: async () => sobrescrever.modeloPronto ?? true,
    auditar: (e) => void auditados.push(e),
    sessaoBloqueada: () => bloqueada,
    turnoAtivo: () => turnoAtivo,
    aoMudarCaptura: (aberta) => void capturas.push(aberta),
    aoDisparar: (e) => void disparos.push(e),
    tetoDoTurnoMs: sobrescrever.tetoDoTurnoMs,
    agendar: (acao, ms) => {
      const a = { acao, ms, cancelado: false }
      agendados.push(a)
      return a as unknown as ReturnType<typeof setTimeout>
    },
    cancelar: (r) => {
      ;(r as unknown as { cancelado: boolean }).cancelado = true
    }
  }
  return {
    servico: new EscutaService(deps),
    auditados,
    capturas,
    disparos,
    gravados,
    alimentados,
    limiares,
    palmasAlimentadas: () => palmasAlimentadas,
    agendados,
    estourarTeto: () => agendados.filter((a) => !a.cancelado).forEach((a) => a.acao()),
    bloquear: (v: boolean) => (bloqueada = v),
    ocuparTurno: (v: boolean) => (turnoAtivo = v)
  }
}

describe('EscutaService — restauração (SPEC-Escuta-01, critérios 8 e 10)', () => {
  it('sem estado salvo e com o modelo pronto, a escuta começa ligada', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    expect(m.servico.estado().ativa).toBe(true)
    expect(m.capturas).toEqual([true])
  })

  it('o kill switch salvo como desligado prevalece sobre o padrão', async () => {
    const m = montar({
      persistido: { ativa: false, frase: true, palmas: true, sensibilidade: 0.5 }
    })
    await m.servico.restaurar()
    expect(m.servico.estado().ativa).toBe(false)
    expect(m.capturas).toEqual([])
  })

  it('sem modelo pronto a escuta não liga sozinha e diz que não está disponível', async () => {
    const m = montar({ persistido: undefined, modeloPronto: false })
    await m.servico.restaurar()
    expect(m.servico.estado()).toMatchObject({ ativa: false, disponivel: false })
    expect(m.capturas).toEqual([])
  })

  it('a restauração que liga é auditada com a via "restauracao"', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    expect(m.auditados).toEqual([{ type: 'voz.escuta.ligada', payload: { via: 'restauracao' } }])
  })
})

describe('EscutaService — kill switch (critérios 8 e 10)', () => {
  it('desligar encerra a captura de fato e audita a via', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    m.auditados.length = 0
    m.capturas.length = 0

    await m.servico.desligar('interface')

    // O que prova o kill switch é o stream fechado, não o rótulo: este é o aviso à tela que fecha o
    // `getUserMedia`. Manter `ativa = false` sem avisar deixaria o microfone aberto.
    expect(m.capturas).toEqual([false])
    expect(m.servico.estado().ativa).toBe(false)
    expect(m.auditados).toEqual([{ type: 'voz.escuta.desligada', payload: { via: 'interface' } }])
  })

  it('o desligamento fica persistido, para sobreviver ao reinício', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    await m.servico.desligar('interface')
    expect(m.gravados.at(-1)?.ativa).toBe(false)
  })

  it('ligar e desligar de novo não duplica a auditoria nem a captura', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    m.auditados.length = 0
    m.capturas.length = 0

    await m.servico.ligar('interface')
    await m.servico.desligar('hotkey')
    await m.servico.desligar('hotkey')

    expect(m.capturas).toEqual([false])
    expect(m.auditados.map((a) => a.payload.via)).toEqual(['hotkey'])
  })

  it('ligar sem modelo pronto é recusado e não abre a captura', async () => {
    const m = montar({ persistido: undefined, modeloPronto: false })
    await m.servico.restaurar()
    const desfecho = await m.servico.ligar('interface')
    expect(desfecho).toEqual({ ok: false, motivo: 'MODELO_AUSENTE' })
    expect(m.capturas).toEqual([])
    expect(m.auditados).toEqual([])
  })
})

describe('EscutaService — hotkey de mute (critério 11)', () => {
  it('alterna a escuta e audita a via "hotkey", sem depender da janela', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    m.auditados.length = 0

    await m.servico.alternarPorHotkey()
    expect(m.servico.estado().ativa).toBe(false)
    await m.servico.alternarPorHotkey()
    expect(m.servico.estado().ativa).toBe(true)

    expect(m.auditados.map((a) => [a.type, a.payload.via])).toEqual([
      ['voz.escuta.desligada', 'hotkey'],
      ['voz.escuta.ligada', 'hotkey']
    ])
  })
})

describe('EscutaService — áudio e gatilhos (critérios 2, 7 e 12)', () => {
  it('escuta desligada não alimenta engine nem detector de palmas', async () => {
    const m = montar({
      persistido: { ativa: false, frase: true, palmas: true, sensibilidade: 0.5 }
    })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.alimentados).toHaveLength(0)
    expect(m.palmasAlimentadas()).toBe(0)
  })

  it('a frase detectada abre o turno com a confiança medida', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toEqual([{ gatilho: 'frase', confianca: 0.91, sessaoBloqueada: false }])
  })

  it('duas palmas abrem o mesmo turno, pelo gatilho "palmas"', async () => {
    const m = montar({ persistido: undefined, palmas: true })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toEqual([{ gatilho: 'palmas', sessaoBloqueada: false }])
  })

  it('cada gatilho liga e desliga separadamente', async () => {
    const m = montar({
      persistido: { ativa: true, frase: false, palmas: true, sensibilidade: 0.5 },
      resposta: DETECCAO,
      palmas: true
    })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.alimentados).toHaveLength(0)
    expect(m.disparos.map((d) => d.gatilho)).toEqual(['palmas'])

    m.servico.definirTurno(false)
    await m.servico.definirGatilhos({ frase: true, palmas: false })
    await m.servico.receberPcm(PCM)
    expect(m.disparos.map((d) => d.gatilho)).toEqual(['palmas', 'frase'])
  })

  it('disparo durante turno ativo é ignorado', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO, palmas: true })
    await m.servico.restaurar()
    m.ocuparTurno(true)
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toEqual([])
  })

  it('com a sessão bloqueada o disparo avisa — quem decide não subir a janela é o loop', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO, bloqueada: true })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.disparos[0]?.sessaoBloqueada).toBe(true)
  })

  it('o estado de bloqueio é lido a cada disparo, não congelado na restauração', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.bloquear(true)
    await m.servico.receberPcm(PCM)
    m.servico.definirTurno(false)
    m.bloquear(false)
    await m.servico.receberPcm(PCM)
    expect(m.disparos.map((d) => d.sessaoBloqueada)).toEqual([true, false])
  })

  it('o limiar de Settings vale na detecção seguinte, sem reiniciar, e fica persistido', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    await m.servico.definirSensibilidade(0.8)
    expect(m.limiares.at(-1)).toBe(0.8)
    expect(m.servico.estado().sensibilidade).toBe(0.8)
    expect(m.gravados.at(-1)?.sensibilidade).toBe(0.8)
  })

  it('sensibilidade fora da faixa é limitada, e não aceita como veio', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    await m.servico.definirSensibilidade(5)
    expect(m.servico.estado().sensibilidade).toBe(0.95)
    await m.servico.definirSensibilidade(Number.NaN)
    expect(m.servico.estado().sensibilidade).toBe(0.5)
  })
})

describe('EscutaService — o turno aberto pelo disparo', () => {
  it('um disparo abre o turno: o áudio seguinte não dispara de novo até o turno encerrar', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()

    await m.servico.receberPcm(PCM)
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toHaveLength(1)

    m.servico.definirTurno(false)
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toHaveLength(2)
  })

  it('o turno aberto pela tela (push-to-talk) também silencia a escuta', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()

    m.servico.definirTurno(true)
    await m.servico.receberPcm(PCM)

    expect(m.disparos).toEqual([])
    expect(m.alimentados).toHaveLength(0)
  })

  it('o turno que ninguém encerra expira sozinho, para a escuta não ficar surda', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO, tetoDoTurnoMs: 90_000 })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.agendados.at(-1)?.ms).toBe(90_000)

    m.estourarTeto()
    await m.servico.receberPcm(PCM)

    expect(m.disparos).toHaveLength(2)
  })

  it('encerrar o turno cancela o teto, e desligar a escuta também encerra o turno', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)

    expect(m.agendados.length).toBeGreaterThan(0)

    await m.servico.desligar('hotkey')

    expect(m.agendados.every((a) => a.cancelado)).toBe(true)
  })
})
