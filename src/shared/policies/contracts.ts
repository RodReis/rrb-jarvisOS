/**
 * Contratos do Policy Engine (SPEC-Execucao-02).
 *
 * Mora em `src/shared` porque o `evaluate` é lógica pura (CONVENTION §3): renderer, main e
 * testes falam os mesmos tipos, e política precisa ser verificável sem carregar o Electron.
 * O renderer importa os *tipos* para ler o resultado — mas **não** avalia (critério 7): quem
 * chama `evaluate` é o main/runtime.
 */

/**
 * Sensibilidade do dado que a ação toca (CONVENTION §2). Enum fechado — o Policy Engine é o
 * primeiro consumidor tipado dele. `personal | financial | health` são o gatilho da regra
 * "JARVIS nunca acessa esses sem aprovação"; `credential | secret` nunca deveriam trafegar
 * em claro (o logging já os redige, `REDACTED_SENSITIVITIES`).
 */
export const SENSITIVITIES = [
  'public',
  'internal',
  'personal',
  'financial',
  'health',
  'credential',
  'secret'
] as const

export type Sensitivity = (typeof SENSITIVITIES)[number]

/** As sensibilidades que, no JARVIS OS, elevam a ação a alto risco (CONVENTION §2). */
export const SENSIBILIDADES_PROTEGIDAS: readonly Sensitivity[] = ['personal', 'financial', 'health']

/**
 * Tier de risco de uma ação (requisitos § Ações Possíveis e Política de Aprovação).
 * Ordenados do menor para o maior; `bloqueado` é também o destino do desconhecido (fail-closed).
 */
export const RISK_TIERS = ['baixo', 'medio', 'alto', 'bloqueado'] as const

export type RiskTier = (typeof RISK_TIERS)[number]

/**
 * O que a política decide fazer com a ação. **Nesta fatia nada disto barra** (modo report,
 * critério 6) — o runtime recebe e audita, mas executa mesmo assim. O enforcement liga no
 * MVP-003, quando `block` passa a barrar de verdade.
 */
export type PolicyOutcome = 'allow' | 'requires-approval' | 'block'

/**
 * A identidade da ação: uma chave estável que casa com o seed da taxonomia. Não é texto
 * livre — é o id da linha em `taxonomy.ts` (ex.: `workflow.run-simulated`). Ação cujo id não
 * está no seed é *desconhecida* e cai em `bloqueado`.
 */
export type ActionId = string

/** O contexto em que a ação acontece — o que torna a classificação sensível ao ambiente. */
export interface PolicyContext {
  /** Espaço onde a ação corre. `personal|financial|health` só elevam risco no JARVIS. */
  readonly workspace: 'noa' | 'jarvis'
  /** Sensibilidade do dado tocado, quando aplicável. */
  readonly sensitivity?: Sensitivity
  /**
   * A ação toca um path, e ele está na allowlist? (SPEC-Execucao-03, critério 4)
   *
   * Booleano **já resolvido pelo main**, não o path cru: a canonicalização com symlink exige
   * `node:fs`, que não existe aqui (`src/shared` compila para o renderer). O main canoniza,
   * chama `isPathAllowed`, e passa o resultado. `undefined` = a ação não toca path (a regra
   * de allowlist não se aplica); `false` = toca um path **fora** do permitido, o que eleva o
   * tier.
   */
  readonly pathAllowed?: boolean
  /** Metadados livres da ação (caminho, alvo…). **Redigido antes de auditar** (ADR-005). */
  readonly detail?: Readonly<Record<string, unknown>>
}

/** O veredito do engine. `reason` é enum-like em pt-BR — nunca `error.message` cru na UI. */
export interface PolicyDecision {
  readonly action: ActionId
  readonly tier: RiskTier
  readonly outcome: PolicyOutcome
  readonly reason: PolicyReason
}

/**
 * Motivos fechados da decisão. Enum, não string livre: a UI decide o que mostrar a partir
 * dele, e um `reason` novo é uma mudança de contrato, não texto que vaza de um `catch`.
 */
export const POLICY_REASONS = [
  'classificada-pelo-seed',
  'elevada-por-sensibilidade-no-jarvis',
  'elevada-por-path-fora-da-allowlist',
  'acao-desconhecida-fail-closed'
] as const

export type PolicyReason = (typeof POLICY_REASONS)[number]

export function isSensitivity(value: unknown): value is Sensitivity {
  return typeof value === 'string' && (SENSITIVITIES as readonly string[]).includes(value)
}

export function isRiskTier(value: unknown): value is RiskTier {
  return typeof value === 'string' && (RISK_TIERS as readonly string[]).includes(value)
}
