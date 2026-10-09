import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Migrations locais forward-only e seed determinístico (SPEC-Release-02). O banco guarda o
 * checksum de cada migration aplicada em `schema_migrations`: migration já aplicada e depois
 * editada, ou que sumiu do diretório, bloqueia — nunca é reescrita. Falha interrompe antes de
 * qualquer publicação (regra 4). A razão devolvida é um código; a saída do banco não sai daqui.
 */

export interface MigrationFile {
  readonly id: string
  readonly sql: string
  readonly checksum: string
}

export interface SqlResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

/** Porta para o banco. A implementação real fala com o `psql` dentro do contêiner. */
export interface SqlExecutor {
  /** Roda o script numa transação única; `stdout` vem sem cabeçalho (`-At`). */
  run(sql: string, database: string): Promise<SqlResult>
  dump(database: string, args: readonly string[]): Promise<string>
}

export type MigrationFailure = 'migration-failed' | 'checksum-divergent' | 'migration-missing'

export type MigrationOutcome =
  | {
      readonly state: 'confirmed'
      readonly applied: readonly string[]
      readonly skipped: readonly string[]
      readonly seedApplied: boolean
      /** Impressão do estado do banco: duas execuções iguais produzem o mesmo valor. */
      readonly fingerprint: string
    }
  | {
      readonly state: 'failed'
      readonly reason: MigrationFailure
      readonly failedAt: string
      readonly applied: readonly string[]
    }

const SEED_ID = '__seed__'
const ID_VALIDO = /^[A-Za-z0-9._-]+$/
const CHECKSUM_VALIDO = /^[a-f0-9]+$/
const NOME_DE_MIGRATION = /^(\d+[_-].*)\.sql$/

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')
const normalizarFimDeLinha = (texto: string): string => texto.replace(/\r\n/g, '\n')

export function lerMigrations(diretorio: string): MigrationFile[] {
  return readdirSync(diretorio)
    .sort()
    .flatMap((arquivo) => {
      const id = NOME_DE_MIGRATION.exec(arquivo)?.[1]
      if (!id) return []
      const sql = readFileSync(join(diretorio, arquivo), 'utf8')
      return [{ id, sql, checksum: sha256(normalizarFimDeLinha(sql)) }]
    })
}

/** Tira o que o `pg_dump` muda a cada execução: comentários de versão e o token `\restrict`. */
export function normalizarDump(dump: string): string {
  return dump
    .split(/\r?\n/)
    .filter((linha) => linha.trim() && !linha.startsWith('--') && !/^\\(un)?restrict\b/.test(linha))
    .join('\n')
}

function registrar(id: string, checksum: string): string {
  return `INSERT INTO schema_migrations (id, checksum) VALUES ('${id}', '${checksum}');`
}

export class DatabaseMigrationRunner {
  constructor(private readonly executor: SqlExecutor) {}

  checksumDoSeed(seed: string): string {
    return sha256(normalizarFimDeLinha(seed))
  }

  async apply(entrada: {
    readonly database: string
    readonly migrations: readonly MigrationFile[]
    readonly seed?: string
  }): Promise<MigrationOutcome> {
    for (const m of entrada.migrations) {
      if (!ID_VALIDO.test(m.id) || !CHECKSUM_VALIDO.test(m.checksum))
        throw new TypeError(`Migration inválida: ${m.id}`)
    }
    const { database } = entrada
    await this.executor.run(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());`,
      database
    )
    const aplicadasNoBanco = await this.lerAplicadas(database)
    const noDiretorio = new Map(entrada.migrations.map((m) => [m.id, m.checksum]))

    for (const [id, checksum] of aplicadasNoBanco) {
      if (id === SEED_ID) continue
      if (!noDiretorio.has(id)) return this.falha('migration-missing', id, [])
      if (noDiretorio.get(id) !== checksum) return this.falha('checksum-divergent', id, [])
    }

    const applied: string[] = []
    const skipped: string[] = []
    for (const m of entrada.migrations) {
      if (aplicadasNoBanco.has(m.id)) {
        skipped.push(m.id)
        continue
      }
      const resultado = await this.executor.run(
        `${m.sql}\n;\n${registrar(m.id, m.checksum)}`,
        database
      )
      if (!resultado.ok) return this.falha('migration-failed', m.id, applied)
      applied.push(m.id)
    }

    let seedApplied = false
    if (entrada.seed !== undefined) {
      const checksum = this.checksumDoSeed(entrada.seed)
      const anterior = aplicadasNoBanco.get(SEED_ID)
      if (anterior !== undefined && anterior !== checksum)
        return this.falha('checksum-divergent', SEED_ID, applied)
      if (anterior === undefined) {
        const resultado = await this.executor.run(
          `${entrada.seed}\n;\n${registrar(SEED_ID, checksum)}`,
          database
        )
        if (!resultado.ok) return this.falha('migration-failed', SEED_ID, applied)
        seedApplied = true
      }
    }

    return {
      state: 'confirmed',
      applied,
      skipped,
      seedApplied,
      fingerprint: await this.impressao(database, entrada.migrations, entrada.seed)
    }
  }

  private async lerAplicadas(database: string): Promise<Map<string, string>> {
    const resultado = await this.executor.run(
      `SELECT id || '|' || checksum FROM schema_migrations ORDER BY id;`,
      database
    )
    const mapa = new Map<string, string>()
    for (const linha of resultado.stdout.split(/\r?\n/)) {
      const corte = linha.indexOf('|')
      if (corte > 0) mapa.set(linha.slice(0, corte), linha.slice(corte + 1).trim())
    }
    return mapa
  }

  private async impressao(
    database: string,
    migrations: readonly MigrationFile[],
    seed?: string
  ): Promise<string> {
    const esquema = await this.executor.dump(database, [
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--exclude-table=schema_migrations'
    ])
    const dados = await this.executor.dump(database, [
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--exclude-table=schema_migrations'
    ])
    return sha256(
      [
        migrations.map((m) => `${m.id}:${m.checksum}`).join(','),
        seed === undefined ? '' : this.checksumDoSeed(seed),
        normalizarDump(esquema),
        normalizarDump(dados)
      ].join('\n--\n')
    )
  }

  private falha(
    reason: MigrationFailure,
    failedAt: string,
    applied: readonly string[]
  ): MigrationOutcome {
    return { state: 'failed', reason, failedAt, applied }
  }
}
