/**
 * Persistência do orçamento e do gasto (SPEC-Providers-03, critérios 1 e 3).
 *
 * Camada fina: guarda a `BudgetPolicy` do escopo e soma os `CostEvent` do período. A decisão
 * é da função pura em `@shared/domain/budget`; o serviço junta as duas. A separação é o que
 * permite testar o recorte de período sem envolver política, e a política sem envolver banco.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import {
  MOEDA_DO_ORCAMENTO,
  orcamentoPadrao,
  type BudgetPolicy,
  type GastoAcumulado
} from '@shared/domain/budget'
import { log } from '../logging/logger'

interface PolicyRow {
  readonly daily_limit: number
  readonly monthly_limit: number
  readonly alert_threshold: number
  readonly currency: string
}

/** O que se grava ao fim de uma chamada — o `CostEvent` da F02 com o escopo e o instante. */
export interface CostEventInput {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /** O `id` da chamada (o `correlationId` do log) — casa o custo com a auditoria e o stream. */
  readonly callId: string
  readonly provider: AiProvider
  readonly model: string
  /**
   * USD estimado na rota paga; **`null` na rota de assinatura** (SPEC-Planejamento-02,
   * critério 1a). `null` e não zero: zero afirmaria "custou nada", `null` diz "não se converte
   * em USD" — que é o fato da rota MAX. Converter seria número inventado, e o gate barraria com
   * base nele (emenda do PI de 2026-08-29).
   */
  readonly estimadoUsd: number | null
  /** Ausente quando a chamada não chegou ao `usage` — grava NULL, não zero. */
  readonly realUsd?: number
  /**
   * `true` quando a rota registra uso sem valor monetário.
   *
   * Coluna e não dedução do `provider`: é **fato da linha**. Deduzi-lo consultando
   * `ROTAS_UNMETERED` na leitura faria as linhas antigas mudarem de significado no dia em que
   * a lista mudasse — e o ledger é justamente o que não pode mudar de significado depois.
   */
  readonly unmetered?: boolean
  /**
   * Tokens e tempo — **o que a rota de assinatura registra no lugar do dinheiro** (spec §
   * Orçamento: "chamadas, tokens e tempo"). Sem eles, a linha da rota de assinatura seria uma
   * linha de números vazios, indistinguível de erro.
   */
  readonly tokensEntrada?: number
  readonly tokensSaida?: number
  readonly latenciaTotalMs?: number
  /** O projeto e o manifesto que originaram a chamada, quando ela veio do planejamento. */
  readonly projectId?: string
  readonly contextPackId?: string
}

export class BudgetRepository {
  constructor(private readonly db: Database) {}

  /**
   * O orçamento do escopo, ou o **padrão** quando nunca foi editado (critério 1).
   *
   * Ausência de linha é o padrão valendo, não erro: o app tem orçamento desde o primeiro boot,
   * sem semear linha por usuário. Semear criaria a pergunta "e quem já existia antes desta
   * migration?" — que o default em código não tem.
   */
  find(userId: string, workspaceId: WorkspaceId): BudgetPolicy {
    const row = this.db
      .prepare(
        `SELECT daily_limit, monthly_limit, alert_threshold, currency
           FROM budget_policy
          WHERE user_id = ? AND workspace_id = ?`
      )
      .get(userId, workspaceId) as PolicyRow | undefined

    if (row === undefined) return orcamentoPadrao(userId, workspaceId)

    return {
      user_id: userId,
      workspace_id: workspaceId,
      dailyLimit: row.daily_limit,
      monthlyLimit: row.monthly_limit,
      alertThreshold: row.alert_threshold,
      currency: MOEDA_DO_ORCAMENTO
    }
  }

  /**
   * Grava (ou substitui) o orçamento do escopo. A PK composta faz disto um UPDATE da linha
   * existente — o orçamento é um por escopo, não um histórico.
   */
  save(policy: BudgetPolicy, agora: Date): BudgetPolicy {
    this.db
      .prepare(
        `INSERT INTO budget_policy
           (user_id, workspace_id, daily_limit, monthly_limit, alert_threshold, currency, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id) DO UPDATE SET
           daily_limit     = excluded.daily_limit,
           monthly_limit   = excluded.monthly_limit,
           alert_threshold = excluded.alert_threshold,
           currency        = excluded.currency,
           updated_at      = excluded.updated_at`
      )
      .run(
        policy.user_id,
        policy.workspace_id,
        policy.dailyLimit,
        policy.monthlyLimit,
        policy.alertThreshold,
        policy.currency,
        agora.toISOString()
      )

    log.db.info('Orçamento atualizado', {
      workspace: policy.workspace_id,
      dailyLimit: policy.dailyLimit,
      monthlyLimit: policy.monthlyLimit,
      alertThreshold: policy.alertThreshold
    })

    return policy
  }

  /** Registra o custo de uma chamada concluída (ou falha, sem `realUsd`). */
  recordCost(input: CostEventInput, agora: Date): void {
    this.db
      .prepare(
        `INSERT INTO cost_event
           (id, user_id, workspace_id, call_id, provider, model, estimado_usd, real_usd, created_at,
            unmetered, tokens_entrada, tokens_saida, latencia_total_ms, project_id, context_pack_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.user_id,
        input.workspace_id,
        input.callId,
        input.provider,
        input.model,
        input.estimadoUsd,
        input.realUsd ?? null,
        agora.toISOString(),
        input.unmetered === true ? 1 : 0,
        input.tokensEntrada ?? null,
        input.tokensSaida ?? null,
        input.latenciaTotalMs ?? null,
        input.projectId ?? null,
        input.contextPackId ?? null
      )
  }

  /**
   * Soma dos `CostEvent` **reais** do dia e do mês correntes, por escopo (critério 3).
   *
   * Recorte por prefixo do ISO (`2026-08-29` e `2026-08`), e não por `BETWEEN` com datas
   * calculadas: o `created_at` é gravado em ISO UTC, então o prefixo **é** o período. Calcular
   * fronteiras exigiria acertar o fim do mês, o ano bissexto e o horário de verão — três
   * chances de errar para responder a mesma pergunta.
   *
   * `SUM` ignora NULL, então a chamada sem custo medido não entra como zero: ela não conta,
   * que é a resposta honesta para "não se sabe quanto custou". `?? 0` cobre o caso de nenhuma
   * linha, em que o `SUM` devolve NULL.
   *
   * O fuso é o **UTC**, não o local: a soma tem de casar com o `created_at` gravado, e gravar
   * em UTC e recortar em local faria o dia virar em hora errada.
   *
   * **`unmetered = 0` é filtro explícito, não acidente** (SPEC-Planejamento-02, critério 1a).
   * A linha da rota de assinatura já tem `real_usd` NULL, e o `SUM` a ignoraria de qualquer
   * forma — mas depender disso faria a isenção viver num efeito colateral: no dia em que
   * alguém preenchesse `real_usd` para "não deixar coluna vazia", o uso do MAX entraria na
   * soma e passaria a barrar a rota que o PI decidiu não barrar. O `WHERE` diz a regra.
   */
  totals(userId: string, workspaceId: WorkspaceId, agora: Date): GastoAcumulado {
    const iso = agora.toISOString()
    const dia = iso.slice(0, 10) // AAAA-MM-DD
    const mes = iso.slice(0, 7) // AAAA-MM

    const somar = (prefixo: string): number => {
      const row = this.db
        .prepare(
          `SELECT SUM(real_usd) AS total
             FROM cost_event
            WHERE user_id = ? AND workspace_id = ? AND created_at LIKE ? || '%'
              AND unmetered = 0`
        )
        .get(userId, workspaceId, prefixo) as { total: number | null }

      return row.total ?? 0
    }

    return { diaUsd: somar(dia), mesUsd: somar(mes) }
  }
}
