import type { ReleaseEnvironment } from '@shared/domain/release'
import {
  DatabaseMigrationRunner,
  type MigrationFile,
  type MigrationOutcome
} from '../database-migration-runner'
import { PromotionProviderError, type PromotionDatabasePort } from '../promotion-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso } from './preview-cli-errors'
import {
  BARRA_INVERTIDA,
  lerConexaoDoBanco,
  PORTA_DO_POSTGRES,
  PsqlExecutor
} from './railway-database-adapter'

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

export class RailwayPromotionDatabaseAdapter implements Pick<
  PromotionDatabasePort,
  'migrate' | 'applied'
> {
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
    // O `psql` lê o SQL de stdin e executa meta-comandos (`\! comando` roda no host do operador):
    // nenhuma barra invertida entra, nem dentro de literal.
    if (input.migrations.some((m) => m.sql.includes(BARRA_INVERTIDA)))
      throw new PromotionProviderError(
        'incompatible-state',
        'Migration não pode conter barra invertida (meta-comando do psql).'
      )
    return this.comRunner(input.environment, (runner, database) =>
      runner.apply({
        database,
        migrations: input.migrations,
        // Produção: nenhum `pg_dump`. A impressão ninguém usa aqui e leria o dado do ambiente.
        impressao: false
      })
    )
  }

  /**
   * O que o banco do ambiente já aplicou (SPEC-Release-05): só leitura, pela mesma conexão da
   * migration. É a prova que a reconciliação de uma migration incerta usa antes de repetir.
   */
  async applied(input: {
    environment: ReleaseEnvironment
  }): Promise<readonly { id: string; checksum: string }[]> {
    return this.comRunner(input.environment, (runner, database) => runner.aplicadas(database))
  }

  private async comRunner<T>(
    environment: ReleaseEnvironment,
    usar: (runner: DatabaseMigrationRunner, database: string) => Promise<T>
  ): Promise<T> {
    const ambiente = this.nomeDoAmbiente(environment)
    let abriuProxy = false
    const conexao = await lerConexaoDoBanco(
      (args, etapa) => this.cli(args, etapa),
      this.config.databaseService,
      ambiente,
      () => {
        abriuProxy = true
      }
    )
    try {
      return await usar(
        new DatabaseMigrationRunner(new PsqlExecutor(this.runner, conexao)),
        conexao.database
      )
    } finally {
      // O proxy é endereço público do banco: quem o abriu o fecha. O que já existia é do operador.
      if (abriuProxy) await this.fecharProxy(ambiente)
    }
  }

  /** Melhor esforço: falhar aqui não pode desfazer nem mascarar a migration que já foi aplicada. */
  private async fecharProxy(ambiente: string): Promise<void> {
    try {
      await this.cli(
        [
          'tcp-proxy',
          'delete',
          String(PORTA_DO_POSTGRES),
          '--yes',
          '--service',
          this.config.databaseService,
          '--environment',
          ambiente,
          '--json'
        ],
        'fechar proxy do banco'
      )
    } catch {
      // O proxy segue protegido pela senha; o operador o remove pelo painel do Railway.
    }
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
