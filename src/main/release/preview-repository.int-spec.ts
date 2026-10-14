import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SqliteDatabase from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { migrate } from '../storage/migrations'
import {
  PreviewOwnershipError,
  PreviewRepository,
  type PreviewClaimInput
} from './preview-repository'

const KEY = 'preview-test-audit-key'
const T0 = '2026-10-13T12:00:00.000Z'
const T1 = '2026-10-13T12:01:00.000Z'
const T_APOS_PRAZO = '2026-10-13T12:20:00.000Z'
const TTL = 5 * 60_000
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
/** Migrations aplicadas antes da que criou preview_resource/preview_gate (SPEC-Release-03). */
const MIGRATIONS_ANTES_DO_PREVIEW = 64

function entrada(parcial: Partial<PreviewClaimInput> = {}): PreviewClaimInput {
  return {
    ...SCOPE,
    pullRequest: 12,
    specId: 'SPEC-Release-03',
    specRevision: '2026-08-29',
    headSha: SHA_A,
    ...parcial
  }
}

let directory: string
let db: Database
let audit: AuditRepository
let repo: PreviewRepository

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'jarvisos-preview-'))
  db = openDatabase(join(directory, 'jarvis.db'))
  audit = new AuditRepository(db, KEY)
  repo = new PreviewRepository(db, audit)
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

function claimed(parcial: Partial<PreviewClaimInput> = {}, owner = 'exec-1', now = T0) {
  const claim = repo.claim(entrada(parcial), owner, TTL, now)
  if (claim.outcome !== 'claimed') throw new Error('esperava posse')
  return claim.run
}

describe('PreviewRun único por projeto + PR + SPEC', () => {
  it('cria exatamente um run e reaproveita o mesmo ao repetir o evento', () => {
    const primeiro = claimed()
    repo.release(primeiro.id, 'exec-1')
    const segundo = claimed({}, 'exec-2', T1)

    expect(segundo.id).toBe(primeiro.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM preview_run').get()).toEqual({ n: 1 })
    expect(primeiro).toMatchObject({ status: 'queued', generation: 1, specRevision: '2026-08-29' })
  })

  it('PRs distintos e SPECs distintas recebem runs distintos', () => {
    const a = claimed({ pullRequest: 12 })
    const b = claimed({ pullRequest: 13 }, 'exec-2')
    const c = claimed({ specId: 'SPEC-Release-04' }, 'exec-3')
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })

  it('o SHA muda no lugar: um commit novo não cria outra linha', () => {
    const run = claimed()
    repo.transition(run.id, 'exec-1', { status: 'preparing' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'ready' }, T0)
    const atualizado = repo.transition(
      run.id,
      'exec-1',
      { status: 'preparing', headSha: SHA_B },
      T1
    )

    expect(atualizado).toMatchObject({ id: run.id, headSha: SHA_B, status: 'preparing' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM preview_run').get()).toEqual({ n: 1 })
  })

  it('recusa PR, SHA e SPEC inválidos antes de gravar', () => {
    expect(() => repo.claim(entrada({ pullRequest: 0 }), 'exec-1', TTL, T0)).toThrow(TypeError)
    expect(() => repo.claim(entrada({ headSha: 'main' }), 'exec-1', TTL, T0)).toThrow(TypeError)
    expect(() => repo.claim(entrada({ specId: '' }), 'exec-1', TTL, T0)).toThrow(TypeError)
    expect(db.prepare('SELECT COUNT(*) AS n FROM preview_run').get()).toEqual({ n: 0 })
  })
})

describe('posse do run', () => {
  it('um segundo executor recebe busy enquanto a posse vale', () => {
    claimed()
    const concorrente = repo.claim(entrada(), 'exec-2', TTL, T1)
    expect(concorrente.outcome).toBe('busy')
  })

  it('a posse vencida passa para quem chega depois', () => {
    claimed()
    const retomada = repo.claim(entrada(), 'exec-2', TTL, T_APOS_PRAZO)
    expect(retomada.outcome).toBe('claimed')
  })

  it('o dono que perdeu a posse não consegue mais escrever', () => {
    const run = claimed()
    repo.claim(entrada(), 'exec-2', TTL, T_APOS_PRAZO)
    expect(() => repo.transition(run.id, 'exec-1', { status: 'preparing' }, T_APOS_PRAZO)).toThrow(
      PreviewOwnershipError
    )
    expect(() =>
      repo.recordGate(
        run.id,
        'exec-1',
        { sourceSha: SHA_A, gate: 'health', result: 'passed' },
        T_APOS_PRAZO
      )
    ).toThrow(PreviewOwnershipError)
  })

  it('liberar a posse deixa o run disponível na hora', () => {
    const run = claimed()
    repo.release(run.id, 'exec-1')
    expect(repo.claim(entrada(), 'exec-2', TTL, T1).outcome).toBe('claimed')
  })
})

describe('transições e histórico', () => {
  it('rejeita transição inválida e registra cada mudança válida, com auditoria íntegra', () => {
    const run = claimed()
    expect(() => repo.transition(run.id, 'exec-1', { status: 'ready' }, T0)).toThrow(
      /Transição de Preview inválida/
    )
    repo.transition(run.id, 'exec-1', { status: 'preparing' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'ready' }, T1)

    const eventos = db
      .prepare('SELECT kind,from_status,to_status FROM preview_event ORDER BY created_at, rowid')
      .all()
    expect(eventos).toEqual([
      { kind: 'preview-created', from_status: null, to_status: 'queued' },
      { kind: 'preview-updated', from_status: 'queued', to_status: 'preparing' },
      { kind: 'preview-updated', from_status: 'preparing', to_status: 'ready' }
    ])
    expect(audit.verify(SCOPE.userId).ok).toBe(true)
  })

  it('o motivo é um código curto; texto livre é recusado', () => {
    const run = claimed()
    expect(() =>
      repo.transition(run.id, 'exec-1', { status: 'failed', reason: 'Token: abc 123' }, T0)
    ).toThrow(TypeError)
    expect(() =>
      repo.transition(run.id, 'exec-1', { status: 'failed', reason: 'migration-failed' }, T0)
    ).not.toThrow()
  })

  it('removido e reaberto sobe a geração, sem reaproveitar nome de recurso', () => {
    const run = claimed()
    repo.transition(run.id, 'exec-1', { status: 'removing' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'removed' }, T0)
    const reaberto = repo.transition(run.id, 'exec-1', { status: 'queued' }, T1)
    expect(reaberto.generation).toBe(2)
  })

  it('os eventos são append-only', () => {
    claimed()
    expect(() => db.prepare("UPDATE preview_event SET kind='x'").run()).toThrow(/append-only/)
    expect(() => db.prepare('DELETE FROM preview_event').run()).toThrow(/append-only/)
  })
})

describe('recursos temporários', () => {
  it('um recurso por run, geração e tipo: repetir atualiza o mesmo registro', () => {
    const run = claimed()
    repo.upsertResource(
      run.id,
      'exec-1',
      {
        kind: 'backend',
        provider: 'railway',
        externalId: 'env-1',
        sourceSha: SHA_A,
        state: 'provisioning'
      },
      T0
    )
    const pronto = repo.upsertResource(
      run.id,
      'exec-1',
      {
        kind: 'backend',
        provider: 'railway',
        externalId: 'env-1',
        url: 'https://api-pv.up.railway.app',
        sourceSha: SHA_A,
        state: 'ready'
      },
      T1
    )

    expect(pronto).toMatchObject({ state: 'ready', url: 'https://api-pv.up.railway.app' })
    expect(repo.resources(run.id)).toHaveLength(1)
  })

  it('recursos de gerações diferentes convivem; a consulta padrão traz a geração corrente', () => {
    const run = claimed()
    repo.upsertResource(
      run.id,
      'exec-1',
      {
        kind: 'backend',
        provider: 'railway',
        externalId: 'g1',
        sourceSha: SHA_A,
        state: 'destroyed'
      },
      T0
    )
    repo.transition(run.id, 'exec-1', { status: 'removing' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'removed' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'queued' }, T1)
    repo.upsertResource(
      run.id,
      'exec-1',
      { kind: 'backend', provider: 'railway', externalId: 'g2', sourceSha: SHA_A, state: 'ready' },
      T1
    )

    expect(repo.resources(run.id).map((r) => r.externalId)).toEqual(['g2'])
    expect(repo.resources(run.id, 1).map((r) => r.externalId)).toEqual(['g1'])
  })

  it('recusa recurso sem identificador externo', () => {
    const run = claimed()
    expect(() =>
      repo.upsertResource(
        run.id,
        'exec-1',
        { kind: 'image', provider: 'ghcr', externalId: ' ', sourceSha: SHA_A, state: 'ready' },
        T0
      )
    ).toThrow(TypeError)
  })
})

describe('gates por SHA', () => {
  it('um commit novo invalida os gates do SHA anterior sem apagá-los', () => {
    const run = claimed()
    repo.transition(run.id, 'exec-1', { status: 'preparing' }, T0)
    repo.recordGate(run.id, 'exec-1', { sourceSha: SHA_A, gate: 'health', result: 'passed' }, T0)
    expect(repo.currentGates(run.id).map((g) => g.gate)).toEqual(['health'])

    repo.transition(run.id, 'exec-1', { status: 'failed', reason: 'health-failed' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'preparing', headSha: SHA_B }, T1)

    expect(repo.currentGates(run.id)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM preview_gate').get()).toEqual({ n: 1 })
  })

  it('os gates são append-only', () => {
    const run = claimed()
    repo.recordGate(run.id, 'exec-1', { sourceSha: SHA_A, gate: 'seed', result: 'passed' }, T0)
    expect(() => db.prepare("UPDATE preview_gate SET result='blocked'").run()).toThrow(
      /append-only/
    )
    expect(() => db.prepare('DELETE FROM preview_gate').run()).toThrow(/append-only/)
  })
})

describe('renovação da posse', () => {
  it('cada escrita do dono estende o prazo: um run que trabalha não perde a posse', () => {
    const run = claimed({}, 'exec-1', T0)
    // 4 min depois (dentro do prazo de 5) o dono escreve; o prazo passa a contar daí.
    repo.recordGate(
      run.id,
      'exec-1',
      { sourceSha: SHA_A, gate: 'health', result: 'passed' },
      '2026-10-13T12:04:00.000Z'
    )
    // 8 min depois do início o prazo original já venceu, mas o renovado ainda vale.
    expect(repo.claim(entrada(), 'exec-2', TTL, '2026-10-13T12:08:00.000Z').outcome).toBe('busy')
    // 10 min depois da última escrita, venceu.
    expect(repo.claim(entrada(), 'exec-2', TTL, '2026-10-13T12:10:00.000Z').outcome).toBe('claimed')
  })

  it('renew() estende sem escrever nada', () => {
    const run = claimed({}, 'exec-1', T0)
    repo.renew(run.id, 'exec-1', '2026-10-13T12:04:00.000Z')
    expect(repo.claim(entrada(), 'exec-2', TTL, '2026-10-13T12:08:00.000Z').outcome).toBe('busy')
  })

  it('quem perdeu a posse não renova', () => {
    const run = claimed({}, 'exec-1', T0)
    repo.claim(entrada(), 'exec-2', TTL, T_APOS_PRAZO)
    expect(() => repo.renew(run.id, 'exec-1', T_APOS_PRAZO)).toThrow(PreviewOwnershipError)
  })
})

describe('gates por geração', () => {
  it('reabrir o PR com o mesmo SHA não herda os gates da geração anterior', () => {
    const run = claimed()
    repo.recordGate(run.id, 'exec-1', { sourceSha: SHA_A, gate: 'health', result: 'passed' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'removing' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'removed' }, T0)
    repo.transition(run.id, 'exec-1', { status: 'queued' }, T1)

    expect(repo.currentGates(run.id)).toEqual([])
  })
})

describe('migration do PreviewRun legado', () => {
  it('religa os eventos ao sobrevivente quando havia várias linhas por PR', () => {
    // Banco exatamente na versão anterior à migration do Preview (a 65ª): independe das migrations
    // que vierem depois, que `openDatabase` aplica na sequência.
    const legado = new SqliteDatabase(join(directory, 'legado.db'))
    legado.pragma('foreign_keys = ON')
    migrate(legado, MIGRATIONS_ANTES_DO_PREVIEW)
    expect(
      legado.prepare("SELECT 1 FROM sqlite_master WHERE name='preview_resource'").get()
    ).toBeUndefined()
    // Simula o schema da F01: refaz preview_run/preview_event como eram.
    legado.exec(`
      DROP TABLE preview_event; DROP TABLE preview_run;
      CREATE TABLE preview_run (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL, pull_request INTEGER NOT NULL, head_sha TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (user_id, workspace_id, project_id, pull_request, head_sha));
      CREATE TABLE preview_event (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL, preview_id TEXT NOT NULL REFERENCES preview_run(id), kind TEXT NOT NULL,
        from_status TEXT, to_status TEXT, created_at TEXT NOT NULL);
      INSERT INTO preview_run VALUES ('velho','user-1','jarvis','project-1',12,'${SHA_A}','ready','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
      INSERT INTO preview_run VALUES ('novo','user-1','jarvis','project-1',12,'${SHA_B}','preparing','2026-10-02T00:00:00Z','2026-10-02T00:00:00Z');
      INSERT INTO preview_event VALUES ('e1','user-1','jarvis','project-1','velho','preview-updated',NULL,'ready','2026-10-01T00:00:00Z');
    `)
    legado.close()

    const migrado = openDatabase(join(directory, 'legado.db'))
    expect(migrado.prepare('SELECT id,spec_id,head_sha,status FROM preview_run').all()).toEqual([
      { id: 'novo', spec_id: 'legacy', head_sha: SHA_B, status: 'preparing' }
    ])
    expect(migrado.prepare('SELECT preview_id FROM preview_event').all()).toEqual([
      { preview_id: 'novo' }
    ])
    migrado.close()
  })
})
