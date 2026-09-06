import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { baixarArtefato, type Artefato, type DepsDoDownload } from './download-de-artefato'

const CONTEUDO = Buffer.from('conteudo do runtime de voz')
const SHA_CERTO = createHash('sha256').update(CONTEUDO).digest('hex')

function artefato(extra: Partial<Artefato> = {}): Artefato {
  return {
    id: 'runtime-python',
    url: 'https://exemplo.invalido/python.tar.gz',
    sha256: SHA_CERTO,
    destino: 'models/python.tar.gz',
    ...extra
  }
}

function deps(extra: Partial<DepsDoDownload> = {}): DepsDoDownload {
  return {
    buscar: vi.fn(async () => CONTEUDO),
    gravar: vi.fn(async () => undefined),
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
    expect(d.gravar).toHaveBeenCalled()
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
    const d = deps({ buscar: vi.fn(async () => OUTRO) })

    const r = await baixarArtefato(artefato(), d)

    expect(r.estado).toBe('hash-divergente')
    // Apagar é parte do critério: um arquivo com hash errado no disco seria usado na próxima
    // execução como se estivesse íntegro.
    expect(d.apagar).toHaveBeenCalled()
  })

  it('o evento de fim registra a recusa, não um sucesso', async () => {
    const d = deps({ buscar: vi.fn(async () => OUTRO) })

    await baixarArtefato(artefato(), d)

    const fim = (d.auditar as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(fim.type).toBe('voz.download.fim')
    expect(fim.payload.estado).toBe('hash-divergente')
  })

  it('o hash esperado e o obtido vão para a auditoria, não só "falhou"', async () => {
    // Sem os dois números, investigar depois exige repetir o download — e o artefato adulterado
    // já foi apagado. A auditoria é a única testemunha que sobra.
    const d = deps({ buscar: vi.fn(async () => OUTRO) })

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
