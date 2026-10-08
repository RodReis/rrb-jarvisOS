import type { Database } from 'better-sqlite3'
import type { EscopoDeControle } from '@shared/domain/continuous-controls'

type ChaveDeControle = 'pausa' | 'execucao' | 'gasto' | 'push' | 'criacao-pr' | 'merge'

interface LinhaDeControle {
  readonly chave: ChaveDeControle
  readonly valor: number
  readonly actor: string
  readonly updated_at: string
}

interface LinhaDeComando {
  readonly fingerprint: string
  readonly resultado: string
}

export class ContinuousControlsRepository {
  constructor(private readonly db: Database) {}

  buscar(
    escopo: EscopoDeControle,
    chave: ChaveDeControle
  ): { readonly valor: boolean; readonly actor: string; readonly updatedAt: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT valor, actor, updated_at FROM pipeline_control_policy
          WHERE user_id = ? AND workspace_id = ? AND scope_project_id = ? AND chave = ?`
      )
      .get(escopo.userId, escopo.workspaceId, escopo.projectId ?? '', chave) as
      Omit<LinhaDeControle, 'chave'> | undefined
    return row === undefined
      ? undefined
      : { valor: row.valor === 1, actor: row.actor, updatedAt: row.updated_at }
  }

  listar(escopo: EscopoDeControle): readonly LinhaDeControle[] {
    return this.db
      .prepare(
        `SELECT chave, valor, actor, updated_at FROM pipeline_control_policy
          WHERE user_id = ? AND workspace_id = ? AND scope_project_id = ?`
      )
      .all(escopo.userId, escopo.workspaceId, escopo.projectId ?? '') as LinhaDeControle[]
  }

  salvar(
    escopo: EscopoDeControle,
    chave: ChaveDeControle,
    valor: boolean,
    actor: string,
    updatedAt: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO pipeline_control_policy
           (user_id, workspace_id, scope_project_id, chave, valor, actor, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, workspace_id, scope_project_id, chave) DO UPDATE SET
           valor = excluded.valor,
           actor = excluded.actor,
           updated_at = excluded.updated_at`
      )
      .run(
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId ?? '',
        chave,
        valor ? 1 : 0,
        actor,
        updatedAt
      )
  }

  limpar(escopo: EscopoDeControle, chave: ChaveDeControle): void {
    this.db
      .prepare(
        `DELETE FROM pipeline_control_policy
          WHERE user_id = ? AND workspace_id = ? AND scope_project_id = ? AND chave = ?`
      )
      .run(escopo.userId, escopo.workspaceId, escopo.projectId ?? '', chave)
  }

  listarWorkspace(
    escopo: Pick<EscopoDeControle, 'userId' | 'workspaceId'>
  ): readonly LinhaDeControle[] {
    return this.db
      .prepare(
        `SELECT chave, valor, actor, updated_at FROM pipeline_control_policy
        WHERE user_id = ? AND workspace_id = ? AND scope_project_id = ''`
      )
      .all(escopo.userId, escopo.workspaceId) as LinhaDeControle[]
  }

  buscarWorkspace(
    escopo: Pick<EscopoDeControle, 'userId' | 'workspaceId'>,
    chave: ChaveDeControle
  ): ReturnType<ContinuousControlsRepository['buscar']> {
    const row = this.db
      .prepare(
        `SELECT valor, actor, updated_at FROM pipeline_control_policy
        WHERE user_id = ? AND workspace_id = ? AND scope_project_id = '' AND chave = ?`
      )
      .get(escopo.userId, escopo.workspaceId, chave) as Omit<LinhaDeControle, 'chave'> | undefined
    return row === undefined
      ? undefined
      : { valor: row.valor === 1, actor: row.actor, updatedAt: row.updated_at }
  }

  comando(escopo: EscopoDeControle, idempotencyKey: string): LinhaDeComando | undefined {
    return this.db
      .prepare(
        `SELECT fingerprint, resultado FROM pipeline_control_scope_command
         WHERE user_id = ? AND workspace_id = ? AND scope_project_id = ? AND idempotency_key = ?`
      )
      .get(escopo.userId, escopo.workspaceId, escopo.projectId ?? '', idempotencyKey) as
      LinhaDeComando | undefined
  }

  executarIdempotente<T>(
    escopo: EscopoDeControle,
    idempotencyKey: string,
    fingerprint: string,
    executar: () => T,
    agora: string
  ): T {
    const transacao = this.db.transaction(() => {
      const existente = this.comando(escopo, idempotencyKey)
      if (existente !== undefined) {
        if (existente.fingerprint !== fingerprint) return { conflito: true as const }
        return { resultado: JSON.parse(existente.resultado) as T }
      }
      const resultado = executar()
      this.salvarComando(escopo, idempotencyKey, fingerprint, resultado, agora)
      return { resultado }
    })
    const resultado = transacao()
    if ('conflito' in resultado) throw new Error('idempotency-conflict')
    return resultado.resultado
  }

  private salvarComando(
    escopo: EscopoDeControle,
    idempotencyKey: string,
    fingerprint: string,
    resultado: unknown,
    createdAt: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO pipeline_control_scope_command
           (user_id, workspace_id, scope_project_id, idempotency_key, fingerprint, resultado, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId ?? '',
        idempotencyKey,
        fingerprint,
        JSON.stringify(resultado),
        createdAt
      )
  }
}

export type { ChaveDeControle }
