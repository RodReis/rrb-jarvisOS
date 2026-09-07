import { describe, expect, it, vi } from 'vitest'
import {
  artefatosFaltando,
  instalarRuntime,
  CAMINHO_DO_SCRIPT,
  DIRETORIO_DO_RUNTIME,
  MARCA_DE_WHEELS,
  type DepsDaInstalacao
} from './instalacao'
import { SCRIPT_DO_SIDECAR } from './script-do-sidecar'
import type { Artefato } from './download-de-artefato'

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
  },
  {
    id: 'modelo-whisper-small-model',
    grupo: 'modelo',
    url: 'https://exemplo.invalido/model.bin',
    sha256: 'c',
    destino: 'voz/models/whisper-small/model.bin'
  }
]

/** Um disco de mentira: o conjunto de caminhos que existem. */
function deps(presentes: Set<string>, extra: Partial<DepsDaInstalacao> = {}): DepsDaInstalacao {
  return {
    existe: vi.fn(async (p: string) => presentes.has(p)),
    extrair: vi.fn(async (_o: string, d: string) => void presentes.add(d)),
    escrever: vi.fn(async (p: string) => void presentes.add(p)),
    rodarPython: vi.fn(async () => undefined),
    absoluto: (p: string) => `C:/userData/${p}`,
    ...extra
  }
}

/** Tudo baixado, nada instalado — o estado logo depois dos downloads. */
function baixado(): Set<string> {
  return new Set(CATALOGO.map((a) => a.destino))
}

describe('prontidão — a pergunta é sobre o disco (critério 4)', () => {
  it('lista os ids do que falta, não um booleano', async () => {
    // A tela precisa dizer **o que** baixar na primeira execução; `pronta: false` a obrigaria a
    // adivinhar.
    const faltando = await artefatosFaltando(CATALOGO, async () => false)

    expect(faltando).toEqual([
      'runtime-python',
      'wheel-faster-whisper',
      'modelo-whisper-small-model'
    ])
  })

  it('vazia quando está tudo no lugar', async () => {
    const presentes = baixado()

    expect(await artefatosFaltando(CATALOGO, async (p) => presentes.has(p))).toEqual([])
  })

  it('acusa o que sumiu depois de baixado', async () => {
    // Anotação de "instalado" diria que está pronto; o disco diz a verdade.
    const presentes = baixado()
    presentes.delete('voz/models/whisper-small/model.bin')

    expect(await artefatosFaltando(CATALOGO, async (p) => presentes.has(p))).toEqual([
      'modelo-whisper-small-model'
    ])
  })
})

describe('instalação — recusa começar pela metade', () => {
  it('não extrai nem instala se faltar artefato', async () => {
    // Um runtime instalado pela metade é pior que nenhum: `disponivel()` passaria a mentir.
    const d = deps(new Set())

    const r = await instalarRuntime(CATALOGO, d)

    expect(r.estado).toBe('faltam-artefatos')
    expect(d.extrair).not.toHaveBeenCalled()
    expect(d.rodarPython).not.toHaveBeenCalled()
  })

  it('diz quais artefatos faltam', async () => {
    const presentes = baixado()
    presentes.delete('voz/wheels/fw.whl')

    const r = await instalarRuntime(CATALOGO, deps(presentes))

    expect(r.estado === 'faltam-artefatos' && r.ids).toEqual(['wheel-faster-whisper'])
  })
})

describe('instalação — caminho completo', () => {
  it('extrai, instala as wheels e escreve o script', async () => {
    const d = deps(baixado())

    const r = await instalarRuntime(CATALOGO, d)

    expect(r.estado).toBe('ok')
    expect(d.extrair).toHaveBeenCalledWith('voz/runtime/py.tar.gz', DIRETORIO_DO_RUNTIME)
    expect(d.rodarPython).toHaveBeenCalled()
    expect(d.escrever).toHaveBeenCalledWith(CAMINHO_DO_SCRIPT, SCRIPT_DO_SIDECAR)
  })

  it('o pip não vai à rede buscar dependência nenhuma', async () => {
    // `--no-index` e `--no-deps` são o que mantém o catálogo pinado sendo a verdade: sem eles o
    // pip resolveria e traria bytes que nenhum hash verificou.
    const d = deps(baixado())

    await instalarRuntime(CATALOGO, d)

    const args = (d.rodarPython as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args).toContain('--no-index')
    expect(args).toContain('--no-deps')
    expect(args).toContain('C:/userData/voz/wheels/fw.whl')
  })

  it('instala só as wheels, nunca o modelo nem o tarball', async () => {
    const d = deps(baixado())

    await instalarRuntime(CATALOGO, d)

    const args = (d.rodarPython as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args.join(' ')).not.toContain('model.bin')
    expect(args.join(' ')).not.toContain('py.tar.gz')
  })
})

describe('instalação — idempotente, e por isso retomável', () => {
  it('não extrai de novo o que já foi extraído', async () => {
    const presentes = baixado()
    presentes.add(DIRETORIO_DO_RUNTIME)
    const d = deps(presentes)

    await instalarRuntime(CATALOGO, d)

    expect(d.extrair).not.toHaveBeenCalled()
  })

  it('não reinstala as wheels quando a marca existe', async () => {
    const presentes = baixado()
    presentes.add(DIRETORIO_DO_RUNTIME)
    presentes.add(MARCA_DE_WHEELS)
    const d = deps(presentes)

    await instalarRuntime(CATALOGO, d)

    expect(d.rodarPython).not.toHaveBeenCalled()
  })

  it('reescreve o script mesmo com tudo instalado', async () => {
    // Ele é a única peça que muda junto com o código do app: uma versão velha no disco falaria
    // um protocolo que o `Sidecar` não fala mais.
    const presentes = baixado()
    presentes.add(DIRETORIO_DO_RUNTIME)
    presentes.add(MARCA_DE_WHEELS)
    const d = deps(presentes)

    await instalarRuntime(CATALOGO, d)

    expect(d.escrever).toHaveBeenCalledWith(CAMINHO_DO_SCRIPT, SCRIPT_DO_SIDECAR)
  })
})

describe('instalação — falha não deixa marca mentindo', () => {
  it('pip que falha não escreve a marca de wheels instaladas', async () => {
    // Com a marca escrita antes, a execução seguinte pularia o passo e o sidecar subiria num
    // runtime sem faster-whisper — falha adiada, e no lugar mais confuso possível.
    const d = deps(baixado(), {
      rodarPython: vi.fn(async () => {
        throw new Error('pip saiu com código 1')
      })
    })

    const r = await instalarRuntime(CATALOGO, d)

    expect(r.estado).toBe('falhou')
    const escritos = (d.escrever as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(escritos).not.toContain(MARCA_DE_WHEELS)
  })

  it('a falha volta com o motivo, para a tela ter o que dizer', async () => {
    const d = deps(baixado(), {
      extrair: vi.fn(async () => {
        throw new Error('tarball corrompido')
      })
    })

    const r = await instalarRuntime(CATALOGO, d)

    expect(r.estado === 'falhou' && r.motivo).toContain('corrompido')
  })
})
