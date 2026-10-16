import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import type { PromotionDatabasePort } from './promotion-ports'
import { AuditRepository } from '../storage/audit-repository'
import { loadOrCreateAuditKey } from '../storage/audit-key'
import { openDatabase } from '../storage/database'
import { PipelineRepository } from '../pipeline/pipeline-repository'
import { createCommandRunner, type CommandRunner } from './adapters/command-runner'
import { GithubReleaseAdapter } from './adapters/github-release-adapter'
import { GhcrArtifactAdapter } from './adapters/ghcr-artifact-adapter'
import { GitSourceVerifier } from './adapters/git-source-verifier'
import { HttpPromotionVerifier } from './adapters/http-promotion-verifier'
import { LocalComposeAdapter, iniciarDockerDesktop } from './adapters/local-compose-adapter'
import { PreparationBuildAdapter } from './adapters/preparation-build-adapter'
import { RailwayBackupAdapter } from './adapters/railway-backup-adapter'
import { RailwayConfigurationReader } from './adapters/railway-configuration-reader'
import { RailwayPromotionBackendAdapter } from './adapters/railway-promotion-backend-adapter'
import { RailwayPromotionDatabaseAdapter } from './adapters/railway-promotion-database-adapter'
import { V2PipelineCorrectionAdapter } from './adapters/v2-pipeline-correction-adapter'
import { VercelPromotionAdapter } from './adapters/vercel-promotion-adapter'
import { ReleaseCorrectionDispatcher } from './correction/dispatcher'
import { lerMigrations } from './database-migration-runner'
import { UsoInvalido } from './preview-cli-args'
import { lerOpcoesDePromocao, type OpcoesDePromocao } from './promotion-cli-args'
import {
  ambienteIsoladoDoE2e,
  estaDentroDe,
  exigirCommitMergeado,
  temVercelIgnore
} from './promotion-guards'
import { lerNomesDoExemplo } from './configuration-reference-validator'
import { ReleaseLocalRepository } from './release-local-repository'
import { ReleasePreparationService } from './release-preparation-service'
import { assertRepositorioPermitido, carregarPerfilDoProjeto } from './release-project-profile'
import type { PromotionProject } from './release-promotion-effects'
import { carregarPerfilDePromocao, type PromotionProfile } from './release-promotion-profile'
import { ReleasePromotionRepository } from './release-promotion-repository'
import { ReleaseRecoveryRepository } from './release-recovery-repository'
import { codigoDeSaida, type DesfechoDoComando } from './release-promote-saida'
import { PromotionService } from './release-promotion-service'
import { ReleasePublisher } from './release-publisher'
import { ReleaseRepository } from './release-repository'

/**
 * Comando da aplicação que promove e recupera releases (SPEC-Release-04 e 05). Roda dentro do
 * runtime do Electron porque a chave da cadeia de auditoria está selada no `safeStorage`. Chamado
 * por `scripts/release-promote.mjs`. Idempotente: repetir retoma do último passo confirmado e
 * nunca repete um passo de efeito incerto antes de reconciliá-lo.
 *
 * - `merge` cria (ou consolida) o candidato do SHA e o leva até a Produção estabilizada, que então
 *   recebe manifesto, tag e GitHub Release; `resume` retoma uma release e o que ficou pendente.
 * - `cancel` cancela com segurança (a operação remota em voo termina e é reconciliada antes).
 * - `rollback --to <release_id>` volta Produção a uma release conhecida; `recover` libera o
 *   projeto pausado por uma release degradada, depois de provar o estado conhecido na nuvem.
 * - `publish` e `verify` (só GitHub e banco local) publicam e conferem a identidade da release.
 *
 * Em `merge`, `resume` e `cancel` a árvore local — contexto de build, migrations e pasta do
 * frontend — precisa ser exatamente o commit da release: o `vercel deploy` publica o conteúdo da
 * pasta, não o SHA. Nenhum evento restaura o banco.
 *
 * Saída: o desfecho como JSON, sem token, URL de credencial ou saída de provedor. Código 0 = fez
 * o que foi pedido; 3 = falhou ou exige ação do operador (a evidência diz qual); 5 = aguarda a
 * lane, outro executor ou o provedor; 2 = uso inválido.
 */

const BINARIOS = [
  'docker',
  'railway',
  'vercel',
  'psql',
  'pg_dump',
  'git',
  'gh',
  'npx',
  'npm',
  'node'
]
const E2E_TIMEOUT_MS = 15 * 60_000

function argumentosDoLauncher(): readonly string[] {
  try {
    const argv: unknown = JSON.parse(process.env.JARVIS_RELEASE_PROMOTE_ARGV ?? '[]')
    if (Array.isArray(argv) && argv.every((item) => typeof item === 'string')) return argv
  } catch {
    // cai no erro de uso abaixo
  }
  throw new UsoInvalido('Execute pelo comando: npm run release:promote -- <argumentos>.')
}

/** O contexto de build, as migrations e o frontend saem da árvore local: ela precisa ser o commit. */
async function exigirArvoreDoCommit(
  runner: CommandRunner,
  pastas: readonly string[],
  sha: string
): Promise<void> {
  const verificador = new GitSourceVerifier(runner)
  for (const pasta of new Set(pastas)) {
    const resultado = await verificador.verify(pasta, sha)
    if (resultado !== 'ok')
      throw new UsoInvalido(
        `A árvore local não é o commit da release (${resultado}): faça checkout do SHA e deixe-a limpa.`
      )
  }
}

/**
 * Jornada essencial do projeto: roda o comando do perfil contra o ambiente. O código vem de um
 * commit mergeado mas roda na máquina do operador, então HOME e os diretórios de credencial
 * (Railway, Vercel, login do GHCR) apontam para uma pasta temporária vazia e nenhum token é
 * repassado.
 */
function jornadaEssencial(runner: CommandRunner, perfil: PromotionProfile) {
  const e2e = perfil.verification.e2e
  if (!e2e) return undefined
  return {
    run: async (environment: 'staging' | 'production'): Promise<boolean> => {
      const urls = perfil.environments[environment]
      const pasta = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'))
      try {
        const r = await runner.run(e2e.command, e2e.args, {
          cwd: e2e.cwd,
          env: {
            ...ambienteIsoladoDoE2e(pasta, process.env),
            E2E_ENVIRONMENT: environment,
            E2E_BASE_URL: urls.frontendUrl,
            E2E_API_URL: urls.backendUrl
          },
          timeoutMs: E2E_TIMEOUT_MS
        })
        return r.code === 0 && !r.timedOut
      } finally {
        rmSync(pasta, { recursive: true, force: true })
      }
    }
  }
}

function montarServico(
  chaveDeAuditoria: Buffer,
  runner: CommandRunner,
  opcoes: OpcoesDePromocao,
  perfil: PromotionProfile,
  projetoFor: (sha: string) => ReturnType<typeof carregarPerfilDoProjeto>,
  nucleo: ReturnType<typeof montarNucleo>
) {
  const { railway, vercel } = perfil
  const { local } = nucleo
  // Separação de domínio: o fingerprint não reutiliza a chave da auditoria diretamente.
  const fingerprintKey = createHmac('sha256', chaveDeAuditoria)
    .update('release-config-fingerprint')
    .digest('hex')
  const preparation = new ReleasePreparationService(
    local,
    new LocalComposeAdapter(runner, {
      composeFile: resolve(opcoes.composeFile),
      autoStartDocker: opcoes.autoStartDocker,
      startDocker: iniciarDockerDesktop
    }),
    new GhcrArtifactAdapter(runner, opcoes.registry, opcoes.builder ?? undefined),
    new GitSourceVerifier(runner),
    fingerprintKey
  )
  const backend = new RailwayPromotionBackendAdapter(runner, {
    workdir: railway.workdir,
    token: opcoes.tokens.railway,
    environments: railway.environments,
    backendService: railway.backendService
  })
  const frontend = new VercelPromotionAdapter(runner, {
    workdir: vercel.workdir,
    token: opcoes.tokens.vercel,
    ...(vercel.scope ? { scope: vercel.scope } : {}),
    stagingDomain: vercel.stagingDomain,
    productionDomain: vercel.productionDomain
  })
  const migrate = new RailwayPromotionDatabaseAdapter(runner, {
    workdir: railway.workdir,
    token: opcoes.tokens.railway,
    environments: railway.environments,
    databaseService: railway.databaseService
  })
  const backup = new RailwayBackupAdapter({
    token: opcoes.tokens.railway,
    projectId: railway.projectId,
    databaseService: railway.databaseService,
    environments: railway.environments
  })
  const database: PromotionDatabasePort = {
    backup: (input) => backup.backup(input),
    applied: (input) => migrate.applied(input),
    migrate: (input) => migrate.migrate(input)
  }
  const verifier = new HttpPromotionVerifier({
    environments: perfil.environments,
    healthPath: perfil.verification.healthPath,
    runtimeConfigPath: perfil.verification.runtimeConfigPath,
    smokePaths: perfil.verification.smokePaths,
    currentBackend: (environment) => backend.current(environment),
    currentFrontend: (environment) => frontend.current(environment),
    e2e: jornadaEssencial(runner, perfil)
  })
  const configuracao = new RailwayConfigurationReader(runner, {
    workdir: railway.workdir,
    token: opcoes.tokens.railway,
    backendService: railway.backendService,
    environments: railway.environments,
    fingerprintKey
  })
  const service = new PromotionService({
    repository: nucleo.repository,
    promotion: nucleo.promotion,
    local,
    recovery: nucleo.recovery,
    correction: nucleo.correction,
    publisher: nucleo.publisher,
    build: new PreparationBuildAdapter(preparation, projetoFor),
    backend,
    database,
    frontend,
    verifier
  })
  return { service, configuracao }
}

/** Repositórios e serviços que todo evento usa: o núcleo local, o publicador e a volta à V2. */
function montarNucleo(
  db: ReturnType<typeof openDatabase>,
  audit: AuditRepository,
  runner: CommandRunner,
  perfil: PromotionProfile
) {
  const repository = new ReleaseRepository(db, audit)
  const promotion = new ReleasePromotionRepository(db, audit)
  const local = new ReleaseLocalRepository(db, audit)
  const recovery = new ReleaseRecoveryRepository(db, audit)
  const publisher = new ReleasePublisher({
    repository,
    promotion,
    local,
    recovery,
    // Sem o repositório no perfil, a identidade existe e a publicação fica pendente (regra 8).
    ...(perfil.github ? { git: new GithubReleaseAdapter(runner, perfil.github.repository) } : {})
  })
  const correction = new ReleaseCorrectionDispatcher({
    repository,
    recovery,
    v2: new V2PipelineCorrectionAdapter(new PipelineRepository(db), audit)
  })
  return { repository, promotion, local, recovery, publisher, correction }
}

/**
 * Valida o que `merge`, `resume` e `cancel` leem da árvore local (contexto de build, migrations e
 * frontend) e monta o projeto da promoção. A árvore precisa ser exatamente o commit da release.
 */
async function prepararProjeto(
  runner: CommandRunner,
  opcoes: OpcoesDePromocao,
  perfil: PromotionProfile,
  sha: string
) {
  const projetoFor = (alvo: string) => {
    const projeto = carregarPerfilDoProjeto(resolve(opcoes.profile), alvo)
    // O destino da publicação é decisão do operador, não do arquivo do projeto.
    assertRepositorioPermitido(projeto.repository, opcoes.registry, opcoes.namespace ?? undefined)
    return projeto
  }
  let projeto: ReturnType<typeof projetoFor>
  try {
    projeto = projetoFor(sha)
  } catch (erro) {
    throw new UsoInvalido(erro instanceof Error ? erro.message : 'Perfil do projeto inválido.')
  }
  // 1) O commit foi revisado e mergeado (ancestral da base), não é um HEAD local qualquer.
  const merge = await exigirCommitMergeado(runner, projeto.contextDir, sha, opcoes.baseRef)
  if (merge !== 'ok')
    throw new UsoInvalido(
      merge === 'not-merged'
        ? `O commit ${sha} não está em ${opcoes.baseRef}: só se promove o que foi mergeado.`
        : `Não foi possível provar que o commit está em ${opcoes.baseRef} (git fetch/merge-base falhou).`
    )
  // 2) O perfil do operador fica fora do código promovido: o comando de E2E dele roda aqui.
  const arvores = [projeto.contextDir, projeto.migrationsDir, perfil.vercel.workdir]
  const perfilDoOperador = resolve(opcoes.promotionProfile)
  if (arvores.some((arvore) => estaDentroDe(arvore, perfilDoOperador)))
    throw new UsoInvalido(
      'O perfil de promoção não pode ficar dentro do código que está sendo promovido.'
    )
  // 3) `.vercelignore` faria o `vercel deploy` publicar arquivos que o Git ignora.
  if (temVercelIgnore(perfil.vercel.workdir))
    throw new UsoInvalido(
      'A pasta do frontend tem .vercelignore: remova-o (o .gitignore passa a ser a única regra).'
    )
  // 4) A árvore local é exatamente o commit, em tudo que o build, a migration e o deploy leem.
  await exigirArvoreDoCommit(
    runner,
    [
      projeto.contextDir,
      projeto.migrationsDir,
      perfil.vercel.workdir,
      dirname(projeto.envExampleFile),
      ...(projeto.seedFile ? [dirname(projeto.seedFile)] : [])
    ],
    sha
  )
  return { projeto, projetoFor }
}

/** `rollback` e `recover` não constroem nada: o build é recusado se alguém tentar usá-lo. */
const SEM_PROJETO = (): never => {
  throw new UsoInvalido('Este evento não usa o perfil do projeto.')
}

async function executar(
  db: ReturnType<typeof openDatabase>,
  audit: AuditRepository,
  chaveDeAuditoria: Buffer,
  runner: CommandRunner,
  opcoes: OpcoesDePromocao,
  perfil: PromotionProfile
): Promise<DesfechoDoComando> {
  const { scope } = opcoes
  const nucleo = montarNucleo(db, audit, runner, perfil)

  // Só o banco local e o GitHub: nenhuma credencial de Railway ou Vercel entra.
  if (opcoes.event === 'publish')
    return { evento: 'publish', resultado: await nucleo.publisher.publish(scope, opcoes.release!) }
  if (opcoes.event === 'verify')
    return { evento: 'verify', resultado: await nucleo.publisher.verify(scope, opcoes.release!) }

  // A árvore local só importa quando o evento pode ler migrations ou publicar o frontend.
  let promocao: PromotionProject | null = null
  let projetoFor: Parameters<typeof montarServico>[4] = SEM_PROJETO
  if (opcoes.event === 'merge' || opcoes.event === 'resume' || opcoes.event === 'cancel') {
    // A release e o SHA que ela carrega: o `merge` informa o SHA; os demais o leem da release.
    let sha = opcoes.sha
    if (opcoes.release) {
      const existente = nucleo.repository.get({ ...scope, releaseId: opcoes.release })
      if (!existente) throw new UsoInvalido('Release não encontrada no escopo informado.')
      sha = existente.sha
    }
    if (!sha) throw new UsoInvalido('Informe o SHA da release.')
    const preparado = await prepararProjeto(runner, opcoes, perfil, sha)
    projetoFor = preparado.projetoFor
    const { service, configuracao } = montarServico(
      chaveDeAuditoria,
      runner,
      opcoes,
      perfil,
      projetoFor,
      nucleo
    )
    promocao = {
      migrations: lerMigrations(preparado.projeto.migrationsDir),
      configuration: {
        names: lerNomesDoExemplo(readFileSync(preparado.projeto.envExampleFile, 'utf8')),
        isolated: perfil.configuration.isolatedKeys,
        load: () => configuracao.load()
      },
      ...(perfil.stabilization ? { stabilization: perfil.stabilization } : {})
    }
    if (opcoes.event === 'cancel')
      return { evento: 'cancel', resultado: await service.cancel(scope, opcoes.release!, promocao) }
    if (opcoes.event === 'resume')
      return {
        evento: 'resume',
        resultado: await service.promote(scope, opcoes.release!, promocao)
      }
    return {
      evento: 'merge',
      resultado: await service.handleMerge(scope, sha, promocao, opcoes.inclusion)
    }
  }

  const { service } = montarServico(chaveDeAuditoria, runner, opcoes, perfil, projetoFor, nucleo)
  if (opcoes.event === 'rollback')
    return { evento: 'rollback', resultado: await service.rollback(scope, { to: opcoes.to! }) }
  return {
    evento: 'recover',
    resultado: await service.recover(scope, { acknowledge: opcoes.acknowledge })
  }
}

async function principal(): Promise<number> {
  const opcoes = lerOpcoesDePromocao(argumentosDoLauncher(), process.env)
  const dataDir = resolve(opcoes.dataDir)
  if (!existsSync(join(dataDir, 'jarvis.db')) || !existsSync(join(dataDir, 'audit.key')))
    throw new UsoInvalido('--data-dir não contém jarvis.db e audit.key do app.')
  app.setPath('userData', dataDir)
  await app.whenReady()

  const runner = createCommandRunner({ allowed: BINARIOS })
  const db = openDatabase(join(dataDir, 'jarvis.db'))
  try {
    const chaveDeAuditoria = loadOrCreateAuditKey(join(dataDir, 'audit.key'))
    const audit = new AuditRepository(db, chaveDeAuditoria)
    let perfil: PromotionProfile
    try {
      perfil = carregarPerfilDePromocao(resolve(opcoes.promotionProfile))
    } catch (erro) {
      throw new UsoInvalido(erro instanceof Error ? erro.message : 'Perfil de promoção inválido.')
    }
    const desfecho = await executar(db, audit, chaveDeAuditoria, runner, opcoes, perfil)
    process.stdout.write(`${JSON.stringify(desfecho.resultado, null, 2)}\n`)
    return codigoDeSaida(desfecho)
  } finally {
    db.close()
  }
}

principal().then(
  (codigo) => app.exit(codigo),
  (erro: unknown) => {
    process.stderr.write(
      `${erro instanceof Error ? erro.message : 'Falha ao promover a release.'}\n`
    )
    app.exit(erro instanceof UsoInvalido ? 2 : 1)
  }
)
