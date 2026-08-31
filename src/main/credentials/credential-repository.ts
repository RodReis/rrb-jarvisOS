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
import type { ConnectorCredentialKey } from '@shared/domain/connectors'
import { log } from '../logging/logger'
import type { SecretCipher } from './secret-vault'

interface CredentialRow {
  readonly id: string
  readonly key: string
  readonly secret: Buffer
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Uma chave endereçável no vault.
 *
 * Duas famílias, e não uma: `CredentialKey` são as credenciais de provider de IA
 * (SPEC-Providers-01) e `ConnectorCredentialKey` são as de conector (SPEC-Conectores-01) —
 * separadas por decisão do PI (2026-08-29), porque a tela de credenciais lista o que **falta**
 * por chave, e misturá-las faria o Settings anunciar credenciais de conector ausentes que
 * ninguém consegue usar até a M6-F03.
 *
 * O que elas compartilham é o **armazenamento**: a coluna `credential_ref.key` sempre foi
 * texto, e o `UNIQUE (user_id, workspace_id, key)` já endereça qualquer chave lógica. Um
 * segundo cofre para conector duplicaria a cifra, a migration e o cuidado com o segredo em
 * troca de nada — a separação que importa é a de **taxonomia**, e ela vive nos tipos do
 * domínio, não em duas tabelas.
 */
export type VaultKey = CredentialKey | ConnectorCredentialKey

export class CredentialRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher
  ) {}

  /**
   * As chaves que **têm valor no vault** naquele escopo. Só as chaves — o valor não sai daqui
   * a não ser por `readSecret`, que tem um call site só (o adapter, no momento da chamada).
   *
   * `VaultKey` e não `CredentialKey`: a coluna guarda as duas taxonomias, e tipar o retorno como
   * só uma delas afirmaria que uma chave de conector gravada aqui é uma chave de IA. Quem
   * consome filtra pela lista que lhe interessa — é o que `listStatus` e `listConnectorStatus`
   * fazem, cada um varrendo o próprio enum.
   */
  listKeys(userId: string, workspaceId: WorkspaceId): readonly VaultKey[] {
    const rows = this.db
      .prepare(
        `SELECT key FROM credential_ref
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY key`
      )
      .all(userId, workspaceId) as Pick<CredentialRow, 'key'>[]

    return rows.map((row) => row.key as VaultKey)
  }

  /** Metadados de uma credencial do vault, sem tocar o valor. */
  find(
    userId: string,
    workspaceId: WorkspaceId,
    key: VaultKey
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
  upsert(userId: string, workspaceId: WorkspaceId, key: VaultKey, plaintext: string): void {
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
  remove(userId: string, workspaceId: WorkspaceId, key: VaultKey): boolean {
    const info = this.db
      .prepare('DELETE FROM credential_ref WHERE user_id = ? AND workspace_id = ? AND key = ?')
      .run(userId, workspaceId, key)

    if (info.changes === 0) return false

    log.db.info('Credencial removida do vault', { op: 'delete', table: 'credential_ref' })
    return true
  }

  /**
   * Grava um **payload estruturado** e o prazo, numa escrita só (SPEC-Conectores-03, crit. 8).
   *
   * A emenda do OAuth ao vault da M5-F01. O que muda em relação ao `upsert`: o segredo cifrado
   * é um objeto serializado (access + refresh + expirações), e o `expires_at` acompanha **fora**
   * da cifra, para que "vence quando?" seja respondível sem destravar o DPAPI.
   *
   * **A rotação é atômica porque é um único `INSERT … ON CONFLICT DO UPDATE`**, e é isto que o
   * critério 8 cobra: se o refresh falhar depois, a linha antiga continua inteira; se ele der
   * certo, o par novo substitui o par velho de uma vez. A alternativa — `DELETE` seguido de
   * `INSERT`, ou uma coluna por campo — teria um instante em que o cofre guarda um refresh token
   * sem o access token que ele renova, que é credencial meio-escrita.
   */
  upsertPayload(
    userId: string,
    workspaceId: WorkspaceId,
    key: VaultKey,
    payload: unknown,
    expiresAt?: string
  ): void {
    const agora = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO credential_ref
           (id, user_id, workspace_id, key, secret, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, key)
         DO UPDATE SET secret = excluded.secret,
                       expires_at = excluded.expires_at,
                       updated_at = excluded.updated_at`
      )
      .run(
        randomUUID(),
        userId,
        workspaceId,
        key,
        this.cipher.encrypt(JSON.stringify(payload)),
        expiresAt ?? null,
        agora,
        agora
      )

    log.db.info('Credencial estruturada gravada cifrada no vault', {
      op: 'upsert',
      table: 'credential_ref'
    })
  }

  /**
   * Lê o payload estruturado, decifrando e desserializando.
   *
   * `undefined` cobre os três casos em que não há payload utilizável — ausente, ilegível
   * (cifra de outra máquina) e não-JSON (uma credencial gravada por `upsert` como valor único,
   * que é o formato legítimo das chaves de IA). Os três significam a mesma coisa para quem
   * chama: *não há credencial OAuth aqui*, que é o desfecho que a camada de cima já trata.
   */
  readPayload<T>(userId: string, workspaceId: WorkspaceId, key: VaultKey): T | undefined {
    const cru = this.readSecret(userId, workspaceId, key)
    if (cru === undefined) return undefined

    try {
      return JSON.parse(cru) as T
    } catch {
      // Sem `error` no log: a mensagem do `JSON.parse` cita o trecho que falhou, e o trecho é o
      // segredo decifrado. O fato de não ser JSON é tudo que precisa ser registrado.
      log.db.warn('Credencial do vault não é um payload estruturado; tratada como ausente', {
        op: 'select',
        table: 'credential_ref'
      })
      return undefined
    }
  }

  /**
   * Quando aquela credencial vence — **sem decifrar nada**.
   *
   * O caminho que justifica a coluna: a tela de Configurações pergunta isto a cada render, e
   * responder decifrando faria o app destravar o DPAPI para ler um relógio. `undefined` = não
   * expira (ou não existe), que é o mesmo desfecho prático: não há renovação a fazer.
   */
  expiresAt(userId: string, workspaceId: WorkspaceId, key: VaultKey): string | undefined {
    const row = this.db
      .prepare(
        'SELECT expires_at FROM credential_ref WHERE user_id = ? AND workspace_id = ? AND key = ?'
      )
      .get(userId, workspaceId, key) as { expires_at: string | null } | undefined

    return row?.expires_at ?? undefined
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
  readSecret(userId: string, workspaceId: WorkspaceId, key: VaultKey): string | undefined {
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
