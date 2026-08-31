/**
 * Persistência do roteamento e do modelo ativo (SPEC-Providers-04, critérios 3 e 5).
 *
 * Camada fina, como o `BudgetRepository`: guarda e devolve. A decisão de qual provider atende é
 * da função pura em `@shared/domain/routing`; a auditoria é do `RoutingService`.
 */

import type { Database } from 'better-sqlite3'
import { MODELO_PADRAO, TABELA_DE_PRECO, type AiProvider } from '@shared/domain/ai'
import {
  ROTEAMENTO_PADRAO,
  TASK_TYPES,
  isProviderRoute,
  type ProviderRoute,
  type RoutingPolicy,
  type TaskType
} from '@shared/domain/routing'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'

interface RotaRow {
  readonly task_type: string
  readonly preferencia: string
  readonly preferir_local: number
}

export class RoutingRepository {
  constructor(private readonly db: Database) {}

  /**
   * As rotas do escopo, com as **padrão preenchendo** o que nunca foi editado.
   *
   * Mescla por tipo, e não tudo-ou-nada: editar a rota de `chat` não pode fazer as outras
   * quatro sumirem, e um `find` que devolvesse só o gravado deixaria `code` sem preferência
   * nenhuma depois da primeira edição.
   */
  find(userId: string, workspaceId: WorkspaceId): RoutingPolicy {
    const linhas = this.db
      .prepare(
        `SELECT task_type, preferencia, preferir_local
           FROM provider_route
          WHERE user_id = ? AND workspace_id = ?`
      )
      .all(userId, workspaceId) as RotaRow[]

    const rotas: Record<TaskType, ProviderRoute> = { ...ROTEAMENTO_PADRAO }

    for (const linha of linhas) {
      const candidata = {
        taskType: linha.task_type,
        preferencia: this.lerPreferencia(linha.preferencia),
        preferirLocal: linha.preferir_local === 1
      }

      // Valida na leitura, e não só na escrita: o banco é arquivo no disco do usuário, e uma
      // linha corrompida (ou gravada por versão anterior com outro formato) não pode virar uma
      // rota que aponta para provider inexistente. Linha inválida cai no padrão — que é a
      // degradação certa, porque o app continua roteando.
      if (!isProviderRoute(candidata)) {
        log.db.warn('Rota de provider ignorada por não casar com o contrato', {
          taskType: linha.task_type
        })
        continue
      }

      rotas[candidata.taskType] = candidata
    }

    return { user_id: userId, workspace_id: workspaceId, rotas }
  }

  private lerPreferencia(raw: string): readonly string[] {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }

  /** Grava (ou substitui) a rota de um tipo de tarefa e devolve o conjunto resultante. */
  save(userId: string, workspaceId: WorkspaceId, rota: ProviderRoute, agora: Date): RoutingPolicy {
    this.db
      .prepare(
        `INSERT INTO provider_route
           (user_id, workspace_id, task_type, preferencia, preferir_local, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, task_type) DO UPDATE SET
           preferencia    = excluded.preferencia,
           preferir_local = excluded.preferir_local,
           updated_at     = excluded.updated_at`
      )
      .run(
        userId,
        workspaceId,
        rota.taskType,
        JSON.stringify(rota.preferencia),
        rota.preferirLocal ? 1 : 0,
        agora.toISOString()
      )

    log.db.info('Rota de provider atualizada', {
      workspace: workspaceId,
      taskType: rota.taskType,
      preferencia: rota.preferencia
    })

    return this.find(userId, workspaceId)
  }

  /**
   * O modelo ativo de um provider, ou o padrão quando nunca foi trocado.
   *
   * Modelo desconhecido na tabela de preço cai no padrão em vez de ser devolvido: um modelo que
   * não está na tabela custaria zero na conta da F03, e um orçamento que não vê o gasto é pior
   * que um modelo trocado de volta.
   */
  modeloAtivo(userId: string, workspaceId: WorkspaceId, provider: AiProvider): string {
    const linha = this.db
      .prepare(
        `SELECT model FROM active_model
          WHERE user_id = ? AND workspace_id = ? AND provider = ?`
      )
      .get(userId, workspaceId, provider) as { model: string } | undefined

    if (linha === undefined) return MODELO_PADRAO[provider]
    if (TABELA_DE_PRECO[provider][linha.model] === undefined) {
      log.db.warn('Modelo ativo fora da tabela de preço; usando o padrão do provider', {
        provider,
        modelo: linha.model
      })
      return MODELO_PADRAO[provider]
    }

    return linha.model
  }

  /**
   * Troca o modelo ativo. Recusa modelo fora da tabela de preço — **na escrita**, para o
   * inválido não chegar ao disco (a checagem na leitura é a segunda barreira, para o que já
   * está lá).
   */
  saveModelo(
    userId: string,
    workspaceId: WorkspaceId,
    provider: AiProvider,
    modelo: string,
    agora: Date
  ): boolean {
    if (TABELA_DE_PRECO[provider][modelo] === undefined) return false

    this.db
      .prepare(
        `INSERT INTO active_model (user_id, workspace_id, provider, model, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, provider) DO UPDATE SET
           model      = excluded.model,
           updated_at = excluded.updated_at`
      )
      .run(userId, workspaceId, provider, modelo, agora.toISOString())

    return true
  }

  /** Os modelos que um provider oferece — o que a tela lista no seletor de troca. */
  modelosDisponiveis(provider: AiProvider): readonly string[] {
    return Object.keys(TABELA_DE_PRECO[provider])
  }

  /** Os cinco tipos, para o serviço iterar sem redeclarar a lista. */
  get tiposDeTarefa(): readonly TaskType[] {
    return TASK_TYPES
  }
}
