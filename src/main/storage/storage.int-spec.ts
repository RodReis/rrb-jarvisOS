/**
 * Integração com o SQLite real (categoria "Banco" do ADR-003).
 *
 * O que se prova aqui não dá para provar em unidade: que o **trigger** rejeita UPDATE e
 * DELETE mesmo vindo de fora do repositório, que uma forja feita direto no arquivo é
 * detectada, e que as consultas de fato isolam por `user_id`/`workspace_id`. É a diferença
 * entre "a API não expõe alteração" e "o storage recusa a alteração".
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from './migrations'

const logDb = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logDb }) }))

const { openDatabase } = await import('./database')
const { AuditRepository } = await import('./audit-repository')
const { SessionRepository, UserProfileRepository } = await import('./repositories')

const CHAVE = 'chave-de-teste'

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-db-'))
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, CHAVE)
  logDb.info.mockClear()
  logDb.error.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('migrations', () => {
  it('leva o banco à versão de schema esperada', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('preserva a auditoria ao migrar de um schema antigo (v1 → v2)', () => {
    // A regra central do runner: migration NUNCA zera evidência. Simula um banco parado
    // na v1 — sem a coluna `theme` — e verifica que a cadeia sobrevive à migração e
    // continua verificável.
    db.close()
    const caminho = join(dir, 'antigo.db')
    const antigo = openDatabase(caminho)
    new AuditRepository(antigo, CHAVE).append({ user_id: 'u-1', type: 'login' })
    // Volta o schema para a v1: desfaz tudo que as migrations posteriores criam e recua o
    // marcador de versão. Cada migration nova precisa ser desfeita aqui — senão a migração
    // tenta recriar um objeto que já existe. A v2 adicionou `theme`; a v3, `allowed_directory`.
    antigo.exec('ALTER TABLE user_profile DROP COLUMN theme')
    antigo.exec('DROP TABLE allowed_directory')
    antigo.exec('DROP TABLE workflow')
    antigo.exec('DROP TABLE automation')
    antigo.pragma('user_version = 1')
    antigo.close()

    const migrado = openDatabase(caminho)

    expect(migrado.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(new AuditRepository(migrado, CHAVE).verify('u-1')).toEqual({ ok: true, checked: 1 })
    migrado.close()
    db = openDatabase(join(dir, 'teste.db'))
  })

  it('é idempotente e preserva o dado já gravado', () => {
    // A regra da spec: migration nunca zera auditoria. Reabrir o banco não pode
    // reaplicar nada nem perder evento.
    audit.append({ user_id: 'u-1', type: 'login' })
    db.close()

    const reaberto = openDatabase(join(dir, 'teste.db'))
    const eventos = new AuditRepository(reaberto, CHAVE).list('u-1')

    expect(eventos).toHaveLength(1)
    expect(reaberto.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    reaberto.close()
    db = reaberto
  })
})

describe('AuditEvent — append-only no storage (ADR-004, camada 1)', () => {
  it('o trigger rejeita UPDATE mesmo por SQL direto, fora do repositório', () => {
    // O repositório não expõe update; isto prova que nem contornando ele dá.
    audit.append({ user_id: 'u-1', type: 'login' })

    expect(() => db.prepare("UPDATE audit_event SET type = 'logout'").run()).toThrow(/append-only/)
  })

  it('o trigger rejeita DELETE mesmo por SQL direto', () => {
    audit.append({ user_id: 'u-1', type: 'login' })

    expect(() => db.prepare('DELETE FROM audit_event').run()).toThrow(/append-only/)
    expect(audit.list('u-1')).toHaveLength(1)
  })

  it('impede dois eventos com o mesmo seq para o mesmo usuário', () => {
    const evento = audit.append({ user_id: 'u-1', type: 'login' })

    expect(() =>
      db
        .prepare(
          `INSERT INTO audit_event (id, user_id, workspace_id, type, payload, created_at, seq, prev_hash, hash)
           VALUES ('outro', 'u-1', NULL, 'login', '{}', '2026-07-22T10:00:00.000Z', ?, 'x', 'y')`
        )
        .run(evento.seq)
    ).toThrow()
  })
})

describe('AuditEvent — cadeia', () => {
  it('encadeia seq e prev_hash a partir do genesis', () => {
    const primeiro = audit.append({ user_id: 'u-1', type: 'login' })
    const segundo = audit.append({ user_id: 'u-1', type: 'workspace-switch', workspace_id: 'noa' })

    expect(primeiro.seq).toBe(1)
    expect(primeiro.prev_hash).toBe('genesis')
    expect(segundo.seq).toBe(2)
    expect(segundo.prev_hash).toBe(primeiro.hash)
  })

  it('mantém cadeias independentes por usuário', () => {
    audit.append({ user_id: 'u-1', type: 'login' })
    const outro = audit.append({ user_id: 'u-2', type: 'login' })

    // O seq é monotônico POR usuário: o primeiro evento de u-2 é o seq 1 dele.
    expect(outro.seq).toBe(1)
    expect(audit.verify('u-1').ok).toBe(true)
    expect(audit.verify('u-2').ok).toBe(true)
  })

  it('verifica a cadeia íntegra', () => {
    for (let i = 0; i < 5; i += 1) audit.append({ user_id: 'u-1', type: 'login' })

    expect(audit.verify('u-1')).toEqual({ ok: true, checked: 5 })
  })

  it('acusa forja feita direto no arquivo do banco (critério de aceite 3)', () => {
    // A prova central da fatia. O trigger impede UPDATE — então o atacante teria de
    // desligá-lo, que é exatamente o que se simula aqui: dropar o trigger e editar a
    // linha. A cadeia continua acusando, porque sem a chave HMAC ele não a recomputa.
    audit.append({ user_id: 'u-1', type: 'login' })
    audit.append({ user_id: 'u-1', type: 'workspace-switch', workspace_id: 'noa' })
    audit.append({ user_id: 'u-1', type: 'logout' })

    db.exec('DROP TRIGGER audit_event_sem_update')
    db.prepare('UPDATE audit_event SET payload = \'{"forjado":true}\' WHERE seq = 2').run()

    const resultado = audit.verify('u-1')

    expect(resultado.ok).toBe(false)
    expect(resultado).toMatchObject({ brokenAt: 2, reason: 'hash-invalido' })
  })

  it('verifica a cadeia completa mesmo quando há eventos de workspaces distintos', () => {
    // A cadeia é por user_id: verificar só um recorte acusaria quebra falsa.
    audit.append({ user_id: 'u-1', type: 'workspace-switch', workspace_id: 'noa' })
    audit.append({ user_id: 'u-1', type: 'workspace-switch', workspace_id: 'jarvis' })

    expect(audit.verify('u-1')).toEqual({ ok: true, checked: 2 })
  })
})

describe('isolamento por escopo (critério de aceite 5)', () => {
  it('não devolve evento de um usuário na consulta de outro', () => {
    audit.append({ user_id: 'u-1', type: 'login' })
    audit.append({ user_id: 'u-2', type: 'login' })

    expect(audit.list('u-1')).toHaveLength(1)
    expect(audit.list('u-1').every((e) => e.user_id === 'u-1')).toBe(true)
  })

  it('não devolve evento de noa na consulta escopada a jarvis', () => {
    audit.append({ user_id: 'u-1', type: 'workspace-switch', workspace_id: 'noa' })
    audit.append({ user_id: 'u-1', type: 'workspace-switch', workspace_id: 'jarvis' })

    const noJarvis = audit.list('u-1', 'jarvis')

    expect(noJarvis).toHaveLength(1)
    expect(noJarvis[0]?.workspace_id).toBe('jarvis')
  })

  it('não devolve sessão de um usuário na consulta de outro', () => {
    const sessions = new SessionRepository(db)
    const base = {
      expires_at: '2026-08-21T10:00:00.000Z',
      last_online_auth_at: '2026-07-22T10:00:00.000Z',
      created_at: '2026-07-22T10:00:00.000Z'
    }
    sessions.save({ id: 's-1', user_id: 'u-1', ...base })
    sessions.save({ id: 's-2', user_id: 'u-2', ...base })

    expect(sessions.findActive('u-1')?.id).toBe('s-1')
    expect(sessions.findActive('u-2')?.id).toBe('s-2')
  })

  it('logout de um usuário não apaga a sessão do outro', () => {
    const sessions = new SessionRepository(db)
    const base = {
      expires_at: '2026-08-21T10:00:00.000Z',
      last_online_auth_at: '2026-07-22T10:00:00.000Z',
      created_at: '2026-07-22T10:00:00.000Z'
    }
    sessions.save({ id: 's-1', user_id: 'u-1', ...base })
    sessions.save({ id: 's-2', user_id: 'u-2', ...base })

    sessions.deleteForUser('u-1')

    expect(sessions.findActive('u-1')).toBeUndefined()
    expect(sessions.findActive('u-2')?.id).toBe('s-2')
  })
})

describe('nenhum segredo no banco (critério de aceite 6)', () => {
  it('a tabela session não tem coluna de token', () => {
    const colunas = (db.pragma('table_info(session)') as { name: string }[]).map((c) => c.name)

    expect(colunas).toEqual(['id', 'user_id', 'expires_at', 'last_online_auth_at', 'created_at'])
    expect(colunas.join(' ')).not.toMatch(/token|secret|password/i)
  })
})

describe('perfil de usuário', () => {
  it('grava e relê, sem duplicar ao salvar de novo', () => {
    const profiles = new UserProfileRepository(db)
    const perfil = {
      id: 'u-1',
      name: 'Rodrigo',
      email: 'rod@example.com',
      locale: 'pt-BR' as const,
      theme: 'sistema' as const
    }

    profiles.save(perfil)
    profiles.save({ ...perfil, name: 'Rodrigo Reis' })

    expect(profiles.findById('u-1')?.name).toBe('Rodrigo Reis')
    expect(db.prepare('SELECT COUNT(*) c FROM user_profile').get()).toEqual({ c: 1 })
  })

  it('não sobrescreve preferências ao regravar o perfil (SPEC-05, critério 1)', () => {
    // O main chama `save` a cada boot com o perfil padrão. Se o upsert sobrescrevesse
    // `locale`/`theme`, a escolha do usuário sumiria a cada reinício.
    const profiles = new UserProfileRepository(db)
    const padrao = {
      id: 'u-1',
      name: 'Usuário local',
      email: '',
      locale: 'pt-BR' as const,
      theme: 'sistema' as const
    }

    profiles.save(padrao)
    profiles.savePreferences('u-1', { locale: 'en-US', theme: 'escuro' })
    profiles.save(padrao) // simula o boot seguinte

    expect(profiles.findById('u-1')).toMatchObject({ locale: 'en-US', theme: 'escuro' })
  })
})

describe('instrumentação do logger (critério de aceite 7)', () => {
  it('emite info na categoria db ao gravar com sucesso', () => {
    audit.append({ user_id: 'u-1', type: 'login' })

    expect(logDb.info).toHaveBeenCalledWith(
      'Evento de auditoria registrado',
      expect.objectContaining({ op: 'insert', table: 'audit_event' })
    )
  })

  it('emite error na categoria db quando a gravação falha', () => {
    // Falha real, não simulada: o trigger rejeita, e o repositório tem de logar `error`
    // com `ctx.op`/`ctx.table` antes de propagar.
    const profiles = new UserProfileRepository(db)
    db.exec('DROP TABLE user_profile')

    expect(() =>
      profiles.save({ id: 'u-1', name: 'x', email: 'x@y.z', locale: 'pt-BR', theme: 'sistema' })
    ).toThrow()
    expect(logDb.error).toHaveBeenCalledWith(
      'Falha ao gravar perfil de usuário',
      expect.objectContaining({ op: 'upsert', table: 'user_profile' })
    )
  })

  it('não coloca valor sensível no ctx do log', () => {
    audit.append({ user_id: 'u-1', type: 'login', payload: { token: 'nao-pode-vazar' } })

    expect(JSON.stringify(logDb.info.mock.calls)).not.toContain('nao-pode-vazar')
  })
})
