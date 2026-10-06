import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { CronogramaService } = await import('./cronograma-service')
const { criarCronogramaEmDisco } = await import('./cronograma-em-disco')

describe('SPEC-Escuta-04 · auditoria real', () => {
  it('encadeia alteração e execução com decisões por atividade', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'cronograma-audit-'))
    const db = openDatabase(join(pasta, 'audit.db'))
    try {
      const audit = new AuditRepository(db, 'chave-de-teste')
      const policy = new PolicyService(audit, () => 'usuario-a')
      const estado = criarCronogramaEmDisco(join(pasta, 'cronograma.json'), 'usuario-a')
      const servico = new CronogramaService({
        agora: () => new Date(2026, 9, 6, 8, 0),
        estado,
        avaliar: (acao) => policy.classify(acao, { workspace: 'jarvis' }),
        auditar: (marco, payload) => {
          audit.append({
            user_id: 'usuario-a',
            workspace_id: 'jarvis',
            type: 'voz.cronograma',
            payload: { marco, ...payload }
          })
        },
        midiaAutorizada: () => true,
        podeReproduzir: async () => true,
        sessaoBloqueada: () => false,
        falar: async () => undefined,
        tocarMidia: async () => undefined
      })
      servico.salvar({
        versao: 1,
        ativa: true,
        sequencias: [
          {
            id: 'entrada',
            nome: 'Chegada',
            ativa: true,
            gatilho: { tipo: 'evento', evento: 'boas-vindas' },
            atividades: [{ id: 'fala', tipo: 'falar' }]
          }
        ]
      })
      servico.dispararEvento('boas-vindas')
      await servico.aguardarFila()
      const eventos = audit.list('usuario-a')
      expect(eventos.map((e) => e.type)).toEqual([
        'voz.cronograma',
        'policy-decision',
        'voz.cronograma',
        'voz.cronograma',
        'policy-decision',
        'voz.cronograma'
      ])
      expect(audit.verify('usuario-a').ok).toBe(true)
      expect(estado.historico()).toHaveLength(1)
    } finally {
      db.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
