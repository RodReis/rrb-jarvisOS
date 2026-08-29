/**
 * Persistência do ledger de créditos de conector (SPEC-Conectores-02, critérios 7 e 8).
 *
 * Camada fina, espelhando o `BudgetRepository` do MVP-005: guarda o teto do escopo e soma os
 * `credit_event` do período. A decisão é da função pura em `@shared/domain/connector-governance`;
 * o serviço junta as duas. A separação permite testar o recorte de período sem envolver
 * política, e a política sem envolver banco.
 *
 * **Ledger separado do de USD** por decisão do PI (2026-08-29): a Tavily cobra em créditos e o
 * GitHub não cobra; converter para dólar dependeria do plano contratado e produziria número
 * falso, além de esconder qual orçamento estourou.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ConnectorId } from '@shared/domain/connectors'
import {
  tetoDeCreditosPadrao,
  type ConnectorCreditPolicy,
  type CreditosConsumidos
} from '@shared/domain/connector-governance'
import { log } from '../logging/logger'

interface PolicyRow {
  readonly daily_limit: number
  readonly monthly_limit: number
}

/** O que se grava ao fim de uma chamada — o consumo declarado pelo adapter, com o escopo. */
export interface CreditEventInput {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly connector: ConnectorId
  readonly operation: string
  /** O `correlationId` da chamada — casa o consumo com a auditoria e o log (critério 7). */
  readonly correlationId: string
  readonly creditos: number
  /** Nulo até o MVP-008, onde projeto nasce (critério 7). */
  readonly projectId?: string
}

export class CreditRepository {
  constructor(private readonly db: Database) {}

  /**
   * O teto do escopo, ou o **padrão** quando nunca foi editado.
   *
   * Ausência de linha é o padrão valendo, não erro — como em `budget_policy`: o app tem teto
   * desde o primeiro boot, sem semear linha por usuário e sem a pergunta "e quem já existia
   * antes desta migration?".
   */
  find(userId: string, workspaceId: WorkspaceId, connector: ConnectorId): ConnectorCreditPolicy {
    const row = this.db
      .prepare(
        `SELECT daily_limit, monthly_limit
           FROM connector_credit_policy
          WHERE user_id = ? AND workspace_id = ? AND connector = ?`
      )
      .get(userId, workspaceId, connector) as PolicyRow | undefined

    if (row === undefined) return tetoDeCreditosPadrao(userId, workspaceId, connector)

    return {
      user_id: userId,
      workspace_id: workspaceId,
      connector,
      dailyLimit: row.daily_limit,
      monthlyLimit: row.monthly_limit
    }
  }

  /** Grava (ou substitui) o teto. A PK composta faz disto um UPDATE — é um teto por escopo. */
  save(policy: ConnectorCreditPolicy, agora: Date): ConnectorCreditPolicy {
    this.db
      .prepare(
        `INSERT INTO connector_credit_policy
           (user_id, workspace_id, connector, daily_limit, monthly_limit, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, connector) DO UPDATE SET
           daily_limit   = excluded.daily_limit,
           monthly_limit = excluded.monthly_limit,
           updated_at    = excluded.updated_at`
      )
      .run(
        policy.user_id,
        policy.workspace_id,
        policy.connector,
        policy.dailyLimit,
        policy.monthlyLimit,
        agora.toISOString()
      )

    log.db.info('Teto de créditos de conector atualizado', {
      workspace: policy.workspace_id,
      connector: policy.connector,
      dailyLimit: policy.dailyLimit,
      monthlyLimit: policy.monthlyLimit
    })

    return policy
  }

  /** Registra o consumo de uma chamada. Zero é fato (o GitHub não cobra), não ausência. */
  record(input: CreditEventInput, agora: Date): void {
    this.db
      .prepare(
        `INSERT INTO credit_event
           (id, user_id, workspace_id, connector, operation, correlation_id, creditos, project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.user_id,
        input.workspace_id,
        input.connector,
        input.operation,
        input.correlationId,
        input.creditos,
        input.projectId ?? null,
        agora.toISOString()
      )
  }

  /**
   * Créditos consumidos no dia e no mês correntes, por escopo **e conector**.
   *
   * Recorte por prefixo do ISO (`2026-08-29` e `2026-08`), como no `BudgetRepository`, e pela
   * mesma razão: o `created_at` é gravado em ISO UTC, então o prefixo **é** o período. Calcular
   * fronteiras exigiria acertar fim de mês, ano bissexto e horário de verão — três chances de
   * errar para responder a mesma pergunta.
   *
   * Filtra por `connector` porque o teto é por conector: somar tudo faria a Tavily esgotar a
   * cota do GitHub, que nem cobra.
   */
  totals(
    userId: string,
    workspaceId: WorkspaceId,
    connector: ConnectorId,
    agora: Date
  ): CreditosConsumidos {
    const iso = agora.toISOString()
    const dia = iso.slice(0, 10)
    const mes = iso.slice(0, 7)

    const somar = (prefixo: string): number => {
      const row = this.db
        .prepare(
          `SELECT SUM(creditos) AS total
             FROM credit_event
            WHERE user_id = ? AND workspace_id = ? AND connector = ?
              AND created_at LIKE ? || '%'`
        )
        .get(userId, workspaceId, connector, prefixo) as { total: number | null } | undefined

      return row?.total ?? 0
    }

    return { dia: somar(dia), mes: somar(mes) }
  }
}
