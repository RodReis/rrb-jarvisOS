import type { GateResult, ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import { GATES_OBRIGATORIOS, ambienteAprovadoTecnicamente } from '@shared/domain/release-promotion'
import type { ReleaseRepository } from './release-repository'

/**
 * Gates técnicos da promoção (SPEC-Release-04). O motor só registra resultados e responde "este
 * ambiente está aprovado?"; a decisão de qual gate é obrigatório mora no domínio puro
 * (`GATES_OBRIGATORIOS`). Quem promove não decide aprovação: pergunta aqui.
 */

export interface GateRecord {
  readonly gate: string
  readonly result: GateResult['result']
  /** Código curto, nunca a mensagem do provedor. */
  readonly reason?: string
}

interface GateInput extends ReleaseScope {
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly gate: string
  readonly result: GateResult['result']
  readonly reasonCode: string | null
}

export interface GateStore {
  recordGate(input: GateInput, now: string): void
  gates(scope: ReleaseScope, releaseId: string): readonly GateResult[]
}

/** O `ReleaseRepository` da F01 como armazém de gates. */
export function gateStoreFrom(repository: ReleaseRepository): GateStore {
  return {
    recordGate: (input, now) => repository.recordGate(input, now),
    gates: (scope, releaseId) => repository.detail({ ...scope, releaseId })?.gates ?? []
  }
}

export class ReleaseGateEngine {
  constructor(
    private readonly store: GateStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  record(
    scope: ReleaseScope,
    releaseId: string,
    environment: ReleaseEnvironment,
    outcome: GateRecord
  ): void {
    this.store.recordGate(
      {
        ...scope,
        releaseId,
        environment,
        gate: outcome.gate,
        result: outcome.result,
        reasonCode: outcome.reason ?? null
      },
      this.now()
    )
  }

  approved(scope: ReleaseScope, releaseId: string, environment: ReleaseEnvironment): boolean {
    return ambienteAprovadoTecnicamente(environment, this.store.gates(scope, releaseId))
  }

  /** O primeiro gate obrigatório que não está `passed`, com o motivo registrado; `null` se aprovado. */
  firstBlocker(
    scope: ReleaseScope,
    releaseId: string,
    environment: ReleaseEnvironment
  ): { gate: string; reason: string | null } | null {
    const gates = this.store.gates(scope, releaseId).filter((g) => g.environment === environment)
    for (const nome of GATES_OBRIGATORIOS[environment]) {
      const vigente = gates
        .filter((g) => g.gate === nome)
        .reduce<GateResult | null>(
          (ultimo, g) => (!ultimo || ultimo.createdAt <= g.createdAt ? g : ultimo),
          null
        )
      if (vigente?.result !== 'passed') return { gate: nome, reason: vigente?.reason ?? null }
    }
    return null
  }
}
