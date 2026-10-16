import { afterEach, describe, expect, it } from 'vitest'
import { ReleaseCorrectionDispatcher } from './correction/dispatcher'
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
 * Contrafactuais e fixtures de falha da SPEC-Release-05 (§ Estratégia de testes): auth expirada,
 * IDs obsoletos, compensação parcial, e as três coisas que NUNCA podem acontecer — tag antes da
 * estabilização (coberto em release-publisher), restore automático do banco e correção direta em
 * Produção.
 */

let h: Harness

afterEach(() => h.fechar())

const mutacoesDeNuvem = (calls: readonly string[]): string[] =>
  calls.filter((c) => /^(backend\.deploy|build\.|database\.|frontend\.build)/.test(c))

describe('auth expirada', () => {
  it('credencial recusada no deploy de Produção: falha de configuração, sem repetir e sem voltar à V2', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:production', 'auth', 10)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), {
      pullRequest: 432,
      sliceId: 'slice-9'
    })

    expect(r).toMatchObject({ state: 'failed', reason: 'backend_healthy-auth' })
    expect(h.cloud.calls.filter((c) => c === 'backend.deploy:production')).toHaveLength(1)
    expect(h.v2.pedidos).toEqual([])
    expect(h.recovery.evidence(SCOPE, r.releaseId)).toContainEqual(
      expect.objectContaining({ kind: 'compensation', environment: 'production' })
    )
  })

  it('a credencial também expira na compensação: degraded, projeto pausado, e só recupera com a nuvem de volta', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    // A versão nova chega a Produção e o smoke reprova; depois a credencial expira na compensação.
    h.cloud.smokeFails.add('production')
    h.cloud.failOn('backend.rollback:production', 'auth', 2)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('degraded')
    expect(h.recovery.activePause(SCOPE)).toMatchObject({ reason: 'compensation-incomplete' })

    // Credencial ainda recusada: a recuperação tenta, não prova e mantém o projeto pausado.
    expect(await h.service.recover(SCOPE)).toMatchObject({ state: 'paused' })
    // Credencial renovada: refaz e prova o estado conhecido na nuvem.
    expect(await h.service.recover(SCOPE)).toMatchObject({ state: 'resumed' })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
  })
})

describe('IDs obsoletos', () => {
  it('o deployment de destino não existe mais no provedor: a compensação falha e o projeto pausa', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    // O provedor já descartou o deployment da release anterior.
    h.cloud.backendHistory.length = 0
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r.state).toBe('degraded')
    expect(h.promotion.listCompensations(SCOPE, r.releaseId).map((c) => c.state)).toContain(
      'failed'
    )
    expect(h.recovery.activePause(SCOPE)).not.toBeNull()
  })

  it('recuperar não consegue provar um destino que sumiu; só o reconhecimento do operador libera', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.backendHistory.length = 0
    h.cloud.smokeFails.add('production')
    await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(await h.service.recover(SCOPE)).toMatchObject({
      state: 'paused',
      reason: 'recovery-not-verified'
    })
    expect(await h.service.recover(SCOPE, { acknowledge: true })).toMatchObject({
      state: 'resumed'
    })
  })

  it('rollback para uma release cujo deployment sumiu não é declarado sucesso', async () => {
    h = montarHarness()
    const a = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    h.clock.sleep(60_000)
    await h.service.handleMerge(SCOPE, SHA_B, projeto())
    const alvo = h.promotion.getDeployment(SCOPE, a.releaseId, 'production', 'backend')!.externalId
    h.cloud.backendHistory.splice(
      h.cloud.backendHistory.findIndex((b) => b.deploymentId === alvo),
      1
    )

    const r = await h.service.rollback(SCOPE, { to: a.releaseId })

    expect(r).toMatchObject({ state: 'failed', reason: 'rollback-not-verified' })
    expect(h.recovery.activePause(SCOPE)).not.toBeNull()
  })
})

describe('contrafactual: restore automático do banco', () => {
  it('a porta de banco não tem operação de restauração: não há como pedir uma', () => {
    h = montarHarness()
    expect(Object.keys(h.cloud.database).sort()).toEqual(['applied', 'backup', 'migrate'])
  })

  it('falha, compensação, cancelamento, rollback e recuperação nunca chamam o banco depois da falha', async () => {
    h = montarHarness()
    const a = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    h.clock.sleep(60_000)
    h.cloud.smokeFails.add('production')
    h.cloud.failOn('backend.rollback:production', 'failed', 1)
    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(b.state).toBe('degraded')
    h.cloud.smokeFails.delete('production')
    const depoisDaFalha = h.cloud.calls.length

    await h.service.recover(SCOPE)
    await h.service.rollback(SCOPE, { to: a.releaseId })
    await h.service.cancel(SCOPE, b.releaseId, projeto())

    expect(h.cloud.calls.slice(depoisDaFalha).filter((c) => c.startsWith('database.'))).toEqual([])
  })
})

describe('contrafactual: correção direta em Produção', () => {
  it('o despachante da V2 não aceita nenhuma porta de nuvem: corrigir Produção é impossível por construção', () => {
    h = montarHarness()
    const despachante = new ReleaseCorrectionDispatcher({
      repository: h.repository,
      recovery: h.recovery,
      v2: { open: async () => ({ runId: 'r' }) },
      // @ts-expect-error — as dependências do despachante não incluem backend, frontend nem banco.
      backend: h.cloud.backend
    })
    expect(despachante).toBeInstanceOf(ReleaseCorrectionDispatcher)
  })

  it('depois da falha, a única mudança em Produção é a restauração para o que já era conhecido', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), {
      pullRequest: 432,
      sliceId: 'slice-9'
    })
    expect(r.state).toBe('failed')

    const calls = h.cloud.calls
    const aposAFalha = calls.slice(calls.lastIndexOf('verifier.verify:production') + 1)
    expect(mutacoesDeNuvem(aposAFalha)).toEqual([])
    // Tudo o que mexeu em Produção depois da falha aponta para os deployments da release anterior.
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.cloud.frontendAssigned.get('production')).toBe('dpl_antigo')
    expect(h.v2.pedidos).toHaveLength(1)
  })
})
