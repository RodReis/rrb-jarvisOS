import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DatabaseMigrationRunner,
  lerMigrations,
  normalizarDump,
  type MigrationFile,
  type SqlExecutor
} from './database-migration-runner'

const M1: MigrationFile = { id: '001_a', sql: 'CREATE TABLE a (id int);', checksum: 'a1' }
const M2: MigrationFile = { id: '002_b', sql: 'CREATE TABLE b (id int);', checksum: 'a2' }
const SEED = 'INSERT INTO a VALUES (1);'

/** Executor roteirizado: guarda cada script e responde a leitura de `schema_migrations`. */
function executor(
  aplicadas: string,
  falhaEm?: string
): SqlExecutor & { scripts: string[]; dumps: (readonly string[])[] } {
  const scripts: string[] = []
  const dumps: (readonly string[])[] = []
  return {
    scripts,
    dumps,
    async run(sql) {
      scripts.push(sql)
      if (sql.includes('FROM schema_migrations')) return { ok: true, stdout: aplicadas, stderr: '' }
      if (falhaEm && sql.includes(falhaEm)) return { ok: false, stdout: '', stderr: 'ERROR: boom' }
      return { ok: true, stdout: '', stderr: '' }
    },
    async dump(_db, args) {
      dumps.push(args)
      return `-- comentário\nCREATE TABLE a (id int);\n`
    }
  }
}

describe('DatabaseMigrationRunner', () => {
  it('cria a tabela de controle, aplica em ordem e grava o checksum de cada migration', async () => {
    const exec = executor('')
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1, M2] })
    expect(r).toMatchObject({ state: 'confirmed', applied: ['001_a', '002_b'] })
    expect(exec.scripts[0]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations')
    const aplicadas = exec.scripts.filter((s) => s.includes('INSERT INTO schema_migrations'))
    expect(aplicadas[0]).toContain(`'001_a'`)
    expect(aplicadas[0]).toContain(`'a1'`)
    expect(aplicadas[1]).toContain(`'002_b'`)
  })

  it('sem impressão do banco não roda pg_dump: o dado do ambiente não é lido (Produção)', async () => {
    const exec = executor('')
    const r = await new DatabaseMigrationRunner(exec).apply({
      database: 'd',
      migrations: [M1, M2],
      impressao: false
    })
    expect(r).toMatchObject({ state: 'confirmed', applied: ['001_a', '002_b'] })
    expect(exec.dumps).toEqual([])
    // A impressão sem banco ainda identifica as migrations aplicadas.
    expect((r as { fingerprint: string }).fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('pula a migration já aplicada com o mesmo checksum', async () => {
    const exec = executor('001_a|a1\n')
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1, M2] })
    expect(r).toMatchObject({ state: 'confirmed', applied: ['002_b'], skipped: ['001_a'] })
  })

  it('migration já aplicada e alterada depois bloqueia: forward-only', async () => {
    const exec = executor('001_a|ff\n')
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1, M2] })
    expect(r).toMatchObject({ state: 'failed', reason: 'checksum-divergent', failedAt: '001_a' })
    expect(exec.scripts.some((s) => s.includes('CREATE TABLE b'))).toBe(false)
  })

  it('migration aplicada que sumiu do diretório bloqueia', async () => {
    const exec = executor('001_a|a1\n003_c|a3\n')
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1, M2] })
    expect(r).toMatchObject({ state: 'failed', reason: 'migration-missing', failedAt: '003_c' })
  })

  it('migration quebrada interrompe: as seguintes e o seed não rodam', async () => {
    const exec = executor('', 'CREATE TABLE a')
    const r = await new DatabaseMigrationRunner(exec).apply({
      database: 'd',
      migrations: [M1, M2],
      seed: SEED
    })
    expect(r).toMatchObject({ state: 'failed', reason: 'migration-failed', failedAt: '001_a' })
    expect(exec.scripts.some((s) => s.includes('CREATE TABLE b'))).toBe(false)
    expect(exec.scripts.some((s) => s.includes(SEED))).toBe(false)
  })

  it('a razão da falha é um código: a saída do banco não vaza para o resultado', async () => {
    const exec = executor('', 'CREATE TABLE a')
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1] })
    expect(JSON.stringify(r)).not.toContain('boom')
  })

  it('aplica o seed uma vez, depois das migrations, e o registra como controle', async () => {
    const exec = executor('')
    const r = await new DatabaseMigrationRunner(exec).apply({
      database: 'd',
      migrations: [M1],
      seed: SEED
    })
    expect(r).toMatchObject({ state: 'confirmed', seedApplied: true })
    const ordem = exec.scripts.filter((s) => s.includes('INSERT INTO'))
    expect(ordem[0]).toContain('001_a')
    expect(ordem[1]).toContain(SEED)
    expect(ordem[1]).toContain(`'__seed__'`)
  })

  it('não repete o seed já aplicado', async () => {
    const seedSum = new DatabaseMigrationRunner(executor('')).checksumDoSeed(SEED)
    const exec = executor(`001_a|a1\n__seed__|${seedSum}\n`)
    const r = await new DatabaseMigrationRunner(exec).apply({
      database: 'd',
      migrations: [M1],
      seed: SEED
    })
    expect(r).toMatchObject({ state: 'confirmed', seedApplied: false })
  })

  it('falha ao criar a tabela de controle bloqueia', async () => {
    const exec = executor('')
    exec.run = async () => ({ ok: false, stdout: '', stderr: 'x' })
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1] })
    expect(r).toMatchObject({
      state: 'failed',
      reason: 'migration-failed',
      failedAt: 'schema_migrations'
    })
  })

  it('falha ao ler o que já foi aplicado não vira "nada aplicado"', async () => {
    const exec = executor('')
    const original = exec.run
    exec.run = async (sql, db) =>
      sql.includes('FROM schema_migrations')
        ? { ok: false, stdout: '', stderr: 'x' }
        : original(sql, db)
    const r = await new DatabaseMigrationRunner(exec).apply({ database: 'd', migrations: [M1] })
    expect(r).toMatchObject({
      state: 'failed',
      reason: 'migration-failed',
      failedAt: 'schema_migrations'
    })
    expect(exec.scripts.some((s) => s.includes('CREATE TABLE a'))).toBe(false)
  })

  it('recusa id de migration fora do padrão (vai para SQL)', async () => {
    await expect(
      new DatabaseMigrationRunner(executor('')).apply({
        database: 'd',
        migrations: [{ id: "x'; DROP TABLE a;--", sql: 'SELECT 1', checksum: 'aa' }]
      })
    ).rejects.toThrow(TypeError)
  })

  it('a impressão do banco é estável: ignora comentários de versão', () => {
    expect(
      normalizarDump(
        '-- Dumped from database version 16.10\n\\restrict abc123\nCREATE TABLE a;\n\n\\unrestrict abc123\n'
      )
    ).toBe('CREATE TABLE a;')
  })

  it('o fingerprint não depende de comentário nem de token aleatório do dump', async () => {
    const a = executor('')
    const b = executor('')
    b.dump = async () =>
      `-- outra versão\n\\restrict zzz\nCREATE TABLE a (id int);\n\\unrestrict zzz\n`
    const ra = await new DatabaseMigrationRunner(a).apply({ database: 'd', migrations: [M1] })
    const rb = await new DatabaseMigrationRunner(b).apply({ database: 'd', migrations: [M1] })
    expect(
      ra.state === 'confirmed' && rb.state === 'confirmed' && ra.fingerprint === rb.fingerprint
    ).toBe(true)
  })
})

describe('lerMigrations', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('ordena por nome, ignora o que não é migration e normaliza fim de linha no checksum', () => {
    dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    writeFileSync(join(dir, '002_b.sql'), 'SELECT 2;\r\n')
    writeFileSync(join(dir, '001_a.sql'), 'SELECT 1;\n')
    writeFileSync(join(dir, 'LEIAME.md'), 'x')
    const lidas = lerMigrations(dir)
    expect(lidas.map((m) => m.id)).toEqual(['001_a', '002_b'])
    const crlf = lidas[1]!.checksum
    writeFileSync(join(dir, '002_b.sql'), 'SELECT 2;\n')
    expect(lerMigrations(dir)[1]!.checksum).toBe(crlf)
  })
})

describe('DatabaseMigrationRunner.aplicadas (reconciliação, SPEC-Release-05)', () => {
  /** Executor que responde à presença da tabela e à leitura dos checksums; nunca escreve. */
  function leitor(
    presente: string,
    linhas: string,
    falhaNaPresenca = false
  ): SqlExecutor & { scripts: string[] } {
    const scripts: string[] = []
    return {
      scripts,
      async run(sql) {
        scripts.push(sql)
        if (sql.includes('to_regclass')) {
          return falhaNaPresenca
            ? { ok: false, stdout: '', stderr: 'ERROR: conexão' }
            : { ok: true, stdout: presente, stderr: '' }
        }
        return { ok: true, stdout: linhas, stderr: '' }
      },
      async dump() {
        throw new Error('leitura não faz dump')
      }
    }
  }

  it('devolve o que o banco já aplicou, sem a marca do seed e sem escrever nada', async () => {
    const exec = leitor('t', ['001_a|a1', '002_b|a2', '__seed__|ff', ''].join('\n'))
    expect(await new DatabaseMigrationRunner(exec).aplicadas('d')).toEqual([
      { id: '001_a', checksum: 'a1' },
      { id: '002_b', checksum: 'a2' }
    ])
    expect(exec.scripts.some((s) => /CREATE|INSERT|UPDATE|DELETE/i.test(s))).toBe(false)
  })

  it('banco virgem (sem a tabela de controle) não tem migration aplicada', async () => {
    expect(await new DatabaseMigrationRunner(leitor('f', '')).aplicadas('d')).toEqual([])
  })

  it('leitura que falha não é "nada aplicado": lança, para a reconciliação ficar sem resposta', async () => {
    await expect(new DatabaseMigrationRunner(leitor('', '', true)).aplicadas('d')).rejects.toThrow(
      'migration-state-unreadable'
    )
  })
})
