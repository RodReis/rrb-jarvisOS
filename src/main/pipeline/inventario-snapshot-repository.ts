import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  comporInventario,
  fingerprintInventario,
  type DiagnosticoInventario,
  type InventarioGlobal
} from './inventario-global'
import { log } from '../logging/logger'

export interface EscopoDoInventario {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

interface SnapshotRow {
  readonly fingerprint: string
  readonly payload: string
  readonly payload_hash: string
  readonly observed_at: string
}

export interface SnapshotPersistido {
  readonly inventario: InventarioGlobal
  readonly observadoEm: string
}

/** Snapshot local e escopado. É cache durável reconstruível, nunca substitui STATUS ou GitHub. */
export class InventarioSnapshotRepository {
  constructor(private readonly db: Database) {}

  salvar(
    escopo: EscopoDoInventario,
    inventario: InventarioGlobal,
    observadoEm = new Date().toISOString()
  ): void {
    const payload = JSON.stringify(inventario)
    const payloadHash = createHash('sha256').update(payload, 'utf8').digest('hex')
    this.db
      .prepare(
        `INSERT INTO dag_inventory_snapshot
         (user_id, workspace_id, project_id, fingerprint, payload, payload_hash, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id, project_id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         payload = excluded.payload,
         payload_hash = excluded.payload_hash,
         observed_at = excluded.observed_at`
      )
      .run(
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        inventario.fingerprint,
        payload,
        payloadHash,
        observadoEm
      )
    log.db.info('Snapshot do inventário global gravado', {
      op: 'upsert',
      table: 'dag_inventory_snapshot'
    })
  }

  carregar(escopo: EscopoDoInventario): SnapshotPersistido | undefined {
    const row = this.db
      .prepare(
        `SELECT fingerprint, payload, payload_hash, observed_at FROM dag_inventory_snapshot
       WHERE user_id = ? AND workspace_id = ? AND project_id = ?`
      )
      .get(escopo.userId, escopo.workspaceId, escopo.projectId) as SnapshotRow | undefined
    if (row === undefined) return undefined

    try {
      const payload: unknown = JSON.parse(row.payload)
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !Array.isArray((payload as { nos?: unknown }).nos) ||
        !Array.isArray((payload as { diagnosticos?: unknown }).diagnosticos) ||
        !Array.isArray((payload as { ordem?: unknown }).ordem) ||
        typeof (payload as { fingerprint?: unknown }).fingerprint !== 'string'
      ) {
        throw new Error('payload inválido')
      }
      const inventario = payload as InventarioGlobal
      const calculado = comporInventario(inventario.nos)
      if (
        !inventario.diagnosticos.every(ehDiagnostico) ||
        inventario.fingerprint !== row.fingerprint ||
        createHash('sha256').update(row.payload, 'utf8').digest('hex') !== row.payload_hash ||
        fingerprintInventario(inventario.nos, inventario.diagnosticos) !== row.fingerprint ||
        JSON.stringify(inventario.ordem) !==
          JSON.stringify(inventario.diagnosticos.length > 0 ? [] : calculado.ordem)
      ) {
        throw new Error('fingerprint divergente')
      }
      return { inventario, observadoEm: row.observed_at }
    } catch {
      log.db.warn('Snapshot do inventário ilegível; precisa ser reconstruído pelas fontes', {
        op: 'select',
        table: 'dag_inventory_snapshot'
      })
      return undefined
    }
  }
}

function ehDiagnostico(valor: unknown): valor is DiagnosticoInventario {
  if (typeof valor !== 'object' || valor === null) return false
  const diagnostico = valor as Partial<DiagnosticoInventario>
  return (
    [
      'duplicidade',
      'dependencia-ausente',
      'ciclo',
      'referencia-quebrada',
      'item-orfao',
      'conflito-projecao'
    ].includes(diagnostico.codigo ?? '') &&
    Array.isArray(diagnostico.envolvidos) &&
    diagnostico.envolvidos.every((id) => typeof id === 'string') &&
    typeof diagnostico.mensagem === 'string'
  )
}
