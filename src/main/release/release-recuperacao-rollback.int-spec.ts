import { afterEach, describe, expect, it } from 'vitest'
import {
  SCOPE,
  SHA_A,
  SHA_B,
  SHA_C,
  montarHarness,
  projeto,
  type Harness
} from './promotion-test-harness'

/**
 * Rollback por `release_id` (SPEC-Release-05, critério 9 e regra 4): restaura frontend e backend
 * de uma release conhecida, prova o resultado na nuvem e nunca toca o banco. A release revertida
 * deixa de ser o destino conhecido das compensações seguintes.
 */

let h: Harness

afterEach(() => h.fechar())

const bancoTocado = (): string[] => h.cloud.calls.filter((c) => c.startsWith('database.'))

/** A e B concluídas, nessa ordem: Produção serve B e A é o destino do rollback. */
async function duasConcluidas(): Promise<{ a: string; b: string }> {
  const a = await h.service.handleMerge(SCOPE, SHA_A, projeto())
  const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
  expect([a.state, b.state]).toEqual(['completed', 'completed'])
  h.clock.sleep(60_000)
  return { a: a.releaseId, b: b.releaseId }
}

describe('rollback para um release_id conhecido', () => {
  it('restaura frontend e backend da release alvo, prova na nuvem e deixa o banco como está', async () => {
    h = montarHarness()
    const { a, b } = await duasConcluidas()
    const alvoBackend = h.promotion.getDeployment(SCOPE, a, 'production', 'backend')!.externalId
    const alvoFrontend = h.promotion.getDeployment(SCOPE, a, 'production', 'frontend')!.externalId
    const banco = bancoTocado()

    const r = await h.service.rollback(SCOPE, { to: a })

    expect(r).toMatchObject({ state: 'rolled-back', from: b, to: a })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe(alvoBackend)
    expect(h.cloud.frontendAssigned.get('production')).toBe(alvoFrontend)
    expect(bancoTocado()).toEqual(banco)
    expect(h.recovery.rollbacks(SCOPE, b)).toEqual([
      expect.objectContaining({ fromReleaseId: b, toReleaseId: a, state: 'confirmed' })
    ])
    expect(h.recovery.evidence(SCOPE, b)).toContainEqual(
      expect.objectContaining({ kind: 'rollback', state: 'confirmed', environment: 'production' })
    )
  })

  it('a prova na nuvem usa a identidade da release alvo (digest e frontend)', async () => {
    h = montarHarness()
    const { a } = await duasConcluidas()
    const pedidos: { digest: string; frontend: string; checks: readonly string[] }[] = []
    const original = h.cloud.verifier.verify
    h.cloud.verifier.verify = async (input) => {
      if (input.environment === 'production')
        pedidos.push({
          digest: input.backendDigest,
          frontend: input.frontendDeploymentId,
          checks: input.checks
        })
      return original(input)
    }
    await h.service.rollback(SCOPE, { to: a })
    const ultimo = pedidos.at(-1)!
    expect(ultimo.digest).toBe(h.local.getArtifact(SCOPE, a, 'backend-image')!.digest)
    expect(ultimo.frontend).toBe(
      h.promotion.getDeployment(SCOPE, a, 'production', 'frontend')!.externalId
    )
    expect([...ultimo.checks].sort()).toEqual(['backend_health', 'frontend_wiring', 'smoke'])
  })

  it('libera a lane de Produção: a próxima release promove normalmente', async () => {
    h = montarHarness()
    const { a } = await duasConcluidas()
    await h.service.rollback(SCOPE, { to: a })
    const c = await h.service.handleMerge(SCOPE, SHA_C, projeto())
    expect(c.state).toBe('completed')
  })

  it('a release revertida deixa de ser o destino das compensações: falha seguinte volta para o alvo', async () => {
    h = montarHarness()
    const { a } = await duasConcluidas()
    const alvo = h.promotion.getDeployment(SCOPE, a, 'production', 'backend')!.externalId
    await h.service.rollback(SCOPE, { to: a })

    h.cloud.smokeFails.add('production')
    const c = await h.service.handleMerge(SCOPE, SHA_C, projeto())

    expect(c.state).toBe('failed')
    expect(h.cloud.backends.get('production')!.deploymentId).toBe(alvo)
  })

  it('rollback com salto (C → A) tira B de cena: a falha seguinte volta para A, nunca para B', async () => {
    h = montarHarness()
    const a = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    h.clock.sleep(60_000)
    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    h.clock.sleep(60_000)
    const c = await h.service.handleMerge(SCOPE, SHA_C, projeto())
    expect([a.state, b.state, c.state]).toEqual(['completed', 'completed', 'completed'])
    const alvo = h.promotion.getDeployment(SCOPE, a.releaseId, 'production', 'backend')!.externalId

    expect(await h.service.rollback(SCOPE, { to: a.releaseId })).toMatchObject({
      state: 'rolled-back',
      from: c.releaseId
    })
    // Servindo A: um segundo rollback para A já é "já está servindo", e B não é o que serve.
    expect(await h.service.rollback(SCOPE, { to: a.releaseId })).toMatchObject({
      state: 'rejected',
      reason: 'already-serving'
    })
    h.clock.sleep(60_000)
    h.cloud.smokeFails.add('production')
    const d = await h.service.handleMerge(SCOPE, 'd'.repeat(40), projeto())
    expect(d.state).toBe('failed')
    expect(h.cloud.backends.get('production')!.deploymentId).toBe(alvo)
  })

  it('rollback para frente (A → B) vale: passa a servir B e as compensações voltam para B', async () => {
    h = montarHarness()
    const a = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    h.clock.sleep(60_000)
    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    h.clock.sleep(60_000)
    await h.service.rollback(SCOPE, { to: a.releaseId })
    h.clock.sleep(60_000)
    expect(await h.service.rollback(SCOPE, { to: b.releaseId })).toMatchObject({
      state: 'rolled-back',
      to: b.releaseId
    })
    const esperado = h.promotion.getDeployment(SCOPE, b.releaseId, 'production', 'backend')!
    expect(h.cloud.backends.get('production')!.deploymentId).toBe(esperado.externalId)
    expect(h.promotion.lastKnownDeployment(SCOPE, 'production', 'backend', 'x')?.releaseId).toBe(
      b.releaseId
    )
  })

  it('rollback repetido para a mesma release é recusado: já está servindo', async () => {
    h = montarHarness()
    const { a } = await duasConcluidas()
    await h.service.rollback(SCOPE, { to: a })
    expect(await h.service.rollback(SCOPE, { to: a })).toMatchObject({
      state: 'rejected',
      reason: 'already-serving'
    })
  })
})

describe('recusas (nada acontece na nuvem)', () => {
  it.each([
    ['release inexistente', () => 'nao-existe', 'target-not-found'],
    ['release que não concluiu', null, 'target-not-completed']
  ])('%s', async (_nome, destino, motivo) => {
    h = montarHarness()
    await duasConcluidas()
    const falha = await h.service.handleMerge(
      SCOPE,
      SHA_C,
      projeto({ staging: {}, production: {} })
    )
    expect(falha.state).toBe('failed')
    const alvo = destino ? destino() : falha.releaseId
    const antes = h.cloud.calls.length

    const r = await h.service.rollback(SCOPE, { to: alvo })

    expect(r).toMatchObject({ state: 'rejected', reason: motivo })
    expect(h.cloud.calls).toHaveLength(antes)
  })

  it('sem nenhuma release servindo não há do que voltar', async () => {
    h = montarHarness()
    expect(await h.service.rollback(SCOPE, { to: 'qualquer' })).toMatchObject({
      state: 'rejected',
      reason: 'nothing-to-roll-back'
    })
  })

  it('Produção ocupada por outra release: espera, sem tocar a nuvem', async () => {
    h = montarHarness()
    const { a, b } = await duasConcluidas()
    // Outra release toma a lane de Produção.
    const c = h.repository.enqueue(SCOPE, SHA_C, h.clock.now()).release.id
    h.db
      .prepare(
        `INSERT INTO release_environment_lane (user_id,workspace_id,project_id,environment,active_release_id,updated_at)
         VALUES (?,?,?,'production',?,?) ON CONFLICT(user_id,workspace_id,project_id,environment)
         DO UPDATE SET active_release_id=excluded.active_release_id`
      )
      .run(SCOPE.userId, SCOPE.workspaceId, SCOPE.projectId, c, h.clock.now())
    const antes = h.cloud.calls.length

    const r = await h.service.rollback(SCOPE, { to: a })

    expect(r).toMatchObject({ state: 'waiting', reason: 'lane-busy', from: b })
    expect(h.cloud.calls).toHaveLength(antes)
  })
})

describe('posse da lane de Produção', () => {
  it('queda com a lane presa por uma release concluída não trava a próxima promoção', async () => {
    h = montarHarness()
    const { b } = await duasConcluidas()
    // O rollback tomou a lane com a release concluída e o processo morreu antes de largá-la.
    h.repository.acquireLease(
      { ...SCOPE, releaseId: b, environment: 'production' },
      'rollback-morto',
      60_000,
      h.clock.now()
    )
    h.clock.sleep(20 * 60_000)

    const c = await h.service.handleMerge(SCOPE, SHA_C, projeto())

    expect(c.state).toBe('completed')
  })

  it('o que Produção serve é relido depois de tomar a lane: se mudou, o rollback espera', async () => {
    h = montarHarness()
    const { a, b } = await duasConcluidas()
    const original = h.promotion.lastKnownDeployment.bind(h.promotion)
    let leituras = 0
    h.promotion.lastKnownDeployment = (...args) => {
      leituras += 1
      const real = original(...args)
      // Na segunda leitura (já com a lane), outra promoção concluiu: serve outra release.
      return leituras >= 2 && real ? { ...real, releaseId: 'outra-release' } : real
    }
    const antes = h.cloud.calls.length

    const r = await h.service.rollback(SCOPE, { to: a })

    expect(r).toMatchObject({ state: 'waiting', reason: 'serving-changed', from: b })
    expect(h.cloud.calls).toHaveLength(antes)
    expect(h.recovery.rollbacks(SCOPE, b)).toEqual([])
  })
})

describe('rollback que não fecha', () => {
  it('provedor recusa a restauração: falha, pausa o projeto e registra a intenção como falha', async () => {
    h = montarHarness()
    const { a, b } = await duasConcluidas()
    h.cloud.failOn('backend.rollback:production', 'failed', 5)

    const r = await h.service.rollback(SCOPE, { to: a })

    expect(r).toMatchObject({ state: 'failed', reason: 'rollback-not-verified' })
    expect(h.recovery.rollbacks(SCOPE, b)[0]).toMatchObject({ state: 'failed' })
    expect(h.recovery.activePause(SCOPE)).toMatchObject({ reason: 'rollback-not-verified' })
    // A release revertida continua o destino conhecido: o rollback não se confirmou.
    expect(h.promotion.lastKnownDeployment(SCOPE, 'production', 'backend', 'x')?.releaseId).toBe(b)
  })

  it('restaurou mas a prova na nuvem reprova: falha em vez de declarar sucesso', async () => {
    h = montarHarness()
    const { a } = await duasConcluidas()
    h.cloud.smokeFails.add('production')

    const r = await h.service.rollback(SCOPE, { to: a })

    expect(r).toMatchObject({ state: 'failed', reason: 'rollback-not-verified' })
    expect(h.recovery.activePause(SCOPE)).not.toBeNull()
  })
})
