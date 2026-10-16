import { afterEach, describe, expect, it } from 'vitest'
import {
  ProcessKiller,
  SCOPE,
  SHA_A,
  SimulatedCrash,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

/**
 * Cancelamento seguro em cada fase (SPEC-Release-05, regra 3 e critério 5). Cancelar nunca mata
 * cegamente um efeito remoto nem apaga evidência: a operação corrente termina e é reconciliada,
 * e só então o ambiente volta para um deployment conhecido. Depois da promoção, cancelar é
 * rollback para a release anterior conhecida.
 */

let h: Harness

afterEach(() => h.fechar())

const chamadas = (operacao: string): number => h.cloud.calls.filter((c) => c === operacao).length
const status = (releaseId: string) => h.repository.get({ ...SCOPE, releaseId })!.status
const cancelamento = (releaseId: string) => h.recovery.cancellation(SCOPE, releaseId)

/**
 * Pede o cancelamento "de outro processo" no meio de uma operação remota: o executor segura o
 * lease, então o pedido só pode ser registrado — quem o cumpre é o executor, no próximo ponto seguro.
 */
function cancelarDuranteAOperacao(
  operacao: 'backend.deploy' | 'frontend.assign' | 'database.migrate',
  ambiente: 'staging' | 'production'
): { resultado: () => unknown } {
  let valor: unknown = null
  let pedido = false
  const [porta, metodo] = operacao.split('.') as ['backend' | 'frontend' | 'database', string]
  const alvo = h.cloud[porta] as unknown as Record<
    string,
    (input: { environment: string }) => Promise<unknown>
  >
  const original = alvo[metodo]!.bind(alvo)
  alvo[metodo] = async (input) => {
    const feito = await original(input)
    if (input.environment === ambiente && !pedido) {
      pedido = true
      const releaseId = h.repository.queue(SCOPE).candidate!.id
      valor = await h.novoServico({ ownerId: 'cli' }).cancel(SCOPE, releaseId, projeto())
    }
    return feito
  }
  return { resultado: () => valor }
}

describe('antes de Staging', () => {
  it('release na fila: cancela, limpa os temporários e termina em estado conhecido', async () => {
    h = montarHarness()
    const id = h.repository.enqueue(SCOPE, SHA_A, h.clock.now()).release.id

    const r = await h.service.cancel(SCOPE, id, projeto())

    expect(r).toMatchObject({ state: 'cancelled', status: 'failed', reason: null })
    expect(status(id)).toBe('failed')
    expect(cancelamento(id)).toMatchObject({ state: 'done', phase: 'queued' })
    expect(h.cloud.calls).toContain('build.cleanup')
    expect(h.promotion.listCompensations(SCOPE, id)).toEqual([])
    // Cancelar não é falha de código: nada volta à V2.
    expect(h.v2.pedidos).toEqual([])
  })

  it('durante a preparação: o passo incerto é reconciliado antes de parar e a evidência é preservada', async () => {
    const morte = new ProcessKiller(7, 'after')
    h = montarHarness({ morte })
    try {
      await h.service.handleMerge(SCOPE, SHA_A, projeto())
    } catch (erro) {
      if (!(erro instanceof SimulatedCrash)) throw erro
    }
    const id = h.repository.queue(SCOPE).candidate!.id
    await h.clock.sleep(20 * 60_000)
    expect(['queued', 'preparing']).toContain(status(id))

    const r = await h.novoServico({ ownerId: 'cli' }).cancel(SCOPE, id, projeto())

    expect(r).toMatchObject({ state: 'cancelled', status: 'failed' })
    expect(h.cloud.calls).toContain('build.cleanup')
    // O que foi construído não é apagado: o artefato continua registrado (e imutável).
    const incertos = h.db
      .prepare(
        `SELECT COUNT(*) AS n FROM release_step WHERE release_id=? AND state IN ('intended','ambiguous')`
      )
      .get(id)
    expect(incertos).toEqual({ n: 0 })
  })

  it('passo incerto que o provedor não deixa reconciliar: o cancelamento fica bloqueado, sem terminar a release', async () => {
    h = montarHarness()
    h.cloud.failAfter('backend.deploy:staging', 'timeout')
    h.cloud.failOn('backend.current:staging', 'timeout', 100)
    const bloqueada = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(bloqueada.state).toBe('blocked')

    const r = await h.novoServico({ ownerId: 'cli' }).cancel(SCOPE, bloqueada.releaseId, projeto())

    expect(r).toMatchObject({ state: 'blocked', reason: 'reconciliation-required' })
    expect(status(bloqueada.releaseId)).toBe('staging')
    expect(cancelamento(bloqueada.releaseId)).toMatchObject({ state: 'blocked' })
    expect(h.promotion.listCompensations(SCOPE, bloqueada.releaseId)).toEqual([])
  })
})

describe('durante Staging', () => {
  it('conclui a operação remota corrente, não executa mais nada e devolve Staging ao estado conhecido', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    const pedido = cancelarDuranteAOperacao('backend.deploy', 'staging')

    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'cancelled', environment: 'staging' })
    // A operação em voo terminou (um deploy, nunca interrompido) e nada além dela foi executado.
    expect(chamadas('backend.deploy:staging')).toBe(1)
    expect(chamadas('frontend.assign:staging')).toBe(0)
    expect(chamadas('database.migrate:production')).toBe(0)
    expect(h.cloud.backends.get('staging')!.deploymentId).toBe('rw-staging-antigo')
    expect(cancelamento(r.releaseId)).toMatchObject({ state: 'done', phase: 'staging' })
    expect(pedido.resultado()).toMatchObject({ state: 'requested' })
    // Compensação depois, nunca antes, do deploy que estava em voo.
    const calls = h.cloud.calls
    expect(calls.indexOf('backend.rollback:staging')).toBeGreaterThan(
      calls.indexOf('backend.deploy:staging')
    )
    expect(h.v2.pedidos).toEqual([])
  })

  it('o cancelamento pedido com a release parada é cumprido na próxima retomada', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.deploy:staging', 'timeout', 1)
    h.cloud.failOn('backend.current:staging', 'timeout', 3)
    const parada = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(parada.state).toBe('blocked')

    h.recovery.requestCancellation(SCOPE, parada.releaseId, 'staging', h.clock.now())
    const retomada = await h.novoServico().promote(SCOPE, parada.releaseId, projeto())

    expect(retomada).toMatchObject({ state: 'failed', reason: 'cancelled' })
    expect(cancelamento(parada.releaseId)).toMatchObject({ state: 'done' })
  })
})

describe('durante Produção', () => {
  it('converte-se em compensação segura de Produção; Staging permanece como foi aprovado', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    cancelarDuranteAOperacao('frontend.assign', 'production')

    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'cancelled', environment: 'production' })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.cloud.frontendAssigned.get('production')).toBe('dpl_antigo')
    expect(h.cloud.backends.get('staging')!.deploymentId).not.toBe('rw-staging-antigo')
    expect(cancelamento(r.releaseId)).toMatchObject({ state: 'done', phase: 'production' })
    // O banco nunca é restaurado.
    expect(h.cloud.calls.filter((c) => /database\.restore/.test(c))).toEqual([])
  })

  it('compensação que não fecha deixa degraded e pausa o projeto', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.failOn('backend.rollback:production', 'failed', 1)
    cancelarDuranteAOperacao('frontend.assign', 'production')

    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'degraded', reason: 'cancelled' })
    expect(h.recovery.activePause(SCOPE)).toMatchObject({ reason: 'compensation-incomplete' })
  })
})

describe('depois da promoção (estabilização)', () => {
  it('cancelar equivale a rollback para a release anterior conhecida; a release nunca conclui', async () => {
    let esperas = 0
    h = montarHarness({
      sleep: async (ms) => {
        esperas += 1
        if (esperas === 1) {
          // Primeira espera da janela de estabilização: alguém pede o cancelamento.
          const id = h.repository.queue(SCOPE).candidate!.id
          const cli = await h.novoServico({ ownerId: 'cli' }).cancel(SCOPE, id, projeto())
          expect(cli).toMatchObject({ state: 'requested' })
        }
        await h.clock.sleep(ms)
      }
    })
    semearReleaseConcluida(h)

    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'failed', reason: 'cancelled' })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(cancelamento(r.releaseId)).toMatchObject({ state: 'done', phase: 'stabilizing' })
    expect(status(r.releaseId)).toBe('failed')
  })
})

describe('regras gerais do cancelamento', () => {
  it('release já terminal não é cancelável: concluída pede rollback, as demais já terminaram', async () => {
    h = montarHarness()
    const concluida = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(concluida.state).toBe('completed')
    expect(await h.service.cancel(SCOPE, concluida.releaseId, projeto())).toMatchObject({
      state: 'rejected',
      reason: 'already-terminal'
    })
    expect(cancelamento(concluida.releaseId)).toBeNull()
  })

  it('o pedido é idempotente: repetir não cria outro nem repete a limpeza', async () => {
    h = montarHarness()
    const id = h.repository.enqueue(SCOPE, SHA_A, h.clock.now()).release.id
    await h.service.cancel(SCOPE, id, projeto())
    const repetido = await h.service.cancel(SCOPE, id, projeto())
    expect(repetido).toMatchObject({ state: 'rejected', reason: 'already-terminal' })
    expect(chamadas('build.cleanup')).toBe(1)
  })

  it('falha da limpeza dos temporários vira evidência pendente, não impede o cancelamento', async () => {
    h = montarHarness()
    h.cloud.failOn('build.cleanup', 'failed', 1)
    const id = h.repository.enqueue(SCOPE, SHA_A, h.clock.now()).release.id
    const r = await h.service.cancel(SCOPE, id, projeto())
    expect(r).toMatchObject({ state: 'cancelled', status: 'failed' })
    expect(h.recovery.evidence(SCOPE, id)).toContainEqual(
      expect.objectContaining({ kind: 'cancellation', state: 'pending', reason: 'cleanup-failed' })
    )
  })
})
