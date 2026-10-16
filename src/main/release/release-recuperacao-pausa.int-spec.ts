import { afterEach, describe, expect, it } from 'vitest'
import {
  OUTRO_PROJETO,
  SCOPE,
  SHA_A,
  SHA_B,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

/**
 * Compensação parcial → `degraded` → pausa só do projeto afetado (SPEC-Release-05, critério 4).
 * A recuperação é um comando do operador: refaz a compensação que falhou, prova na nuvem que o
 * ambiente voltou ao estado conhecido e só então libera o projeto.
 */

let h: Harness

afterEach(() => h.fechar())

const chamadas = (operacao: string): number => h.cloud.calls.filter((c) => c === operacao).length

/** Release B falha em Produção e a compensação do backend também falha: degraded. */
async function degradar(): Promise<string> {
  semearReleaseConcluida(h)
  h.cloud.smokeFails.add('production')
  h.cloud.failOn('backend.rollback:production', 'failed', 1)
  const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
  expect(r.state).toBe('degraded')
  h.cloud.smokeFails.delete('production')
  return r.releaseId
}

describe('release degradada pausa o projeto, e só ele', () => {
  it('a pausa nasce com o motivo e a release que a causou', async () => {
    h = montarHarness()
    const releaseId = await degradar()
    expect(h.recovery.activePause(SCOPE)).toMatchObject({
      releaseId,
      reason: 'compensation-incomplete'
    })
    expect(h.recovery.evidence(SCOPE, releaseId)).toContainEqual(
      expect.objectContaining({ kind: 'compensation', state: 'failed', environment: 'production' })
    )
  })

  it('sem release anterior para onde voltar, a versão ruim segue no ar e o projeto fica pausado', async () => {
    h = montarHarness()
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('degraded')
    expect(h.recovery.activePause(SCOPE)).toMatchObject({ reason: 'no-previous-release' })
  })

  it('um merge novo no projeto pausado é enfileirado e não promove nada', async () => {
    h = montarHarness()
    await degradar()
    const antes = h.cloud.calls.length

    const r = await h.service.handleMerge(SCOPE, SHA_B, projeto())

    expect(r).toMatchObject({ state: 'blocked', reason: 'project-paused', status: 'queued' })
    expect(h.cloud.calls).toHaveLength(antes)
    expect(h.repository.queue(SCOPE).candidate?.sha).toBe(SHA_B)
  })

  it('retomar um projeto pausado não executa nenhuma release aberta', async () => {
    h = montarHarness()
    await degradar()
    await h.service.handleMerge(SCOPE, SHA_B, projeto())
    const antes = h.cloud.calls.length
    const resultados = await h.service.resume(SCOPE, projeto())
    expect(resultados.map((x) => x.reason)).toEqual(['project-paused'])
    expect(h.cloud.calls).toHaveLength(antes)
  })

  it('release em voo em Staging não toma a lane de Produção depois que o projeto foi pausado', async () => {
    h = montarHarness()
    // Uma release de outro momento degrada e pausa o projeto no meio do Staging desta.
    const original = h.cloud.frontend.assign
    let pausou = false
    h.cloud.frontend.assign = async (input) => {
      await original(input)
      if (input.environment === 'staging' && !pausou) {
        pausou = true
        const outra = h.repository.enqueue(SCOPE, SHA_B, h.clock.now()).release.id
        h.recovery.pauseProject(SCOPE, outra, 'compensation-incomplete', h.clock.now())
      }
    }

    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(r).toMatchObject({ state: 'blocked', reason: 'project-paused', status: 'staging' })
    expect(h.cloud.calls.filter((c) => c.endsWith(':production'))).toEqual([])
    const lane = h.db
      .prepare(
        `SELECT active_release_id FROM release_environment_lane WHERE environment='production'`
      )
      .get() as { active_release_id: string | null } | undefined
    expect(lane?.active_release_id ?? null).toBeNull()
  })

  it('outro projeto segue publicando enquanto este está pausado', async () => {
    h = montarHarness()
    await degradar()
    const outro = h.outroProjeto()
    const r = await outro.service.handleMerge(OUTRO_PROJETO, SHA_A, projeto())
    expect(r.state).toBe('completed')
    expect(h.recovery.activePause(OUTRO_PROJETO)).toBeNull()
  })

  it('o relato da própria release degradada continua disponível', async () => {
    h = montarHarness()
    const releaseId = await degradar()
    const r = await h.service.promote(SCOPE, releaseId, projeto())
    expect(r).toMatchObject({ state: 'degraded', releaseId })
  })
})

describe('recuperação do projeto pausado', () => {
  it('provedor ainda falhando: a compensação é refeita, não confirma e o projeto segue pausado', async () => {
    h = montarHarness()
    await degradar()
    h.cloud.failOn('backend.rollback:production', 'failed', 5)

    const r = await h.service.recover(SCOPE)

    expect(r).toMatchObject({ state: 'paused', reason: 'recovery-not-verified' })
    expect(h.recovery.activePause(SCOPE)).not.toBeNull()
    expect(chamadas('backend.rollback:production')).toBeGreaterThanOrEqual(2)
  })

  it('provedor de volta: refaz, prova o estado conhecido na nuvem e libera o projeto', async () => {
    h = montarHarness()
    const releaseId = await degradar()

    const r = await h.service.recover(SCOPE)

    expect(r).toMatchObject({ state: 'resumed' })
    expect(h.cloud.backends.get('production')!.deploymentId).toBe('rw-production-antigo')
    expect(h.recovery.activePause(SCOPE)).toBeNull()
    expect(h.recovery.evidence(SCOPE, releaseId)).toContainEqual(
      expect.objectContaining({ kind: 'recovery', state: 'confirmed' })
    )
    // Liberado: o próximo merge promove normalmente.
    const seguinte = await h.service.handleMerge(SCOPE, SHA_B, projeto())
    expect(seguinte.state).toBe('completed')
  })

  it('recuperar toma a lane de Produção: com outra escrita em curso, espera sem tocar a nuvem', async () => {
    h = montarHarness()
    await degradar()
    const outra = h.repository.enqueue(SCOPE, SHA_B, h.clock.now()).release.id
    h.db
      .prepare(
        `INSERT INTO release_environment_lane (user_id,workspace_id,project_id,environment,active_release_id,updated_at)
         VALUES (?,?,?,'production',?,?) ON CONFLICT(user_id,workspace_id,project_id,environment)
         DO UPDATE SET active_release_id=excluded.active_release_id`
      )
      .run(SCOPE.userId, SCOPE.workspaceId, SCOPE.projectId, outra, h.clock.now())
    h.db.prepare(`UPDATE release_run SET status='preparing' WHERE id=?`).run(outra)
    const antes = h.cloud.calls.length

    const r = await h.service.recover(SCOPE)

    expect(r).toMatchObject({ state: 'waiting', reason: 'lane-busy' })
    expect(h.cloud.calls).toHaveLength(antes)
    expect(h.recovery.activePause(SCOPE)).not.toBeNull()
  })

  it('o reconhecimento do operador fica marcado na cadeia de auditoria, distinto da recuperação provada', async () => {
    h = montarHarness()
    h.cloud.smokeFails.add('production')
    const degradada = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(degradada.state).toBe('degraded')

    await h.service.recover(SCOPE, { acknowledge: true })

    const eventos = h.audit
      .list(SCOPE.userId)
      .filter((e) => JSON.stringify(e.payload).includes('project-resumed'))
    expect(eventos).toHaveLength(1)
    expect(JSON.stringify(eventos[0]!.payload)).toContain('"acknowledged":"true"')
    expect(JSON.stringify(eventos[0]!.payload)).toContain('no-previous-release')
  })

  it('recuperar é idempotente e nunca toca o banco', async () => {
    h = montarHarness()
    await degradar()
    await h.service.recover(SCOPE)
    const repetida = await h.service.recover(SCOPE)
    expect(repetida).toMatchObject({ state: 'none' })
    expect(h.cloud.calls.filter((c) => c.startsWith('database.'))).not.toContain(
      'database.restore:production'
    )
  })

  it('sem estado conhecido para provar, só o reconhecimento explícito do operador libera o projeto', async () => {
    h = montarHarness()
    h.cloud.smokeFails.add('production')
    const degradada = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(degradada.state).toBe('degraded')

    const sem = await h.service.recover(SCOPE)
    expect(sem).toMatchObject({ state: 'paused' })

    const com = await h.service.recover(SCOPE, { acknowledge: true })
    expect(com).toMatchObject({ state: 'resumed' })
    expect(h.recovery.activePause(SCOPE)).toBeNull()
    expect(h.recovery.evidence(SCOPE, degradada.releaseId)).toContainEqual(
      expect.objectContaining({ kind: 'recovery', action: 'operator-acknowledged' })
    )
  })
})
