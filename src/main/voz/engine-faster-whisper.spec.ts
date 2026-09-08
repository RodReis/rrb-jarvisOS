import { describe, expect, it, vi } from 'vitest'
import { criarEngineFasterWhisper } from './engine-faster-whisper'
import type { Sidecar } from './sidecar'
import type { ModoDeCompute } from '@shared/domain/voz'

/**
 * Um sidecar de mentira que grava o que recebeu.
 *
 * O que se mede aqui é o **protocolo**: quais pedidos saem, em que ordem e com que argumentos.
 * O sidecar real já tem os próprios testes, e o script Python é medido pelo smoke com áudio.
 */
function sidecarFalso(resposta: Record<string, unknown> = {}): {
  sidecar: Sidecar
  pedidos: Record<string, unknown>[]
} {
  const pedidos: Record<string, unknown>[] = []

  const sidecar = {
    pedir: vi.fn(async (payload: Record<string, unknown>) => {
      pedidos.push(payload)
      if (payload.op === 'configurar') return { ok: true }
      return { ok: true, texto: 'bom dia', idioma: 'pt', segmentos: [], ...resposta }
    }),
    encerrar: vi.fn(async () => undefined)
  } as unknown as Sidecar

  return { sidecar, pedidos }
}

const CONFIG = { modelo: 'C:/modelos/whisper-small', idioma: 'pt' }

describe('engine faster-whisper — o contrato do SttEngine (critério 1)', () => {
  it('traduz a resposta do sidecar no resultado que o app espera', async () => {
    const { sidecar } = sidecarFalso({
      texto: 'abrir o painel',
      segmentos: [{ inicioMs: 0, fimMs: 900, texto: 'abrir o painel' }]
    })

    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })
    const r = await engine.transcribe(new Int16Array([1, 2, 3]))

    expect(r.texto).toBe('abrir o painel')
    expect(r.idioma).toBe('pt')
    expect(r.segmentos).toEqual([{ inicioMs: 0, fimMs: 900, texto: 'abrir o painel' }])
  })

  it('manda o PCM como lista de inteiros, e não como Int16Array', async () => {
    // Um `Int16Array` serializa em JSON como objeto indexado (`{"0":1,...}`), que o lado
    // Python leria como dicionário — a transcrição chegaria vazia sem nada acusar.
    const { sidecar, pedidos } = sidecarFalso()
    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })

    await engine.transcribe(new Int16Array([7, -7]))

    const transcricao = pedidos.find((p) => p.op === 'transcrever')
    expect(Array.isArray(transcricao?.amostras)).toBe(true)
    expect(transcricao?.amostras).toEqual([7, -7])
  })

  it('não deixa forma inesperada do outro processo derrubar a transcrição', async () => {
    // A resposta vem de fora: um campo com forma errada não pode custar a frase inteira.
    const { sidecar } = sidecarFalso({ texto: 42, segmentos: 'nada disso' })
    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })

    const r = await engine.transcribe(new Int16Array([1]))

    expect(r.texto).toBe('')
    expect(r.segmentos).toEqual([])
  })

  it('descarta segmento sem texto em vez de inventar um vazio', async () => {
    const { sidecar } = sidecarFalso({
      segmentos: [{ inicioMs: 0, fimMs: 10 }, { inicioMs: 10, fimMs: 20, texto: 'ok' }]
    })
    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })

    const r = await engine.transcribe(new Int16Array([1]))

    expect(r.segmentos).toEqual([{ inicioMs: 10, fimMs: 20, texto: 'ok' }])
  })
})

describe('engine faster-whisper — Settings vale na chamada seguinte (critério 6)', () => {
  it('reconfigura o sidecar quando o modelo muda, sem restart', async () => {
    const { sidecar, pedidos } = sidecarFalso()
    let config = { modelo: 'C:/modelos/small', idioma: 'pt' }

    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => config })
    await engine.transcribe(new Int16Array([1]))

    config = { modelo: 'C:/modelos/medium', idioma: 'pt' }
    await engine.transcribe(new Int16Array([1]))

    const configuracoes = pedidos.filter((p) => p.op === 'configurar')
    expect(configuracoes).toHaveLength(2)
    expect(configuracoes[1]?.modelo).toBe('C:/modelos/medium')
  })

  it('reconfigura quando só o idioma muda', async () => {
    const { sidecar, pedidos } = sidecarFalso()
    let config = { modelo: 'C:/modelos/small', idioma: 'pt' }

    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => config })
    await engine.transcribe(new Int16Array([1]))

    config = { modelo: 'C:/modelos/small', idioma: 'en' }
    await engine.transcribe(new Int16Array([1]))

    expect(pedidos.filter((p) => p.op === 'configurar')).toHaveLength(2)
  })

  it('não reconfigura quando nada mudou — recarregar o modelo custaria segundos por frase', async () => {
    const { sidecar, pedidos } = sidecarFalso()
    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })

    await engine.transcribe(new Int16Array([1]))
    await engine.transcribe(new Int16Array([2]))
    await engine.transcribe(new Int16Array([3]))

    expect(pedidos.filter((p) => p.op === 'configurar')).toHaveLength(1)
  })

  it('configura antes de transcrever, nunca depois', async () => {
    const { sidecar, pedidos } = sidecarFalso()
    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })

    await engine.transcribe(new Int16Array([1]))

    expect(pedidos.map((p) => p.op)).toEqual(['configurar', 'transcrever'])
  })
})

describe('engine faster-whisper — o modo de compute chega à UI (critério 7)', () => {
  it('registra a queda para CPU que o sidecar reportou', async () => {
    // O sidecar cai para CPU quando o CUDA falha, e quem decide o que a tela mostra é este
    // registro: sem ele, a UI indicaria GPU numa máquina rodando em int8.
    const { sidecar } = sidecarFalso({ compute: 'cpu-int8' })
    const modos: ModoDeCompute[] = []

    const engine = criarEngineFasterWhisper({
      sidecar,
      configuracao: () => CONFIG,
      registrarCompute: (m) => modos.push(m)
    })
    await engine.transcribe(new Int16Array([1]))

    expect(modos).toEqual(['cpu-int8'])
  })

  it('ignora modo que não é um dos dois conhecidos', async () => {
    const { sidecar } = sidecarFalso({ compute: 'quantico' })
    const modos: ModoDeCompute[] = []

    const engine = criarEngineFasterWhisper({
      sidecar,
      configuracao: () => CONFIG,
      registrarCompute: (m) => modos.push(m)
    })
    await engine.transcribe(new Int16Array([1]))

    expect(modos).toEqual([])
  })
})

describe('engine faster-whisper — disponibilidade e encerramento', () => {
  it('responde indisponível sem subir o processo quando falta artefato', async () => {
    const { sidecar, pedidos } = sidecarFalso()
    const engine = criarEngineFasterWhisper({
      sidecar,
      configuracao: () => CONFIG,
      artefatosPresentes: () => false
    })

    expect(await engine.disponivel()).toBe(false)
    expect(pedidos).toHaveLength(0)
  })

  it('encerra o sidecar e esquece a configuração — o processo novo nasce sem ela', async () => {
    const { sidecar, pedidos } = sidecarFalso()
    const engine = criarEngineFasterWhisper({ sidecar, configuracao: () => CONFIG })

    await engine.transcribe(new Int16Array([1]))
    await engine.encerrar()
    await engine.transcribe(new Int16Array([1]))

    // Duas configurações: o processo que morreu levou o modelo carregado com ele, e pular a
    // segunda deixaria o sidecar novo transcrevendo sem modelo nenhum.
    expect(pedidos.filter((p) => p.op === 'configurar')).toHaveLength(2)
  })
})
