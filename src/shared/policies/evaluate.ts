/**
 * O núcleo do Policy Engine (SPEC-Execucao-02).
 *
 * `evaluate` é **puro**: dado (ação, contexto) devolve uma `PolicyDecision`. Sem I/O, sem
 * storage, sem rede — categoria Regras. Quem persiste a decisão como `AuditEvent` é o
 * runtime no main (`PolicyService`); aqui só se decide.
 *
 * Quatro regras, nesta ordem de precedência:
 *   1. **Fail-closed** — ação fora do seed ⇒ `bloqueado`. O desconhecido é negado por padrão.
 *   2. **Sensibilidade no JARVIS** — ação que toca `personal|financial|health` no JARVIS OS
 *      é elevada a `alto` (CONVENTION §2: "JARVIS nunca acessa esses sem aprovação"), mesmo
 *      que o seed a classifique mais baixo.
 *   3. **Path fora da allowlist** (SPEC-Execucao-03) — ação sobre path fora do permitido
 *      sobe **um** nível a partir do seed (ex.: ler/gravar fora de diretório permitido ⇒
 *      médio, conforme requisitos). Fica abaixo da sensibilidade: dado protegido no JARVIS
 *      é sempre alto, independentemente de onde o path esteja.
 *   4. **Seed** — caso contrário, o tier é o do seed.
 *
 * Modo report (critério 6): o `outcome` diz o que *deveria* acontecer, mas nada barra nesta
 * fatia. O runtime registra e segue. Enforcement liga no MVP-003.
 */

import type { PolicyContext, PolicyDecision, RiskTier } from './contracts'
import { SENSIBILIDADES_PROTEGIDAS } from './contracts'
import { RISK_TAXONOMY } from './taxonomy'

/**
 * Outcome derivado do tier, segundo a política dos requisitos:
 * baixo → executa · médio/alto → aprovação · bloqueado → barra (quando o enforcement ligar).
 *
 * Derivar do tier (em vez de guardar no seed) mantém a taxonomia enxuta e garante que os dois
 * nunca divirjam: não há como uma linha do seed dizer `alto` + `allow` por engano.
 */
function outcomeParaTier(tier: RiskTier): PolicyDecision['outcome'] {
  switch (tier) {
    case 'baixo':
      return 'allow'
    case 'medio':
    case 'alto':
      return 'requires-approval'
    case 'bloqueado':
      return 'block'
  }
}

/** A ação toca dado protegido rodando no JARVIS OS? É o gatilho da regra 2. */
function elevaPorSensibilidade(context: PolicyContext): boolean {
  return (
    context.workspace === 'jarvis' &&
    context.sensitivity !== undefined &&
    SENSIBILIDADES_PROTEGIDAS.includes(context.sensitivity)
  )
}

/**
 * Sobe um nível na escala de tiers (baixo→medio→alto), saturando em `alto`.
 *
 * `alto` é o teto desta elevação: `bloqueado` é reservado ao fail-closed (ação desconhecida),
 * não a uma ação conhecida que apenas tocou um path fora. Empurrar para `bloqueado` aqui
 * confundiria "arriscado, precisa de aprovação" com "não reconhecido" — dois estados
 * distintos que a UI e o audit precisam distinguir.
 */
function subirUmNivel(tier: RiskTier): RiskTier {
  const escala: readonly RiskTier[] = ['baixo', 'medio', 'alto']
  const i = escala.indexOf(tier)
  if (i === -1) return tier // 'bloqueado' não sobe
  return escala[Math.min(i + 1, escala.length - 1)] ?? tier
}

export function evaluate(action: string, context: PolicyContext): PolicyDecision {
  const entrada = RISK_TAXONOMY.get(action)

  // Regra 1 — fail-closed. Precede tudo: sem entrada no seed, não há tier a elevar nem a ler.
  if (!entrada) {
    return {
      action,
      tier: 'bloqueado',
      outcome: 'block',
      reason: 'acao-desconhecida-fail-closed'
    }
  }

  // Regra 2 — sensibilidade no JARVIS eleva a alto, sobrepondo o tier do seed.
  if (elevaPorSensibilidade(context)) {
    return {
      action,
      tier: 'alto',
      outcome: 'requires-approval',
      reason: 'elevada-por-sensibilidade-no-jarvis'
    }
  }

  // Regra 3 — path fora da allowlist sobe um nível a partir do seed (SPEC-Execucao-03).
  // `pathAllowed === false` é o gatilho: `undefined` (ação não toca path) e `true` (dentro)
  // não elevam. A checagem explícita evita que `undefined` — falsy — dispare a regra.
  if (context.pathAllowed === false) {
    const tier = subirUmNivel(entrada.tier)
    return {
      action,
      tier,
      outcome: outcomeParaTier(tier),
      reason: 'elevada-por-path-fora-da-allowlist'
    }
  }

  // Regra 4 — o tier do seed.
  return {
    action,
    tier: entrada.tier,
    outcome: outcomeParaTier(entrada.tier),
    reason: 'classificada-pelo-seed'
  }
}
