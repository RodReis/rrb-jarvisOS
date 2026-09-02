import { describe, expect, it } from 'vitest'
import { ledgerCompleto, resumoDoLedger } from './execution-ledger'
import type { ExecutionLedger } from './execution-ledger'

const base: ExecutionLedger = {
  runId: 'run-1',
  userId: 'user-1',
  projectId: 'proj-1',
  estadoFinal: 'MERGED',
  duracaoMs: 1000,
  tentativas: 1,
  tokens: 100,
  creditos: 2,
  custoUsd: 0.5,
  eventos: [{ em: '2026-09-02T00:00:00.000Z', oQue: 'run-iniciado' }],
  headSha: 'a'.repeat(40),
  mergeSha: 'b'.repeat(40),
  checks: [{ nome: 'validacao', conclusao: 'success' }],
  artefatos: [],
  encerradoEm: '2026-09-02T00:10:00.000Z'
}

describe('ledgerCompleto', () => {
  it('aceita MERGED com head, merge e checks coerentes', () => {
    expect(ledgerCompleto(base)).toBe(true)
  })

  it('recusa MERGED sem merge SHA — o critério 1 não admite merge deduzido', () => {
    expect(ledgerCompleto({ ...base, mergeSha: undefined })).toBe(false)
  })

  it('recusa MERGED sem head SHA — sem ele não há o que comparar com o merge', () => {
    expect(ledgerCompleto({ ...base, headSha: undefined })).toBe(false)
  })

  it('recusa MERGED sem check algum: merge sem verificação não é coerente', () => {
    expect(ledgerCompleto({ ...base, checks: [] })).toBe(false)
  })

  it('aceita AWAITING_MERGE sem merge SHA — é terminal legítimo, não falha', () => {
    const esperando: ExecutionLedger = {
      ...base,
      estadoFinal: 'AWAITING_MERGE',
      mergeSha: undefined
    }
    expect(ledgerCompleto(esperando)).toBe(true)
  })

  it('recusa artefato sem hash: prova referenciada por caminho some quando o arquivo sai', () => {
    const semHash: ExecutionLedger = {
      ...base,
      artefatos: [{ nome: 'reports/TESTS.md', hash: '   ', bytes: 10 }]
    }
    expect(ledgerCompleto(semHash)).toBe(false)
  })
})

describe('resumoDoLedger', () => {
  it('devolve o que a tela mostra sem log técnico', () => {
    const resumo = resumoDoLedger(base)
    expect(resumo.estadoFinal).toBe('MERGED')
    expect(resumo.custoUsd).toBe(0.5)
    expect(resumo.duracaoMs).toBe(1000)
    expect(resumo.artefatos).toHaveLength(0)
  })
})
