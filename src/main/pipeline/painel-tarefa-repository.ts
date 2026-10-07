import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import {
  COTA_BYTES_DO_PAINEL,
  RETENCAO_DIAS_DO_PAINEL,
  decidirSnapshot,
  caminhoRelativoDoPainelValido,
  type EstadoDoSnapshot,
  type SnapshotDeArquivoDaTarefa,
  type SnapshotDoDiffDaTarefa
} from '@shared/domain/painel-tarefa'
import type { WorkspaceId } from '@shared/domain/entities'

export interface SnapshotCapturado {
  readonly caminho: string
  readonly tipo: 'texto' | 'binario' | 'removido'
  readonly bytes: number
  readonly sha256: string
  readonly conteudo?: string
  readonly diff?: string
}

interface SnapshotRow {
  readonly id: string
  readonly task_id: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly kind: 'texto' | 'binario' | 'removido' | 'diff'
  readonly estado: EstadoDoSnapshot
  readonly content: Buffer | null
  readonly created_at: string
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

export class PainelDaTarefaRepository {
  constructor(
    private readonly db: Database,
    private readonly agora: () => Date = () => new Date()
  ) {}

  salvarSnapshots(
    escopo: {
      readonly userId: string
      readonly workspace: WorkspaceId
      readonly projectId: string
    },
    runId: string,
    tarefaId: string,
    itens: readonly SnapshotCapturado[]
  ): boolean {
    if (runId.trim() === '' || tarefaId.trim() === '') return false
    const gravar = this.db.prepare(
      `INSERT INTO squad_task_snapshot
       (id,user_id,workspace_id,project_id,run_id,task_id,path,sha256,bytes,kind,state,content,created_at,expired_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`
    )
    const agora = this.agora().toISOString()
    let reservado = 0
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM squad_task_snapshot WHERE user_id=? AND workspace_id=? AND project_id=? AND run_id=? AND task_id=?`
        )
        .run(escopo.userId, escopo.workspace, escopo.projectId, runId, tarefaId)
      reservado = (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(bytes), 0) AS bytes FROM squad_task_snapshot
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ? AND content IS NOT NULL`
          )
          .get(escopo.userId, escopo.workspace, escopo.projectId, runId) as {
          readonly bytes: number
        }
      ).bytes
      for (const item of itens) {
        if (!caminhoRelativoDoPainelValido(item.caminho) && item.caminho !== '__diff__') continue
        const conteudo = item.conteudo
        const diff = item.diff
        const contentBytes = conteudo === undefined ? 0 : Buffer.byteLength(conteudo, 'utf8')
        const diffBytes = diff === undefined ? 0 : Buffer.byteLength(diff, 'utf8')
        const decisao = decidirSnapshot({
          bytesDoConteudo: contentBytes,
          bytesDoDiff: diffBytes,
          bytesDoRunJaGravados: reservado
        })
        const permitido = item.tipo === 'texto' && conteudo !== undefined && decisao.permitido
        const state: EstadoDoSnapshot =
          item.tipo === 'texto' && !permitido ? 'incompleto' : 'disponivel'
        const id = randomUUID()
        const content = permitido && conteudo !== undefined ? Buffer.from(conteudo, 'utf8') : null
        gravar.run(
          id,
          escopo.userId,
          escopo.workspace,
          escopo.projectId,
          runId,
          tarefaId,
          item.caminho,
          permitido ? sha256(content!) : item.sha256,
          item.bytes,
          item.tipo,
          state,
          content,
          agora
        )
        if (permitido) reservado += contentBytes
        if (diff !== undefined) {
          const diffDecision = decidirSnapshot({
            bytesDoConteudo: 0,
            bytesDoDiff: diffBytes,
            bytesDoRunJaGravados: reservado
          })
          const diffAllowed = diffDecision.permitido && diffBytes > 0
          const diffId = randomUUID()
          gravar.run(
            diffId,
            escopo.userId,
            escopo.workspace,
            escopo.projectId,
            runId,
            tarefaId,
            `diff/${item.caminho}`,
            sha256(diff),
            diffBytes,
            'diff',
            diffAllowed ? 'disponivel' : 'incompleto',
            diffAllowed ? Buffer.from(diff, 'utf8') : null,
            agora
          )
          if (diffAllowed) reservado += diffBytes
        }
      }
    })()
    this.aplicarRetencao(escopo.userId)
    return true
  }

  snapshots(
    escopo: {
      readonly userId: string
      readonly workspace: WorkspaceId
      readonly projectId: string
    },
    runId: string,
    tarefaId: string
  ): {
    readonly arquivos: readonly SnapshotDeArquivoDaTarefa[]
    readonly diffs: readonly SnapshotDoDiffDaTarefa[]
  } {
    const rows = this.db
      .prepare(
        `SELECT id,task_id,path,sha256,bytes,kind,state AS estado,content,created_at
         FROM squad_task_snapshot WHERE user_id=? AND workspace_id=? AND project_id=? AND run_id=? AND task_id=?
         ORDER BY path`
      )
      .all(escopo.userId, escopo.workspace, escopo.projectId, runId, tarefaId) as SnapshotRow[]
    const arquivos = rows
      .filter((row) => row.kind !== 'diff')
      .map((row) => ({
        id: row.id,
        caminho: row.path,
        sha256: row.sha256,
        bytes: row.bytes,
        tipo: row.kind as 'texto' | 'binario' | 'removido',
        estado:
          row.content === null && row.estado === 'disponivel' && row.kind === 'texto'
            ? 'expirado'
            : row.estado
      }))
    return {
      arquivos,
      diffs: rows
        .filter((row) => row.kind === 'diff')
        .map((row) => ({
          id: row.id,
          caminho: row.path.slice('diff/'.length),
          sha256: row.sha256,
          bytes: row.bytes,
          estado: row.content === null && row.estado === 'disponivel' ? 'expirado' : row.estado
        }))
    }
  }

  conteudo(
    escopo: {
      readonly userId: string
      readonly workspace: WorkspaceId
      readonly projectId: string
    },
    runId: string,
    snapshotId: string
  ): string | undefined {
    const row = this.db
      .prepare(
        `SELECT content,sha256 FROM squad_task_snapshot
        WHERE id=? AND user_id=? AND workspace_id=? AND project_id=? AND run_id=? AND content IS NOT NULL`
      )
      .get(snapshotId, escopo.userId, escopo.workspace, escopo.projectId, runId) as
      { readonly content: Buffer; readonly sha256: string } | undefined
    if (row === undefined || sha256(row.content) !== row.sha256) return undefined
    return row.content.toString('utf8')
  }

  private aplicarRetencao(userId: string): void {
    const rows = this.db
      .prepare(
        `SELECT a.id,a.bytes,a.created_at,r.estado FROM squad_task_snapshot a
        JOIN pipeline_run r ON r.id=a.run_id AND r.user_id=a.user_id
       WHERE a.user_id=? AND a.content IS NOT NULL AND a.state='disponivel'
       ORDER BY a.created_at`
      )
      .all(userId) as {
      readonly id: string
      readonly bytes: number
      readonly created_at: string
      readonly estado: string
    }[]
    const agora = this.agora().getTime()
    const elegiveis = rows.filter((row) => ['MERGED', 'CANCELLED'].includes(row.estado))
    const expirar = new Set(
      elegiveis
        .filter((row) => Date.parse(row.created_at) < agora - RETENCAO_DIAS_DO_PAINEL * 86_400_000)
        .map((row) => row.id)
    )
    let totalElegivel = elegiveis
      .filter((row) => !expirar.has(row.id))
      .reduce((sum, row) => sum + row.bytes, 0)
    for (const row of elegiveis) {
      if (totalElegivel <= COTA_BYTES_DO_PAINEL) break
      if (!expirar.has(row.id)) {
        expirar.add(row.id)
        totalElegivel -= row.bytes
      }
    }
    if (expirar.size === 0) return
    const update = this.db.prepare(
      `UPDATE squad_task_snapshot SET content=NULL,state='expirado',expired_at=? WHERE id=?`
    )
    this.db.transaction(() => {
      for (const id of expirar) update.run(new Date(agora).toISOString(), id)
    })()
  }
}
