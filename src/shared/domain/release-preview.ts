import type { PreviewStatus } from './release'

/**
 * Regras puras do Preview isolado por PR (SPEC-Release-03). Nada aqui conhece Vercel, Railway ou
 * SQLite: o núcleo decide estado, nome e publicação; os adapters executam.
 */

export type PreviewResourceKind = 'image' | 'database' | 'backend' | 'frontend'
export type PreviewProvider = 'ghcr' | 'railway' | 'vercel'
/** Resultado normalizado do contrato da SPEC: `destroyed` só depois de confirmado no provedor. */
export type PreviewResourceState = 'provisioning' | 'ready' | 'failed' | 'destroyed'
export type PreviewGateResult = 'passed' | 'blocked' | 'unknown'

export interface PreviewTargetResult {
  readonly provider: PreviewProvider
  readonly externalId: string
  readonly url?: string
  readonly sourceSha: string
  readonly state: PreviewResourceState
}

export interface PreviewResource extends PreviewTargetResult {
  readonly id: string
  readonly previewId: string
  readonly generation: number
  readonly kind: PreviewResourceKind
  readonly reason: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PreviewGate {
  readonly id: string
  readonly previewId: string
  readonly sourceSha: string
  readonly gate: string
  readonly result: PreviewGateResult
  readonly reason: string | null
  readonly createdAt: string
}

/**
 * Transições do PreviewRun. Um commit novo leva `ready` e `failed` de volta a `preparing` (o mesmo
 * Preview é atualizado); a reabertura do PR leva `removed` a `queued` com outra geração.
 * `preparing` e `removing` repetem a si mesmos: é a retomada de um executor que morreu no meio.
 */
const TRANSICOES: Readonly<Record<PreviewStatus, readonly PreviewStatus[]>> = {
  queued: ['preparing', 'failed', 'removing', 'removed'],
  preparing: ['preparing', 'ready', 'failed', 'removing'],
  ready: ['preparing', 'removing'],
  failed: ['preparing', 'removing'],
  removing: ['removing', 'removed'],
  removed: ['queued']
}

export function transicaoDePreviewPermitida(atual: PreviewStatus, proximo: PreviewStatus): boolean {
  return TRANSICOES[atual].includes(proximo)
}

const SHA_VALIDO = /^[a-f0-9]{7,64}$/i
const SPEC_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const REVISAO_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export function validarEntradaDePreview(entrada: {
  readonly pullRequest: number
  readonly headSha: string
  readonly specId: string
  readonly specRevision: string
}): void {
  if (!Number.isSafeInteger(entrada.pullRequest) || entrada.pullRequest < 1)
    throw new TypeError('Preview exige número de PR positivo.')
  if (!SHA_VALIDO.test(entrada.headSha)) throw new TypeError('Preview exige SHA hexadecimal.')
  if (!SPEC_VALIDA.test(entrada.specId))
    throw new TypeError('Preview exige o identificador da SPEC.')
  if (!REVISAO_VALIDA.test(entrada.specRevision))
    throw new TypeError('Preview exige a revisão aprovada da SPEC.')
}

/**
 * Nome do ambiente temporário do provedor, derivado só do id do run e da geração. É o vínculo de
 * posse: o que não leva este nome não pertence ao Preview e nunca é apagado por ele.
 */
export function nomeDoAmbienteDePreview(previewId: string, generation: number): string {
  const curto = previewId.replace(/-/g, '').toLowerCase().slice(0, 12)
  if (!/^[a-f0-9]{12}$/.test(curto))
    throw new TypeError('Id de Preview inválido para nomear recursos.')
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw new TypeError('Geração de Preview inválida.')
  return `pv-${curto}-g${generation}`
}

export const PADRAO_DE_AMBIENTE_DE_PREVIEW = /^pv-[a-f0-9]{12}-g[1-9]\d*$/

/**
 * URL que pode aparecer no PR: https, sem credencial, sem query nem fragmento. Um token que
 * escape para a URL (`?token=`) não chega ao comentário.
 */
export function urlPublicaDePreview(valor: string | undefined | null): string | null {
  if (!valor) return null
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    return null
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
}

/** Gates de um SHA: só vale o último resultado de cada gate para o SHA corrente. */
export function gatesVigentes(
  gates: readonly PreviewGate[],
  headSha: string
): readonly PreviewGate[] {
  const ultimo = new Map<string, PreviewGate>()
  for (const gate of gates) {
    if (gate.sourceSha !== headSha) continue
    const anterior = ultimo.get(gate.gate)
    if (!anterior || anterior.createdAt <= gate.createdAt) ultimo.set(gate.gate, gate)
  }
  return [...ultimo.values()].sort((a, b) => a.gate.localeCompare(b.gate))
}

export const GATES_OBRIGATORIOS_DE_PREVIEW = [
  'imagem',
  'backend',
  'migration',
  'seed',
  'health',
  'identidade',
  'frontend'
] as const

/** Pronto só com todos os gates obrigatórios `passed` no SHA vigente. */
export function previewProntoParaPublicar(vigentes: readonly PreviewGate[]): boolean {
  return GATES_OBRIGATORIOS_DE_PREVIEW.every((nome) =>
    vigentes.some((g) => g.gate === nome && g.result === 'passed')
  )
}
