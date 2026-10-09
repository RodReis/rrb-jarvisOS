import { createHmac, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { loadOrCreateAuditKey } from '../storage/audit-key'
import { openDatabase } from '../storage/database'
import { createCommandRunner } from './adapters/command-runner'
import { GhcrArtifactAdapter } from './adapters/ghcr-artifact-adapter'
import { LocalComposeAdapter, iniciarDockerDesktop } from './adapters/local-compose-adapter'
import { ReleaseLocalRepository } from './release-local-repository'
import { ReleasePreparationService } from './release-preparation-service'
import { carregarPerfilDoProjeto } from './release-project-profile'
import { ReleaseRepository } from './release-repository'

/**
 * Comando da aplicação que prepara uma release localmente (SPEC-Release-02). Roda dentro do
 * runtime do Electron porque a chave da cadeia de auditoria está selada no `safeStorage`: fora
 * dele não há como registrar o AuditEvent do efeito. Chamado por `scripts/release-prepare.mjs`.
 *
 * Saída: o resultado como JSON (sem valor de chave por construção). Código 0 = preparada,
 * 3 = bloqueada com razão, 2 = uso inválido.
 */

const OPCOES = [
  'data-dir',
  'user',
  'workspace',
  'project',
  'release',
  'profile',
  'compose-file',
  'registry'
] as const
type Opcao = (typeof OPCOES)[number]

class UsoInvalido extends Error {}

/**
 * Os argumentos chegam por variável de ambiente, não pelo `argv`: o Chromium varre a linha de
 * comando inteira, e um valor `host:porta` seguido de outro `--switch` derruba o processo em
 * ~20 ms com código -1 e sem mensagem (medido com `--registry localhost:55790`).
 */
function argumentosDoLauncher(): readonly string[] {
  try {
    const argv: unknown = JSON.parse(process.env.JARVIS_RELEASE_PREPARE_ARGV ?? '[]')
    if (Array.isArray(argv) && argv.every((item) => typeof item === 'string')) return argv
  } catch {
    // cai no erro de uso abaixo
  }
  throw new UsoInvalido('Execute pelo comando: npm run release:prepare -- <argumentos>.')
}

function lerArgumentos(argv: readonly string[]): {
  valores: Map<Opcao, string>
  autoStartDocker: boolean
} {
  const valores = new Map<Opcao, string>()
  let autoStartDocker = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--auto-start-docker') {
      autoStartDocker = true
      continue
    }
    const nome = arg.replace(/^--/, '') as Opcao
    if (!OPCOES.includes(nome) || valores.has(nome))
      throw new UsoInvalido(`Argumento inválido: ${arg}`)
    const valor = argv[++i]
    if (!valor || valor.startsWith('--')) throw new UsoInvalido(`Informe um valor para --${nome}.`)
    valores.set(nome, valor)
  }
  for (const nome of OPCOES) {
    if (nome !== 'registry' && !valores.get(nome))
      throw new UsoInvalido(`Informe --${nome} <valor>.`)
  }
  if (!['noa', 'jarvis'].includes(valores.get('workspace')!))
    throw new UsoInvalido('Workspace deve ser noa ou jarvis.')
  return { valores, autoStartDocker }
}

async function principal(): Promise<number> {
  const { valores, autoStartDocker } = lerArgumentos(argumentosDoLauncher())
  const dataDir = resolve(valores.get('data-dir')!)
  if (!existsSync(join(dataDir, 'jarvis.db')) || !existsSync(join(dataDir, 'audit.key')))
    throw new UsoInvalido('--data-dir não contém jarvis.db e audit.key do app.')
  app.setPath('userData', dataDir)
  await app.whenReady()

  const db = openDatabase(join(dataDir, 'jarvis.db'))
  try {
    const chaveDeAuditoria = loadOrCreateAuditKey(join(dataDir, 'audit.key'))
    const audit = new AuditRepository(db, chaveDeAuditoria)
    const scope: ReleaseScope = {
      userId: valores.get('user')!,
      workspaceId: valores.get('workspace') as ReleaseScope['workspaceId'],
      projectId: valores.get('project')!
    }
    const releaseId = valores.get('release')!
    const release = new ReleaseRepository(db, audit).get({ ...scope, releaseId })
    if (!release) throw new UsoInvalido('Release não encontrada no escopo informado.')

    const runner = createCommandRunner({ allowed: ['docker'] })
    // Separação de domínio: o fingerprint não reutiliza a chave da auditoria diretamente.
    const chaveDeFingerprint = createHmac('sha256', chaveDeAuditoria)
      .update('release-config-fingerprint')
      .digest('hex')
    const servico = new ReleasePreparationService(
      new ReleaseLocalRepository(db, audit),
      new LocalComposeAdapter(runner, {
        composeFile: resolve(valores.get('compose-file')!),
        autoStartDocker,
        startDocker: iniciarDockerDesktop
      }),
      new GhcrArtifactAdapter(runner, valores.get('registry') ?? 'ghcr.io'),
      chaveDeFingerprint
    )
    const resultado = await servico.prepare(
      scope,
      releaseId,
      { leaseId: `local-${randomUUID()}` },
      carregarPerfilDoProjeto(resolve(valores.get('profile')!), release.sha)
    )
    process.stdout.write(`${JSON.stringify(resultado, null, 2)}\n`)
    return resultado.state === 'prepared' ? 0 : 3
  } finally {
    db.close()
  }
}

principal().then(
  (codigo) => app.exit(codigo),
  (erro: unknown) => {
    process.stderr.write(
      `${erro instanceof Error ? erro.message : 'Falha ao preparar a release.'}\n`
    )
    app.exit(erro instanceof UsoInvalido ? 2 : 1)
  }
)
