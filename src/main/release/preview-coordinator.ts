import { randomUUID } from 'node:crypto'
import type { PreviewRun, ReleaseScope } from '@shared/domain/release'
import {
  nomeDoAmbienteDePreview,
  previewProntoParaPublicar,
  urlPublicaDePreview,
  type PreviewGateResult,
  type PreviewResource,
  type PreviewResourceKind
} from '@shared/domain/release-preview'
import type { MigrationFile } from './database-migration-runner'
import {
  PreviewProviderError,
  type PreviewBackendPort,
  type PreviewDatabasePort,
  type PreviewFrontendPort,
  type PreviewImagePort,
  type PreviewProjection,
  type PreviewPublicationPort,
  type PreviewVerifierPort
} from './preview-ports'
import { PreviewOwnershipError, PreviewRepository } from './preview-repository'

/**
 * Ciclo de vida do Preview isolado por PR (SPEC-Release-03). Converge para o estado do PR:
 * `open` (aberto, reaberto ou com commit novo) cria ou atualiza o mesmo Preview; `close` o
 * destrói. Repetir um evento reconcilia e não duplica efeito. O texto do PR nunca chega aqui —
 * só número, SHA, SPEC e revisão, já validados.
 */

export interface PreviewEvent extends ReleaseScope {
  readonly action: 'open' | 'close'
  readonly pullRequest: number
  readonly specId: string
  readonly specRevision: string
  readonly headSha: string
}

export interface PreviewProject {
  readonly migrations: readonly MigrationFile[]
  readonly seed?: string
}

export interface PreviewOutcome {
  readonly state: 'ready' | 'failed' | 'removed' | 'removing' | 'busy' | 'absent'
  /** Verdadeiro quando o evento não precisou mudar nada. */
  readonly repeated: boolean
  readonly run: PreviewRun | null
  /** Tipos de recurso que a limpeza ainda não confirmou como destruídos. */
  readonly pending: readonly PreviewResourceKind[]
  readonly reason: string | null
  readonly publication: 'published' | 'failed' | 'skipped'
}

export interface PreviewCoordinatorDeps {
  readonly repository: PreviewRepository
  readonly image: PreviewImagePort
  readonly backend: PreviewBackendPort
  readonly database: PreviewDatabasePort
  readonly frontend: PreviewFrontendPort
  readonly verifier: PreviewVerifierPort
  readonly publication: PreviewPublicationPort
  readonly project: PreviewProject
  readonly now?: () => string
  readonly lockTtlMs?: number
}

const PRAZO_DA_POSSE_MS = 20 * 60_000

type RegistrarGate = (nome: string, result: PreviewGateResult, reason?: string) => void
/** O que uma etapa precisa: registrar gate e renovar a posse antes da chamada ao provedor. */
interface ContextoDeEtapa {
  readonly gate: RegistrarGate
  readonly renovar: () => void
}
const GATES_DE_MIGRATION = ['migration', 'seed'] as const

class EtapaFalhou extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

export class PreviewCoordinator {
  constructor(private readonly deps: PreviewCoordinatorDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))()
  }

  async handle(event: PreviewEvent): Promise<PreviewOutcome> {
    return event.action === 'open' ? this.ensure(event) : this.destroy(event)
  }

  private async ensure(event: PreviewEvent): Promise<PreviewOutcome> {
    const { repository } = this.deps
    const owner = `preview-${randomUUID()}`
    const claim = repository.claim(
      event,
      owner,
      this.deps.lockTtlMs ?? PRAZO_DA_POSSE_MS,
      this.now()
    )
    if (claim.outcome === 'busy') return this.outcome('busy', claim.run, true)
    let run = claim.run
    try {
      if (run.status === 'removing') {
        const limpeza = await this.teardown(run, owner)
        if (limpeza.pending.length)
          return this.outcome('removing', limpeza.run, false, limpeza.pending)
        run = limpeza.run
      }
      if (run.status === 'removed')
        run = repository.transition(run.id, owner, { status: 'queued' }, this.now())
      if (this.jaPronto(run, event)) return await this.publicar('ready', run, null, [], true)
      run = repository.transition(
        run.id,
        owner,
        { status: 'preparing', headSha: event.headSha, specRevision: event.specRevision },
        this.now()
      )
      return await this.provision(run, owner)
    } catch (erro) {
      if (erro instanceof PreviewOwnershipError)
        return this.outcome('busy', repository.get(run.id), true)
      throw erro
    } finally {
      repository.release(run.id, owner)
    }
  }

  private jaPronto(run: PreviewRun, event: PreviewEvent): boolean {
    if (run.status !== 'ready' || run.headSha !== event.headSha) return false
    if (run.specRevision !== event.specRevision) return false
    const recursos = this.deps.repository.resources(run.id)
    const tipos: PreviewResourceKind[] = ['image', 'database', 'backend', 'frontend']
    const completos = tipos.every((k) =>
      recursos.some((r) => r.kind === k && r.state === 'ready' && r.sourceSha === run.headSha)
    )
    return completos && previewProntoParaPublicar(this.deps.repository.currentGates(run.id))
  }

  private async provision(initial: PreviewRun, owner: string): Promise<PreviewOutcome> {
    const { repository } = this.deps
    const sha = initial.headSha
    const gate = (nome: string, result: PreviewGateResult, reason?: string): void => {
      repository.recordGate(
        initial.id,
        owner,
        { sourceSha: sha, gate: nome, result, reason },
        this.now()
      )
    }
    const ctx: ContextoDeEtapa = {
      gate,
      renovar: () => repository.renew(initial.id, owner, this.now())
    }
    try {
      const imagem = await this.etapa('imagem', ctx, () =>
        this.deps.image.ensure({ sourceSha: sha })
      )
      this.recurso(initial, owner, 'image', 'ghcr', imagem.uri, null, 'ready')
      gate('imagem', 'passed')

      const nome = nomeDoAmbienteDePreview(initial.id, initial.generation)
      // A posse é gravada ANTES da chamada: se o processo morrer no meio, a limpeza acha o ambiente.
      this.recurso(initial, owner, 'backend', 'railway', nome, null, 'provisioning')
      this.recurso(initial, owner, 'database', 'railway', nome, null, 'provisioning')
      const ambiente = await this.etapa('backend', ctx, () =>
        this.deps.backend.provision({
          name: nome,
          imageUri: imagem.uri,
          sourceSha: sha,
          previewRunId: initial.id
        })
      )
      const backendUrl = urlPublicaDePreview(ambiente.backendUrl)
      if (!backendUrl) {
        gate('backend', 'blocked', 'backend-url-invalid')
        throw new EtapaFalhou('backend-url-invalid')
      }
      this.recurso(initial, owner, 'backend', 'railway', ambiente.externalId, backendUrl, 'ready')
      this.recurso(
        initial,
        owner,
        'database',
        'railway',
        ambiente.databaseExternalId,
        null,
        'ready'
      )
      gate('backend', 'passed')

      await this.migrar(nome, ctx)

      this.recurso(initial, owner, 'frontend', 'vercel', `meta:${initial.id}`, null, 'provisioning')
      const frontend = await this.etapa('frontend', ctx, () =>
        this.deps.frontend.deploy({ previewRunId: initial.id, sourceSha: sha, backendUrl })
      )
      const frontendUrl = urlPublicaDePreview(frontend.url)
      if (!frontendUrl) {
        gate('frontend', 'blocked', 'frontend-url-invalid')
        throw new EtapaFalhou('frontend-url-invalid')
      }
      this.recurso(initial, owner, 'frontend', 'vercel', frontend.externalId, frontendUrl, 'ready')
      await this.removerDeploymentsAntigos(initial.id, frontend.externalId)

      const resultados = await this.etapa('verificacao', ctx, () =>
        this.deps.verifier.verify({
          previewRunId: initial.id,
          sourceSha: sha,
          backendUrl,
          frontendUrl
        })
      )
      for (const r of resultados) gate(r.gate, r.result, r.reason)
      const vigentes = repository.currentGates(initial.id)
      if (!previewProntoParaPublicar(vigentes)) {
        const bloqueado = vigentes.find((g) => g.result !== 'passed')
        throw new EtapaFalhou(bloqueado?.reason ?? 'gates-incompletos')
      }
      const pronto = repository.transition(initial.id, owner, { status: 'ready' }, this.now())
      return await this.publicar('ready', pronto, null)
    } catch (erro) {
      if (!(erro instanceof EtapaFalhou)) throw erro
      const falho = repository.transition(
        initial.id,
        owner,
        { status: 'failed', reason: erro.reason },
        this.now()
      )
      return await this.publicar('failed', falho, erro.reason)
    }
  }

  /** Migration ou seed que falha impede o estado `ready` (critério 5). */
  private async migrar(nome: string, ctx: ContextoDeEtapa): Promise<void> {
    const { gate } = ctx
    const { seed, migrations } = this.deps.project
    if (seed === undefined) {
      gate('migration', 'unknown', 'seed-missing')
      gate('seed', 'blocked', 'seed-missing')
      throw new EtapaFalhou('seed-missing')
    }
    const resultado = await this.etapa('migration', ctx, () =>
      this.deps.database.migrateAndSeed({ name: nome, migrations, seed })
    )
    if (resultado.state === 'failed') {
      const noSeed = resultado.failedAt === '__seed__'
      gate('migration', noSeed ? 'passed' : 'blocked', noSeed ? undefined : resultado.reason)
      gate('seed', noSeed ? 'blocked' : 'unknown', resultado.reason)
      throw new EtapaFalhou(resultado.reason)
    }
    for (const g of GATES_DE_MIGRATION) gate(g, 'passed')
  }

  private async removerDeploymentsAntigos(previewRunId: string, atual: string): Promise<void> {
    try {
      for (const id of await this.deps.frontend.list(previewRunId))
        if (id !== atual) await this.deps.frontend.destroy(id)
    } catch {
      // Sobra de commit anterior: a limpeza do fechamento remove tudo que leva a marca do run.
    }
  }

  private async etapa<T>(nome: string, ctx: ContextoDeEtapa, fn: () => Promise<T>): Promise<T> {
    try {
      // Estende a posse antes da chamada longa: outro executor não assume um run que ainda trabalha.
      ctx.renovar()
      return await fn()
    } catch (erro) {
      if (erro instanceof PreviewOwnershipError) throw erro
      const codigo = erro instanceof PreviewProviderError ? erro.code : 'failed'
      const reason = `${nome}-${codigo}`
      if (nome !== 'verificacao') ctx.gate(nome, 'blocked', reason)
      throw new EtapaFalhou(reason)
    }
  }

  private recurso(
    run: PreviewRun,
    owner: string,
    kind: PreviewResourceKind,
    provider: PreviewResource['provider'],
    externalId: string,
    url: string | null,
    state: PreviewResource['state'],
    reason: string | null = null
  ): void {
    this.deps.repository.upsertResource(
      run.id,
      owner,
      { kind, provider, externalId, url, sourceSha: run.headSha, state, reason },
      this.now()
    )
  }

  private async destroy(event: PreviewEvent): Promise<PreviewOutcome> {
    const { repository } = this.deps
    const existente = repository.find(event)
    if (!existente) return this.outcome('absent', null, true)
    if (existente.status === 'removed')
      return await this.publicar('removed', existente, null, [], true)
    const owner = `preview-${randomUUID()}`
    const claim = repository.claim(
      event,
      owner,
      this.deps.lockTtlMs ?? PRAZO_DA_POSSE_MS,
      this.now()
    )
    if (claim.outcome === 'busy') return this.outcome('busy', claim.run, true)
    try {
      const limpeza = await this.teardown(claim.run, owner)
      return await this.publicar(
        limpeza.pending.length ? 'removing' : 'removed',
        limpeza.run,
        limpeza.reason,
        limpeza.pending
      )
    } catch (erro) {
      if (erro instanceof PreviewOwnershipError)
        return this.outcome('busy', repository.get(claim.run.id), true)
      throw erro
    } finally {
      repository.release(claim.run.id, owner)
    }
  }

  /** Destrói por posse: frontend pela marca do run, ambiente pelo nome derivado do run. */
  private async teardown(
    inicial: PreviewRun,
    owner: string
  ): Promise<{ run: PreviewRun; pending: PreviewResourceKind[]; reason: string | null }> {
    const { repository, frontend, backend } = this.deps
    let run = repository.transition(inicial.id, owner, { status: 'removing' }, this.now())
    const falhas: PreviewResourceKind[] = []
    let reason: string | null = null
    const marcar = (
      kind: PreviewResourceKind,
      state: 'destroyed' | 'failed',
      motivo?: string
    ): void => {
      const recurso = repository.resources(run.id).find((r) => r.kind === kind)
      if (!recurso) return
      repository.upsertResource(
        run.id,
        owner,
        {
          kind,
          provider: recurso.provider,
          externalId: recurso.externalId,
          url: recurso.url ?? null,
          sourceSha: recurso.sourceSha,
          state,
          reason: motivo ?? null
        },
        this.now()
      )
    }
    const falhar = (kind: PreviewResourceKind, erro: unknown): void => {
      const codigo = erro instanceof PreviewProviderError ? erro.code : 'failed'
      falhas.push(kind)
      reason ??= `destroy-${codigo}`
      marcar(kind, 'failed', `destroy-${codigo}`)
    }

    try {
      for (const id of await frontend.list(run.id)) await frontend.destroy(id)
      // 'absent' vindo de classificação de texto não prova nada: só vale o que a listagem confirma.
      if ((await frontend.list(run.id)).length > 0)
        throw new PreviewProviderError('failed', 'O frontend continua listado depois de removido.')
      marcar('frontend', 'destroyed')
    } catch (erro) {
      falhar('frontend', erro)
    }
    try {
      await backend.destroy(nomeDoAmbienteDePreview(run.id, run.generation))
      marcar('backend', 'destroyed')
      marcar('database', 'destroyed')
    } catch (erro) {
      falhar('backend', erro)
      falhar('database', erro)
    }
    if (!falhas.length)
      run = repository.transition(run.id, owner, { status: 'removed' }, this.now())
    return { run, pending: [...new Set(falhas)], reason }
  }

  private async publicar(
    state: PreviewOutcome['state'],
    run: PreviewRun,
    reason: string | null,
    pending: readonly PreviewResourceKind[] = [],
    repeated = false
  ): Promise<PreviewOutcome> {
    const { repository, publication } = this.deps
    const projecao: PreviewProjection = {
      run,
      resources: repository.resources(run.id),
      gates: repository.currentGates(run.id)
    }
    try {
      await publication.publish(projecao)
      return { ...this.outcome(state, run, repeated, pending, reason), publication: 'published' }
    } catch {
      // Comentário que não saiu não muda o estado do Preview; o próximo evento publica de novo.
      return { ...this.outcome(state, run, repeated, pending, reason), publication: 'failed' }
    }
  }

  private outcome(
    state: PreviewOutcome['state'],
    run: PreviewRun | null,
    repeated: boolean,
    pending: readonly PreviewResourceKind[] = [],
    reason: string | null = null
  ): PreviewOutcome {
    return { state, repeated, run, pending, reason, publication: 'skipped' }
  }
}
