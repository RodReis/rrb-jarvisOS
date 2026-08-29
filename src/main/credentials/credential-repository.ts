/**
 * Persistência do vault (SPEC-Providers-01, critérios 1 e 2).
 *
 * Camada fina de propósito: guarda e devolve **bytes cifrados**, e não sabe nada sobre env,
 * precedência, política ou auditoria — isso é do `CredentialService`. A separação é o que
 * permite testar "o disco não contém o segredo em claro" sem envolver o resto.
 *
 * Este é o único lugar do projeto que lê ou escreve a coluna `credential_ref.secret`.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { CredentialKey } from '@shared/domain/credentials'
import { log } from '../logging/logger'
import type { SecretCipher } from './secret-vault'

interface CredentialRow {
  readonly id: string
  readonly key: string
  readonly secret: Buffer
  readonly created_at: string
  readonly updated_at: string
}

export class CredentialRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher
  ) {}

  /**
   * As chaves que **têm valor no vault** naquele escopo. Só as chaves — o valor não sai daqui
   * a não ser por `readSecret`, que tem um call site só (o adapter, no momento da chamada).
   */
  listKeys(userId: string, workspaceId: WorkspaceId): readonly CredentialKey[] {
    const rows = this.db
      .prepare(
        `SELECT key FROM credential_ref
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY key`
      )
      .all(userId, workspaceId) as Pick<CredentialRow, 'key'>[]

    return rows.map((row) => row.key as CredentialKey)
  }

  /** Metadados de uma credencial do vault, sem tocar o valor. */
  find(
    userId: string,
    workspaceId: WorkspaceId,
    key: CredentialKey
  ): { id: string; created_at: string; updated_at: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT id, created_at, updated_at FROM credential_ref
          WHERE user_id = ? AND workspace_id = ? AND key = ?`
      )
      .get(userId, workspaceId, key) as Omit<CredentialRow, 'key' | 'secret'> | undefined

    return row
  }

  /**
   * Grava (ou substitui) o valor cifrado.
   *
   * `INSERT … ON CONFLICT DO UPDATE` sobre o `UNIQUE (user_id, workspace_id, key)`: regravar
   * a mesma chave **substitui** o valor em vez de acumular linhas. O vault é um mapa — duas
   * linhas para a mesma chave deixariam a leitura ambígua, e "qual das duas vale" não é
   * pergunta que uma credencial deva ter.
   *
   * `created_at` é preservado no update (`excluded` só toca `secret` e `updated_at`): a
   * credencial é a mesma; o que mudou foi o valor dela.
   */
  upsert(userId: string, workspaceId: WorkspaceId, key: CredentialKey, plaintext: string): void {
    const agora = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO credential_ref (id, user_id, workspace_id, key, secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, key)
         DO UPDATE SET secret = excluded.secret, updated_at = excluded.updated_at`
      )
      .run(randomUUID(), userId, workspaceId, key, this.cipher.encrypt(plaintext), agora, agora)

    // Sem `ctx` com valor nenhum além da chave lógica: nem o tamanho do segredo entra no log.
    log.db.info('Credencial gravada cifrada no vault', { op: 'upsert', table: 'credential_ref' })
  }

  /** Remove a credencial do vault. Devolve `false` quando não havia nada a remover (no-op). */
  remove(userId: string, workspaceId: WorkspaceId, key: CredentialKey): boolean {
    const info = this.db
      .prepare('DELETE FROM credential_ref WHERE user_id = ? AND workspace_id = ? AND key = ?')
      .run(userId, workspaceId, key)

    if (info.changes === 0) return false

    log.db.info('Credencial removida do vault', { op: 'delete', table: 'credential_ref' })
    return true
  }

  /**
   * Decifra e devolve o valor — **o único caminho por onde o segredo sai do storage**.
   *
   * Chamado pelos adapters (F02) no instante da chamada ao provider, no main. Não existe canal
   * IPC que alcance este método: o `JarvisBridge` não tem forma de pedir valor de credencial,
   * e é por isso que o renderer não pode recebê-lo nem por engano.
   *
   * Valor ilegível (troca de usuário do SO, perfil recriado, banco copiado de outra máquina)
   * volta como `undefined`, não exceção: é o mesmo desfecho de "não configurado", e é o que a
   * camada de cima já sabe tratar. Derrubar a chamada do provider por um cofre indecifrável
   * daria ao usuário um erro técnico onde cabe "credencial ausente".
   */
  readSecret(userId: string, workspaceId: WorkspaceId, key: CredentialKey): string | undefined {
    const row = this.db
      .prepare(
        'SELECT secret FROM credential_ref WHERE user_id = ? AND workspace_id = ? AND key = ?'
      )
      .get(userId, workspaceId, key) as Pick<CredentialRow, 'secret'> | undefined

    if (!row) return undefined

    try {
      return this.cipher.decrypt(row.secret)
    } catch (error) {
      log.db.warn('Credencial ilegível no vault; tratada como ausente', { error })
      return undefined
    }
  }
}
