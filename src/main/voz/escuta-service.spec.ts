import { describe, expect, it } from 'vitest'
import type { EventoWakeWordDetectado, WakeWordEngine } from './wake-word-engine'
import type {
  DepsDaEscuta,
  DisparoDeTeste,
  EstadoPersistidoDaEscuta,
  EventoDeEscuta
} from './escuta-service'
import { EscutaService } from './escuta-service'

const PCM = new Int16Array(1280)
const DETECCAO: EventoWakeWordDetectado = { confianca: 0.91, fimDaFraseMs: 1234 }

/** O engine real é um sidecar Python; aqui só importa o contrato `alimentar`/`definirLimiar`. */
function engineFalso(resposta: EventoWakeWordDetectado | null = null) {
  const alimentados: Int16Array[] = []
  const limiares: number[] = []
  const encerramentos = { total: 0 }
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
    encerrar: async () => {
      encerramentos.total += 1
    }
  }
  return { engine, alimentados, limiares, encerramentos }
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
    hotkeyOcupada?: boolean
  } = {}
) {
  const { engine, alimentados, limiares, encerramentos } = engineFalso(
    sobrescrever.resposta ?? null
  )
  const auditados: { type: string; payload: Record<string, unknown> }[] = []
  const capturas: boolean[] = []
  const disparos: EventoDeEscuta[] = []
  const testes: DisparoDeTeste[] = []
  const registradas: string[] = []
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
    aoTestar: (e) => void testes.push(e),
    registrarHotkey: (h) => {
      registradas.push(h)
      return !sobrescrever.hotkeyOcupada
    },
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
    testes,
    registradas,
    gravados,
    alimentados,
    limiares,
    encerramentos,
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
      persistido: {
        ativa: false,
        frase: true,
        palmas: true,
        sensibilidade: 0.5,
        hotkey: 'Control+Alt+M'
      }
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

  it('liga após instalar o modelo quando não havia escolha salva', async () => {
    const opcoes = { modeloPronto: false }
    const m = montar(opcoes)
    await m.servico.restaurar()
    opcoes.modeloPronto = true

    await m.servico.atualizarDisponibilidade()

    expect(m.servico.estado()).toMatchObject({ ativa: true, disponivel: true })
    expect(m.capturas).toEqual([true])
    expect(m.auditados.at(-1)?.payload.via).toBe('restauracao')
  })

  it('instalar o modelo não reverte um kill switch salvo', async () => {
    const opcoes = {
      modeloPronto: false,
      persistido: {
        ativa: false,
        frase: true,
        palmas: true,
        sensibilidade: 0.95,
        hotkey: 'Control+Alt+M' as const
      }
    }
    const m = montar(opcoes)
    await m.servico.restaurar()
    opcoes.modeloPronto = true

    await m.servico.atualizarDisponibilidade()

    expect(m.servico.estado()).toMatchObject({ ativa: false, disponivel: true })
    expect(m.capturas).toEqual([])
  })

  it('a restauração que liga é auditada com a via "restauracao"', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    expect(m.auditados).toEqual([
      { type: 'voz.microfone.posse', payload: { de: 'nenhum', para: 'wake-word' } },
      { type: 'voz.escuta.ligada', payload: { via: 'restauracao' } }
    ])
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
    expect(m.auditados).toEqual([
      { type: 'voz.microfone.posse', payload: { de: 'wake-word', para: 'nenhum' } },
      { type: 'voz.escuta.desligada', payload: { via: 'interface' } }
    ])
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
    expect(m.auditados.map((a) => a.type)).toEqual(['voz.microfone.posse', 'voz.escuta.desligada'])
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
      ['voz.microfone.posse', undefined],
      ['voz.escuta.desligada', 'hotkey'],
      ['voz.microfone.posse', undefined],
      ['voz.escuta.ligada', 'hotkey']
    ])
  })
})

describe('EscutaService — áudio e gatilhos (critérios 2, 7 e 12)', () => {
  it('escuta desligada não alimenta engine nem detector de palmas', async () => {
    const m = montar({
      persistido: {
        ativa: false,
        frase: true,
        palmas: true,
        sensibilidade: 0.5,
        hotkey: 'Control+Alt+M'
      }
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
    expect(m.disparos).toEqual([
      expect.objectContaining({
        gatilho: 'frase',
        confianca: 0.91,
        sessaoBloqueada: false,
        fimDoGatilhoMs: 1234
      })
    ])
  })

  it('duas palmas abrem o mesmo turno, pelo gatilho "palmas"', async () => {
    const m = montar({ persistido: undefined, palmas: true })
    await m.servico.restaurar()
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toEqual([
      expect.objectContaining({ gatilho: 'palmas', sessaoBloqueada: false })
    ])
    expect(m.disparos[0].fimDoGatilhoMs).toEqual(expect.any(Number))
  })

  it('cada gatilho liga e desliga separadamente', async () => {
    const m = montar({
      persistido: {
        ativa: true,
        frase: false,
        palmas: true,
        sensibilidade: 0.5,
        hotkey: 'Control+Alt+M'
      },
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
    expect(m.servico.estado().sensibilidade).toBe(0.95)
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

describe('arbitragem do microfone (SPEC-Escuta-02)', () => {
  it('só anuncia escutando depois da confirmação do stream aberto', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    expect(m.servico.estado().fase).toBe('ocioso')
    m.servico.confirmarCapturaAberta(true)
    expect(m.servico.estado().fase).toBe('escutando')
    m.servico.confirmarCapturaAberta(false)
    expect(m.servico.estado().fase).toBe('ocioso')
  })

  it('push-to-talk suspende o detector e soltar permite novo disparo', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirDono('push-to-talk')
    await m.servico.receberPcm(PCM)
    expect(m.alimentados).toHaveLength(0)
    expect(m.disparos).toHaveLength(0)

    m.servico.definirDono('wake-word')
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toHaveLength(1)
    expect(m.auditados).toContainEqual({
      type: 'voz.microfone.posse',
      payload: { de: 'wake-word', para: 'push-to-talk' }
    })
  })

  it('recusa durante pensamento e aceita durante fala, sem enfileirar', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirTurno(true)
    m.servico.definirFase('pensando')
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toHaveLength(0)
    expect(m.servico.estado().recusaSerial).toBe(1)

    m.servico.definirFase('falando')
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toHaveLength(1)
    expect(m.servico.estado().fase).toBe('gravando')
    await m.servico.receberPcm(PCM)
    expect(m.disparos).toHaveLength(1)
  })
})

describe('EscutaService — modo de teste ao vivo (critério 12)', () => {
  it('em teste, o disparo mostra a confiança medida e o limiar, e não abre turno', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)

    await m.servico.receberPcm(PCM)

    expect(m.testes).toEqual([{ gatilho: 'frase', confianca: 0.91, limiar: 0.95 }])
    // Testar sensibilidade não pode começar uma conversa nem subir a janela.
    expect(m.disparos).toEqual([])
  })

  it('o teste não consome o turno: a próxima detecção continua sendo testada', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)

    await m.servico.receberPcm(PCM)
    await m.servico.receberPcm(PCM)

    expect(m.testes).toHaveLength(2)
  })

  it('as palmas também aparecem no teste, sem confiança (o detector não a mede)', async () => {
    const m = montar({ persistido: undefined, palmas: true })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)

    await m.servico.receberPcm(PCM)

    expect(m.testes).toEqual([{ gatilho: 'palmas', limiar: 0.95 }])
  })

  it('o limiar do teste é o que Settings acabou de definir, sem restart', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)
    await m.servico.definirSensibilidade(0.8)

    await m.servico.receberPcm(PCM)

    expect(m.testes[0]?.limiar).toBe(0.8)
  })

  it('sair do modo de teste devolve o disparo ao turno de verdade', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)
    m.servico.definirModoDeTeste(false)

    await m.servico.receberPcm(PCM)

    expect(m.disparos).toHaveLength(1)
    expect(m.testes).toEqual([])
  })

  it('o modo de teste esquecido expira sozinho, para a escuta não ficar sem abrir turno', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)
    expect(m.agendados.at(-1)?.ms).toBe(120_000)

    m.estourarTeto()
    await m.servico.receberPcm(PCM)

    expect(m.disparos).toHaveLength(1)
  })

  it('desligar a escuta também encerra o modo de teste', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    m.servico.definirModoDeTeste(true)

    await m.servico.desligar('interface')
    await m.servico.ligar('interface')
    await m.servico.receberPcm(PCM)

    expect(m.disparos).toHaveLength(1)
  })
})

describe('EscutaService — o kill switch descarta o que ouviu (critérios 3 e 8)', () => {
  it('desligar encerra o engine: o pré-roll em memória e o processo do detector somem', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    expect(m.encerramentos.total).toBe(0)

    await m.servico.desligar('interface')

    // O engine guarda 1,5 s de áudio num buffer circular e mantém um sidecar vivo. Com o
    // microfone fechado, nada disso pode continuar de pé.
    expect(m.encerramentos.total).toBe(1)
  })

  it('desligar duas vezes não encerra duas vezes', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()

    await m.servico.desligar('hotkey')
    await m.servico.desligar('hotkey')

    expect(m.encerramentos.total).toBe(1)
  })

  it('religar depois de desligar volta a alimentar o engine', async () => {
    const m = montar({ persistido: undefined, resposta: DETECCAO })
    await m.servico.restaurar()
    await m.servico.desligar('interface')
    await m.servico.ligar('interface')

    await m.servico.receberPcm(PCM)

    expect(m.disparos).toHaveLength(1)
  })
})

describe('EscutaService — hotkey de mute configurável (critério 11)', () => {
  it('restaurar registra a hotkey padrão e diz que o SO a aceitou', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()

    expect(m.registradas).toEqual(['Control+Alt+M'])
    expect(m.servico.estado()).toMatchObject({ hotkey: 'Control+Alt+M', hotkeyRegistrada: true })
  })

  it('a hotkey escolhida em Settings é a que vale no reinício', async () => {
    const m = montar({
      persistido: {
        ativa: false,
        frase: true,
        palmas: true,
        sensibilidade: 0.5,
        hotkey: 'Control+Shift+K'
      }
    })
    await m.servico.restaurar()

    expect(m.registradas).toEqual(['Control+Shift+K'])
  })

  it('trocar a hotkey registra a nova, persiste e fica no estado', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()

    await m.servico.definirHotkey('Control+Shift+M')

    expect(m.registradas.at(-1)).toBe('Control+Shift+M')
    expect(m.servico.estado().hotkey).toBe('Control+Shift+M')
    expect(m.gravados.at(-1)?.hotkey).toBe('Control+Shift+M')
  })

  it('combinação fora da lista é recusada: o renderer não sequestra qualquer atalho global', async () => {
    const m = montar({ persistido: undefined })
    await m.servico.restaurar()
    m.registradas.length = 0

    await m.servico.definirHotkey('Control+C')
    await m.servico.definirHotkey('Control+Alt+Space')

    expect(m.registradas).toEqual([])
    expect(m.servico.estado().hotkey).toBe('Control+Alt+M')
  })

  it('atalho ocupado por outro app aparece como não registrado, sem derrubar a escuta', async () => {
    const m = montar({ persistido: undefined, hotkeyOcupada: true })
    await m.servico.restaurar()

    // A escuta segue valendo pelo interruptor da tela; o estado só avisa que o atalho não pegou.
    expect(m.servico.estado()).toMatchObject({ ativa: true, hotkeyRegistrada: false })
  })
})
