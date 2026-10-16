import type { ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import { acaoMinima, classificarFalha } from '@shared/domain/release-recovery'
import type { EvidenceInput, ReleaseRecoveryRepository } from '../release-recovery-repository'

/**
 * Escritor da evidência de recuperação (SPEC-Release-05): cada parada, retry esgotado, compensação,
 * cancelamento ou pendência vira uma linha append-only com causa, estado e **ação mínima**. Só
 * códigos curtos passam — o repositório recusa o resto. A ação mínima vem da classe da falha, nunca
 * da mensagem do provedor.
 */
export class ReleaseEvidenceWriter {
  constructor(
    private readonly recovery: ReleaseRecoveryRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  record(scope: ReleaseScope, releaseId: string, input: EvidenceInput): void {
    this.recovery.appendEvidence(scope, releaseId, input, this.now())
  }

  /** Três tentativas esgotadas: para com a causa, o número de tentativas e a ação mínima. */
  retriesExhausted(
    scope: ReleaseScope,
    releaseId: string,
    input: {
      readonly environment: ReleaseEnvironment
      readonly step: string
      readonly reason: string
      readonly attempts: number
      /** `ambiguous` = o provedor não respondeu à reconciliação; o efeito segue desconhecido. */
      readonly state?: 'failed' | 'ambiguous'
    }
  ): void {
    const incerto = input.state === 'ambiguous'
    this.record(scope, releaseId, {
      kind: 'retries-exhausted',
      state: input.state ?? 'failed',
      environment: input.environment,
      step: input.step,
      reason: input.reason,
      action: incerto ? 'check-provider-status' : acaoMinima(classificarFalha(input.reason)),
      details: { attempts: input.attempts }
    })
  }
}
