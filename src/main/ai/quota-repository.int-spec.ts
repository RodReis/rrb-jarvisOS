import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../storage/migrations'
import { QuotaRepository } from './quota-repository'

describe('QuotaRepository', () => {
  let db: InstanceType<typeof Database>
  let repo: QuotaRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
    repo = new QuotaRepository(db)
  })

  it('ausência de linha é undefined, não erro', () => {
    expect(repo.ler('u1', 'ws1' as never, 'claude-code')).toBeUndefined()
  })

  it('grava e lê de volta o estado completo', () => {
    const agora = new Date('2026-09-02T10:00:00.000Z')
    repo.gravar(
      'u1',
      'ws1' as never,
      {
        provider: 'claude-code',
        origem: 'medida',
        restante: 42,
        limite: 100,
        resetEm: '2026-09-02T12:00:00.000Z',
        atualizadoEm: agora.toISOString()
      },
      agora
    )

    const lido = repo.ler('u1', 'ws1' as never, 'claude-code')
    expect(lido).toEqual({
      provider: 'claude-code',
      origem: 'medida',
      restante: 42,
      limite: 100,
      resetEm: '2026-09-02T12:00:00.000Z',
      atualizadoEm: agora.toISOString()
    })
  })

  it('gravar de novo sobrescreve, nunca duplica linha', () => {
    const t1 = new Date('2026-09-02T10:00:00.000Z')
    const t2 = new Date('2026-09-02T11:00:00.000Z')
    repo.gravar('u1', 'ws1' as never, { provider: 'claude-code', origem: 'desconhecida', atualizadoEm: t1.toISOString() }, t1)
    repo.gravar('u1', 'ws1' as never, { provider: 'claude-code', origem: 'medida', restante: 5, atualizadoEm: t2.toISOString() }, t2)

    const lido = repo.ler('u1', 'ws1' as never, 'claude-code')
    expect(lido?.origem).toBe('medida')
    expect(lido?.restante).toBe(5)

    const contagem = db.prepare('SELECT COUNT(*) as n FROM provider_quota_state').get() as { n: number }
    expect(contagem.n).toBe(1)
  })

  it('escopos distintos (workspace, provider) não colidem', () => {
    const agora = new Date('2026-09-02T10:00:00.000Z')
    repo.gravar('u1', 'ws1' as never, { provider: 'claude-code', origem: 'medida', restante: 1, atualizadoEm: agora.toISOString() }, agora)
    repo.gravar('u1', 'ws2' as never, { provider: 'claude-code', origem: 'medida', restante: 2, atualizadoEm: agora.toISOString() }, agora)

    expect(repo.ler('u1', 'ws1' as never, 'claude-code')?.restante).toBe(1)
    expect(repo.ler('u1', 'ws2' as never, 'claude-code')?.restante).toBe(2)
  })
})
