/**
 * Policy Engine no runtime (SPEC-Execucao-02).
 *
 * O `evaluate` puro vive em `src/shared/policies`; este serviço é a ponte com o mundo real:
 * chama `evaluate`, **audita a decisão** (ADR-004) e a devolve. Duas responsabilidades que o
 * núcleo puro não pode ter — persistência e logging — ficam aqui, no main.
 *
 * **Modo report (critério 6):** `classify` sempre devolve a decisão e sempre a audita, mas
 * **nunca barra**. Mesmo uma ação classificada `bloqueado` volta para o chamador, que segue
 * executando (simulada, na Fatia 05). O enforcement — deixar `outcome: 'block'` de fato
 * impedir a execução — liga no MVP-003. Aqui a decisão é registrada, não aplicada.
 */

import { evaluate, type PolicyContext, type PolicyDecision } from '@shared/policies'
import { redact } from '@shared/contracts/logging-redaction'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'

export class PolicyService {
  constructor(
    private readonly audit: AuditRepository,
    /**
     * Dono da auditoria, resolvido a cada avaliação — mesma razão do `WorkspaceService`: a
     * identidade é o usuário local antes do login e o da sessão depois. Capturar no construtor
     * congelaria o escopo da auditoria no usuário do boot.
     */
    private readonly userId: () => string
  ) {}

  /**
   * Classifica a ação, audita a decisão e a devolve. **Não bloqueia** (modo report).
   *
   * O `AuditEvent` carrega o contexto **redigido** (ADR-005): `detail` pode trazer caminho,
   * alvo ou payload da ação, e o mesmo `redact` do logging remove segredo/PII antes de a
   * decisão virar evidência permanente. Auditar o contexto cru transformaria a auditoria num
   * vazamento — o oposto do que ela existe para fazer.
   */
  classify(action: string, context: PolicyContext): PolicyDecision {
    const decision = evaluate(action, context)

    const detalheRedigido = context.detail ? redact(context.detail) : undefined

    this.audit.append({
      user_id: this.userId(),
      workspace_id: context.workspace as WorkspaceId,
      type: 'policy-decision',
      payload: {
        action: decision.action,
        tier: decision.tier,
        outcome: decision.outcome,
        reason: decision.reason,
        sensitivity: context.sensitivity ?? null,
        ...(detalheRedigido !== undefined ? { detail: detalheRedigido } : {})
      }
    })

    // Categoria `agent`: a decisão de política é do runtime agente, não da UI nem do storage.
    log.agent.info('Decisão de política registrada', {
      action: decision.action,
      tier: decision.tier,
      outcome: decision.outcome,
      reason: decision.reason
    })

    return decision
  }
}
