import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database'
import { AuditRepository } from '../storage/audit-repository'
import type { Database } from 'better-sqlite3'
import { ContinuousControlsRepository } from './continuous-controls-repository'
import { ContinuousControlsService } from './continuous-controls-service'

describe('ContinuousControlsService', () => {
  let db: Database
  let dir: string
  let service: ContinuousControlsService
  let audit: AuditRepository

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-controles-'))
    db = openDatabase(join(dir, 'controles.db'))
    audit = new AuditRepository(db, 'test-key')
    service = new ContinuousControlsService({
      repository: new ContinuousControlsRepository(db),
      audit,
      userId: () => 'u-1',
      agora: () => new Date('2026-10-08T12:00:00.000Z')
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('pausa o workspace sem permitir que um projeto retome antes da pausa global', async () => {
    const escopoWorkspace = { userId: 'u-1', workspaceId: 'jarvis' as const }
    const escopoProjeto = { ...escopoWorkspace, projectId: 'p-1' }

    await service.aplicar({
      escopo: escopoWorkspace,
      acao: { tipo: 'pausa', pausada: true },
      idempotencyKey: 'pause-workspace'
    })
    expect(service.snapshot(escopoProjeto).pausa).toMatchObject({
      pausada: true,
      noWorkspace: true,
      noEscopoAtual: false
    })

    await service.aplicar({
      escopo: escopoProjeto,
      acao: { tipo: 'pausa', pausada: true },
      idempotencyKey: 'pause-project'
    })
    const retomarProjeto = {
      escopo: escopoProjeto,
      acao: { tipo: 'pausa' as const, pausada: false },
      idempotencyKey: 'resume-project'
    }
    const primeiraRetomada = await service.aplicar(retomarProjeto)
    expect(await service.aplicar(retomarProjeto)).toEqual(primeiraRetomada)
    expect(service.pausada(escopoProjeto)).toBe(true)

    await service.aplicar({
      escopo: escopoWorkspace,
      acao: { tipo: 'pausa', pausada: false },
      idempotencyKey: 'resume-workspace'
    })
    expect(service.pausada(escopoProjeto)).toBe(false)
  })

  it('registra auditoria e repete comandos idempotentes sem duplicar a alteração', async () => {
    const escopo = { userId: 'u-1', workspaceId: 'jarvis' as const, projectId: 'p-1' }
    const comando = {
      escopo,
      acao: { tipo: 'switch' as const, controle: 'push' as const, habilitado: false },
      idempotencyKey: 'push-off'
    }

    const primeiro = await service.aplicar(comando)
    const repetido = await service.aplicar(comando)
    const conflito = await service.aplicar({
      ...comando,
      acao: { ...comando.acao, habilitado: true }
    })

    expect(primeiro.status).toBe('updated')
    expect(repetido).toEqual(primeiro)
    expect(conflito.status).toBe('idempotency-conflict')
    expect(
      audit.list('u-1').filter((event) => event.type === 'pipeline-control-change')
    ).toHaveLength(1)
    expect(service.snapshot(escopo).controles.push).toMatchObject({
      enabled: false,
      herdado: false
    })
  })

  it('cancela os runs ativos quando o switch de execução é desligado no escopo deles', async () => {
    const escopo = { userId: 'u-1', workspaceId: 'jarvis' as const, projectId: 'p-1' }
    const cancelados: string[] = []
    service.configureExecutionCancellation({
      ativosDoEscopo: () => [{ runId: 'run-1', projectId: 'p-1' }],
      cancelarRun: async (_projectId, _workspaceId, runId) => {
        cancelados.push(runId)
      }
    })

    await service.aplicar({
      escopo,
      acao: { tipo: 'switch', controle: 'execucao', habilitado: false },
      idempotencyKey: 'execution-off'
    })

    expect(cancelados).toEqual(['run-1'])
    expect(service.habilitado(escopo, 'execucao')).toBe(false)
  })

  it('repete a tentativa de cancelamento quando a mesma chave é reexecutada após falha', async () => {
    const escopo = { userId: 'u-1', workspaceId: 'jarvis' as const, projectId: 'p-1' }
    let tentativas = 0
    service.configureExecutionCancellation({
      ativosDoEscopo: () => [{ runId: 'run-1', projectId: 'p-1' }],
      cancelarRun: async () => {
        tentativas += 1
        if (tentativas === 1) throw new Error('cancelamento temporariamente indisponível')
      }
    })
    const comando = {
      escopo,
      acao: { tipo: 'switch' as const, controle: 'execucao' as const, habilitado: false },
      idempotencyKey: 'execution-off-retry'
    }

    await expect(service.aplicar(comando)).rejects.toThrow(
      'cancelamento temporariamente indisponível'
    )
    expect((await service.aplicar(comando)).status).toBe('updated')
    expect(tentativas).toBe(2)
  })
})
