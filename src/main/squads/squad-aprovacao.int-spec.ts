import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }) })
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ApprovalRepository } = await import('../execution/approval-repository')
const { PipelineRepository } = await import('../pipeline/pipeline-repository')
const { PolicyService } = await import('../policy/policy-service')
const { SquadAprovacaoService, alteraEstruturaDeBanco, comandosDestrutivosDoPerfil } =
  await import('./squad-aprovacao')

let dir: string
let db: Database
let audit: InstanceType<typeof AuditRepository>
let approvals: InstanceType<typeof ApprovalRepository>
let runs: InstanceType<typeof PipelineRepository>
let service: InstanceType<typeof SquadAprovacaoService>
let runId: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-aprovacao-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  approvals = new ApprovalRepository(db)
  runs = new PipelineRepository(db)
  const run = runs.criar(
    { userId: 'u-1', workspaceId: 'jarvis', projectId: 'p-1' },
    { sliceId: 's-1', estado: 'PLANNED' },
    new Date()
  )
  runId = run.id
  expect(runs.transicionar(runId, 'PLANNED', 'AWAITING_PI', new Date())).toBe(true)
  expect(runs.transicionar(runId, 'AWAITING_PI', 'READY', new Date())).toBe(true)
  service = new SquadAprovacaoService({
    db,
    requests: approvals,
    policy: new PolicyService(audit, () => 'u-1'),
    audit,
    runs,
    userId: () => 'u-1'
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const pedido = () => ({
  runId,
  projectId: 'p-1',
  workspaceId: 'jarvis' as const,
  tarefaId: 'dev-1',
  acao: 'alteracao-estrutural-de-banco' as const,
  alvo: 'migrations/001.sql'
})

describe('aprovação sensível do Squad', () => {
  it('pausa antes da ação, audita pedido e decisão do PI e libera somente o run escopado', async () => {
    const aguardando = service.exigir(pedido())
    const request = service.pendentesDoRun(runId, 'jarvis')[0]!
    expect(request.action).toBe('db.alter-structure')
    expect(service.resolver(request.id, 'aprovado', 'outro-projeto', 'jarvis')).toBe(false)
    expect(service.resolver(request.id, 'aprovado', 'p-1', 'noa')).toBe(false)
    expect(service.resolver(request.id, 'aprovado', 'p-1', 'jarvis')).toBe(true)
    expect(await aguardando).toBe(true)
    expect(service.resolver(request.id, 'aprovado', 'p-1', 'jarvis')).toBe(false)
    expect(audit.list('u-1').filter((item) => item.type === 'approval-request')).toHaveLength(2)
  })

  it('recusa e cancelamento não liberam execução; crash encerra pedido pendente', async () => {
    const controle = new AbortController()
    const aguardando = service.exigir({ ...pedido(), signal: controle.signal })
    controle.abort()
    expect(await aguardando).toBe(false)
    expect(service.pendentesDoRun(runId, 'jarvis')).toHaveLength(0)

    const outro = service.exigir(pedido())
    const request = service.pendentesDoRun(runId, 'jarvis')[0]!
    const aposReinicio = new SquadAprovacaoService({
      db,
      requests: approvals,
      policy: new PolicyService(audit, () => 'u-1'),
      audit,
      runs,
      userId: () => 'u-1'
    })
    aposReinicio.reconciliarPendentes()
    expect(approvals.findById('u-1', request.id)?.status).toBe('negado')
    expect(aposReinicio.resolver(request.id, 'aprovado', 'p-1', 'jarvis')).toBe(false)
    // A promessa antiga pertence ao processo que caiu: este teste não a aguarda.
    void outro
  })

  it('classifica paths de schema e migration antes do dispatch', () => {
    expect(alteraEstruturaDeBanco({ paths: ['src/main/storage/migrations.ts'] })).toBe(true)
    expect(alteraEstruturaDeBanco({ paths: ['prisma/schema.prisma'] })).toBe(true)
    expect(alteraEstruturaDeBanco({ paths: ['db/schema.sql'] })).toBe(true)
    expect(alteraEstruturaDeBanco({ paths: ['drizzle/0001_add.sql'] })).toBe(true)
    expect(alteraEstruturaDeBanco({ paths: ['src/components/Card.tsx'] })).toBe(false)
  })

  it('identifica comando destrutivo explícito ou oculto no nome do script', () => {
    expect(
      comandosDestrutivosDoPerfil({
        instalacao: { argv: ['npm', 'ci'] },
        validacoes: [
          { argv: ['npm', 'run', 'test'], id: 'test', nome: 'Teste', grupo: 'test' },
          { argv: ['npm', 'run', 'db:migrate'], id: 'db', nome: 'Banco', grupo: 'db' }
        ]
      } as never)
    ).toEqual([['npm', 'run', 'db:migrate']])
  })
})
