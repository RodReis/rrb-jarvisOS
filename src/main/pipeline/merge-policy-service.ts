/**
 * O kill-switch do merge autônomo (SPEC-Entrega-05; decisão do PI, 2026-08-30).
 *
 * A pergunta que este serviço responde: **este projeto deixa a pipeline mergear sozinha?**
 *
 * O padrão é **sim** — é a tese do MVP-009, e a alternativa (opt-in desligado) transformaria o
 * MVP em "abre PR e espera", que é o que ele existe para superar. O kill-switch existe para
 * projeto com outros colaboradores, onde entrar na `main` sozinho não é aceitável; nele, o run
 * termina em `AWAITING_MERGE` com o PR verde.
 *
 * **Desligar e religar são ações sensíveis** (§ Git automático da M9-F05): geram `AuditEvent`.
 * A razão é a mesma da `allowlist-change` do MVP-004 — é uma mudança de configuração que altera
 * o que a máquina faz sem perguntar, e a auditoria de "quem mudou o que a pipeline pode fazer"
 * é tão necessária quanto a de "o que a pipeline fez".
 *
 * **Sem identidade não há mudança.** Falha fechado, como o gate da M8-F06: uma mudança de
 * política sem quem a fez não responde a pergunta que o `AuditEvent` existe para responder.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { MergePolicyOutcome, PoliticaDeMerge } from '@shared/domain/pipeline'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { MergePolicyRepository } from './merge-policy-repository'

export interface MergePolicyDeps {
  readonly repository: MergePolicyRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /** O id da sessão autenticada. `undefined` sem sessão — e aí a mudança não acontece. */
  readonly identidade: () => string | undefined
  readonly agora?: () => number
}

export class MergePolicyService {
  private readonly agora: () => number

  constructor(private readonly deps: MergePolicyDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /**
   * O merge autônomo está ligado neste projeto?
   *
   * É o que a M9-F05 consulta para escolher entre `MERGED` e `AWAITING_MERGE` (critério 7 da
   * M9-F02, critério 8 da M9-F05).
   */
  autonomoLigado(projectId: string): boolean {
    return this.deps.repository.buscar(this.deps.userId(), projectId).autonomo
  }

  /** A política vigente, com quem a definiu — para a tela mostrar o estado e a origem dele. */
  politica(projectId: string): PoliticaDeMerge {
    return this.deps.repository.buscar(this.deps.userId(), projectId)
  }

  /**
   * Liga ou desliga o merge autônomo do projeto.
   *
   * Recusa quando a política já era essa: um `AuditEvent` por clique que não mudou nada encheria
   * a auditoria de não-eventos, e a pergunta "quando isto foi desligado" passaria a ter várias
   * respostas iguais.
   */
  definir(projectId: string, workspaceId: WorkspaceId, autonomo: boolean): MergePolicyOutcome {
    const userId = this.deps.userId()
    const identidade = this.deps.identidade()

    if (identidade === undefined || identidade.trim() === '') {
      return {
        reason: 'sem-identidade',
        mensagem: 'Mudar o merge autônomo exige sessão autenticada.'
      }
    }

    const atual = this.deps.repository.buscar(userId, projectId)
    if (atual.autonomo === autonomo) {
      return {
        reason: 'sem-mudanca',
        politica: atual,
        mensagem: `O merge autônomo já está ${autonomo ? 'ligado' : 'desligado'}.`
      }
    }

    this.deps.repository.definir(
      { userId, workspaceId, projectId },
      autonomo,
      identidade,
      new Date(this.agora())
    )

    this.deps.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'merge-policy-change',
      payload: { projectId, autonomo, identidade, de: atual.autonomo }
    })

    log.agent.warn('Kill-switch do merge autônomo mudou', { projectId, autonomo })

    return {
      reason: 'definido',
      politica: this.deps.repository.buscar(userId, projectId),
      mensagem: autonomo
        ? 'Merge autônomo ligado: a pipeline mergeia o PR verde sozinha.'
        : 'Merge autônomo desligado: o run termina no PR verde, aguardando o PI.'
    }
  }
}
