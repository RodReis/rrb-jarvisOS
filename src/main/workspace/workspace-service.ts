/**
 * Espaço ativo e a troca entre NOA e JARVIS OS (SPEC-Fundacao-02).
 *
 * O estado mora no main, não no renderer: a troca gera `AuditEvent` (ADR-004) e etiqueta
 * o logger (ADR-005), e nenhum dos dois é acessível do renderer. A UI pede a troca e
 * recebe o resultado já auditado.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import { log, setCurrentWorkspace } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'

/**
 * Espaço ao abrir o app: **sempre JARVIS OS**, por decisão do PI (SPEC-02, pergunta 1).
 * Determinístico de propósito — restaurar o último espaço tornaria a tela inicial
 * dependente de estado anterior.
 */
export const WORKSPACE_INICIAL: WorkspaceId = 'jarvis'

export class WorkspaceService {
  private ativo: WorkspaceId = WORKSPACE_INICIAL

  constructor(
    private readonly audit: AuditRepository,
    /**
     * Dono da auditoria. Enquanto a F03 (auth) não existe, o app roda com um usuário
     * local fixo; quando o login entrar, quem chama passa o `user_id` real da sessão.
     */
    private readonly userId: string
  ) {
    setCurrentWorkspace(this.ativo)
  }

  atual(): WorkspaceId {
    return this.ativo
  }

  /**
   * Troca o espaço ativo, auditando e logando a transição.
   *
   * Audita **antes** de considerar a troca efetivada: se a gravação do `AuditEvent`
   * falhar, o espaço não muda. Auditoria que pode ser pulada quando o disco falha não
   * é evidência (ADR-004).
   */
  trocar(destino: WorkspaceId): { workspace: WorkspaceId; auditSeq: number } {
    const origem = this.ativo

    const evento = this.audit.append({
      user_id: this.userId,
      workspace_id: destino,
      type: 'workspace-switch',
      payload: { de: origem, para: destino }
    })

    this.ativo = destino
    // O logger passa a etiquetar os registros seguintes com o espaço novo (ADR-005).
    setCurrentWorkspace(destino)

    log.ipc.info('Espaço de trabalho alternado', {
      de: origem,
      para: destino,
      auditSeq: evento.seq
    })

    return { workspace: destino, auditSeq: evento.seq }
  }
}
