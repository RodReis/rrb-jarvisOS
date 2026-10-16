import type { ReleaseScope } from '@shared/domain/release'
import { UsoInvalido } from './preview-cli-args'

/**
 * Argumentos do comando `release:promote` (SPEC-Release-04 e 05), validados antes de qualquer
 * efeito. Os tokens (Railway e Vercel) **não** são argumentos: vêm do ambiente do operador e
 * nunca entram em `argv`, em evento ou em log. Entrada inválida é erro de uso, não falha interna.
 *
 * Eventos: `merge` (promove um commit mergeado), `resume` (retoma uma release), `cancel`
 * (cancelamento seguro), `rollback` (volta Produção a um `release_id`), `recover` (libera um
 * projeto pausado), `publish` (tag + GitHub Release pendentes) e `verify` (confere a identidade).
 */

export type EventoDePromocao =
  'merge' | 'resume' | 'cancel' | 'rollback' | 'recover' | 'publish' | 'verify'

const EVENTOS: readonly EventoDePromocao[] = [
  'merge',
  'resume',
  'cancel',
  'rollback',
  'recover',
  'publish',
  'verify'
]
/** Eventos que operam sobre uma release já existente. */
const EVENTOS_COM_RELEASE: readonly EventoDePromocao[] = ['resume', 'cancel', 'publish', 'verify']
/** Eventos que só falam com o banco local e o GitHub: não precisam de Railway nem Vercel. */
const EVENTOS_SEM_NUVEM: readonly EventoDePromocao[] = ['publish', 'verify']

export interface InclusaoDoMerge {
  readonly pullRequest?: number
  readonly specId?: string
  /** A fatia da V2 que originou o trabalho: é por ela que a correção volta à V2. */
  readonly sliceId?: string
  readonly issue?: number
}

export interface OpcoesDePromocao {
  readonly dataDir: string
  readonly scope: ReleaseScope
  readonly event: EventoDePromocao
  /** Obrigatório em `merge`. */
  readonly sha: string | null
  /** Obrigatório em `resume`, `cancel`, `publish` e `verify`. */
  readonly release: string | null
  /** Obrigatório em `rollback`: o `release_id` de destino (nunca "a anterior"). */
  readonly to: string | null
  /** Só em `merge`: o que o merge trouxe. */
  readonly inclusion: InclusaoDoMerge
  /** Só em `recover`: o operador declara que o ambiente foi corrigido à mão. */
  readonly acknowledge: boolean
  readonly profile: string
  readonly promotionProfile: string
  readonly composeFile: string
  readonly registry: string
  readonly namespace: string | null
  readonly builder: string | null
  /** Branch onde o commit precisa estar mergeado (padrão `origin/main`). */
  readonly baseRef: string
  readonly autoStartDocker: boolean
  /** Vazios em `publish` e `verify`, que não falam com Railway nem Vercel. */
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
const OPCIONAIS = [
  'sha',
  'release',
  'to',
  'pr',
  'spec',
  'slice',
  'issue',
  'registry',
  'namespace',
  'builder',
  'base-ref'
] as const
type Nome = (typeof OBRIGATORIAS)[number] | (typeof OPCIONAIS)[number]
const NOMES: readonly string[] = [...OBRIGATORIAS, ...OPCIONAIS]
/** SHA completo: prefixo curto colide (28 bits) e identifica pouco. */
const SHA_VALIDO = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const REFERENCIA_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/
/** `release_id` é sempre um UUID: "anterior", "latest" e afins não identificam release. */
const ID_DE_RELEASE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_DE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ID_DE_FATIA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function inteiroPositivo(texto: string | undefined, nome: string): number | undefined {
  if (texto === undefined) return undefined
  if (!/^[1-9]\d{0,9}$/.test(texto))
    throw new UsoInvalido(`--${nome} deve ser um inteiro positivo.`)
  return Number(texto)
}

export function lerOpcoesDePromocao(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): OpcoesDePromocao {
  const valores = new Map<Nome, string>()
  let autoStartDocker = false
  let acknowledge = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--auto-start-docker') {
      autoStartDocker = true
      continue
    }
    if (arg === '--acknowledge') {
      acknowledge = true
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
  const evento = v('event')
  if (!EVENTOS.includes(evento as EventoDePromocao))
    throw new UsoInvalido(`--event deve ser um de: ${EVENTOS.join(', ')}.`)
  const event = evento as EventoDePromocao

  // O SHA é sempre minúsculo: o diário, a inclusão e o GitHub comparam por igualdade.
  const sha = valores.get('sha')?.toLowerCase() ?? null
  const release = valores.get('release') ?? null
  const to = valores.get('to') ?? null
  const temInclusao = ['pr', 'spec', 'slice', 'issue'].some((n) => valores.has(n as Nome))
  if (event === 'merge' && (!sha || !SHA_VALIDO.test(sha)))
    throw new UsoInvalido('--event merge exige --sha completo (40 ou 64 caracteres hexadecimais).')
  if (event !== 'merge' && sha) throw new UsoInvalido('--sha só vale em --event merge.')
  if (EVENTOS_COM_RELEASE.includes(event) && (!release || !ID_DE_RELEASE.test(release)))
    throw new UsoInvalido(`--event ${event} exige --release com o id da release.`)
  if (!EVENTOS_COM_RELEASE.includes(event) && release)
    throw new UsoInvalido(`--release não vale em --event ${event}.`)
  if (event === 'rollback' && (!to || !ID_DE_RELEASE.test(to)))
    throw new UsoInvalido('--event rollback exige --to com o release_id de destino.')
  if (event !== 'rollback' && to) throw new UsoInvalido('--to só vale em --event rollback.')
  if (event !== 'merge' && temInclusao)
    throw new UsoInvalido('--pr, --spec, --slice e --issue só valem em --event merge.')
  if (event !== 'recover' && acknowledge)
    throw new UsoInvalido('--acknowledge só vale em --event recover.')

  const spec = valores.get('spec')
  const slice = valores.get('slice')
  if (spec !== undefined && !ID_DE_SPEC.test(spec)) throw new UsoInvalido('--spec inválido.')
  if (slice !== undefined && !ID_DE_FATIA.test(slice)) throw new UsoInvalido('--slice inválido.')
  const pullRequest = inteiroPositivo(valores.get('pr'), 'pr')
  const issue = inteiroPositivo(valores.get('issue'), 'issue')
  const inclusion: InclusaoDoMerge = {
    ...(pullRequest === undefined ? {} : { pullRequest }),
    ...(spec === undefined ? {} : { specId: spec }),
    ...(slice === undefined ? {} : { sliceId: slice }),
    ...(issue === undefined ? {} : { issue })
  }

  const baseRef = valores.get('base-ref') ?? 'origin/main'
  if (!REFERENCIA_VALIDA.test(baseRef)) throw new UsoInvalido('--base-ref inválido.')

  const railway = env.RAILWAY_API_TOKEN
  const vercel = env.VERCEL_TOKEN
  if (!EVENTOS_SEM_NUVEM.includes(event)) {
    if (!railway) throw new UsoInvalido('Defina RAILWAY_API_TOKEN no ambiente.')
    if (!vercel) throw new UsoInvalido('Defina VERCEL_TOKEN no ambiente.')
  }

  return {
    dataDir: v('data-dir'),
    scope: { userId: v('user'), workspaceId: workspace, projectId: v('project') },
    event,
    sha,
    release,
    to,
    inclusion,
    acknowledge,
    profile: v('profile'),
    promotionProfile: v('promotion-profile'),
    composeFile: v('compose-file'),
    registry: valores.get('registry') ?? 'ghcr.io',
    namespace: valores.get('namespace') ?? null,
    builder: valores.get('builder') ?? null,
    baseRef,
    autoStartDocker,
    tokens: EVENTOS_SEM_NUVEM.includes(event)
      ? { railway: '', vercel: '' }
      : { railway: railway!, vercel: vercel! }
  }
}
