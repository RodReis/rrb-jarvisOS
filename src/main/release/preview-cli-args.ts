import type { ReleaseScope } from '@shared/domain/release'
import { validarEntradaDePreview } from '@shared/domain/release-preview'

/**
 * Argumentos do comando `release:preview` (SPEC-Release-03), validados antes de qualquer efeito.
 * Segredos (tokens de Vercel e Railway) **não** são argumentos: vêm do ambiente do operador e
 * nunca entram em `argv`, em evento ou em log. Entrada inválida é erro de uso, não falha interna.
 */

export class UsoInvalido extends Error {}

export type EventoDePreview = 'sync' | 'open' | 'close'

export interface OpcoesDePreview {
  readonly dataDir: string
  readonly scope: ReleaseScope
  readonly pullRequest: number
  readonly specId: string
  readonly specRevision: string
  readonly event: EventoDePreview
  /** Obrigatório em `open` (conferido contra o head observado); `sync` e `close` usam o PR observado. */
  readonly headSha: string | null
  readonly githubRepository: string
  readonly profile: string
  readonly registry: string
  readonly namespace: string | null
  readonly builder: string | null
  readonly railway: {
    readonly workdir: string
    readonly templateEnvironment: string
    readonly backendService: string
    readonly databaseService: string
  }
  readonly vercel: {
    readonly workdir: string
    readonly apiUrlVariable: string
    readonly scope: string | null
  }
  readonly tokens: { readonly railway: string; readonly vercel: string }
}

const OBRIGATORIAS = [
  'data-dir',
  'user',
  'workspace',
  'project',
  'pr',
  'spec',
  'spec-revision',
  'repo',
  'profile',
  'railway-workdir',
  'railway-template',
  'railway-backend-service',
  'railway-database-service',
  'vercel-workdir',
  'vercel-api-env'
] as const
const OPCIONAIS = ['event', 'sha', 'registry', 'namespace', 'builder', 'vercel-scope'] as const
type Nome = (typeof OBRIGATORIAS)[number] | (typeof OPCIONAIS)[number]
const NOMES: readonly string[] = [...OBRIGATORIAS, ...OPCIONAIS]

export function lerOpcoesDePreview(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): OpcoesDePreview {
  const valores = new Map<Nome, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    const nome = arg.replace(/^--/, '')
    if (!arg.startsWith('--') || !NOMES.includes(nome) || valores.has(nome as Nome))
      throw new UsoInvalido(`Argumento inválido: ${arg}`)
    const valor = argv[++i]
    if (!valor || valor.startsWith('--')) throw new UsoInvalido(`Informe um valor para --${nome}.`)
    valores.set(nome as Nome, valor)
  }
  for (const nome of OBRIGATORIAS)
    if (!valores.get(nome)) throw new UsoInvalido(`Informe --${nome} <valor>.`)
  const v = (nome: Nome): string => valores.get(nome)!

  const workspace = v('workspace')
  if (workspace !== 'noa' && workspace !== 'jarvis')
    throw new UsoInvalido('Workspace deve ser noa ou jarvis.')
  const event = (valores.get('event') ?? 'sync') as EventoDePreview
  if (!['sync', 'open', 'close'].includes(event))
    throw new UsoInvalido('--event deve ser sync, open ou close.')
  const pullRequest = Number(v('pr'))
  if (!/^\d+$/.test(v('pr')) || !Number.isSafeInteger(pullRequest) || pullRequest < 1)
    throw new UsoInvalido('--pr deve ser um número inteiro positivo.')
  const headSha = valores.get('sha') ?? null
  if (event === 'open' && !headSha) throw new UsoInvalido('--event open exige --sha.')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v('repo')))
    throw new UsoInvalido('--repo deve estar no formato dono/nome.')

  try {
    validarEntradaDePreview({
      pullRequest,
      headSha: headSha ?? '0'.repeat(40),
      specId: v('spec'),
      specRevision: v('spec-revision')
    })
  } catch (erro) {
    throw new UsoInvalido(erro instanceof Error ? erro.message : 'Entrada de Preview inválida.')
  }

  const railway = env.RAILWAY_API_TOKEN
  const vercel = env.VERCEL_TOKEN
  if (!railway) throw new UsoInvalido('Defina RAILWAY_API_TOKEN no ambiente.')
  if (!vercel) throw new UsoInvalido('Defina VERCEL_TOKEN no ambiente.')

  return {
    dataDir: v('data-dir'),
    scope: { userId: v('user'), workspaceId: workspace, projectId: v('project') },
    pullRequest,
    specId: v('spec'),
    specRevision: v('spec-revision'),
    event,
    headSha,
    githubRepository: v('repo'),
    profile: v('profile'),
    registry: valores.get('registry') ?? 'ghcr.io',
    namespace: valores.get('namespace') ?? null,
    builder: valores.get('builder') ?? null,
    railway: {
      workdir: v('railway-workdir'),
      templateEnvironment: v('railway-template'),
      backendService: v('railway-backend-service'),
      databaseService: v('railway-database-service')
    },
    vercel: {
      workdir: v('vercel-workdir'),
      apiUrlVariable: v('vercel-api-env'),
      scope: valores.get('vercel-scope') ?? null
    },
    tokens: { railway, vercel }
  }
}
