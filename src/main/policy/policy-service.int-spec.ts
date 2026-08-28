/**
 * Policy Engine contra o SQLite real (SPEC-Execucao-02, categoria Banco).
 *
 * Prova o que o núcleo puro não pode: que **toda decisão vira `AuditEvent` encadeado**
 * (critério 3), que o contexto sensível é **redigido** antes de ser gravado (ADR-005), e que
 * o **modo report** não barra — uma ação classificada `bloqueado` ainda devolve a decisão e é
 * auditada (critério 6).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('./policy-service')

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let service: InstanceType<typeof PolicyService>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-policy-'))
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  service = new PolicyService(audit, () => 'u-1')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('PolicyService — toda decisão gera AuditEvent encadeado (critério 3)', () => {
  it('N avaliações ⇒ N eventos, cadeia íntegra', () => {
    service.classify('workflow.run-simulated', { workspace: 'noa' })
    service.classify('api.external-call', { workspace: 'jarvis' })
    service.classify('acao.desconhecida', { workspace: 'noa' })

    const eventos = audit.list('u-1')
    expect(eventos).toHaveLength(3)
    expect(eventos.every((e) => e.type === 'policy-decision')).toBe(true)
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('o evento carrega tier, outcome e reason da decisão', () => {
    const decisao = service.classify('deploy.production', { workspace: 'noa' })
    const [evento] = audit.list('u-1')

    expect(evento.payload).toMatchObject({
      action: 'deploy.production',
      tier: decisao.tier,
      outcome: decisao.outcome,
      reason: decisao.reason
    })
  })
})

describe('PolicyService — contexto redigido antes de auditar (ADR-005)', () => {
  it('não grava valor sob chave sensível no detail', () => {
    service.classify('secrets.change', {
      workspace: 'jarvis',
      detail: { alvo: '.env', token: 'super-secreto-123' }
    })

    const [evento] = audit.list('u-1')
    const detail = (evento.payload as { detail?: Record<string, unknown> }).detail

    expect(detail?.alvo).toBe('.env') // metadado não sensível permanece
    expect(detail?.token).toBe('[redigido]') // segredo redigido
    // Varredura defensiva: o valor não pode aparecer em lugar nenhum do evento serializado.
    expect(JSON.stringify(evento)).not.toContain('super-secreto-123')
  })

  it('objeto que se declara sensível some inteiro', () => {
    service.classify('data.access-sensitive', {
      workspace: 'jarvis',
      detail: { registro: { sensitivity: 'health', valor: 'diagnóstico-x' } }
    })

    const [evento] = audit.list('u-1')
    expect(JSON.stringify(evento)).not.toContain('diagnóstico-x')
  })
})

describe('PolicyService — modo report: classifica e audita, nunca barra (critério 6)', () => {
  it('ação bloqueada ainda devolve a decisão e é auditada — não lança', () => {
    // O contrato do modo report: mesmo `bloqueado` volta ao chamador. Se `classify`
    // lançasse ou engolisse a decisão, a Fatia 05 não teria como "executar mesmo assim".
    const decisao = service.classify('acao.proibida.inexistente', { workspace: 'jarvis' })

    expect(decisao.tier).toBe('bloqueado')
    expect(decisao.outcome).toBe('block')
    expect(audit.list('u-1')).toHaveLength(1) // a decisão de bloqueio foi registrada
  })

  it('"executar workflow simulado" roda baixo, auditada, sem bloqueio (critério 5)', () => {
    const decisao = service.classify('workflow.run-simulated', { workspace: 'jarvis' })

    expect(decisao.tier).toBe('baixo')
    expect(decisao.outcome).toBe('allow')
    expect(audit.list('u-1')).toHaveLength(1)
  })
})
