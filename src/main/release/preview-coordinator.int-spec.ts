import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { PreviewCoordinator, type PreviewEvent, type PreviewProject } from './preview-coordinator'
import { PreviewRepository } from './preview-repository'
import { FakeCloud } from './preview-test-doubles'

const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const SHA_1 = 'a'.repeat(40)
const SHA_2 = 'b'.repeat(40)
const PROJETO: PreviewProject = {
  migrations: [{ id: '001_base', sql: 'SELECT 1;', checksum: 'c'.repeat(64) }],
  seed: 'INSERT INTO t VALUES (1);'
}

let directory: string
let db: Database
let repo: PreviewRepository
let audit: AuditRepository
let cloud: FakeCloud
let coordinator: PreviewCoordinator
let relogio = 0

function evento(parcial: Partial<PreviewEvent> = {}): PreviewEvent {
  return {
    ...SCOPE,
    action: 'open',
    pullRequest: 12,
    specId: 'SPEC-Release-03',
    specRevision: '2026-08-29',
    headSha: SHA_1,
    ...parcial
  }
}

function montar(project: PreviewProject = PROJETO): void {
  coordinator = new PreviewCoordinator({
    repository: repo,
    image: cloud.image,
    backend: cloud.backend,
    database: cloud.database,
    frontend: cloud.frontend,
    verifier: cloud.verifier,
    publication: cloud.publication,
    project,
    // Relógio determinístico e crescente: cada leitura avança um segundo.
    now: () => new Date(Date.UTC(2026, 9, 13, 12, 0, (relogio += 1))).toISOString()
  })
}

beforeEach(() => {
  relogio = 0
  directory = mkdtempSync(join(tmpdir(), 'jarvisos-preview-coord-'))
  db = openDatabase(join(directory, 'jarvis.db'))
  audit = new AuditRepository(db, 'preview-coord-key')
  repo = new PreviewRepository(db, audit)
  cloud = new FakeCloud()
  montar()
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

/** Chamadas aos provedores, sem a publicação do comentário. */
const externas = (): string[] => cloud.calls.filter((c) => c !== 'publication.publish')

const total = (tabela: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n

describe('abrir PR elegível', () => {
  it('cria exatamente um Preview full-stack, pronto, com todos os gates passados', async () => {
    const r = await coordinator.handle(evento())

    expect(r).toMatchObject({ state: 'ready', repeated: false, publication: 'published' })
    expect(cloud.environments.size).toBe(1)
    expect(cloud.deployments.size).toBe(1)
    expect(total('preview_run')).toBe(1)
    const gates = repo.currentGates(r.run!.id)
    expect(gates.map((g) => [g.gate, g.result])).toEqual([
      ['backend', 'passed'],
      ['frontend', 'passed'],
      ['health', 'passed'],
      ['identidade', 'passed'],
      ['imagem', 'passed'],
      ['migration', 'passed'],
      ['seed', 'passed']
    ])
    expect(repo.resources(r.run!.id).map((x) => [x.kind, x.state])).toEqual(
      expect.arrayContaining([
        ['image', 'ready'],
        ['backend', 'ready'],
        ['database', 'ready'],
        ['frontend', 'ready']
      ])
    )
  })

  it('o frontend entregue aponta para o backend do próprio run', async () => {
    const r = await coordinator.handle(evento())
    const backend = repo.resources(r.run!.id).find((x) => x.kind === 'backend')!
    const frontend = [...cloud.deployments.values()][0]!
    expect(frontend.backendUrl).toBe(backend.url)
    expect(frontend.previewRunId).toBe(r.run!.id)
  })

  it('publica no PR URLs, SHA, revisão da SPEC e gates do SHA corrente', async () => {
    await coordinator.handle(evento())
    const projecao = cloud.published.at(-1)!
    expect(projecao.run).toMatchObject({ headSha: SHA_1, specRevision: '2026-08-29' })
    expect(projecao.gates.every((g) => g.sourceSha === SHA_1)).toBe(true)
    expect(
      projecao.resources.some((x) => x.kind === 'frontend' && x.url?.startsWith('https://'))
    ).toBe(true)
  })
})

describe('dois PRs simultâneos', () => {
  it('recebem ambientes, URLs, IDs e bancos distintos, cada frontend ligado ao seu backend', async () => {
    const [a, b] = await Promise.all([
      coordinator.handle(evento({ pullRequest: 12 })),
      coordinator.handle(evento({ pullRequest: 13, headSha: SHA_2 }))
    ])

    expect(a.state).toBe('ready')
    expect(b.state).toBe('ready')
    expect(a.run!.id).not.toBe(b.run!.id)
    expect(cloud.environments.size).toBe(2)
    const envs = [...cloud.environments.values()]
    expect(new Set(envs.map((e) => e.name)).size).toBe(2)
    expect(new Set(envs.map((e) => e.backendUrl)).size).toBe(2)
    expect(envs[0]!.database).not.toBe(envs[1]!.database)
    for (const run of [a.run!, b.run!]) {
      const backend = repo.resources(run.id).find((x) => x.kind === 'backend')!
      const frontend = [...cloud.deployments.values()].find((d) => d.previewRunId === run.id)!
      expect(frontend.backendUrl).toBe(backend.url)
    }
  })
})

describe('commit novo', () => {
  it('atualiza o mesmo Preview, troca o deployment e invalida a evidência do SHA anterior', async () => {
    const primeiro = await coordinator.handle(evento())
    const antigo = [...cloud.deployments.keys()][0]!

    const segundo = await coordinator.handle(evento({ headSha: SHA_2 }))

    expect(segundo.run!.id).toBe(primeiro.run!.id)
    expect(segundo.run!.headSha).toBe(SHA_2)
    expect(total('preview_run')).toBe(1)
    expect(cloud.environments.size).toBe(1)
    expect(cloud.deployments.size).toBe(1)
    expect(cloud.deployments.has(antigo)).toBe(false)
    const gates = repo.currentGates(segundo.run!.id)
    expect(gates.length).toBe(7)
    expect(gates.every((g) => g.sourceSha === SHA_2)).toBe(true)
    // A evidência do SHA anterior continua gravada, só não vale mais.
    expect(
      (
        db.prepare('SELECT COUNT(*) AS n FROM preview_gate WHERE source_sha=?').get(SHA_1) as {
          n: number
        }
      ).n
    ).toBe(7)
  })
})

describe('evento repetido', () => {
  it('abrir duas vezes o mesmo SHA não executa nenhum efeito externo nem grava evento novo', async () => {
    await coordinator.handle(evento())
    const chamadas = externas().length
    const eventos = total('preview_event')

    const repetido = await coordinator.handle(evento())

    expect(repetido).toMatchObject({ state: 'ready', repeated: true, publication: 'published' })
    expect(externas().length).toBe(chamadas)
    // Só o comentário é republicado: se a primeira publicação tivesse falhado, esta a corrige.
    expect(cloud.calls.filter((c) => c === 'publication.publish')).toHaveLength(2)
    expect(total('preview_event')).toBe(eventos)
  })

  it('dois eventos simultâneos do mesmo PR resultam em um único Preview', async () => {
    const [x, y] = await Promise.all([coordinator.handle(evento()), coordinator.handle(evento())])

    expect([x.state, y.state].sort()).toEqual(['busy', 'ready'])
    expect(cloud.environments.size).toBe(1)
    expect(cloud.deployments.size).toBe(1)
    expect(total('preview_run')).toBe(1)
  })

  it('o evento de fechamento repetido destrói uma vez e depois nada faz', async () => {
    await coordinator.handle(evento())
    await coordinator.handle(evento({ action: 'close' }))
    const chamadas = externas().length

    const repetido = await coordinator.handle(evento({ action: 'close' }))

    expect(repetido).toMatchObject({ state: 'removed', repeated: true })
    expect(externas().length).toBe(chamadas)
  })
})

describe('migration e seed', () => {
  it('migration que falha impede o estado ready e o frontend nunca sobe', async () => {
    cloud.migrationOutcome = {
      state: 'failed',
      reason: 'migration-failed',
      failedAt: '001_base',
      applied: []
    }

    const r = await coordinator.handle(evento())

    expect(r).toMatchObject({ state: 'failed', reason: 'migration-failed' })
    expect(r.run!.status).toBe('failed')
    expect(cloud.deployments.size).toBe(0)
    const gates = repo.currentGates(r.run!.id)
    expect(gates.find((g) => g.gate === 'migration')?.result).toBe('blocked')
  })

  it('seed que falha impede ready e deixa a migration passada registrada', async () => {
    cloud.migrationOutcome = {
      state: 'failed',
      reason: 'migration-failed',
      failedAt: '__seed__',
      applied: ['001_base']
    }

    const r = await coordinator.handle(evento())

    expect(r.state).toBe('failed')
    const gates = repo.currentGates(r.run!.id)
    expect(gates.find((g) => g.gate === 'migration')?.result).toBe('passed')
    expect(gates.find((g) => g.gate === 'seed')?.result).toBe('blocked')
  })

  it('sem seed determinístico nada fica pronto', async () => {
    montar({ migrations: PROJETO.migrations })

    const r = await coordinator.handle(evento())

    expect(r).toMatchObject({ state: 'failed', reason: 'seed-missing' })
    expect(cloud.deployments.size).toBe(0)
  })
})

describe('falha injetada ao criar cada recurso', () => {
  it.each([
    ['image.ensure', 'imagem-failed'],
    ['backend.provision', 'backend-timeout'],
    ['database.migrate', 'migration-quota'],
    ['frontend.deploy', 'frontend-auth'],
    ['verifier.verify', 'verificacao-failed']
  ] as const)(
    '%s falha → failed (%s) e a repetição converge sem duplicar',
    async (operacao, motivo) => {
      const codigo = motivo.split('-')[1] as 'failed' | 'timeout' | 'quota' | 'auth'
      cloud.failOn(operacao, codigo)

      const falho = await coordinator.handle(evento())
      expect(falho).toMatchObject({ state: 'failed', reason: motivo })
      expect(repo.get(falho.run!.id).status).toBe('failed')

      cloud.clearFaults()
      const refeito = await coordinator.handle(evento())
      expect(refeito.state).toBe('ready')
      expect(refeito.run!.id).toBe(falho.run!.id)
      expect(cloud.environments.size).toBe(1)
      expect(cloud.deployments.size).toBe(1)
    }
  )

  it('o erro do provedor nunca vira evidência: nem o texto nem segredo ecoado entram no banco', async () => {
    cloud.failOn('backend.provision', 'auth')
    await coordinator.handle(evento())

    const tudo = JSON.stringify({
      runs: db.prepare('SELECT * FROM preview_run').all(),
      eventos: db.prepare('SELECT * FROM preview_event').all(),
      gates: db.prepare('SELECT * FROM preview_gate').all(),
      recursos: db.prepare('SELECT * FROM preview_resource').all(),
      audit: audit.list(SCOPE.userId)
    })
    expect(tudo).not.toContain('falha injetada')
    expect(tudo).toContain('backend-auth')
  })
})

describe('fechar PR', () => {
  it('remove os recursos temporários do Preview, preserva imagem e histórico', async () => {
    const aberto = await coordinator.handle(evento())

    const r = await coordinator.handle(evento({ action: 'close' }))

    expect(r).toMatchObject({ state: 'removed', pending: [] })
    expect(cloud.environments.size).toBe(0)
    expect(cloud.deployments.size).toBe(0)
    expect(cloud.images.size).toBe(1)
    const estados = Object.fromEntries(repo.resources(aberto.run!.id).map((x) => [x.kind, x.state]))
    expect(estados).toEqual({
      image: 'ready',
      backend: 'destroyed',
      database: 'destroyed',
      frontend: 'destroyed'
    })
    expect(total('preview_gate')).toBeGreaterThan(0)
    expect(total('preview_event')).toBeGreaterThan(1)
    expect(audit.verify(SCOPE.userId).ok).toBe(true)
  })

  it('não toca no Preview de outro PR', async () => {
    await coordinator.handle(evento({ pullRequest: 12 }))
    const outro = await coordinator.handle(evento({ pullRequest: 13, headSha: SHA_2 }))

    await coordinator.handle(evento({ pullRequest: 12, action: 'close' }))

    expect(cloud.environments.size).toBe(1)
    expect([...cloud.deployments.values()][0]!.previewRunId).toBe(outro.run!.id)
  })

  it('fechar PR sem Preview não cria run nem chama provedor', async () => {
    const r = await coordinator.handle(evento({ action: 'close' }))
    expect(r).toMatchObject({ state: 'absent', repeated: true })
    expect(total('preview_run')).toBe(0)
    expect(cloud.calls).toEqual([])
  })

  it.each([
    ['frontend.destroy', 'frontend'],
    ['backend.destroy', 'backend']
  ] as const)(
    'falha em %s deixa pendência reconciliável e nunca declara destroyed',
    async (operacao, tipo) => {
      const aberto = await coordinator.handle(evento())
      cloud.failOn(operacao, 'timeout')

      const r = await coordinator.handle(evento({ action: 'close' }))

      expect(r.state).toBe('removing')
      expect(r.pending).toContain(tipo)
      expect(repo.get(aberto.run!.id).status).toBe('removing')
      const recurso = repo.resources(aberto.run!.id).find((x) => x.kind === tipo)!
      expect(recurso.state).toBe('failed')
      expect(recurso.reason).toBe('destroy-timeout')

      cloud.clearFaults()
      const refeito = await coordinator.handle(evento({ action: 'close' }))
      expect(refeito).toMatchObject({ state: 'removed', pending: [] })
      expect(cloud.environments.size).toBe(0)
      expect(cloud.deployments.size).toBe(0)
    }
  )

  it('reabrir o PR cria recursos novos numa geração nova', async () => {
    const primeiro = await coordinator.handle(evento())
    const nomeAntigo = [...cloud.environments.keys()][0]!
    await coordinator.handle(evento({ action: 'close' }))

    const reaberto = await coordinator.handle(evento({ headSha: SHA_2 }))

    expect(reaberto.run!.id).toBe(primeiro.run!.id)
    expect(reaberto.run!.generation).toBe(2)
    expect([...cloud.environments.keys()]).not.toContain(nomeAntigo)
    expect(reaberto.state).toBe('ready')
  })

  it('abrir de novo durante uma limpeza pendente termina a limpeza antes de recriar', async () => {
    await coordinator.handle(evento())
    cloud.failOn('backend.destroy', 'timeout')
    await coordinator.handle(evento({ action: 'close' }))
    cloud.clearFaults()

    const r = await coordinator.handle(evento({ headSha: SHA_2 }))

    expect(r.state).toBe('ready')
    expect(r.run!.generation).toBe(2)
    expect(cloud.environments.size).toBe(1)
  })
})

describe('publicação no PR', () => {
  it('comentário que não sai não muda o estado do Preview', async () => {
    cloud.failOn('publication.publish', 'failed')

    const r = await coordinator.handle(evento())

    expect(r).toMatchObject({ state: 'ready', publication: 'failed' })
    expect(repo.get(r.run!.id).status).toBe('ready')
  })

  it('republica no evento repetido: comentário perdido na primeira vez é corrigido na segunda', async () => {
    cloud.failOn('publication.publish', 'failed')
    const primeiro = await coordinator.handle(evento())
    expect(primeiro.publication).toBe('failed')

    const segundo = await coordinator.handle(evento())

    expect(segundo).toMatchObject({ state: 'ready', repeated: true, publication: 'published' })
    expect(cloud.published).toHaveLength(1)
  })

  it('republica também o fechamento repetido', async () => {
    await coordinator.handle(evento())
    cloud.failOn('publication.publish', 'failed')
    const fechado = await coordinator.handle(evento({ action: 'close' }))
    expect(fechado).toMatchObject({ state: 'removed', publication: 'failed' })

    const repetido = await coordinator.handle(evento({ action: 'close' }))

    expect(repetido).toMatchObject({ state: 'removed', repeated: true, publication: 'published' })
  })
})

describe('limpeza do frontend', () => {
  it('"ausente" não basta: se a listagem ainda mostra o deployment, a limpeza fica pendente', async () => {
    await coordinator.handle(evento())
    // A remoção "responde bem", mas o deployment continua existindo (ex.: escopo errado).
    cloud.frontend.destroy = async () => 'absent'

    const r = await coordinator.handle(evento({ action: 'close' }))

    expect(r.state).toBe('removing')
    expect(r.pending).toContain('frontend')
    expect(cloud.deployments.size).toBe(1)
  })
})

describe('posse durante etapa lenta', () => {
  it('a posse é renovada a cada etapa: provisionamento longo não deixa outro executor assumir', async () => {
    // Cada leitura do relógio avança 1 s; com prazo de 5 s, sem renovação o run perderia a posse
    // no meio (são mais de 5 leituras até o fim). Com renovação por etapa ele conclui.
    relogio = 0
    coordinator = new PreviewCoordinator({
      repository: repo,
      image: cloud.image,
      backend: cloud.backend,
      database: cloud.database,
      frontend: cloud.frontend,
      verifier: cloud.verifier,
      publication: cloud.publication,
      project: PROJETO,
      lockTtlMs: 5_000,
      now: () => new Date(Date.UTC(2026, 9, 13, 12, 0, (relogio += 1))).toISOString()
    })

    const r = await coordinator.handle(evento())

    expect(r.state).toBe('ready')
  })
})
