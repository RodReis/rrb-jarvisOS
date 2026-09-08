import { describe, expect, it, vi } from 'vitest'
import { criarEnginePiper, type VozDoCatalogo } from './engine-piper'
import type { Sidecar } from './sidecar'
import { falar } from './tts-engine'

/**
 * O engine Piper (SPEC-Voz-02, critérios 1, 2 e 3).
 *
 * O sidecar é dublê: o que se prova aqui é a **tradução** entre o contrato do app e o protocolo
 * JSON — não que o Piper sintetize, que é responsabilidade do script Python e foi medido com o
 * runtime real (ver `reports/spike-visemes-piper.md`).
 */

const FABER: VozDoCatalogo = {
  id: 'pt_BR-faber-medium',
  rotulo: 'Faber',
  caminho: '/models/faber.onnx'
}
const EDRESSON: VozDoCatalogo = {
  id: 'pt_BR-edresson-low',
  rotulo: 'Edresson',
  caminho: '/models/edresson.onnx'
}

/** Uma resposta de síntese com alinhamento — o caminho exato da `faber`. */
function respostaComAlinhamento(): Record<string, unknown> {
  return {
    ok: true,
    sampleRate: 22050,
    pcm: Array.from({ length: 2205 }, () => 100),
    fonemas: ['b', 'o', 'n'],
    alinhamentos: [
      { fonema: 'b', amostras: 735 },
      { fonema: 'o', amostras: 735 },
      { fonema: 'n', amostras: 735 }
    ]
  }
}

/** Uma resposta **sem** alinhamento — o caso medido da `edresson`: lista vazia, sem erro. */
function respostaSemAlinhamento(): Record<string, unknown> {
  return {
    ok: true,
    sampleRate: 16000,
    pcm: Array.from({ length: 1600 }, () => 100),
    fonemas: ['b', 'o', 'n'],
    alinhamentos: []
  }
}

function dubleDoSidecar(resposta: () => Record<string, unknown>): {
  sidecar: Sidecar
  pedidos: Record<string, unknown>[]
} {
  const pedidos: Record<string, unknown>[] = []
  const sidecar = {
    pedir: vi.fn(async (payload: Record<string, unknown>) => {
      pedidos.push(payload)
      return payload.op === 'falar' ? resposta() : { ok: true }
    }),
    encerrar: vi.fn(async () => {})
  } as unknown as Sidecar

  return { sidecar, pedidos }
}

describe('engine Piper', () => {
  it('só oferece voz cujo arquivo está no disco', async () => {
    // O catálogo lista o que **pode** ser baixado; `disponivel` responde sobre o que está lá. Sem
    // este filtro, a tela ofereceria falar numa voz que ainda não existe.
    const { sidecar } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({
      sidecar,
      vozes: () => [FABER, EDRESSON],
      existe: (c) => c === FABER.caminho
    })

    expect(await engine.disponivel()).toBe(true)
    expect((await engine.vozes()).map((v) => v.id)).toEqual([FABER.id])
  })

  it('não está disponível quando nenhuma voz foi baixada', async () => {
    const { sidecar } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => false })

    expect(await engine.disponivel()).toBe(false)
    expect(await engine.vozes()).toEqual([])
  })

  it('marca a timeline como exata quando o alinhamento veio', async () => {
    const { sidecar } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    const fala = await engine.speak('Bom dia', FABER.id)

    expect(fala.timeline).toBe('exato')
    expect(fala.sampleRate).toBe(22050)
    expect(fala.visemes.length).toBeGreaterThan(0)
    expect(fala.visemes[fala.visemes.length - 1].endMs).toBeCloseTo(100, 6)
  })

  it('cai no estimado quando o alinhamento veio vazio, e registra qual caminho foi', async () => {
    // O critério 3 pede que o caminho seja observável. Sem o registro, o dia em que a `faber`
    // perdesse o alinhamento numa revisão nova passaria despercebido — a fala continuaria saindo.
    const registrarTimeline = vi.fn()
    const { sidecar } = dubleDoSidecar(respostaSemAlinhamento)
    const engine = criarEnginePiper({
      sidecar,
      vozes: () => [EDRESSON],
      existe: () => true,
      registrarTimeline
    })

    const fala = await engine.speak('Bom dia', EDRESSON.id)

    expect(fala.timeline).toBe('estimado')
    expect(registrarTimeline).toHaveBeenCalledWith(EDRESSON.id, 'estimado')
    // Mesmo no plano B a timeline cobre o áudio: 1600 amostras a 16 kHz = 100 ms.
    expect(fala.visemes[fala.visemes.length - 1].endMs).toBeCloseTo(100, 6)
  })

  it('a voz passa a reportar o caminho que ela realmente entregou', async () => {
    const { sidecar } = dubleDoSidecar(respostaSemAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [EDRESSON], existe: () => true })

    // Antes de falar, o engine não tem observação — assume o caminho default.
    expect((await engine.vozes())[0].timeline).toBe('exato')

    await engine.speak('Bom dia', EDRESSON.id)

    expect((await engine.vozes())[0].timeline).toBe('estimado')
  })

  it('não vaza a observação de um engine para outro', async () => {
    // O contrafactual do isolamento: com o mapa no módulo em vez de no closure, o segundo engine
    // herdaria `estimado` sem nunca ter falado.
    const a = criarEnginePiper({
      sidecar: dubleDoSidecar(respostaSemAlinhamento).sidecar,
      vozes: () => [EDRESSON],
      existe: () => true
    })
    await a.speak('Bom dia', EDRESSON.id)

    const b = criarEnginePiper({
      sidecar: dubleDoSidecar(respostaComAlinhamento).sidecar,
      vozes: () => [EDRESSON],
      existe: () => true
    })

    expect((await b.vozes())[0].timeline).toBe('exato')
  })

  it('configura uma vez e reusa enquanto o conjunto de vozes não muda', async () => {
    // O sidecar descarta a voz carregada a cada `configurar`, e o `load` custa ~1,2 s (medido no
    // spike). Reconfigurar por frase pagaria isso quinze vezes o custo da síntese.
    const { sidecar, pedidos } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    await engine.speak('um', FABER.id)
    await engine.speak('dois', FABER.id)

    expect(pedidos.filter((p) => p.op === 'configurar')).toHaveLength(1)
    expect(pedidos.filter((p) => p.op === 'falar')).toHaveLength(2)
  })

  it('reconfigura quando uma voz nova é baixada, sem restart', async () => {
    const { sidecar, pedidos } = dubleDoSidecar(respostaComAlinhamento)
    let baixadas = [FABER]
    const engine = criarEnginePiper({ sidecar, vozes: () => baixadas, existe: () => true })

    await engine.speak('um', FABER.id)
    baixadas = [FABER, EDRESSON]
    await engine.speak('dois', FABER.id)

    expect(pedidos.filter((p) => p.op === 'configurar')).toHaveLength(2)
  })

  it('nenhum pedido ao sidecar carrega caminho de modelo depois do configurar', async () => {
    // O critério 6 proíbe caminho de modelo na ponte. O `configurar` os carrega por necessidade —
    // é o main falando com o próprio processo filho —, mas o `falar` leva só id de voz.
    const { sidecar, pedidos } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    await engine.speak('Bom dia', FABER.id)

    const falar = pedidos.filter((p) => p.op === 'falar')
    for (const p of falar) {
      expect(JSON.stringify(p)).not.toContain('.onnx')
    }
  })

  it('recusa áudio vazio em vez de devolver fala silenciosa', async () => {
    // Sample rate zero é o que o sidecar devolve quando o Piper não produz chunk. Aceitar isso
    // daria à tela um `ok` que não faz som — o pior desfecho, porque não há próxima ação.
    const { sidecar } = dubleDoSidecar(() => ({ ok: true, sampleRate: 0, pcm: [], fonemas: [] }))
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    await expect(engine.speak('Bom dia', FABER.id)).rejects.toThrow(/vazio/i)
  })

  it('sobrevive a resposta malformada do sidecar', async () => {
    // A resposta vem de outro processo. Forma inesperada tem que virar erro tratado, não crash do
    // main — é a mesma régua do `ok` do conector que não garante forma.
    const { sidecar } = dubleDoSidecar(() => ({ ok: true, sampleRate: 'muitos', pcm: 'áudio' }))
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    const desfecho = await falar(engine, 'Bom dia', FABER.id)

    expect(desfecho.estado).toBe('falhou')
  })

  it('encerra o sidecar e esquece a configuração', async () => {
    const { sidecar } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    await engine.speak('um', FABER.id)
    await engine.encerrar()
    await engine.speak('dois', FABER.id)

    expect(sidecar.encerrar).toHaveBeenCalled()
  })
})

describe('falar traduz tudo em desfecho tratado', () => {
  it('recusa texto vazio sem acordar o sidecar', async () => {
    // O spike mediu: string vazia devolve zero chunks no Piper. Chamar o engine gastaria o `load`
    // de 1,2 s para receber um erro que culpa o engine por um acidente de quem chamou.
    const { sidecar, pedidos } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    expect(await falar(engine, '   ', FABER.id)).toEqual({ estado: 'sem-texto' })
    expect(pedidos).toEqual([])
  })

  it('distingue voz não baixada de falha de síntese', async () => {
    // Desfechos diferentes porque as ações são diferentes: `indisponivel` pede **baixar**,
    // `falhou` pede **tentar de novo**. Fundir os dois daria à primeira execução a ação errada.
    const { sidecar } = dubleDoSidecar(respostaComAlinhamento)
    const semVoz = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => false })

    expect(await falar(semVoz, 'Bom dia', FABER.id)).toEqual({ estado: 'indisponivel' })
  })

  it('devolve ok com o handle quando tudo funciona', async () => {
    const { sidecar } = dubleDoSidecar(respostaComAlinhamento)
    const engine = criarEnginePiper({ sidecar, vozes: () => [FABER], existe: () => true })

    const desfecho = await falar(engine, 'Bom dia', FABER.id)

    expect(desfecho.estado).toBe('ok')
    if (desfecho.estado === 'ok') {
      expect(desfecho.fala.timeline).toBe('exato')
      expect(desfecho.fala.pcm.length).toBe(2205)
    }
  })
})
