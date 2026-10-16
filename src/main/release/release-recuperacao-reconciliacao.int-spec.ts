import { afterEach, describe, expect, it } from 'vitest'
import {
  SCOPE,
  SHA_A,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

/**
 * Reconciliação de `prepared` e `database_migrated` (SPEC-Release-05): na F04 esses dois passos
 * ficavam sem reconciliação automática. Agora o banco e os artefatos respondem o que já aconteceu,
 * e um resultado incerto nunca repete o que o provedor já aplicou.
 */

let h: Harness

afterEach(() => h.fechar())

const chamadas = (operacao: string): number => h.cloud.calls.filter((c) => c === operacao).length
const migrations = (releaseId: string, ambiente: 'staging' | 'production') =>
  h.promotion.listMigrations(SCOPE, releaseId).filter((m) => m.environment === ambiente)
const gate = (releaseId: string, ambiente: 'staging' | 'production', nome: string) =>
  h.repository
    .detail({ ...SCOPE, releaseId })!
    .gates.filter((g) => g.environment === ambiente && g.gate === nome)
    .at(-1)

describe('database_migrated incerto é reconciliado no banco', () => {
  it('migration aplicada cuja resposta se perdeu é reconhecida: não roda duas vezes', async () => {
    h = montarHarness()
    h.cloud.failAfter('database.migrate:staging', 'timeout')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(chamadas('database.migrate:staging')).toBe(1)
    expect(chamadas('database.applied:staging')).toBeGreaterThan(0)
    expect(migrations(r.releaseId, 'staging').map((m) => m.state)).toEqual([
      'confirmed',
      'confirmed'
    ])
    // O gate obrigatório não pode ficar sem registro só porque a resposta se perdeu.
    expect(gate(r.releaseId, 'staging', 'migration')).toMatchObject({ result: 'passed' })
  })

  it('em Produção o backup anterior à migration continua registrado e não é refeito', async () => {
    h = montarHarness()
    h.cloud.failAfter('database.migrate:production', 'timeout')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(chamadas('database.backup:production')).toBe(1)
    expect(chamadas('database.migrate:production')).toBe(1)
    expect(
      migrations(r.releaseId, 'production').every((m) => m.backupRef === 'bkp-production-1')
    ).toBe(true)
    expect(gate(r.releaseId, 'production', 'backup')).toMatchObject({ result: 'passed' })
  })

  it('migration só parcialmente aplicada é completada pela repetição, sem reaplicar o que existe', async () => {
    h = montarHarness()
    semearReleaseConcluida(h) // o banco já tem 001_init
    h.cloud.databases.set('staging', ['001_init'])
    h.cloud.failOn('database.migrate:staging', 'timeout', 1)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(h.cloud.databases.get('staging')).toEqual(['001_init', '002_users'])
    expect(chamadas('database.migrate:staging')).toBe(2)
  })

  it('banco que não responde à leitura: o passo fica incerto e a migration não repete às cegas', async () => {
    h = montarHarness()
    h.cloud.failAfter('database.migrate:staging', 'timeout')
    h.cloud.failOn('database.applied:staging', 'timeout', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'blocked', environment: 'staging', step: 'database_migrated' })
    expect(chamadas('database.migrate:staging')).toBe(1)
    expect(h.promotion.listCompensations(SCOPE, r.releaseId)).toEqual([])
  })

  it('checksum divergente no banco não é "aplicado": a repetição recusa de forma definitiva', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failAfter('database.migrate:staging', 'timeout')
    // O banco devolve um checksum que o diretório de migrations não tem.
    const original = h.cloud.database.applied
    h.cloud.database.applied = async (input) =>
      (await original(input)).map((m) => ({ ...m, checksum: '9'.repeat(64) }))
    h.cloud.migrationOutcome = {
      state: 'failed',
      reason: 'checksum-divergent',
      failedAt: '001_init',
      applied: []
    }
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'checksum-divergent' })
  })
})

describe('prepared incerto é reconciliado nos artefatos', () => {
  it('build e frontend feitos cuja resposta se perdeu não são refeitos', async () => {
    h = montarHarness()
    h.cloud.failAfter('frontend.build', 'timeout')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(h.cloud.builds).toBe(1)
    expect(h.cloud.frontendBuilds.size).toBe(1)
    const staging = h.promotion.getDeployment(SCOPE, r.releaseId, 'staging', 'frontend')
    const producao = h.promotion.getDeployment(SCOPE, r.releaseId, 'production', 'frontend')
    expect(staging?.externalId).toBe(producao?.externalId)
  })

  it('o artefato já registrado é reaproveitado: a imagem não é construída duas vezes', async () => {
    h = montarHarness()
    h.cloud.failOn('frontend.build', 'timeout', 1)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('completed')
    expect(h.cloud.builds).toBe(1)
  })
})
