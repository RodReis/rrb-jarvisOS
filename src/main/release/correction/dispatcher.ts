import { createHash } from 'node:crypto'
import type { ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import {
  classificarAchados,
  classificarFalha,
  jsonCanonico,
  retornaParaV2,
  type AchadoAnterior
} from '@shared/domain/release-recovery'
import {
  exigirCodigo,
  type CorrectionClass,
  ReleaseCorrection,
  ReleaseRecoveryRepository
} from '../release-recovery-repository'
import type { ReleaseRepository } from '../release-repository'
import { ReleaseEvidenceWriter } from './evidence-writer'

/**
 * Retorno à V2 (SPEC-Release-05, regra 5 e critério 6). Falha de código, teste, health ou migration
 * abre uma correção **na V2**, na fatia de origem da mesma SPEC, com o histórico das correções
 * anteriores no contexto — e nada mais. O despachante não recebe nenhuma porta de nuvem: corrigir
 * Produção diretamente é impossível por construção, não por disciplina. Sem novo aceite: a V2
 * reaproveita a aprovação vigente da mesma revisão da SPEC.
 */

export class V2CorrectionUnavailable extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'V2CorrectionUnavailable'
  }
}

export interface CorrectionRequest {
  readonly scope: ReleaseScope
  readonly releaseId: string
  readonly sliceId: string
  readonly specId: string | null
  /** Idempotência na V2: o mesmo pedido nunca cria dois runs. */
  readonly dispatchKey: string
  readonly contextJson: string
  readonly contextSha256: string
}

export interface V2CorrectionPort {
  /** Abre o run de correção da fatia na V2. Recusa definitiva lança `V2CorrectionUnavailable`. */
  open(request: CorrectionRequest): Promise<{ runId: string }>
}

export interface CorrectionFailure {
  readonly environment: ReleaseEnvironment
  readonly step?: string
  /** Código curto do motivo; nunca texto de provedor. */
  readonly reason: string
}

export interface CorrectionDispatcherDeps {
  readonly repository: ReleaseRepository
  readonly recovery: ReleaseRecoveryRepository
  readonly v2: V2CorrectionPort
  readonly now?: () => string
}

interface GateDoContexto {
  readonly environment: string
  readonly gate: string
  readonly result: string
  readonly reason: string | null
}

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')

export class ReleaseCorrectionDispatcher {
  private readonly evidence: ReleaseEvidenceWriter

  constructor(private readonly deps: CorrectionDispatcherDeps) {
    this.evidence = new ReleaseEvidenceWriter(deps.recovery, () => this.now())
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))()
  }

  /** `null` quando a falha não é de código: configuração, transitória ou desconhecida é do operador. */
  async dispatch(
    scope: ReleaseScope,
    releaseId: string,
    failure: CorrectionFailure
  ): Promise<ReleaseCorrection | null> {
    exigirCodigo(failure.reason, 'Motivo da falha')
    const classe = classificarFalha(failure.reason)
    if (!retornaParaV2(classe)) return null
    const contexto = this.contexto(scope, releaseId, failure, classe as CorrectionClass)
    const correcao = this.deps.recovery.saveCorrection(
      scope,
      releaseId,
      {
        failureClass: classe as CorrectionClass,
        environment: failure.environment,
        ...(failure.step ? { step: failure.step } : {}),
        reason: failure.reason,
        dispatchKey: `release-correction:${releaseId}`,
        contextJson: contexto,
        contextSha256: sha256(contexto)
      },
      this.now()
    )
    return correcao.state === 'pending' ? this.abrir(scope, correcao) : correcao
  }

  /** Reabre, uma vez, as correções que a V2 ainda não recebeu (queda ou erro transitório). */
  async retryPending(scope: ReleaseScope): Promise<ReleaseCorrection[]> {
    const abertas: ReleaseCorrection[] = []
    for (const pendente of this.deps.recovery.pendingCorrections(scope)) {
      const resultado = await this.abrir(scope, pendente)
      if (resultado.state === 'opened') abertas.push(resultado)
    }
    return abertas
  }

  private async abrir(
    scope: ReleaseScope,
    correcao: ReleaseCorrection
  ): Promise<ReleaseCorrection> {
    const { recovery } = this.deps
    const inclusoes = recovery.inclusions(scope, correcao.releaseId)
    const sliceId = inclusoes.find((i) => i.sliceId)?.sliceId
    if (!sliceId) return this.indisponivel(scope, correcao, 'no-slice')
    try {
      const { runId } = await this.deps.v2.open({
        scope,
        releaseId: correcao.releaseId,
        sliceId,
        specId: inclusoes.find((i) => i.specId)?.specId ?? null,
        dispatchKey: correcao.dispatchKey,
        contextJson: correcao.contextJson,
        contextSha256: correcao.contextSha256
      })
      recovery.markCorrection(scope, correcao.releaseId, { state: 'opened', runId }, this.now())
      this.evidence.record(scope, correcao.releaseId, {
        kind: 'correction',
        state: 'confirmed',
        environment: correcao.environment,
        reason: correcao.reason
      })
    } catch (erro) {
      if (erro instanceof V2CorrectionUnavailable)
        return this.indisponivel(scope, correcao, erro.code)
      // Erro desconhecido: a V2 pode ou não ter recebido. Fica pendente; a chave de dispatch da
      // V2 faz a repetição não duplicar o run.
      this.evidence.record(scope, correcao.releaseId, {
        kind: 'correction',
        state: 'pending',
        environment: correcao.environment,
        reason: 'v2-unreachable',
        action: 'retry-correction'
      })
    }
    return recovery.correction(scope, correcao.releaseId)!
  }

  private indisponivel(
    scope: ReleaseScope,
    correcao: ReleaseCorrection,
    motivo: string
  ): ReleaseCorrection {
    this.deps.recovery.markCorrection(
      scope,
      correcao.releaseId,
      { state: 'unavailable', reason: motivo },
      this.now()
    )
    this.evidence.record(scope, correcao.releaseId, {
      kind: 'correction',
      state: 'failed',
      environment: correcao.environment,
      reason: motivo,
      action: 'open-v2-run-manually'
    })
    return this.deps.recovery.correction(scope, correcao.releaseId)!
  }

  /** Documento entregue à V2: ids, hashes e códigos — nunca texto de PR, URL ou saída de provedor. */
  private contexto(
    scope: ReleaseScope,
    releaseId: string,
    failure: CorrectionFailure,
    classe: CorrectionClass
  ): string {
    const { repository, recovery } = this.deps
    const release = repository.get({ ...scope, releaseId })
    const inclusoes = recovery.inclusions(scope, releaseId)
    const specs = [...new Set(inclusoes.flatMap((i) => (i.specId ? [i.specId] : [])))].sort()
    const anteriores: AchadoAnterior[] = []
    for (const spec of specs)
      for (const antiga of recovery.correctionsForSpec(scope, spec)) {
        if (antiga.releaseId === releaseId) continue
        anteriores.push({
          code: antiga.reason,
          releaseId: antiga.releaseId,
          resolved: recovery.specConcludedAfter(scope, spec, antiga.createdAt)
        })
      }
    // O último resultado de cada gate: o que o ambiente concluiu, não o histórico de tentativas.
    const gates = new Map<string, GateDoContexto>()
    for (const gate of repository.detail({ ...scope, releaseId })?.gates ?? [])
      gates.set(`${gate.environment}:${gate.gate}`, {
        environment: gate.environment,
        gate: gate.gate,
        result: gate.result,
        reason: gate.reason
      })
    return jsonCanonico({
      schema: 1,
      releaseId,
      sha: release?.sha ?? null,
      failure: {
        environment: failure.environment,
        step: failure.step ?? null,
        reason: failure.reason,
        class: classe
      },
      specs,
      inclusions: inclusoes.map((i) => ({
        sha: i.sha,
        pullRequest: i.pullRequest ?? null,
        specId: i.specId ?? null,
        sliceId: i.sliceId ?? null,
        issue: i.issue ?? null
      })),
      gates: [...gates.values()],
      findings: classificarAchados(failure.reason, anteriores),
      evidence: recovery.evidence(scope, releaseId).map((e) => ({
        kind: e.kind,
        state: e.state,
        environment: e.environment ?? null,
        step: e.step ?? null,
        reason: e.reason ?? null,
        action: e.action ?? null
      }))
    })
  }
}
