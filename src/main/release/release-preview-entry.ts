import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { AuditRepository } from '../storage/audit-repository'
import { loadOrCreateAuditKey } from '../storage/audit-key'
import { openDatabase } from '../storage/database'
import { createCommandRunner, type CommandRunner } from './adapters/command-runner'
import { GhcrArtifactAdapter } from './adapters/ghcr-artifact-adapter'
import { GhcrPreviewImageAdapter } from './adapters/ghcr-preview-image-adapter'
import { GitSourceVerifier } from './adapters/git-source-verifier'
import { GithubPrCommentAdapter } from './adapters/github-pr-comment-adapter'
import { HttpPreviewVerifier } from './adapters/http-preview-verifier'
import {
  RailwayBackendAdapter,
  type RailwayPreviewConfig
} from './adapters/railway-backend-adapter'
import { RailwayDatabaseAdapter } from './adapters/railway-database-adapter'
import { VercelFrontendAdapter } from './adapters/vercel-frontend-adapter'
import { lerMigrations } from './database-migration-runner'
import { PreviewCoordinator, type PreviewEvent, type PreviewOutcome } from './preview-coordinator'
import { UsoInvalido, lerOpcoesDePreview, type OpcoesDePreview } from './preview-cli-args'
import { PreviewRepository } from './preview-repository'
import { convergirPreview, type PullRequestObservado } from './preview-sync'
import { assertRepositorioPermitido, carregarPerfilDoProjeto } from './release-project-profile'

/**
 * Comando da aplicação que converge o Preview de um PR (SPEC-Release-03). Roda dentro do runtime
 * do Electron porque a chave da cadeia de auditoria está selada no `safeStorage`. Chamado por
 * `scripts/release-preview.mjs`. Idempotente: pode ser repetido a qualquer momento — o estado vem
 * do PR observado no GitHub (aberto → cria/atualiza; fechado ou mergeado → destrói) e é
 * reobservado ao terminar, então um fechamento que chegou no meio do provisionamento não se perde.
 *
 * Saída: o resultado como JSON, sem URL de credencial, token ou saída de provedor. Código 0 =
 * pronto/removido/ausente e comentário publicado; 3 = falhou, limpeza pendente ou comentário não
 * publicado (repetir corrige); 5 = outro executor cuida do PR; 2 = uso inválido.
 */

const CODIGO_OK = 0
const CODIGO_PENDENTE = 3
const CODIGO_OCUPADO = 5

function argumentosDoLauncher(): readonly string[] {
  try {
    const argv: unknown = JSON.parse(process.env.JARVIS_RELEASE_PREVIEW_ARGV ?? '[]')
    if (Array.isArray(argv) && argv.every((item) => typeof item === 'string')) return argv
  } catch {
    // cai no erro de uso abaixo
  }
  throw new UsoInvalido('Execute pelo comando: npm run release:preview -- <argumentos>.')
}

/** Estado real do PR no GitHub: o texto do PR nunca é lido, só estado, origem e SHA do head. */
async function observarPullRequest(
  runner: CommandRunner,
  opcoes: OpcoesDePreview
): Promise<PullRequestObservado> {
  const r = await runner.run(
    'gh',
    [
      'pr', 'view', String(opcoes.pullRequest),
      '--repo', opcoes.githubRepository,
      '--json', 'state,headRefOid,isCrossRepository'
    ], // prettier-ignore
    { timeoutMs: 60_000 }
  )
  if (r.code !== 0 || r.timedOut) throw new Error('Não foi possível ler o estado do PR no GitHub.')
  const bruto = JSON.parse(r.stdout) as {
    state?: unknown
    headRefOid?: unknown
    isCrossRepository?: unknown
  }
  if (
    typeof bruto.headRefOid !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(bruto.headRefOid) ||
    typeof bruto.state !== 'string' ||
    typeof bruto.isCrossRepository !== 'boolean'
  )
    throw new Error('O GitHub devolveu o PR em formato inesperado.')
  return {
    aberto: bruto.state.toUpperCase() === 'OPEN',
    headSha: bruto.headRefOid,
    deFork: bruto.isCrossRepository
  }
}

function codigoDeSaida(resultado: PreviewOutcome): number {
  if (resultado.state === 'busy') return CODIGO_OCUPADO
  if (
    resultado.state === 'failed' ||
    resultado.state === 'removing' ||
    resultado.publication === 'failed'
  )
    return CODIGO_PENDENTE
  return CODIGO_OK
}

/** O contexto de build, as migrations e o seed saem da árvore local: ela precisa ser o commit do PR. */
async function exigirArvoreDoCommit(
  runner: CommandRunner,
  pastas: readonly string[],
  headSha: string
): Promise<void> {
  const verificador = new GitSourceVerifier(runner)
  for (const pasta of new Set(pastas)) {
    const resultado = await verificador.verify(pasta, headSha)
    if (resultado !== 'ok')
      throw new UsoInvalido(
        `A árvore local não é o commit do PR (${resultado}): faça checkout do head do PR e deixe-a limpa.`
      )
  }
}

async function principal(): Promise<number> {
  const opcoes = lerOpcoesDePreview(argumentosDoLauncher(), process.env)
  const dataDir = resolve(opcoes.dataDir)
  if (!existsSync(join(dataDir, 'jarvis.db')) || !existsSync(join(dataDir, 'audit.key')))
    throw new UsoInvalido('--data-dir não contém jarvis.db e audit.key do app.')
  app.setPath('userData', dataDir)
  await app.whenReady()

  const runner = createCommandRunner({
    allowed: ['docker', 'railway', 'vercel', 'psql', 'pg_dump', 'gh', 'git']
  })
  const db = openDatabase(join(dataDir, 'jarvis.db'))
  try {
    const audit = new AuditRepository(db, loadOrCreateAuditKey(join(dataDir, 'audit.key')))
    const repository = new PreviewRepository(db, audit)

    const aplicar = async (observado: PullRequestObservado): Promise<PreviewOutcome> => {
      const headSha = observado.headSha
      let projeto: ReturnType<typeof carregarPerfilDoProjeto>
      try {
        projeto = carregarPerfilDoProjeto(resolve(opcoes.profile), headSha)
        assertRepositorioPermitido(
          projeto.repository,
          opcoes.registry,
          opcoes.namespace ?? undefined
        )
      } catch (erro) {
        throw new UsoInvalido(erro instanceof Error ? erro.message : 'Perfil do projeto inválido.')
      }
      if (observado.aberto)
        await exigirArvoreDoCommit(
          runner,
          [
            projeto.contextDir,
            projeto.migrationsDir,
            ...(projeto.seedFile ? [dirname(projeto.seedFile)] : [])
          ],
          headSha
        )
      const railway: RailwayPreviewConfig = {
        ...opcoes.railway,
        token: opcoes.tokens.railway,
        backendPort: projeto.profile.backend.containerPort
      }
      const ghcr = new GhcrArtifactAdapter(runner, opcoes.registry, opcoes.builder ?? undefined)
      const coordenador = new PreviewCoordinator({
        repository,
        image: new GhcrPreviewImageAdapter(ghcr, {
          repository: projeto.repository,
          contextDir: projeto.contextDir,
          ...(projeto.profile.backend.dockerfile
            ? { dockerfile: projeto.profile.backend.dockerfile }
            : {})
        }),
        backend: new RailwayBackendAdapter(runner, railway),
        database: new RailwayDatabaseAdapter(runner, railway),
        frontend: new VercelFrontendAdapter(runner, {
          workdir: opcoes.vercel.workdir,
          token: opcoes.tokens.vercel,
          apiUrlVariable: opcoes.vercel.apiUrlVariable,
          ...(opcoes.vercel.scope ? { scope: opcoes.vercel.scope } : {})
        }),
        verifier: new HttpPreviewVerifier({ healthPath: projeto.profile.backend.healthPath }),
        publication: new GithubPrCommentAdapter(runner, opcoes.githubRepository),
        project: {
          migrations: lerMigrations(projeto.migrationsDir),
          ...(projeto.seedFile ? { seed: readFileSync(projeto.seedFile, 'utf8') } : {})
        }
      })
      const evento: PreviewEvent = {
        ...opcoes.scope,
        action: observado.aberto ? 'open' : 'close',
        pullRequest: opcoes.pullRequest,
        specId: opcoes.specId,
        specRevision: opcoes.specRevision,
        headSha
      }
      return coordenador.handle(evento)
    }

    const resultado = await convergirPreview(
      { observar: () => observarPullRequest(runner, opcoes), aplicar },
      opcoes.event,
      opcoes.headSha
    )
    process.stdout.write(
      `${JSON.stringify(
        {
          state: resultado.state,
          repeated: resultado.repeated,
          reason: resultado.reason,
          pending: resultado.pending,
          publication: resultado.publication,
          previewId: resultado.run?.id ?? null,
          headSha: resultado.run?.headSha ?? null
        },
        null,
        2
      )}\n`
    )
    return codigoDeSaida(resultado)
  } finally {
    db.close()
  }
}

principal().then(
  (codigo) => app.exit(codigo),
  (erro: unknown) => {
    process.stderr.write(
      `${erro instanceof Error ? erro.message : 'Falha ao converger o Preview.'}\n`
    )
    app.exit(erro instanceof UsoInvalido ? 2 : 1)
  }
)
