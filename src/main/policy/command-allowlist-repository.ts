/**
 * Persistência da allowlist de **comandos** (SPEC-ExecucaoReal-02, 1ª barreira).
 *
 * Conceito novo desta fatia — o MVP-002 só tinha allowlist de *diretórios*. As duas coexistem
 * e são checadas juntas pelo motor de terminal: um comando precisa de binário permitido **e**
 * de cwd permitido; falhar em qualquer uma barra.
 *
 * Duas diferenças deliberadas em relação a `AllowlistRepository`, e ambas vêm da spec:
 *
 *  - **Sem default de fábrica.** A lista nasce vazia e nada é semeado: nenhum comando roda
 *    até o usuário permitir explicitamente. Onde a allowlist de diretórios tem o `appDir`
 *    como invariante (o app precisa alcançar o próprio diretório para funcionar), aqui não
 *    há comando nenhum de que o app precise — então o conjunto vazio é o estado correto de
 *    partida, não uma lacuna a preencher.
 *  - **Escopo por workspace, além do usuário.** O que o JARVIS OS pode executar não é o que o
 *    NOA pode. Diretório permitido é sobre onde os arquivos do usuário estão; comando
 *    permitido é sobre o que aquele espaço tem autoridade para rodar.
 *
 * **Toda edição audita** (ADR-004) e é classificada **alto risco** (critério 7): mudar o que
 * a máquina pode executar é a decisão mais sensível desta fatia — mais que qualquer comando
 * isolado, porque muda o teto do que será possível dali em diante.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { canonicalizeBinary } from '@shared/policies'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { PolicyService } from './policy-service'

interface AllowedCommandRow {
  readonly binary: string
}

export class CommandAllowlistRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository,
    /**
     * O Policy Engine, para classificar a **edição da lista** como ação de alto risco
     * (`permissions.change`). Entra por injeção como no `WorkflowService`: a classificação é
     * do runtime, e o repositório precisa continuar exercitável com um serviço de teste.
     */
    private readonly policy: PolicyService
  ) {}

  /**
   * Comandos permitidos do usuário naquele espaço. Devolve binários **canônicos**, prontos
   * para `isCommandAllowed`. Lista vazia é o estado normal de um usuário novo — e significa
   * que nada executa.
   */
  list(userId: string, workspaceId: WorkspaceId): readonly string[] {
    const rows = this.db
      .prepare(
        `SELECT binary FROM allowed_command
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY created_at`
      )
      .all(userId, workspaceId) as AllowedCommandRow[]

    return rows.map((row) => row.binary)
  }

  /**
   * Permite um binário e audita. Canoniza antes de gravar — a comparação downstream assume
   * canônico, e guardar `GIT.EXE` cru faria `git` não casar a própria entrada do usuário.
   *
   * Idempotente: re-adicionar um binário já presente não cria linha nova (o `UNIQUE` do
   * schema) e **não** audita. Auditar um no-op poluiria a evidência com eventos que não
   * correspondem a uma decisão real — mesma regra da allowlist de diretórios.
   */
  add(
    userId: string,
    workspaceId: WorkspaceId,
    rawBinary: string
  ): { binary: string; added: boolean } {
    const binary = canonicalizeBinary(rawBinary)

    if (binary.length === 0) return { binary, added: false }

    const jaExiste =
      this.db
        .prepare(
          'SELECT 1 FROM allowed_command WHERE user_id = ? AND workspace_id = ? AND binary = ?'
        )
        .get(userId, workspaceId, binary) !== undefined

    if (jaExiste) return { binary, added: false }

    // Classifica **antes** de gravar: a decisão de política é sobre o ato de permitir, e
    // registrá-la depois inverteria a ordem que a auditoria conta (decidi, então fiz).
    this.policy.classify('permissions.change', {
      workspace: workspaceId,
      detail: { op: 'add', alvo: 'allowed_command', binary }
    })

    this.db
      .prepare(
        `INSERT INTO allowed_command (id, user_id, workspace_id, binary, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), userId, workspaceId, binary, new Date().toISOString())

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'allowlist-change',
      payload: { op: 'add', alvo: 'comando', binary }
    })

    log.db.info('Comando adicionado à allowlist', { op: 'insert', table: 'allowed_command' })
    return { binary, added: true }
  }

  /** Revoga um binário e audita. Remover o que não está na lista é no-op — nada a registrar. */
  remove(
    userId: string,
    workspaceId: WorkspaceId,
    rawBinary: string
  ): { binary: string; removed: boolean } {
    const binary = canonicalizeBinary(rawBinary)

    const info = this.db
      .prepare('DELETE FROM allowed_command WHERE user_id = ? AND workspace_id = ? AND binary = ?')
      .run(userId, workspaceId, binary)

    if (info.changes === 0) return { binary, removed: false }

    this.policy.classify('permissions.change', {
      workspace: workspaceId,
      detail: { op: 'remove', alvo: 'allowed_command', binary }
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'allowlist-change',
      payload: { op: 'remove', alvo: 'comando', binary }
    })

    log.db.info('Comando removido da allowlist', { op: 'delete', table: 'allowed_command' })
    return { binary, removed: true }
  }
}
