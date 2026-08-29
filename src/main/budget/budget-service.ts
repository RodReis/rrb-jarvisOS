/**
 * O gate de orçamento (SPEC-Providers-03, critérios 2, 6 e 8).
 *
 * Junta as três peças que moram separadas de propósito: o **repositório** (limites e gasto),
 * a **decisão pura** (`avaliarOrcamento`) e a **auditoria**. Roda no main; o renderer edita
 * limites e lê o acumulado por IPC tipado, e nunca calcula nada (critério 8).
 *
 * O que este serviço **não** faz: chamar provider. Ele responde "cabe?" e registra a resposta;
 * quem decide o que fazer com o veredito é o ponto único de chamada (`AiCallService`). Inverter
 * — o gate disparando a chamada — colocaria duas responsabilidades num lugar onde o teste do
 * critério 2 passaria a precisar de um adapter.
 */

import {
  avaliarOrcamento,
  type BudgetLimitsInput,
  type BudgetSnapshot,
  type VereditoDoOrcamento
} from '@shared/domain/budget'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { BudgetRepository, CostEventInput } from './budget-repository'

/** O escopo de quem pergunta — o mesmo par de `AiCallContext` (F02). */
export interface BudgetScope {
  readonly userId: string
  readonly workspace: WorkspaceId
}

/**
 * Recusa a entrada inválida na fronteira (CONVENTION §2: validar no limite do sistema).
 *
 * Limite negativo e limiar fora de 0–1 não são orçamentos apertados: são estado que faz a
 * decisão mentir — um limiar 1,5 nunca alerta, um limite -1 bloqueia tudo sem o usuário
 * entender por quê. Recusar aqui é mais barato que descobrir depois na tela.
 */
export class BudgetInputError extends Error {}

function validar(limites: BudgetLimitsInput): void {
  const finito = (n: number): boolean => Number.isFinite(n)

  if (!finito(limites.dailyLimit) || limites.dailyLimit < 0) {
    throw new BudgetInputError('O limite diário precisa ser um número maior ou igual a zero.')
  }
  if (!finito(limites.monthlyLimit) || limites.monthlyLimit < 0) {
    throw new BudgetInputError('O limite mensal precisa ser um número maior ou igual a zero.')
  }
  if (
    !finito(limites.alertThreshold) ||
    limites.alertThreshold <= 0 ||
    limites.alertThreshold > 1
  ) {
    throw new BudgetInputError('O limiar de alerta precisa estar entre 0 e 1 (por exemplo, 0,8).')
  }
}

export class BudgetService {
  constructor(
    private readonly repo: BudgetRepository,
    private readonly audit: AuditRepository,
    /**
     * O relógio, injetável. Não é cerimônia: o recorte de dia/mês é a regra central do
     * critério 3, e testá-lo com `new Date()` fixo no código significaria não testá-lo —
     * ou testá-lo só no dia em que o teste roda.
     */
    private readonly now: () => Date = () => new Date()
  ) {}

  /** O que a tela de Settings mostra: limites atuais + acumulado do dia e do mês. */
  snapshot(scope: BudgetScope): BudgetSnapshot {
    const agora = this.now()
    return {
      policy: this.repo.find(scope.userId, scope.workspace),
      gasto: this.repo.totals(scope.userId, scope.workspace, agora)
    }
  }

  /** Edita os limites do escopo. Ação de configuração: auditada como `budget-change`. */
  setLimits(scope: BudgetScope, limites: BudgetLimitsInput): BudgetSnapshot {
    validar(limites)

    const agora = this.now()
    const anterior = this.repo.find(scope.userId, scope.workspace)
    const policy = this.repo.save(
      { ...anterior, ...limites, user_id: scope.userId, workspace_id: scope.workspace },
      agora
    )

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'budget-change',
      payload: {
        de: {
          dailyLimit: anterior.dailyLimit,
          monthlyLimit: anterior.monthlyLimit,
          alertThreshold: anterior.alertThreshold
        },
        para: {
          dailyLimit: policy.dailyLimit,
          monthlyLimit: policy.monthlyLimit,
          alertThreshold: policy.alertThreshold
        }
      }
    })

    return { policy, gasto: this.repo.totals(scope.userId, scope.workspace, agora) }
  }

  /**
   * O gate: decide sobre esta chamada e **audita a decisão** (critérios 2 e 6).
   *
   * Audita os três desfechos, não só o bloqueio. "O orçamento nunca barrou" e "o gate nunca
   * rodou" são fatos diferentes, e um log só dos bloqueios os tornaria indistinguíveis.
   */
  check(scope: BudgetScope, estimativaUsd: number): VereditoDoOrcamento {
    const agora = this.now()
    const policy = this.repo.find(scope.userId, scope.workspace)
    const gasto = this.repo.totals(scope.userId, scope.workspace, agora)
    const veredito = avaliarOrcamento(policy, gasto, estimativaUsd)

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'budget-decision',
      payload: {
        decisao: veredito.decisao,
        estimadoUsd: estimativaUsd,
        acumuladoDiaUsd: gasto.diaUsd,
        acumuladoMesUsd: gasto.mesUsd,
        dailyLimit: policy.dailyLimit,
        monthlyLimit: policy.monthlyLimit,
        ...(veredito.decisao === 'permitido' ? {} : { periodo: veredito.periodo })
      }
    })

    if (veredito.decisao !== 'permitido') {
      const registrar = veredito.decisao === 'bloqueado' ? log.ai.warn : log.ai.info
      registrar(
        veredito.decisao === 'bloqueado'
          ? 'Chamada barrada pelo orçamento'
          : 'Orçamento cruzou o limiar de alerta',
        {
          workspace: scope.workspace,
          periodo: veredito.periodo,
          limiteUsd: veredito.limiteUsd,
          projetadoUsd: veredito.projetadoUsd
        }
      )
    }

    return veredito
  }

  /**
   * Registra o custo de uma chamada que já terminou — o insumo do `totals` da próxima.
   *
   * É o elo que fecha o critério 4: a chamada que estourou no meio do stream **termina**, o
   * gasto real entra aqui, e a próxima chamada é barrada por ele.
   */
  record(input: Omit<CostEventInput, 'user_id' | 'workspace_id'>, scope: BudgetScope): void {
    this.repo.recordCost(
      { ...input, user_id: scope.userId, workspace_id: scope.workspace },
      this.now()
    )
  }
}
