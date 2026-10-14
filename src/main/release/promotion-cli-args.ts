import type { ReleaseScope } from '@shared/domain/release'
import { UsoInvalido } from './preview-cli-args'

/**
 * Argumentos do comando `release:promote` (SPEC-Release-04), validados antes de qualquer efeito.
 * Os tokens (Railway e Vercel) **não** são argumentos: vêm do ambiente do operador e nunca entram
 * em `argv`, em evento ou em log. Entrada inválida é erro de uso, não falha interna.
 */

export type EventoDePromocao = 'merge' | 'resume'

export interface OpcoesDePromocao {
  readonly dataDir: string
  readonly scope: ReleaseScope
  readonly event: EventoDePromocao
  /** Obrigatório em `merge`. */
  readonly sha: string | null
  /** Obrigatório em `resume`: a release que esperava a lane ou parou num passo incerto. */
  readonly release: string | null
  readonly profile: string
  readonly promotionProfile: string
  readonly composeFile: string
  readonly registry: string
  readonly namespace: string | null
  readonly builder: string | null
  readonly autoStartDocker: boolean
  readonly tokens: { readonly railway: string; readonly vercel: string }
}

const OBRIGATORIAS = [
  'data-dir',
  'user',
  'workspace',
  'project',
  'profile',
  'promotion-profile',
  'compose-file',
  'event'
] as const
const OPCIONAIS = ['sha', 'release', 'registry', 'namespace', 'builder'] as const
type Nome = (typeof OBRIGATORIAS)[number] | (typeof OPCIONAIS)[number]
const NOMES: readonly string[] = [...OBRIGATORIAS, ...OPCIONAIS]
const SHA_VALIDO = /^[a-f0-9]{7,64}$/i
const ID_DE_RELEASE = /^[A-Za-z0-9-]{8,64}$/

export function lerOpcoesDePromocao(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): OpcoesDePromocao {
  const valores = new Map<Nome, string>()
  let autoStartDocker = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--auto-start-docker') {
      autoStartDocker = true
      continue
    }
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
  const event = v('event')
  if (event !== 'merge' && event !== 'resume')
    throw new UsoInvalido('--event deve ser merge ou resume.')
  const sha = valores.get('sha') ?? null
  const release = valores.get('release') ?? null
  if (event === 'merge' && (!sha || !SHA_VALIDO.test(sha)))
    throw new UsoInvalido('--event merge exige --sha hexadecimal (7 a 64 caracteres).')
  if (event === 'resume' && (!release || !ID_DE_RELEASE.test(release)))
    throw new UsoInvalido('--event resume exige --release com o id da release.')

  const railway = env.RAILWAY_API_TOKEN
  const vercel = env.VERCEL_TOKEN
  if (!railway) throw new UsoInvalido('Defina RAILWAY_API_TOKEN no ambiente.')
  if (!vercel) throw new UsoInvalido('Defina VERCEL_TOKEN no ambiente.')

  return {
    dataDir: v('data-dir'),
    scope: { userId: v('user'), workspaceId: workspace, projectId: v('project') },
    event,
    sha: event === 'merge' ? sha : null,
    release: event === 'resume' ? release : null,
    profile: v('profile'),
    promotionProfile: v('promotion-profile'),
    composeFile: v('compose-file'),
    registry: valores.get('registry') ?? 'ghcr.io',
    namespace: valores.get('namespace') ?? null,
    builder: valores.get('builder') ?? null,
    autoStartDocker,
    tokens: { railway, vercel }
  }
}
