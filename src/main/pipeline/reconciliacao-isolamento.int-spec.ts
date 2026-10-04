/**
 * A reconciliação do boot consulta o isolamento por run (SPEC-Scheduler-03).
 *
 * Antes, ela só enxergava o que tinha lease: container, rede e sidecar criados antes do lease (ou
 * depois de ele ser liberado) nunca eram encontrados. O inventário fecha esse buraco, e a
 * reconciliação o consulta **antes** dos leases — os leases dos recursos já devolvidos caem junto.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { PipelineRepository } = await import('./pipeline-repository')
const { ReconciliacaoService } = await import('./reconciliacao-service')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'

let dir: string
let db: Db
let ordem: string[]

function montar(
  isolamento?: { reconciliar: () => Promise<readonly unknown[]> },
  verificadorDeLease?: () => boolean
): InstanceType<typeof ReconciliacaoService> {
  return new ReconciliacaoService({
    runs: new PipelineRepository(db),
    leases: new LeaseRepository(db),
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    ...(isolamento === undefined ? {} : { isolamento: isolamento as never }),
    ...(verificadorDeLease === undefined
      ? {}
      : {
          verificadores: [
            {
              prefixo: 'container:',
              emUso: () => {
                ordem.push('verificador-de-lease')
                return verificadorDeLease()
              }
            }
          ]
        })
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-rec-isol-'))
  db = openDatabase(join(dir, 'app.db'))
  ordem = []
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('reconcileAll com o isolamento', () => {
  it('inclui os achados do isolamento no resultado', async () => {
    const achado = { recurso: 'run:morto', decisao: 'liberado', motivo: 'Recursos devolvidos.' }
    const servico = montar({ reconciliar: async () => [achado] })

    expect(await servico.reconcileAll()).toContainEqual(achado)
  })

  it('consulta o isolamento antes de olhar os leases', async () => {
    const leases = new LeaseRepository(db)
    leases.adquirir(USER, { proprietario: 'morto', recurso: 'container:morto' }, 0)
    const servico = montar(
      {
        reconciliar: async () => {
          ordem.push('isolamento')
          return []
        }
      },
      () => false
    )

    await servico.reconcileAll()

    expect(ordem).toEqual(['isolamento', 'verificador-de-lease'])
  })

  it('isolamento que falha vira achado bloqueado: falha de detecção não é "nada a reconciliar"', async () => {
    const servico = montar({
      reconciliar: async () => {
        throw new Error('docker caiu')
      }
    })

    const achados = await servico.reconcileAll()

    expect(achados).toContainEqual(
      expect.objectContaining({ recurso: 'isolamento', decisao: 'bloqueado' })
    )
    expect(achados.find((a) => a.recurso === 'isolamento')?.motivo).toContain('docker caiu')
  })

  it('sem isolamento a reconciliação é a de antes', async () => {
    expect(await montar().reconcileAll()).toEqual([])
  })
})
