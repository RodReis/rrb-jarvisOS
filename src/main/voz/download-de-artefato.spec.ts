import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  baixarArtefato,
  type Artefato,
  type CorpoDoDownload,
  type DepsDoDownload
} from './download-de-artefato'

const CONTEUDO = Buffer.from('conteudo do runtime de voz')
const SHA_CERTO = createHash('sha256').update(CONTEUDO).digest('hex')

/** Um corpo em pedaços, como a origem entrega. Vários pedaços por padrão, que é o caso real. */
function corpo(dados: Buffer, pedacos = 3, totalBytes?: number): CorpoDoDownload {
  const tamanho = Math.ceil(dados.length / pedacos)

  return {
    totalBytes,
    pedacos: (async function* () {
      for (let i = 0; i < dados.length; i += tamanho) yield dados.subarray(i, i + tamanho)
    })()
  }
}

/** Consome o gerador como o disco consumiria — sem isso o hash nunca vê byte nenhum. */
async function consumir(pedacos: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _ of pedacos) void _
}

function artefato(extra: Partial<Artefato> = {}): Artefato {
  return {
    id: 'runtime-python',
    grupo: 'runtime',
    url: 'https://exemplo.invalido/python.tar.gz',
    sha256: SHA_CERTO,
    destino: 'models/python.tar.gz',
    ...extra
  }
}

function deps(extra: Partial<DepsDoDownload> = {}): DepsDoDownload {
  return {
    buscar: vi.fn(async () => corpo(CONTEUDO)),
    gravarPedacos: vi.fn(async (_destino, pedacos) => consumir(pedacos)),
    promover: vi.fn(async () => undefined),
    apagar: vi.fn(async () => undefined),
    auditar: vi.fn(),
    permitido: () => true,
    ...extra
  }
}

describe('download de artefato — caminho feliz (critério 4)', () => {
  it('grava quando o hash confere', async () => {
    const d = deps()

    const r = await baixarArtefato(artefato(), d)

    expect(r.estado).toBe('ok')
    expect(d.promover).toHaveBeenCalled()
  })

  it('audita antes e depois — a ação é sensível (rede + disco)', async () => {
    const d = deps()

    await baixarArtefato(artefato(), d)

    const tipos = (d.auditar as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].type)
    expect(tipos).toEqual(['voz.download.inicio', 'voz.download.fim'])
  })
})

describe('download de artefato — hash divergente (critério 4)', () => {
  const OUTRO = Buffer.from('conteudo adulterado')

  it('rejeita, apaga e informa', async () => {
    const d = deps({ buscar: vi.fn(async () => corpo(OUTRO)) })

    const r = await baixarArtefato(artefato(), d)

    expect(r.estado).toBe('hash-divergente')
    // Apagar é parte do critério: um arquivo com hash errado no disco seria usado na próxima
    // execução como se estivesse íntegro.
    expect(d.apagar).toHaveBeenCalled()
  })

  it('o evento de fim registra a recusa, não um sucesso', async () => {
    const d = deps({ buscar: vi.fn(async () => corpo(OUTRO)) })

    await baixarArtefato(artefato(), d)

    const fim = (d.auditar as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(fim.type).toBe('voz.download.fim')
    expect(fim.payload.estado).toBe('hash-divergente')
  })

  it('o hash esperado e o obtido vão para a auditoria, não só "falhou"', async () => {
    // Sem os dois números, investigar depois exige repetir o download — e o artefato adulterado
    // já foi apagado. A auditoria é a única testemunha que sobra.
    const d = deps({ buscar: vi.fn(async () => corpo(OUTRO)) })

    await baixarArtefato(artefato(), d)

    const fim = (d.auditar as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(fim.payload.esperado).toBe(SHA_CERTO)
    expect(typeof fim.payload.obtido).toBe('string')
    expect(fim.payload.obtido).not.toBe(SHA_CERTO)
  })
})

describe('download de artefato — a URL passa pelo Policy Engine', () => {
  it('URL fora da allowlist é bloqueada antes de qualquer rede', async () => {
    // Fail closed (CLAUDE.md): o que a política não reconhece não acontece. E **antes** da
    // rede, senão o bloqueio chegaria depois de o byte já ter atravessado.
    const d = deps({ permitido: () => false })

    const r = await baixarArtefato(artefato({ url: 'https://outro.invalido/x' }), d)

    expect(r.estado).toBe('bloqueado')
    expect(d.buscar).not.toHaveBeenCalled()
  })

  it('falha de rede vira desfecho tratado, com o motivo', async () => {
    const d = deps({
      buscar: vi.fn(async () => {
        throw new Error('sem conexão')
      })
    })

    const r = await baixarArtefato(artefato(), d)

    expect(r.estado).toBe('falhou')
    expect(r.estado === 'falhou' && r.motivo).toContain('conexão')
  })

  it('falha de rede também fecha o par de auditoria', async () => {
    // Evento de início sem fim deixaria a cadeia sugerindo download em curso para sempre.
    const d = deps({
      buscar: vi.fn(async () => {
        throw new Error('sem conexão')
      })
    })

    await baixarArtefato(artefato(), d)

    const tipos = (d.auditar as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].type)
    expect(tipos).toEqual(['voz.download.inicio', 'voz.download.fim'])
  })
})

describe('download de artefato — o arquivo ruim nunca toca o destino (critério 4)', () => {
  const OUTRO = Buffer.from('conteudo adulterado')

  it('grava no temporário, não no destino final', async () => {
    // O byte chega ao disco antes de haver hash para conferir. Se ele chegasse no caminho
    // definitivo, a execução seguinte o encontraria e o usaria como íntegro — que é exatamente
    // o modo de falha que a verificação existe para fechar.
    const d = deps()

    await baixarArtefato(artefato(), d)

    const destinoGravado = (d.gravarPedacos as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(destinoGravado).not.toBe('models/python.tar.gz')
    expect(destinoGravado).toContain('.parcial')
  })

  it('promove ao destino só depois de o hash conferir', async () => {
    const d = deps()

    await baixarArtefato(artefato(), d)

    expect(d.promover).toHaveBeenCalledWith('models/python.tar.gz.parcial', 'models/python.tar.gz')
  })

  it('hash divergente apaga o temporário e nunca promove', async () => {
    const d = deps({ buscar: vi.fn(async () => corpo(OUTRO)) })

    const r = await baixarArtefato(artefato(), d)

    expect(r.estado).toBe('hash-divergente')
    expect(d.promover).not.toHaveBeenCalled()
    expect(d.apagar).toHaveBeenCalledWith('models/python.tar.gz.parcial')
  })

  it('download interrompido no meio não deixa parcial para trás', async () => {
    // Sem isto, a tentativa seguinte encontraria um arquivo truncado no caminho do temporário e
    // uma retomada ingênua o trataria como completo.
    const d = deps({
      gravarPedacos: vi.fn(async () => {
        throw new Error('disco cheio')
      })
    })

    const r = await baixarArtefato(artefato(), d)

    expect(r.estado).toBe('falhou')
    expect(d.apagar).toHaveBeenCalledWith('models/python.tar.gz.parcial')
  })
})

describe('download de artefato — progresso (critério 4)', () => {
  it('reporta o quanto já veio, pedaço a pedaço', async () => {
    const vistos: number[] = []
    const d = deps({ progresso: (p) => vistos.push(p.baixados) })

    await baixarArtefato(artefato(), d)

    // Crescente e terminando no tamanho total: uma barra que anda, não um salto de 0 a 100.
    expect(vistos.length).toBeGreaterThan(1)
    expect(vistos).toEqual([...vistos].sort((a, b) => a - b))
    expect(vistos.at(-1)).toBe(CONTEUDO.length)
  })

  it('leva o grupo junto, para a tela saber do que é a barra', async () => {
    const vistos: { artefato: string; grupo: string }[] = []
    const d = deps({ progresso: (p) => vistos.push({ artefato: p.artefato, grupo: p.grupo }) })

    await baixarArtefato(artefato({ id: 'modelo-whisper-small-model', grupo: 'modelo' }), d)

    // Afirmar dentro do callback não prova nada: se ele nunca é chamado, o teste passa calado.
    expect(vistos.length).toBeGreaterThan(0)
    expect(vistos.every((v) => v.grupo === 'modelo')).toBe(true)
    expect(vistos.every((v) => v.artefato === 'modelo-whisper-small-model')).toBe(true)
  })

  it('origem que não declara tamanho deixa o total indefinido, não zero', async () => {
    // Zero seria um número, e a tela desenharia uma barra parada em 0% em vez de dizer que não
    // sabe o tamanho.
    const totais: (number | undefined)[] = []
    const d = deps({
      buscar: vi.fn(async () => corpo(CONTEUDO)),
      progresso: (p) => totais.push(p.totalBytes)
    })

    await baixarArtefato(artefato(), d)

    expect(totais.length).toBeGreaterThan(0)
    expect(totais.every((t) => t === undefined)).toBe(true)
  })

  it('quando a origem declara o tamanho, ele acompanha cada aviso', async () => {
    const totais: (number | undefined)[] = []
    const d = deps({
      buscar: vi.fn(async () => corpo(CONTEUDO, 3, CONTEUDO.length)),
      progresso: (p) => totais.push(p.totalBytes)
    })

    await baixarArtefato(artefato(), d)

    expect(totais.length).toBeGreaterThan(0)
    expect(totais.every((t) => t === CONTEUDO.length)).toBe(true)
  })
})
