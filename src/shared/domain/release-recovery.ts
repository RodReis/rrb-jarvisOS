/**
 * Regras puras da recuperação de release (SPEC-Release-05): como uma falha é classificada, quando
 * uma tentativa pode se repetir e qual é o nome da tag de uma Produção estabilizada. Nada aqui
 * conhece Railway, Vercel, GitHub ou SQLite — o domínio decide, os serviços executam.
 */

/** Classes do design §12. `unknown` = efeito ou causa que a pipeline não soube classificar. */
export type FailureClass =
  'transient' | 'configuration' | 'artifact' | 'migration' | 'health_or_test' | 'unknown'

/** Regra 1 da SPEC: no máximo três tentativas **totais** por passo (a primeira conta). */
export const MAX_TENTATIVAS_POR_PASSO = 3
/** Espera antes da 2ª e da 3ª tentativa. Cresce: um provedor que acabou de falhar não é martelado. */
export const ESPERA_ENTRE_TENTATIVAS_MS: readonly number[] = [2_000, 8_000]

export function podeTentarDeNovo(tentativasFeitas: number): boolean {
  return tentativasFeitas < MAX_TENTATIVAS_POR_PASSO
}

/** Quanto esperar antes da tentativa `numero` (1-based). A primeira não espera. */
export function esperaAntesDaTentativa(numero: number): number {
  if (!Number.isInteger(numero) || numero < 1 || numero > MAX_TENTATIVAS_POR_PASSO)
    throw new RangeError(`A tentativa deve estar entre 1 e ${MAX_TENTATIVAS_POR_PASSO}.`)
  return numero === 1 ? 0 : (ESPERA_ENTRE_TENTATIVAS_MS[numero - 2] ?? 0)
}

const PASSOS_DE_SAUDE = /^(backend_healthy|frontend_promoted|smoke_passed)-/
const GATES_DE_SAUDE = /^(health-down|frontend-wiring|smoke|e2e_essential|stabilization)/

/**
 * Classifica o código curto de motivo que os efeitos e o serviço gravam. Timeout e cota vencem o
 * prefixo do passo: um efeito incerto nunca é lido como defeito de código. Código que ninguém
 * previu é `unknown` — nunca devolve trabalho à V2 por palpite.
 */
export function classificarFalha(codigo: string): FailureClass {
  if (/-(timeout|quota)$/.test(codigo)) return 'transient'
  // Tentativas esgotadas sem o motivo da última: a causa é desconhecida, não é defeito de código.
  if (/-retries-exhausted$/.test(codigo)) return 'unknown'
  if (/^config-/.test(codigo) || /-auth$/.test(codigo) || codigo === 'profile-invalid')
    return 'configuration'
  // `staging-<gate>` / `production-<gate>`: o gate obrigatório que bloqueou o ambiente.
  const gate = /^(?:staging|production)-(.+)$/.exec(codigo)?.[1]
  if (gate !== undefined) {
    if (gate === 'configuration' || gate === 'backup') return 'configuration'
    if (gate === 'migration') return 'migration'
    return 'health_or_test'
  }
  if (
    /^build-/.test(codigo) ||
    /no-artifact/.test(codigo) ||
    /^prepared-/.test(codigo) ||
    codigo === 'partial'
  )
    return 'artifact'
  if (
    /^database_migrated-/.test(codigo) ||
    ['migration-failed', 'checksum-divergent', 'migration-missing'].includes(codigo)
  )
    return 'migration'
  if (PASSOS_DE_SAUDE.test(codigo) || GATES_DE_SAUDE.test(codigo)) return 'health_or_test'
  return 'unknown'
}

/** Falha de código, teste, health, migration ou build volta à V2; o resto é decisão do operador. */
export function retornaParaV2(classe: FailureClass): boolean {
  return classe === 'health_or_test' || classe === 'migration' || classe === 'artifact'
}

/** `release-YYYYMMDD-HHMM-<shortsha>` em UTC (design §13). SemVer só com política explícita. */
export function nomeDaTag(instante: string, sha: string): string {
  if (!/^[a-f0-9]{7,64}$/i.test(sha)) throw new TypeError('O SHA da tag deve ser hexadecimal.')
  const ms = Date.parse(instante)
  if (!Number.isFinite(ms)) throw new TypeError('Instante inválido para o nome da tag.')
  const iso = new Date(ms).toISOString() // 2026-10-15T23:47:12.000Z
  const data = iso.slice(0, 10).replaceAll('-', '')
  const hora = iso.slice(11, 16).replace(':', '')
  return `release-${data}-${hora}-${sha.slice(0, 7).toLowerCase()}`
}

const ACAO_MINIMA: Readonly<Record<FailureClass, string>> = {
  transient: 'check-provider-status',
  configuration: 'fix-configuration',
  artifact: 'fix-build-in-v2',
  migration: 'fix-migration-in-v2',
  health_or_test: 'fix-code-in-v2',
  unknown: 'investigate-manually'
}

/** A ação mínima (código curto) que a evidência de parada aponta para a classe da falha. */
export function acaoMinima(classe: FailureClass): string {
  return ACAO_MINIMA[classe]
}

/**
 * JSON com chaves ordenadas e sem espaço: o mesmo valor produz sempre o mesmo texto, então o hash
 * do manifesto e do contexto de correção é verificável por quem o recalcula. `undefined` é
 * omitido; número não finito e função não são JSON e são recusados.
 */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'string')
    return JSON.stringify(valor)
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new TypeError('Número não finito não é JSON.')
    return JSON.stringify(valor)
  }
  if (Array.isArray(valor))
    return `[${valor.map((item) => jsonCanonico(item === undefined ? null : item)).join(',')}]`
  if (typeof valor === 'object') {
    const campos = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([chave, v]) => `${JSON.stringify(chave)}:${jsonCanonico(v)}`)
    return `{${campos.join(',')}}`
  }
  throw new TypeError('Valor que não é JSON.')
}

export interface AchadoAnterior {
  readonly code: string
  readonly releaseId: string
  /** A SPEC concluiu uma release depois desta falha. */
  readonly resolved: boolean
}

export type StatusDoAchado = 'new' | 'recurring' | 'open' | 'resolved'

export interface AchadoDoContexto {
  readonly code: string
  readonly status: StatusDoAchado
  readonly releases: readonly string[]
}

/**
 * Classifica os achados que a V2 recebe ao reabrir a SPEC (regra 6): o da falha atual é `new` só
 * se nunca apareceu; código já visto — resolvido ou não — é `recurring`, nunca novo. Os anteriores
 * de outro código seguem no histórico como `open` ou `resolved`.
 */
export function classificarAchados(
  atual: string,
  anteriores: readonly AchadoAnterior[]
): AchadoDoContexto[] {
  const porCodigo = new Map<string, AchadoAnterior[]>()
  for (const achado of anteriores) {
    const lista = porCodigo.get(achado.code) ?? []
    lista.push(achado)
    porCodigo.set(achado.code, lista)
  }
  const doAtual = porCodigo.get(atual)
  const resultado: AchadoDoContexto[] = [
    {
      code: atual,
      status: doAtual ? 'recurring' : 'new',
      releases: doAtual?.map((a) => a.releaseId) ?? []
    }
  ]
  for (const [code, lista] of porCodigo) {
    if (code === atual) continue
    resultado.push({
      code,
      status: lista.every((a) => a.resolved) ? 'resolved' : 'open',
      releases: lista.map((a) => a.releaseId)
    })
  }
  return resultado
}
