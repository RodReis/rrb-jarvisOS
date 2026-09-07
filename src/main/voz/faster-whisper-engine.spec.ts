import { describe, expect, it, vi } from 'vitest'
import { FasterWhisperEngine, type DepsDoEngine } from './faster-whisper-engine'
import type { Sidecar } from './sidecar'
import type { Artefato } from './download-de-artefato'
import type { DepsDaInstalacao } from './instalacao'

const CATALOGO: readonly Artefato[] = [
  {
    id: 'runtime-python',
    grupo: 'runtime',
    url: 'https://exemplo.invalido/py.tar.gz',
    sha256: 'a',
    destino: 'voz/runtime/py.tar.gz'
  },
  {
    id: 'wheel-faster-whisper',
    grupo: 'wheel',
    url: 'https://exemplo.invalido/fw.whl',
    sha256: 'b',
    destino: 'voz/wheels/fw.whl'
  }
]

const RESPOSTA_BOA = {
  ok: true,
  texto: 'bom dia',
  idioma: 'pt',
  segmentos: [{ inicioMs: 0, fimMs: 900, texto: 'bom dia' }]
}

function sidecarFalso(resposta: Record<string, unknown> = RESPOSTA_BOA): {
  sidecar: Sidecar
  pedir: ReturnType<typeof vi.fn>
  encerrar: ReturnType<typeof vi.fn>
} {
  const pedir = vi.fn(async () => resposta)
  const encerrar = vi.fn(async () => undefined)

  return { sidecar: { pedir, encerrar } as unknown as Sidecar, pedir, encerrar }
}

function instalacao(
  presentes: Set<string>,
  extra: Partial<DepsDaInstalacao> = {}
): DepsDaInstalacao {
  return {
    existe: vi.fn(async (p: string) => presentes.has(p)),
    extrair: vi.fn(async (_o: string, d: string) => void presentes.add(d)),
    escrever: vi.fn(async (p: string) => void presentes.add(p)),
    rodarPython: vi.fn(async () => undefined),
    absoluto: (p: string) => `C:/userData/${p}`,
    ...extra
  }
}

function deps(extra: Partial<DepsDoEngine> = {}): DepsDoEngine {
  return {
    artefatos: CATALOGO,
    instalacao: instalacao(new Set(CATALOGO.map((a) => a.destino))),
    criarSidecar: () => sidecarFalso().sidecar,
    lerConfiguracaoBruta: async () => undefined,
    absoluto: (p: string) => `C:/userData/${p}`,
    registrarCompute: vi.fn(),
    ...extra
  }
}

describe('engine — prontidão pergunta ao disco (critério 4)', () => {
  it('indisponível enquanto faltar artefato', async () => {
    const engine = new FasterWhisperEngine(deps({ instalacao: instalacao(new Set()) }))

    expect(await engine.disponivel()).toBe(false)
  })

  it('não tenta instalar com artefato faltando', async () => {
    const inst = instalacao(new Set())
    const engine = new FasterWhisperEngine(deps({ instalacao: inst }))

    await engine.disponivel()

    expect(inst.rodarPython).not.toHaveBeenCalled()
  })

  it('baixado mas não instalado ainda não é pronto — ele instala antes de dizer sim', async () => {
    // Responder `true` para "baixado" deixaria a transcrição seguinte falhar com um erro de
    // import do Python, que é a mensagem mais inútil possível para quem só queria falar.
    const inst = instalacao(new Set(CATALOGO.map((a) => a.destino)))
    const engine = new FasterWhisperEngine(deps({ instalacao: inst }))

    expect(await engine.disponivel()).toBe(true)
    expect(inst.rodarPython).toHaveBeenCalled()
  })

  it('instalação que falha deixa o engine indisponível', async () => {
    const inst = instalacao(new Set(CATALOGO.map((a) => a.destino)), {
      rodarPython: vi.fn(async () => {
        throw new Error('pip falhou')
      })
    })
    const engine = new FasterWhisperEngine(deps({ instalacao: inst }))

    expect(await engine.disponivel()).toBe(false)
  })
})

describe('engine — o áudio vai no pedido, nunca em arquivo (critério 8)', () => {
  it('manda o PCM em base64 dentro da chamada', async () => {
    const { sidecar, pedir } = sidecarFalso()
    const engine = new FasterWhisperEngine(deps({ criarSidecar: () => sidecar }))

    await engine.transcribe(Int16Array.from([1, 2, 3, 4]))

    const pedido = pedir.mock.calls[0][0] as Record<string, unknown>
    expect(pedido.acao).toBe('transcrever')
    expect(typeof pedido.pcm).toBe('string')
    expect(Buffer.from(pedido.pcm as string, 'base64').length).toBe(8)
  })

  it('o engine não escreve nada durante a transcrição', async () => {
    const inst = instalacao(new Set(CATALOGO.map((a) => a.destino)))
    const engine = new FasterWhisperEngine(deps({ instalacao: inst }))

    await engine.transcribe(Int16Array.from([1, 2, 3]))

    expect(inst.escrever).not.toHaveBeenCalled()
  })
})

describe('engine — configuração vale na chamada seguinte (critério 6)', () => {
  it('lê a configuração a cada transcrição, não uma vez só', async () => {
    // É isto que faz "sem restart" ser verdade: não há estado em memória a invalidar quando
    // Settings muda.
    const ler = vi.fn(async () => '{"idioma":"pt"}')
    const engine = new FasterWhisperEngine(deps({ lerConfiguracaoBruta: ler }))

    await engine.transcribe(Int16Array.from([1]))
    await engine.transcribe(Int16Array.from([2]))

    expect(ler).toHaveBeenCalledTimes(2)
  })

  it('o idioma configurado chega no pedido', async () => {
    const { sidecar, pedir } = sidecarFalso()
    const engine = new FasterWhisperEngine(
      deps({ criarSidecar: () => sidecar, lerConfiguracaoBruta: async () => '{"idioma":"en"}' })
    )

    await engine.transcribe(Int16Array.from([1]))

    expect((pedir.mock.calls[0][0] as Record<string, unknown>).idioma).toBe('en')
  })

  it('trocar a configuração entre chamadas muda a chamada seguinte', async () => {
    const { sidecar, pedir } = sidecarFalso()
    let bruto = '{"idioma":"pt"}'
    const engine = new FasterWhisperEngine(
      deps({ criarSidecar: () => sidecar, lerConfiguracaoBruta: async () => bruto })
    )

    await engine.transcribe(Int16Array.from([1]))
    bruto = '{"idioma":"es"}'
    await engine.transcribe(Int16Array.from([2]))

    expect((pedir.mock.calls[0][0] as Record<string, unknown>).idioma).toBe('pt')
    expect((pedir.mock.calls[1][0] as Record<string, unknown>).idioma).toBe('es')
  })
})

describe('engine — um sidecar só, reusado', () => {
  it('não sobe um processo por enunciado', async () => {
    // Carregar o modelo Whisper custa segundos; pagar isso por frase seria o oposto do que a
    // fatia entrega.
    const criar = vi.fn(() => sidecarFalso().sidecar)
    const engine = new FasterWhisperEngine(deps({ criarSidecar: criar }))

    await engine.transcribe(Int16Array.from([1]))
    await engine.transcribe(Int16Array.from([2]))

    expect(criar).toHaveBeenCalledTimes(1)
  })

  it('encerrar mata o sidecar e a chamada seguinte sobe outro', async () => {
    const criar = vi.fn(() => sidecarFalso().sidecar)
    const engine = new FasterWhisperEngine(deps({ criarSidecar: criar }))

    await engine.transcribe(Int16Array.from([1]))
    await engine.encerrar()
    await engine.transcribe(Int16Array.from([2]))

    expect(criar).toHaveBeenCalledTimes(2)
  })

  it('encerrar sem nunca ter transcrito não estoura', async () => {
    await expect(new FasterWhisperEngine(deps()).encerrar()).resolves.toBeUndefined()
  })
})

describe('engine — compute vem do runtime, não de uma sonda daqui (critério 7)', () => {
  it('sem CUDA, reporta cpu-int8 e registra', async () => {
    const registrar = vi.fn()
    const { sidecar } = sidecarFalso({ ok: true, compute: 'cpu-int8' })
    const engine = new FasterWhisperEngine(
      deps({ criarSidecar: () => sidecar, registrarCompute: registrar })
    )

    expect(await engine.sondarCompute()).toBe('cpu-int8')
    expect(registrar).toHaveBeenCalledWith('cpu-int8')
  })

  it('com CUDA, reporta cuda', async () => {
    const { sidecar } = sidecarFalso({ ok: true, compute: 'cuda' })
    const engine = new FasterWhisperEngine(deps({ criarSidecar: () => sidecar }))

    expect(await engine.sondarCompute()).toBe('cuda')
  })

  it('resposta inesperada não vira cuda por acidente', async () => {
    // Fail closed: na dúvida, o modo conservador. Prometer CUDA que não existe faria a UI
    // indicar um desempenho que a máquina não entrega.
    const { sidecar } = sidecarFalso({ ok: true, compute: 'talvez' })
    const engine = new FasterWhisperEngine(deps({ criarSidecar: () => sidecar }))

    expect(await engine.sondarCompute()).toBe('cpu-int8')
  })

  it('antes de sondar, o compute observado é indefinido — não um palpite', async () => {
    expect(new FasterWhisperEngine(deps()).compute).toBeUndefined()
  })
})

describe('engine — resposta de outro processo é lida com desconfiança', () => {
  it('traduz a resposta boa inteira', async () => {
    const { sidecar } = sidecarFalso()
    const engine = new FasterWhisperEngine(deps({ criarSidecar: () => sidecar }))

    const r = await engine.transcribe(Int16Array.from([1]))

    expect(r).toEqual({
      texto: 'bom dia',
      idioma: 'pt',
      segmentos: [{ inicioMs: 0, fimMs: 900, texto: 'bom dia' }]
    })
  })

  it('resposta sem os campos esperados não estoura', async () => {
    // O outro lado é um processo separado; forma inesperada derrubaria a transcrição com um
    // erro sobre `undefined` em vez de devolver o que deu para entender.
    const { sidecar } = sidecarFalso({ ok: true })
    const engine = new FasterWhisperEngine(deps({ criarSidecar: () => sidecar }))

    const r = await engine.transcribe(Int16Array.from([1]))

    expect(r).toEqual({ texto: '', idioma: '', segmentos: [] })
  })

  it('segmento malformado vira segmento neutro, não exceção', async () => {
    const { sidecar } = sidecarFalso({
      ok: true,
      texto: 'oi',
      idioma: 'pt',
      segmentos: [{ texto: 'oi' }, null]
    })
    const engine = new FasterWhisperEngine(deps({ criarSidecar: () => sidecar }))

    const r = await engine.transcribe(Int16Array.from([1]))

    expect(r.segmentos).toEqual([
      { inicioMs: 0, fimMs: 0, texto: 'oi' },
      { inicioMs: 0, fimMs: 0, texto: '' }
    ])
  })
})
