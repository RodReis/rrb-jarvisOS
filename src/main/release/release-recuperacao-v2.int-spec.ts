import { afterEach, describe, expect, it } from 'vitest'
import {
  SCOPE,
  SHA_A,
  SHA_B,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

/**
 * Falha de código volta à V2 (SPEC-Release-05, critério 6 e regra 5) e a release carrega a
 * identidade do que contém (inclusões). A correção nunca altera Produção: o único efeito na nuvem
 * depois da falha é a compensação para um deployment já conhecido.
 */

let h: Harness

afterEach(() => h.fechar())

const INCLUSAO = { pullRequest: 432, specId: 'spec-release-05', sliceId: 'slice-9', issue: 154 }

describe('inclusões da release', () => {
  it('o merge registra SHA, PR, SPEC, fatia e issue na release criada', async () => {
    h = montarHarness()
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(h.recovery.inclusions(SCOPE, r.releaseId)).toEqual([
      expect.objectContaining({ sha: SHA_A, ...INCLUSAO })
    ])
  })

  it('o candidato consolidado herda as inclusões do substituído', async () => {
    h = montarHarness()
    const primeira = h.repository.enqueue(SCOPE, SHA_A, h.clock.now()).release.id
    h.recovery.recordInclusion(
      SCOPE,
      primeira,
      { sha: SHA_A, pullRequest: 1, specId: 'spec-a' },
      h.clock.now()
    )

    const r = await h.service.handleMerge(SCOPE, SHA_B, projeto(), {
      pullRequest: 2,
      specId: 'spec-b'
    })

    expect(r.state).toBe('completed')
    expect(h.repository.get({ ...SCOPE, releaseId: primeira })?.status).toBe('superseded')
    expect(h.recovery.inclusions(SCOPE, r.releaseId).map((i) => [i.sha, i.pullRequest])).toEqual([
      [SHA_A, 1],
      [SHA_B, 2]
    ])
  })

  it('o mesmo merge entregue duas vezes não duplica a inclusão', async () => {
    h = montarHarness()
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(h.recovery.inclusions(SCOPE, r.releaseId)).toHaveLength(1)
  })
})

describe('retorno à V2 (critério 6)', () => {
  it('smoke de Produção que falha compensa e abre a correção na mesma fatia, sem tocar Produção', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)

    expect(r).toMatchObject({ state: 'failed', environment: 'production' })
    expect(h.v2.pedidos).toHaveLength(1)
    expect(h.v2.pedidos[0]).toMatchObject({
      releaseId: r.releaseId,
      sliceId: 'slice-9',
      specId: 'spec-release-05',
      dispatchKey: `release-correction:${r.releaseId}`
    })
    expect(h.recovery.correction(SCOPE, r.releaseId)).toMatchObject({
      state: 'opened',
      failureClass: 'health_or_test',
      environment: 'production'
    })

    // Depois da primeira compensação, a nuvem só vê restaurações para deployments conhecidos.
    const calls = h.cloud.calls
    const inicio = calls.findIndex(
      (c) => c === 'frontend.assign:production' && calls.indexOf(c) > -1
    )
    const depoisDaFalha = calls.slice(calls.lastIndexOf('verifier.verify:production') + 1)
    expect(
      depoisDaFalha.filter((c) => /^(backend\.deploy|build\.|database\.|frontend\.build)/.test(c))
    ).toEqual([])
    expect(inicio).toBeGreaterThan(-1)
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
  })

  it('o contexto leva a falha, o ambiente e a SPEC, e nenhum texto livre', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    const contexto = JSON.parse(h.recovery.correction(SCOPE, r.releaseId)!.contextJson) as {
      failure: { environment: string; reason: string; class: string }
      specs: string[]
    }
    expect(contexto.failure).toMatchObject({ environment: 'production', class: 'health_or_test' })
    expect(contexto.specs).toEqual(['spec-release-05'])
  })

  it('falha de configuração é do operador: nada volta à V2', async () => {
    h = montarHarness()
    const base = projeto()
    const r = await h.service.handleMerge(
      SCOPE,
      SHA_A,
      projeto({ staging: {}, production: {} }),
      INCLUSAO
    )
    void base
    expect(r).toMatchObject({ state: 'failed', reason: 'config-missing' })
    expect(h.v2.pedidos).toEqual([])
    expect(h.recovery.correction(SCOPE, r.releaseId)).toBeNull()
  })

  it('falha transitória esgotada não volta à V2', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'quota', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r.state).toBe('failed')
    expect(h.v2.pedidos).toEqual([])
  })

  it('V2 fora do ar: a release falha do mesmo jeito e a correção fica pendente para a retomada', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    h.v2.falha = new Error('V2 indisponível')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)

    expect(r.state).toBe('failed')
    expect(h.recovery.correction(SCOPE, r.releaseId)).toMatchObject({ state: 'pending' })

    h.v2.falha = null
    const abertas = await h.dispatcher.retryPending(SCOPE)
    expect(abertas).toEqual([expect.objectContaining({ releaseId: r.releaseId, state: 'opened' })])
  })

  it('sem fatia da V2 na inclusão a correção fica indisponível, com a ação mínima registrada', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), { pullRequest: 7 })
    expect(h.recovery.correction(SCOPE, r.releaseId)).toMatchObject({
      state: 'unavailable',
      stateReason: 'no-slice'
    })
    expect(h.v2.pedidos).toEqual([])
  })

  it('o mesmo achado, de novo na mesma SPEC, chega como recorrente', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    const segunda = await h.service.handleMerge(SCOPE, SHA_B, projeto(), INCLUSAO)
    const contexto = JSON.parse(h.recovery.correction(SCOPE, segunda.releaseId)!.contextJson) as {
      findings: { status: string }[]
    }
    expect(contexto.findings[0]?.status).toBe('recurring')
  })
})
