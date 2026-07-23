/**
 * Persistência da allowlist de diretórios (SPEC-Execucao-03).
 *
 * Guarda o conjunto de diretórios que o FS/terminal poderão tocar — **canônicos**, escopados
 * por `user_id`. Nesta fatia é fonte de verdade + consulta; barrar operação real é MVP-003.
 *
 * Duas garantias moram aqui:
 *  - **Default conservador:** um usuário sem nenhuma entrada explícita tem exatamente **um**
 *    diretório permitido — o do app (`userData`). Nada do sistema dele é alcançável por
 *    padrão; tudo além disso é opt-in.
 *  - **Toda edição audita** (ADR-004): adicionar/remover diretório é ação sensível (RF-019) e
 *    gera `AuditEvent` encadeado. A allowlist é evidência de o que foi permitido e quando.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import { canonicalize } from './allowlist-canon'

interface AllowedDirRow {
  readonly id: string
  readonly user_id: string
  readonly path: string
  readonly created_at: string
}

export class AllowlistRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository,
    /**
     * O diretório gerido pelo app (`userData`), **já canônico**. É o default de fábrica:
     * entra por injeção porque `app.getPath('userData')` só existe com o Electron, e o
     * repositório precisa ser exercitável em teste com um diretório temporário qualquer.
     */
    private readonly appDir: string
  ) {}

  /**
   * Diretórios permitidos do usuário. **Sempre inclui o `appDir`** — o default de fábrica
   * não é uma linha gravada (que o usuário poderia remover e ficar sem base nenhuma), e sim
   * um invariante: o diretório do app é permitido por construção. As entradas explícitas do
   * usuário se somam a ele.
   *
   * Retorna paths canônicos, prontos para `isPathAllowed`. Deduplica: se o usuário adicionou
   * explicitamente o próprio `appDir`, ele não aparece duas vezes.
   */
  list(userId: string): readonly string[] {
    const rows = this.db
      .prepare('SELECT path FROM allowed_directory WHERE user_id = ? ORDER BY created_at')
      .all(userId) as Pick<AllowedDirRow, 'path'>[]

    const paths = new Set<string>([this.appDir])
    for (const row of rows) paths.add(row.path)
    return [...paths]
  }

  /**
   * Adiciona um diretório à allowlist do usuário e audita. Canoniza antes de gravar — a
   * comparação downstream (`isPathAllowed`) assume paths canônicos, e guardar o path cru
   * deixaria `../` ou symlink escaparem da checagem.
   *
   * Idempotente: re-adicionar um diretório já presente (ou o próprio `appDir`) não cria linha
   * nova (o `UNIQUE` do schema) e **não** audita — não houve mudança a registrar. Auditar um
   * no-op poluiria a evidência com eventos que não correspondem a uma decisão real.
   */
  add(userId: string, rawPath: string): { path: string; added: boolean } {
    const path = canonicalize(rawPath)

    const jaExiste =
      path === this.appDir ||
      this.db
        .prepare('SELECT 1 FROM allowed_directory WHERE user_id = ? AND path = ?')
        .get(userId, path) !== undefined

    if (jaExiste) {
      return { path, added: false }
    }

    this.db
      .prepare('INSERT INTO allowed_directory (id, user_id, path, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), userId, path, new Date().toISOString())

    // Editar a allowlist é ação sensível (RF-019) — auditada, ainda que sem enforcement.
    this.audit.append({
      user_id: userId,
      type: 'allowlist-change',
      payload: { op: 'add', path }
    })

    log.db.info('Diretório adicionado à allowlist', { op: 'insert', table: 'allowed_directory' })
    return { path, added: true }
  }

  /**
   * Remove um diretório da allowlist e audita. O `appDir` **não** é removível: ele é o default
   * de fábrica e não vive como linha (removê-lo deixaria o usuário sem base permitida). Uma
   * tentativa de removê-lo é um no-op — nada a apagar, nada a auditar.
   */
  remove(userId: string, rawPath: string): { path: string; removed: boolean } {
    const path = canonicalize(rawPath)

    const info = this.db
      .prepare('DELETE FROM allowed_directory WHERE user_id = ? AND path = ?')
      .run(userId, path)

    if (info.changes === 0) {
      return { path, removed: false }
    }

    this.audit.append({
      user_id: userId,
      type: 'allowlist-change',
      payload: { op: 'remove', path }
    })

    log.db.info('Diretório removido da allowlist', { op: 'delete', table: 'allowed_directory' })
    return { path, removed: true }
  }
}
