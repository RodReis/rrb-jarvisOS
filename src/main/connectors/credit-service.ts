/**
 * O gate de créditos de conector (SPEC-Conectores-02, critérios 7 e 8).
 *
 * Junta as três peças que moram separadas de propósito: o **repositório** (teto e consumo), a
 * **decisão pura** (`avaliarCreditos`) e a **auditoria**. É o análogo do `BudgetService` do
 * MVP-005, e a semelhança é deliberada — o que muda é a unidade (créditos, não USD) e o escopo
 * (por conector, não só por espaço).
 *
 * **Os dois ledgers coexistem e estouram separado** (decisão do PI de 2026-08-29). Este serviço
 * não conhece `BudgetService`, e o inverso também vale: nenhum dos dois soma o outro, porque
 * converter crédito em dólar dependeria do plano contratado e produziria número falso.
 *
 * O que este serviço **não** faz: chamar conector. Ele responde "cabe?" e registra a resposta;
 * quem decide o que fazer com o veredito é o ponto único (`ConnectorService`).
 */

import type { ConnectorId } from '@shared/domain/connectors'
import {
  avaliarCreditos,
  type ConnectorCreditPolicy,
  type VereditoDeCredito
} from '@shared/domain/connector-governance'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { CreditEventInput, CreditRepository } from './credit-repository'

/** O escopo de quem pergunta — o mesmo par de `ConnectorCallContext`. */
export interface CreditScope {
  readonly userId: string
  readonly workspace: WorkspaceId
}

/** Teto e consumo de um conector, como a UI e o gate os leem. */
export interface CreditSnapshot {
  readonly policy: ConnectorCreditPolicy
  readonly consumido: { readonly dia: number; readonly mes: number }
}

/**
 * Recusa entrada inválida na fronteira (CONVENTION §2), como o `BudgetInputError`.
 *
 * Teto negativo não é cota apertada: é estado que faz a decisão mentir — qualquer chamada paga
 * bloqueia e o usuário não entende por quê.
 */
export class CreditInputError extends Error {}

export class CreditService {
  constructor(
    private readonly repo: CreditRepository,
    private readonly audit: AuditRepository,
    /**
     * O relógio, injetável — mesma razão do `BudgetService`: o recorte de dia/mês é a regra
     * central do ledger, e testá-lo com `new Date()` fixo no código significaria testá-lo só no
     * dia em que o teste roda.
     */
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Teto atual + consumo do dia e do mês. */
  snapshot(scope: CreditScope, connector: ConnectorId): CreditSnapshot {
    const agora = this.now()
    return {
      policy: this.repo.find(scope.userId, scope.workspace, connector),
      consumido: this.repo.totals(scope.userId, scope.workspace, connector, agora)
    }
  }

  /** Edita o teto do conector naquele escopo. Ação de configuração, auditada. */
  setLimits(
    scope: CreditScope,
    connector: ConnectorId,
    limites: { readonly dailyLimit: number; readonly monthlyLimit: number }
  ): CreditSnapshot {
    for (const [nome, valor] of Object.entries(limites)) {
      if (!Number.isFinite(valor) || valor < 0) {
        throw new CreditInputError(`O limite ${nome} precisa ser um número maior ou igual a zero.`)
      }
    }

    const agora = this.now()
    const anterior = this.repo.find(scope.userId, scope.workspace, connector)
    const policy = this.repo.save(
      { ...anterior, ...limites, user_id: scope.userId, workspace_id: scope.workspace, connector },
      agora
    )

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'connector-credit-change',
      payload: {
        connector,
        de: { dailyLimit: anterior.dailyLimit, monthlyLimit: anterior.monthlyLimit },
        para: { dailyLimit: policy.dailyLimit, monthlyLimit: policy.monthlyLimit }
      }
    })

    return {
      policy,
      consumido: this.repo.totals(scope.userId, scope.workspace, connector, agora)
    }
  }

  /**
   * O gate: decide sobre esta chamada e **audita a decisão** (critério 8).
   *
   * Audita os dois desfechos, não só o bloqueio — pela mesma razão do `BudgetService`: "a cota
   * nunca barrou" e "o gate nunca rodou" são fatos diferentes, e um registro só dos bloqueios
   * os tornaria indistinguíveis.
   */
  check(scope: CreditScope, connector: ConnectorId, custoEstimado: number): VereditoDeCredito {
    const agora = this.now()
    const policy = this.repo.find(scope.userId, scope.workspace, connector)
    const consumido = this.repo.totals(scope.userId, scope.workspace, connector, agora)
    const veredito = avaliarCreditos(policy, consumido, custoEstimado)

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'connector-credit-decision',
      payload: {
        connector,
        decisao: veredito.decisao,
        estimado: custoEstimado,
        consumidoDia: consumido.dia,
        consumidoMes: consumido.mes,
        dailyLimit: policy.dailyLimit,
        monthlyLimit: policy.monthlyLimit,
        ...(veredito.decisao === 'permitido' ? {} : { periodo: veredito.periodo })
      }
    })

    if (veredito.decisao === 'bloqueado') {
      log.integracao.warn('Chamada a conector barrada pelo teto de créditos', {
        workspace: scope.workspace,
        connector,
        periodo: veredito.periodo,
        limite: veredito.limite,
        projetado: veredito.projetado
      })
    }

    return veredito
  }

  /**
   * Registra o consumo de uma chamada que já terminou — o insumo do `totals` da próxima.
   *
   * É o elo que fecha o critério 8: a chamada que consumiu créditos termina, o consumo entra
   * aqui, e a **próxima** é a que o gate barra.
   */
  record(input: Omit<CreditEventInput, 'user_id' | 'workspace_id'>, scope: CreditScope): void {
    this.repo.record({ ...input, user_id: scope.userId, workspace_id: scope.workspace }, this.now())
  }
}
