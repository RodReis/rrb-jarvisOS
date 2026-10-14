import { PADRAO_DE_AMBIENTE_DE_PREVIEW } from '@shared/domain/release-preview'
import {
  DatabaseMigrationRunner,
  type MigrationFile,
  type MigrationOutcome,
  type SqlExecutor,
  type SqlResult
} from '../database-migration-runner'
import { PreviewProviderError, type PreviewDatabasePort } from '../preview-ports'
import type { CommandResult, CommandRunner } from './command-runner'
import { exigirSucesso, lerJson } from './preview-cli-errors'
import type { RailwayPreviewConfig } from './railway-backend-adapter'

/**
 * Migrations e seed no PostgreSQL temporário do Preview (SPEC-Release-03). O banco é o do próprio
 * ambiente Railway; a conexão é por TCP proxy público e `psql`, com a senha **só** no ambiente do
 * processo filho (`PGPASSWORD`), nunca em argumento, e redigida de qualquer saída. A senha é lida
 * do próprio ambiente na hora e não é guardada em lugar nenhum.
 */

const TIMEOUT_MS = 10 * 60_000
export const PORTA_DO_POSTGRES = 5432
/** Barra invertida: abre meta-comando do `psql`. Em constante para o arquivo não conter o literal. */
export const BARRA_INVERTIDA = String.fromCharCode(92)

export interface Conexao {
  readonly host: string
  readonly port: string
  readonly user: string
  readonly password: string
  readonly database: string
}

export class PsqlExecutor implements SqlExecutor {
  constructor(
    private readonly runner: CommandRunner,
    private readonly conexao: Conexao
  ) {}

  private env(): Record<string, string> {
    return {
      PGHOST: this.conexao.host,
      PGPORT: this.conexao.port,
      PGUSER: this.conexao.user,
      PGPASSWORD: this.conexao.password,
      PGDATABASE: this.conexao.database,
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '30'
    }
  }

  async run(sql: string): Promise<SqlResult> {
    const r = await this.runner.run(
      'psql',
      ['--no-psqlrc', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
      { env: this.env(), input: sql, redact: [this.conexao.password], timeoutMs: TIMEOUT_MS }
    )
    // A saída de erro do banco não sai daqui: o runner devolve só um código à camada de cima.
    return { ok: r.code === 0 && !r.timedOut, stdout: r.stdout, stderr: '' }
  }

  async dump(_database: string, args: readonly string[]): Promise<string> {
    const r = await this.runner.run('pg_dump', [...args], {
      env: this.env(),
      redact: [this.conexao.password],
      timeoutMs: TIMEOUT_MS
    })
    if (r.code !== 0 || r.timedOut)
      throw new PreviewProviderError('failed', 'Não foi possível ler o estado do banco do Preview.')
    return r.stdout
  }
}

export class RailwayDatabaseAdapter implements PreviewDatabasePort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: RailwayPreviewConfig
  ) {}

  private cli(args: readonly string[], etapa: string) {
    return this.runner
      .run('railway', args, {
        cwd: this.config.workdir,
        env: { RAILWAY_API_TOKEN: this.config.token },
        redact: [this.config.token],
        timeoutMs: TIMEOUT_MS
      })
      .then((resultado) => exigirSucesso(resultado, etapa))
  }

  async migrateAndSeed(input: {
    name: string
    migrations: readonly MigrationFile[]
    seed: string
  }): Promise<MigrationOutcome> {
    if (!PADRAO_DE_AMBIENTE_DE_PREVIEW.test(input.name))
      throw new PreviewProviderError('incompatible-state', 'O banco não pertence a um Preview.')
    // O `psql` lê o SQL de stdin e executa meta-comandos (`\! comando` roda no host do operador).
    // O SQL vem da árvore do PR: nenhuma barra invertida entra, nem dentro de literal.
    if (
      input.seed.includes(BARRA_INVERTIDA) ||
      input.migrations.some((m) => m.sql.includes(BARRA_INVERTIDA))
    )
      throw new PreviewProviderError(
        'incompatible-state',
        'Migration ou seed do Preview não pode conter barra invertida (meta-comando do psql).'
      )
    const conexao = await this.conectar(input.name)
    return new DatabaseMigrationRunner(new PsqlExecutor(this.runner, conexao)).apply({
      database: conexao.database,
      migrations: input.migrations,
      seed: input.seed
    })
  }

  private conectar(ambiente: string): Promise<Conexao> {
    return lerConexaoDoBanco(
      (args, etapa) => this.cli(args, etapa),
      this.config.databaseService,
      ambiente
    )
  }
}

/**
 * Lê a conexão do banco do ambiente pela CLI: abre o TCP proxy se ainda não houver um e lê as
 * variáveis do serviço. Compartilhada com o banco dos ambientes persistentes (SPEC-Release-04).
 */
export async function lerConexaoDoBanco(
  cli: (args: readonly string[], etapa: string) => Promise<CommandResult>,
  databaseService: string,
  ambiente: string,
  /** Chamado quando ESTA leitura abriu o proxy: quem o abriu é quem deve fechá-lo. */
  aoAbrirProxy?: () => void
): Promise<Conexao> {
  const base = ['--service', databaseService, '--environment', ambiente]
  const proxies = lerJson(
    await cli(['tcp-proxy', 'list', ...base, '--json'], 'listar proxy do banco'),
    'listar proxy do banco'
  )
  if (!Array.isArray(proxies) || proxies.length === 0) {
    await cli(
      ['tcp-proxy', 'create', '--port', String(PORTA_DO_POSTGRES), ...base, '--json'],
      'abrir proxy do banco'
    )
    aoAbrirProxy?.()
  }
  const bruto = lerJson(
    await cli(['variable', 'list', ...base, '--json'], 'ler variáveis do banco'),
    'ler variáveis do banco'
  ) as Record<string, unknown> | null
  const variavel = (nome: string): string => {
    const valor = bruto?.[nome]
    if (typeof valor !== 'string' || !valor)
      throw new PreviewProviderError('incompatible-state', `O banco do ambiente não expõe ${nome}.`)
    return valor
  }
  return {
    host: variavel('RAILWAY_TCP_PROXY_DOMAIN'),
    port: variavel('RAILWAY_TCP_PROXY_PORT'),
    user: variavel('PGUSER'),
    password: variavel('PGPASSWORD'),
    database: variavel('PGDATABASE')
  }
}
