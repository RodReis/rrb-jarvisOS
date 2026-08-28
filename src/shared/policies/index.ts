/** Superfície pública do Policy Engine (SPEC-Execucao-02) e da allowlist (SPEC-Execucao-03). */
export { evaluate } from './evaluate'
export { isPathAllowed } from './allowlist'
export { RISK_TAXONOMY, type TaxonomyEntry } from './taxonomy'
export {
  SENSITIVITIES,
  RISK_TIERS,
  POLICY_REASONS,
  isSensitivity,
  isRiskTier,
  type Sensitivity,
  type RiskTier,
  type PolicyOutcome,
  type PolicyContext,
  type PolicyDecision,
  type PolicyReason,
  type ActionId
} from './contracts'
