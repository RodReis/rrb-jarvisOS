import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  validarJanelaDeEstabilizacao,
  type JanelaDeEstabilizacao
} from '@shared/domain/release-promotion'

/**
 * Perfil de promoção (JSON do **operador**, fora do repositório do projeto): onde ficam Staging e
 * Produção — coordenadas do Railway e da Vercel, URLs públicas, verificação, chaves de isolamento e
 * estabilização (SPEC-Release-04). Lista fechada de campos: qualquer campo desconhecido é recusado,
 * o que também fecha a porta para um token colado no arquivo. Segredos vêm só do ambiente do
 * processo. Caminhos relativos valem a partir da pasta do perfil e não podem sair dela.
 */

export interface PromotionEnvironmentUrls {
  readonly backendUrl: string
  readonly frontendUrl: string
}

export interface PromotionProfile {
  readonly railway: {
    readonly workdir: string
    readonly projectId: string
    readonly backendService: string
    readonly databaseService: string
    readonly environments: { readonly staging: string; readonly production: string }
    readonly backendPort: number
  }
  readonly vercel: {
    readonly workdir: string
    readonly scope?: string
    readonly stagingDomain: string
    readonly productionDomain: string
  }
  readonly environments: {
    readonly staging: PromotionEnvironmentUrls
    readonly production: PromotionEnvironmentUrls
  }
  readonly verification: {
    readonly healthPath: string
    readonly runtimeConfigPath: string
    readonly smokePaths: readonly string[]
    readonly e2e?: {
      readonly command: string
      readonly args: readonly string[]
      readonly cwd: string
    }
  }
  readonly configuration: { readonly isolatedKeys: readonly string[] }
  /** Ausente = padrão do domínio (5 min, 30 s, 1 reinício). */
  readonly stabilization?: JanelaDeEstabilizacao
  /** Onde a tag e a GitHub Release da Produção estabilizada são publicadas (SPEC-Release-05). */
  readonly github?: { readonly repository: string }
}

type Bruto = Record<string, unknown>

/** Só o que a SPEC executa: nada de shell nem binário arbitrário vindo de um arquivo. */
const COMANDOS_DE_E2E: readonly string[] = ['npx', 'npm', 'node']
const NOME_DE_AMBIENTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const NOME_DE_CHAVE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const NOME_DE_SERVICO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ID_DE_PROJETO = /^[A-Za-z0-9][A-Za-z0-9-]{3,63}$/
const DOMINIO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i
/** `//host` e `/\host` resolvem para outro host; só caminho absoluto de verdade passa. */
const CAMINHO_VALIDO = /^\/(?![/\\])[^\s]*$/
const REPOSITORIO_DO_GITHUB = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const QUALQUER = /^[\s\S]+$/

function objeto(valor: unknown, nome: string, permitidas: readonly string[]): Bruto {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor))
    throw new TypeError(`O perfil exige o objeto "${nome}".`)
  for (const chave of Object.keys(valor))
    if (!permitidas.includes(chave))
      throw new TypeError(`O perfil não aceita o campo "${nome}.${chave}".`)
  return valor as Bruto
}

function texto(valor: unknown, nome: string, padrao: RegExp = QUALQUER): string {
  if (typeof valor !== 'string' || !valor.trim() || !padrao.test(valor))
    throw new TypeError(`O perfil exige "${nome}" válido.`)
  return valor
}

function inteiro(valor: unknown, nome: string, minimo: number, maximo: number): number {
  if (!Number.isInteger(valor) || (valor as number) < minimo || (valor as number) > maximo)
    throw new TypeError(`"${nome}" deve ser um inteiro entre ${minimo} e ${maximo}.`)
  return valor as number
}

function caminho(base: string, valor: unknown, nome: string): string {
  const alvo = resolve(base, texto(valor, nome))
  const rel = relative(base, alvo)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new TypeError(`"${nome}" deve ficar dentro da pasta do perfil.`)
  return alvo
}

/** https, sem credencial, query ou fragmento: a URL aparece em evidência e em requisição. */
function urlPublica(valor: unknown, nome: string): string {
  let url: URL
  try {
    url = new URL(texto(valor, nome))
  } catch {
    throw new TypeError(`"${nome}" não é uma URL.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new TypeError(`"${nome}" deve ser https, sem credencial, query nem fragmento.`)
  return url.origin
}

function ambiente(valor: unknown, nome: string): PromotionEnvironmentUrls {
  const o = objeto(valor, nome, ['backendUrl', 'frontendUrl'])
  return {
    backendUrl: urlPublica(o.backendUrl, `${nome}.backendUrl`),
    frontendUrl: urlPublica(o.frontendUrl, `${nome}.frontendUrl`)
  }
}

function lerE2e(valor: unknown, base: string): PromotionProfile['verification']['e2e'] {
  if (valor === undefined) return undefined
  const e = objeto(valor, 'verification.e2e', ['command', 'args', 'cwd'])
  const comando = texto(e.command, 'verification.e2e.command')
  if (!COMANDOS_DE_E2E.includes(comando))
    throw new TypeError(`O comando de E2E deve ser um de: ${COMANDOS_DE_E2E.join(', ')}.`)
  if (!Array.isArray(e.args) || e.args.some((a) => typeof a !== 'string'))
    throw new TypeError('"verification.e2e.args" deve ser uma lista de textos.')
  return {
    command: comando,
    args: e.args as string[],
    cwd: caminho(base, e.cwd, 'verification.e2e.cwd')
  }
}

function lerEstabilizacao(valor: unknown): JanelaDeEstabilizacao | undefined {
  if (valor === undefined) return undefined
  const s = objeto(valor, 'stabilization', ['windowMs', 'intervalMs', 'maxRestarts'])
  const janela: JanelaDeEstabilizacao = {
    windowMs: inteiro(s.windowMs, 'stabilization.windowMs', 1, 3_600_000),
    intervalMs: inteiro(s.intervalMs, 'stabilization.intervalMs', 1, 600_000),
    maxRestarts: inteiro(s.maxRestarts, 'stabilization.maxRestarts', 0, 10)
  }
  validarJanelaDeEstabilizacao(janela)
  return janela
}

function lerRailway(valor: unknown, base: string): PromotionProfile['railway'] {
  const r = objeto(valor, 'railway', [
    'workdir',
    'projectId',
    'backendService',
    'databaseService',
    'environments',
    'backendPort'
  ])
  const envs = objeto(r.environments, 'railway.environments', ['staging', 'production'])
  const staging = texto(envs.staging, 'railway.environments.staging', NOME_DE_AMBIENTE)
  const production = texto(envs.production, 'railway.environments.production', NOME_DE_AMBIENTE)
  if (staging === production)
    throw new TypeError('Staging e Produção precisam de ambientes distintos no Railway.')
  return {
    workdir: caminho(base, r.workdir, 'railway.workdir'),
    projectId: texto(r.projectId, 'railway.projectId', ID_DE_PROJETO),
    backendService: texto(r.backendService, 'railway.backendService', NOME_DE_SERVICO),
    databaseService: texto(r.databaseService, 'railway.databaseService', NOME_DE_SERVICO),
    environments: { staging, production },
    backendPort: inteiro(r.backendPort, 'railway.backendPort', 1, 65_535)
  }
}

function lerVerificacao(valor: unknown, base: string): PromotionProfile['verification'] {
  const v = objeto(valor ?? {}, 'verification', [
    'healthPath',
    'runtimeConfigPath',
    'smokePaths',
    'e2e'
  ])
  const smoke = v.smokePaths === undefined ? ['/'] : v.smokePaths
  if (!Array.isArray(smoke) || smoke.length === 0 || smoke.length > 20)
    throw new TypeError('"verification.smokePaths" deve ser uma lista de 1 a 20 caminhos.')
  const e2e = lerE2e(v.e2e, base)
  return {
    healthPath: texto(v.healthPath ?? '/health', 'verification.healthPath', CAMINHO_VALIDO),
    runtimeConfigPath: texto(
      v.runtimeConfigPath ?? '/runtime-config.json',
      'verification.runtimeConfigPath',
      CAMINHO_VALIDO
    ),
    smokePaths: smoke.map((p, i) => texto(p, `verification.smokePaths[${i}]`, CAMINHO_VALIDO)),
    ...(e2e ? { e2e } : {})
  }
}

function lerVercel(v: Bruto, base: string): PromotionProfile['vercel'] {
  return {
    workdir: caminho(base, v.workdir, 'vercel.workdir'),
    ...(v.scope === undefined ? {} : { scope: texto(v.scope, 'vercel.scope', NOME_DE_SERVICO) }),
    stagingDomain: texto(v.stagingDomain, 'vercel.stagingDomain', DOMINIO).toLowerCase(),
    productionDomain: texto(v.productionDomain, 'vercel.productionDomain', DOMINIO).toLowerCase()
  }
}

export function carregarPerfilDePromocao(arquivo: string): PromotionProfile {
  let bruto: unknown
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch {
    throw new TypeError('O perfil de promoção não é um JSON válido.')
  }
  const base = dirname(resolve(arquivo))
  const raiz = objeto(bruto, 'perfil', [
    'railway',
    'vercel',
    'environments',
    'verification',
    'configuration',
    'stabilization',
    'github'
  ])

  const v = objeto(raiz.vercel, 'vercel', ['workdir', 'scope', 'stagingDomain', 'productionDomain'])
  const urls = objeto(raiz.environments, 'environments', ['staging', 'production'])
  const staging = ambiente(urls.staging, 'environments.staging')
  const production = ambiente(urls.production, 'environments.production')
  if (
    staging.backendUrl === production.backendUrl ||
    staging.frontendUrl === production.frontendUrl
  )
    throw new TypeError(
      'Staging e Produção não podem compartilhar a mesma URL: ambientes isolados.'
    )

  const vercel = lerVercel(v, base)
  // O verificador HTTP olha a URL do perfil e a Vercel promove o domínio: se divergirem, o gate
  // passaria validando um host que não é o que foi promovido.
  if (new URL(staging.frontendUrl).hostname !== vercel.stagingDomain)
    throw new TypeError('environments.staging.frontendUrl deve ser o vercel.stagingDomain.')
  if (new URL(production.frontendUrl).hostname !== vercel.productionDomain)
    throw new TypeError('environments.production.frontendUrl deve ser o vercel.productionDomain.')

  const conf = objeto(raiz.configuration ?? {}, 'configuration', ['isolatedKeys'])
  const isolatedKeys = conf.isolatedKeys === undefined ? [] : conf.isolatedKeys
  if (
    !Array.isArray(isolatedKeys) ||
    isolatedKeys.some((k) => typeof k !== 'string' || !NOME_DE_CHAVE.test(k))
  )
    throw new TypeError('"configuration.isolatedKeys" deve listar nomes de variável válidos.')

  const stabilization = lerEstabilizacao(raiz.stabilization)
  const github = lerGithub(raiz.github)
  return {
    railway: lerRailway(raiz.railway, base),
    vercel,
    environments: { staging, production },
    verification: lerVerificacao(raiz.verification, base),
    configuration: { isolatedKeys: isolatedKeys as string[] },
    ...(stabilization ? { stabilization } : {}),
    ...(github ? { github } : {})
  }
}

/** Só o repositório: a credencial é a do `gh auth login` da máquina e nunca vive neste arquivo. */
function lerGithub(valor: unknown): { repository: string } | undefined {
  if (valor === undefined) return undefined
  const bloco = objeto(valor, 'github', ['repository'])
  return { repository: texto(bloco.repository, 'github.repository', REPOSITORIO_DO_GITHUB) }
}
