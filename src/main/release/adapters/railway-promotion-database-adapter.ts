import type { ReleaseEnvironment } from '@shared/domain/release'
import {
  DatabaseMigrationRunner,
  type MigrationFile,
  type MigrationOutcome
} from '../database-migration-runner'
import { PromotionProviderError, type PromotionDatabasePort } from '../promotion-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso } from './preview-cli-errors'
import { BARRA_INVERTIDA, lerConexaoDoBanco, PsqlExecutor } from './railway-database-adapter'

/**
 * Migrations forward-only no PostgreSQL dos ambientes persistentes (SPEC-Release-04). Mesmo
 * transporte do Preview (F03): o banco é o do próprio ambiente Railway, acessado por TCP proxy
 * e `psql`, com a senha **só** no ambiente do processo filho e redigida de qualquer saída. A
 * senha é lida do ambiente na hora e não é guardada. Aqui não há seed: dado de desenvolvimento
 * nunca entra em Staging ou Produção. O backup é de outro adapter.
 *
 * O token (`RAILWAY_API_TOKEN`) também vai só no ambiente do filho. O diretório de trabalho
 * precisa estar vinculado ao projeto (`railway link`).
 */

export interface RailwayPromotionDatabaseConfig {
  /** Pasta já vinculada ao projeto Railway dos ambientes persistentes. */
  readonly workdir: string
  readonly token: string
  /** Nomes exatos dos ambientes no Railway; qualquer outro nome é recusado. */
  readonly environments: { readonly staging: string; readonly production: string }
  readonly databaseService: string
}

const TIMEOUT_MS = 10 * 60_000

export class RailwayPromotionDatabaseAdapter implements Pick<PromotionDatabasePort, 'migrate'> {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: RailwayPromotionDatabaseConfig
  ) {
    const { staging, production } = config.environments
    if (!staging || !production || staging === production)
      throw new TypeError(
        'Staging e Produção precisam de nomes de ambiente distintos e não vazios.'
      )
  }

  async migrate(input: {
    environment: ReleaseEnvironment
    migrations: readonly MigrationFile[]
  }): Promise<MigrationOutcome> {
    const ambiente = this.nomeDoAmbiente(input.environment)
    // O `psql` lê o SQL de stdin e executa meta-comandos (`\! comando` roda no host do operador):
    // nenhuma barra invertida entra, nem dentro de literal.
    if (input.migrations.some((m) => m.sql.includes(BARRA_INVERTIDA)))
      throw new PromotionProviderError(
        'incompatible-state',
        'Migration não pode conter barra invertida (meta-comando do psql).'
      )
    const conexao = await lerConexaoDoBanco(
      (args, etapa) => this.cli(args, etapa),
      this.config.databaseService,
      ambiente
    )
    return new DatabaseMigrationRunner(new PsqlExecutor(this.runner, conexao)).apply({
      database: conexao.database,
      migrations: input.migrations
    })
  }

  /** Lista de permissão: só os dois nomes configurados chegam à CLI. */
  private nomeDoAmbiente(environment: ReleaseEnvironment): string {
    if (environment !== 'staging' && environment !== 'production')
      throw new PromotionProviderError('incompatible-state', 'Ambiente fora de Staging e Produção.')
    return this.config.environments[environment]
  }

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
}
