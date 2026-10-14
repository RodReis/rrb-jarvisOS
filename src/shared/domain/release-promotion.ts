import type { GateResult, ReleaseEnvironment } from './release'

/**
 * Regras puras da promoção para Staging e Produção (SPEC-Release-04). Nada aqui conhece Vercel,
 * Railway ou SQLite: o domínio decide o que aprova um ambiente e quando a estabilização termina;
 * os adapters executam.
 */

/**
 * Gates obrigatórios por ambiente. Produção tem `backup` (critério 4) e não tem `e2e_essential`:
 * a jornada essencial roda em Staging, e Produção só confirma o mesmo artefato com health e smoke.
 */
export const GATES_OBRIGATORIOS = {
  staging: [
    'configuration',
    'migration',
    'backend_health',
    'frontend_wiring',
    'smoke',
    'e2e_essential'
  ],
  production: ['configuration', 'backup', 'migration', 'backend_health', 'frontend_wiring', 'smoke']
} as const satisfies Record<ReleaseEnvironment, readonly string[]>

/** Último resultado de cada gate do ambiente: reparo posterior substitui bloqueio anterior. */
function gatesVigentes(
  environment: ReleaseEnvironment,
  gates: readonly GateResult[]
): ReadonlyMap<string, GateResult> {
  const ultimo = new Map<string, GateResult>()
  for (const gate of gates) {
    if (gate.environment !== environment) continue
    const anterior = ultimo.get(gate.gate)
    if (!anterior || anterior.createdAt <= gate.createdAt) ultimo.set(gate.gate, gate)
  }
  return ultimo
}

/** Aprovado tecnicamente = todos os gates obrigatórios do ambiente com o último resultado `passed`. */
export function ambienteAprovadoTecnicamente(
  environment: ReleaseEnvironment,
  gates: readonly GateResult[]
): boolean {
  const vigentes = gatesVigentes(environment, gates)
  return GATES_OBRIGATORIOS[environment].every((nome) => vigentes.get(nome)?.result === 'passed')
}

export interface JanelaDeEstabilizacao {
  /** Quanto tempo de saúde contínua estabiliza a release. */
  readonly windowMs: number
  /** Intervalo entre os health checks. */
  readonly intervalMs: number
  /** Quantas falhas isoladas reiniciam a janela antes de compensar. */
  readonly maxRestarts: number
}

export const ESTABILIZACAO_PADRAO: JanelaDeEstabilizacao = {
  windowMs: 5 * 60_000,
  intervalMs: 30_000,
  maxRestarts: 1
}

export function validarJanelaDeEstabilizacao(config: JanelaDeEstabilizacao): void {
  const inteiroPositivo = (n: number): boolean => Number.isSafeInteger(n) && n > 0
  if (!inteiroPositivo(config.windowMs) || !inteiroPositivo(config.intervalMs))
    throw new TypeError('Janela e intervalo de estabilização exigem milissegundos inteiros > 0.')
  if (config.windowMs < config.intervalMs)
    throw new TypeError('A janela de estabilização deve comportar ao menos um intervalo.')
  if (!Number.isSafeInteger(config.maxRestarts) || config.maxRestarts < 0)
    throw new TypeError('O limite de reinícios deve ser um inteiro >= 0.')
}

export interface EstadoDeEstabilizacao {
  readonly startedAtMs: number
  readonly restarts: number
}

export type DecisaoDeEstabilizacao =
  | { readonly decision: 'continue'; readonly state: EstadoDeEstabilizacao }
  | { readonly decision: 'restart'; readonly state: EstadoDeEstabilizacao }
  | { readonly decision: 'stable'; readonly state: EstadoDeEstabilizacao }
  | { readonly decision: 'compensate'; readonly state: EstadoDeEstabilizacao }

/**
 * Uma observação de saúde. Falha dentro do limite reinicia a contagem **a partir da falha**;
 * passado o limite, compensa. A janela só fecha com saúde observada no fim dela.
 */
export function avaliarEstabilizacao(
  config: JanelaDeEstabilizacao,
  estado: EstadoDeEstabilizacao,
  agoraMs: number,
  saudavel: boolean
): DecisaoDeEstabilizacao {
  if (!saudavel) {
    if (estado.restarts >= config.maxRestarts) return { decision: 'compensate', state: estado }
    return {
      decision: 'restart',
      state: { startedAtMs: agoraMs, restarts: estado.restarts + 1 }
    }
  }
  if (agoraMs - estado.startedAtMs >= config.windowMs) return { decision: 'stable', state: estado }
  return { decision: 'continue', state: estado }
}
