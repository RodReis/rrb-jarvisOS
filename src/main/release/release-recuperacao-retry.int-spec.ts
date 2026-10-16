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
 * Retry, reconciliação e parada com evidência (SPEC-Release-05: regras 1–3; critérios 1 e 3).
 * Banco SQLite real e nuvem falsa com estado: um retry que duplicasse deployment apareceria como
 * `backendHistory` com dois itens, não como mock que responde igual a tudo.
 */

let h: Harness

afterEach(() => h.fechar())

const chamadas = (operacao: string): number => h.cloud.calls.filter((c) => c === operacao).length
const passo = (releaseId: string, nome: string, ambiente: 'staging' | 'production' = 'staging') =>
  h.repository.getStep({ ...SCOPE, releaseId, environment: ambiente }, nome)

describe('timeout depois de sucesso remoto (critério 1)', () => {
  it('reconcilia contra o provedor e não implanta duas vezes', async () => {
    h = montarHarness()
    h.cloud.failAfter('backend.deploy:staging', 'timeout')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(chamadas('backend.deploy:staging')).toBe(1)
    expect(h.cloud.backendHistory.filter((b) => b.environment === 'staging')).toHaveLength(1)
    expect(h.cloud.calls).toContain('backend.current:staging')
    expect(passo(r.releaseId, 'backend_healthy')).toMatchObject({ state: 'confirmed', attempt: 1 })
  })

  it('o mesmo vale para a atribuição do frontend em Produção', async () => {
    h = montarHarness()
    h.cloud.failAfter('frontend.assign:production', 'timeout')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(chamadas('frontend.assign:production')).toBe(1)
    expect(h.cloud.frontendAssigned.get('production')).toBe(
      h.promotion.getDeployment(SCOPE, r.releaseId, 'production', 'frontend')!.externalId
    )
  })
})

describe('falha transitória: até três tentativas com backoff (regra 1)', () => {
  it('uma falha transitória é repetida e a release conclui', async () => {
    h = montarHarness()
    h.cloud.failOn('backend.deploy:staging', 'quota', 1)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    expect(chamadas('backend.deploy:staging')).toBe(2)
    expect(passo(r.releaseId, 'backend_healthy')).toMatchObject({ state: 'confirmed', attempt: 2 })
    expect(h.recovery.evidence(SCOPE, r.releaseId)).toContainEqual(
      expect.objectContaining({
        kind: 'retry',
        step: 'backend_healthy',
        reason: 'backend_healthy-quota'
      })
    )
  })

  it('a terceira tentativa ainda vale; a quarta nunca acontece', async () => {
    h = montarHarness()
    h.cloud.failOn('backend.deploy:staging', 'quota', 2)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('completed')
    expect(passo(r.releaseId, 'backend_healthy')?.attempt).toBe(3)
  })

  it('espera mais a cada tentativa: o backoff passa pelo relógio injetado', async () => {
    const esperas: number[] = []
    h = montarHarness({
      sleep: async (ms) => {
        esperas.push(ms)
        await h.clock.sleep(ms)
      }
    })
    h.cloud.failOn('backend.deploy:staging', 'quota', 2)
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const antesDaEstabilizacao = esperas.slice(0, 2)
    expect(antesDaEstabilizacao).toEqual([2_000, 8_000])
  })

  it('três tentativas esgotadas param com causa, evidência e ação mínima', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'quota', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({
      state: 'failed',
      environment: 'staging',
      reason: 'backend_healthy-quota'
    })
    expect(chamadas('backend.deploy:staging')).toBe(3)
    expect(passo(r.releaseId, 'backend_healthy')).toMatchObject({ state: 'failed', attempt: 3 })
    expect(h.recovery.evidence(SCOPE, r.releaseId)).toContainEqual(
      expect.objectContaining({
        kind: 'retries-exhausted',
        state: 'failed',
        environment: 'staging',
        step: 'backend_healthy',
        reason: 'backend_healthy-quota',
        action: 'check-provider-status',
        details: { attempts: 3 }
      })
    )
    // Falha transitória não é defeito de código: nada volta à V2.
    expect(h.recovery.correction(SCOPE, r.releaseId)).toBeNull()
  })

  it('o limite é por passo e sobrevive à retomada: o passo esgotado não ganha novas tentativas', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'quota', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('failed')

    const depois = await h.novoServico().promote(SCOPE, r.releaseId, projeto())
    expect(depois.state).toBe('failed')
    expect(chamadas('backend.deploy:staging')).toBe(3)
  })

  it('falha definitiva não é repetida', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'failed', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('failed')
    expect(chamadas('backend.deploy:staging')).toBe(1)
    expect(h.recovery.evidence(SCOPE, r.releaseId).map((e) => e.kind)).not.toContain('retry')
  })

  it('autenticação inválida bloqueia na hora: repetir não conserta credencial', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'auth', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r).toMatchObject({ state: 'failed', reason: 'backend_healthy-auth' })
    expect(chamadas('backend.deploy:staging')).toBe(1)
  })
})

describe('efeito incerto: reconcilia antes de repetir (regra 2)', () => {
  it('timeout antes do efeito: o provedor não tem o deployment, então a repetição é segura', async () => {
    h = montarHarness()
    h.cloud.failOn('backend.deploy:staging', 'timeout', 1)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('completed')
    const calls = h.cloud.calls
    expect(calls.indexOf('backend.current:staging')).toBeGreaterThan(-1)
    expect(calls.indexOf('backend.current:staging')).toBeLessThan(
      calls.lastIndexOf('backend.deploy:staging')
    )
    expect(h.cloud.backendHistory.filter((b) => b.environment === 'staging')).toHaveLength(1)
  })

  it('reconciliação que não consegue responder bloqueia sem compensar nem repetir às cegas', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'timeout', 1)
    h.cloud.failOn('backend.current:staging', 'timeout', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'blocked', environment: 'staging', step: 'backend_healthy' })
    expect(chamadas('backend.deploy:staging')).toBe(1)
    expect(passo(r.releaseId, 'backend_healthy')?.state).toBe('ambiguous')
    expect(h.promotion.listCompensations(SCOPE, r.releaseId)).toEqual([])
    expect(h.recovery.evidence(SCOPE, r.releaseId)).toContainEqual(
      expect.objectContaining({
        kind: 'retries-exhausted',
        state: 'ambiguous',
        step: 'backend_healthy',
        action: 'check-provider-status'
      })
    )
  })

  it('a retomada seguinte reconcilia de novo e conclui quando o provedor volta', async () => {
    h = montarHarness()
    h.cloud.failAfter('backend.deploy:staging', 'timeout', 1)
    h.cloud.failOn('backend.current:staging', 'timeout', 3)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('blocked')

    const retomada = await h.novoServico().promote(SCOPE, r.releaseId, projeto())
    expect(retomada.state).toBe('completed')
    expect(h.cloud.backendHistory.filter((b) => b.environment === 'staging')).toHaveLength(1)
  })
})
