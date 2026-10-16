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
import { PreviewCoordinator, type PreviewEvent } from './preview-coordinator'
import { PreviewRepository } from './preview-repository'
import { FakeCloud } from './preview-test-doubles'

/**
 * Jornada completa de uma fatia (SPEC-Release-05, critério 10): Preview → merge → Staging →
 * Produção → estabilização → falha → compensação → correção na V2 → nova release → rollback →
 * limpeza. O mundo é o mesmo em todos os passos — um banco local, uma nuvem de Preview e uma nuvem
 * de promoção com estado — então um defeito de isolamento ou de duplicação aparece como asserção
 * quebrada. É a mesma jornada que o roteiro real percorre com o projeto de prova (ver SPEC §
 * Decisões de implementação): aqui, contra a nuvem falsa; lá, contra Vercel, Railway e GHCR.
 */

let h: Harness
let preview: PreviewCoordinator
let nuvemDoPreview: FakeCloud

afterEach(() => h.fechar())

const SPEC = 'SPEC-Release-05'
const INCLUSAO = { pullRequest: 432, specId: 'spec-release-05', sliceId: 'slice-9', issue: 154 }

function montarMundo(): void {
  h = montarHarness()
  nuvemDoPreview = new FakeCloud()
  preview = new PreviewCoordinator({
    repository: new PreviewRepository(h.db, h.audit),
    image: nuvemDoPreview.image,
    backend: nuvemDoPreview.backend,
    database: nuvemDoPreview.database,
    frontend: nuvemDoPreview.frontend,
    verifier: nuvemDoPreview.verifier,
    publication: nuvemDoPreview.publication,
    project: {
      migrations: [{ id: '001_init', sql: 'select 1', checksum: '1'.repeat(64) }],
      seed: 'insert into itens values (1)'
    },
    now: h.clock.now
  })
}

const evento = (pullRequest: number, headSha: string, action: 'open' | 'close'): PreviewEvent => ({
  ...SCOPE,
  action,
  pullRequest,
  specId: SPEC,
  specRevision: '2026-08-29',
  headSha
})

const producao = () => ({
  backend: h.cloud.backends.get('production')!.deploymentId,
  frontend: h.cloud.frontendAssigned.get('production')!
})

describe('jornada Preview → Staging → Produção → falha → correção → rollback → limpeza', () => {
  it('percorre a fatia inteira, sem duplicar efeito e sem encostar Produção fora do caminho', async () => {
    montarMundo()

    // 1. Preview isolado do PR: banco próprio, seed determinístico, nada de Produção.
    const aberto = await preview.handle(evento(432, SHA_A, 'open'))
    expect(aberto).toMatchObject({ state: 'ready' })
    expect(nuvemDoPreview.environments.size).toBe(1)
    expect(h.cloud.calls).toEqual([])

    // 2. Merge confirmado: Staging e Produção com o MESMO digest e o MESMO frontend.
    const r1 = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r1.state).toBe('completed')
    const digest = h.local.getArtifact(SCOPE, r1.releaseId, 'backend-image')!.digest
    for (const kind of ['backend', 'frontend'] as const) {
      const staging = h.promotion.getDeployment(SCOPE, r1.releaseId, 'staging', kind)!
      const prod = h.promotion.getDeployment(SCOPE, r1.releaseId, 'production', kind)!
      expect(staging.artifactDigest).toBe(prod.artifactDigest)
      if (kind === 'frontend') expect(staging.externalId).toBe(prod.externalId)
    }
    expect(h.cloud.builds).toBe(1)
    expect(digest).toMatch(/^sha256:/)

    // 3. Estabilizada: identidade verificável.
    const m1 = h.recovery.manifest(SCOPE, r1.releaseId)!
    expect(h.git.tags.get(m1.tag)?.commitSha).toBe(SHA_A)
    expect(await h.publisher.verify(SCOPE, r1.releaseId)).toEqual({ ok: true, problems: [] })
    const r1Producao = producao()

    // 4. O PR fecha: o Preview é destruído e a evidência fica.
    const fechado = await preview.handle(evento(432, SHA_A, 'close'))
    expect(fechado).toMatchObject({ state: 'removed', pending: [] })
    expect(nuvemDoPreview.environments.size).toBe(0)

    // 5. Segunda fatia: o Preview passa, Staging passa, mas Produção falha ao estabilizar.
    expect((await preview.handle(evento(433, SHA_B, 'open'))).state).toBe('ready')
    h.cloud.smokeFails.add('production')
    h.clock.sleep(60_000)
    const r2 = await h.service.handleMerge(SCOPE, SHA_B, projeto(), {
      ...INCLUSAO,
      pullRequest: 433,
      issue: 155
    })
    h.cloud.smokeFails.delete('production')

    // 5a. Falha: compensa para a release anterior conhecida, sem tag, sem nova aprovação.
    expect(r2).toMatchObject({ state: 'failed', environment: 'production' })
    expect(producao()).toEqual(r1Producao)
    expect(h.recovery.manifest(SCOPE, r2.releaseId)).toBeNull()
    expect(h.git.tags.size).toBe(1)
    expect(h.promotion.listCompensations(SCOPE, r2.releaseId).map((c) => c.state)).toEqual([
      'confirmed',
      'confirmed'
    ])
    // O banco nunca foi restaurado.
    expect(h.cloud.calls.filter((c) => /database\.restore/.test(c))).toEqual([])

    // 5b. Volta à V2 na mesma fatia e SPEC, com o histórico da release no contexto.
    expect(h.v2.pedidos).toHaveLength(1)
    expect(h.v2.pedidos[0]).toMatchObject({ sliceId: 'slice-9', specId: 'spec-release-05' })
    expect(h.recovery.correction(SCOPE, r2.releaseId)).toMatchObject({ state: 'opened' })

    // 6. A correção chega (nova revisão do mesmo PR, mesmo Preview) e a release conclui.
    const atualizado = await preview.handle(evento(433, SHA_C, 'open'))
    expect(atualizado.state).toBe('ready')
    expect(nuvemDoPreview.environments.size).toBe(1)
    h.clock.sleep(60_000)
    const r3 = await h.service.handleMerge(SCOPE, SHA_C, projeto(), {
      ...INCLUSAO,
      pullRequest: 433,
      issue: 155
    })
    expect(r3.state).toBe('completed')
    const m3 = h.recovery.manifest(SCOPE, r3.releaseId)!
    expect(JSON.parse(m3.manifestJson)).toMatchObject({
      previousRelease: { releaseId: r1.releaseId, tag: m1.tag }
    })
    expect(producao()).not.toEqual(r1Producao)

    // 7. Rollback por release_id: Produção volta a servir exatamente a R1.
    h.clock.sleep(60_000)
    const bancoAntes = h.cloud.calls.filter((c) => c.startsWith('database.')).length
    const volta = await h.service.rollback(SCOPE, { to: r1.releaseId })
    expect(volta).toMatchObject({ state: 'rolled-back', to: r1.releaseId })
    expect(producao()).toEqual(r1Producao)
    expect(h.cloud.calls.filter((c) => c.startsWith('database.')).length).toBe(bancoAntes)

    // 8. Limpeza: Preview destruído, lanes livres, nada pendente.
    expect((await preview.handle(evento(433, SHA_C, 'close'))).state).toBe('removed')
    expect(nuvemDoPreview.environments.size).toBe(0)
    const lanes = h.db
      .prepare(
        `SELECT COUNT(*) AS n FROM release_environment_lane WHERE active_release_id IS NOT NULL`
      )
      .get()
    expect(lanes).toEqual({ n: 0 })
    expect(h.recovery.pendingPublications(SCOPE)).toEqual([])
    expect(h.recovery.pendingCorrections(SCOPE)).toEqual([])
    expect(h.recovery.activePause(SCOPE)).toBeNull()
    // Toda release publicada é verificável de novo, depois de tudo.
    for (const id of [r1.releaseId, r3.releaseId])
      expect(await h.publisher.verify(SCOPE, id)).toEqual({ ok: true, problems: [] })
  })

  it('repetir qualquer evento da jornada não muda nada (idempotência de ponta a ponta)', async () => {
    montarMundo()
    await preview.handle(evento(432, SHA_A, 'open'))
    const r1 = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r1.state).toBe('completed')
    const chamadas = h.cloud.calls.length
    const gitChamadas = h.git.calls.filter((c) => c.startsWith('publish:')).length

    const repetido = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    await h.service.resume(SCOPE, projeto())
    expect(repetido).toMatchObject({ state: 'completed', releaseId: r1.releaseId })
    expect(h.cloud.calls).toHaveLength(chamadas)
    expect(h.git.calls.filter((c) => c.startsWith('publish:'))).toHaveLength(gitChamadas)
    expect((await preview.handle(evento(432, SHA_A, 'open'))).repeated).toBe(true)
  })

  it('o PR fechado antes do merge limpa o Preview e a release segue sem ele', async () => {
    montarMundo()
    await preview.handle(evento(432, SHA_A, 'open'))
    await preview.handle(evento(432, SHA_A, 'close'))
    expect(nuvemDoPreview.environments.size).toBe(0)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r.state).toBe('completed')
  })
})
