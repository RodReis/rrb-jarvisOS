import { describe, expect, it } from 'vitest'
import { COTA_BYTES, RETENCAO_DIAS, elegiveisParaExpirar } from './retencao'
import type { ArtefatoRetido } from './retencao'

const DIA_MS = 24 * 60 * 60 * 1000
const AGORA = Date.parse('2026-09-02T00:00:00.000Z')

function item(over: Partial<ArtefatoRetido>): ArtefatoRetido {
  return {
    id: 'a1',
    runId: 'run-1',
    hash: 'h'.repeat(64),
    bytes: 1024,
    criadoEm: new Date(AGORA - DIA_MS).toISOString(),
    fixado: false,
    estadoDoRun: 'MERGED',
    ...over
  }
}

describe('elegiveisParaExpirar', () => {
  it('expira o que passou de 30 dias', () => {
    const velho = item({ id: 'velho', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })
    const novo = item({ id: 'novo' })
    expect(elegiveisParaExpirar([velho, novo], AGORA).map((i) => i.id)).toEqual(['velho'])
  })

  it('nunca expira item fixado, por mais velho que seja', () => {
    const fixado = item({
      id: 'fixado',
      fixado: true,
      criadoEm: new Date(AGORA - 900 * DIA_MS).toISOString()
    })
    expect(elegiveisParaExpirar([fixado], AGORA)).toEqual([])
  })

  it('nunca expira artefato de run ativo, bloqueado ou pendente', () => {
    const naoResolvidos = ['RUNNING', 'PR_CI', 'BLOCKED', 'AWAITING_MERGE'] as const
    for (const estado of naoResolvidos) {
      const preso = item({
        id: estado,
        estadoDoRun: estado,
        criadoEm: new Date(AGORA - 400 * DIA_MS).toISOString()
      })
      expect(elegiveisParaExpirar([preso], AGORA)).toEqual([])
    }
  })

  it('estourada a cota, remove primeiro o elegível mais antigo', () => {
    const metadeDaCota = Math.floor(COTA_BYTES / 2) + 1
    const antigo = item({
      id: 'antigo',
      bytes: metadeDaCota,
      criadoEm: new Date(AGORA - 3 * DIA_MS).toISOString()
    })
    const recente = item({
      id: 'recente',
      bytes: metadeDaCota,
      criadoEm: new Date(AGORA - 1 * DIA_MS).toISOString()
    })
    expect(elegiveisParaExpirar([recente, antigo], AGORA).map((i) => i.id)).toEqual(['antigo'])
  })

  it('a cota não força expirar item protegido — protegido sai da conta, não da proteção', () => {
    const protegido = item({ id: 'p', bytes: COTA_BYTES * 2, estadoDoRun: 'RUNNING' })
    expect(elegiveisParaExpirar([protegido], AGORA)).toEqual([])
  })

  it('protegido que sozinho estoura a cota não arrasta o vizinho resolvido e novo', () => {
    // O protegido ocupa disco, mas não entra na conta da cota: incluí-lo faria um run travado
    // condenar todo o resto, que é remoção em cascata por culpa alheia.
    const protegido = item({ id: 'p', bytes: COTA_BYTES * 2, estadoDoRun: 'BLOCKED' })
    const novoResolvido = item({ id: 'n', bytes: 10 })
    expect(elegiveisParaExpirar([protegido, novoResolvido], AGORA)).toEqual([])
  })

  it('cabe na cota e dentro da idade: nada sai', () => {
    expect(elegiveisParaExpirar([item({})], AGORA)).toEqual([])
  })

  it('RETENCAO_DIAS e COTA_BYTES são os valores que a spec fixa', () => {
    expect(RETENCAO_DIAS).toBe(30)
    expect(COTA_BYTES).toBe(5 * 1024 ** 3)
  })
})
