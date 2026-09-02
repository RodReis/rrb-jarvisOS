/**
 * Persistência do diário de efeitos (SPEC-Entrega-02, § Diário de efeitos; issue #209).
 *
 * **A garantia de "chave igual, payload diferente é conflito" é o `UNIQUE(user_id,
 * chave_idempotente)`, não um `if` do serviço.** Uma checagem em memória ("já existe? compare o
 * fingerprint") tem a mesma janela de corrida que o `LeaseRepository` documenta: dois `call()`
 * concorrentes com a mesma chave e fingerprints diferentes poderiam ambos passar pela checagem
 * antes de qualquer um gravar. O índice fecha essa janela — o segundo `INSERT` viola a
 * restrição, e é essa violação que `registrarIntencao` interpreta.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  EntradaDoDiario,
  EstadoDoEfeito,
  ResultadoDoRegistro
} from '@shared/domain/effect-journal'

interface EffectJournalRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly chave_idempotente: string
  readonly fingerprint: string
  readonly alvo: string
  readonly correlation_id: string
  readonly estado: EstadoDoEfeito
  readonly external_ref_id: string | null
  readonly created_at: string
  readonly updated_at: string
}

function toEntrada(row: EffectJournalRow): EntradaDoDiario {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    chaveIdempotente: row.chave_idempotente,
    fingerprint: row.fingerprint,
    alvo: row.alvo,
    correlationId: row.correlation_id,
    estado: row.estado,
    ...(row.external_ref_id === null ? {} : { externalRefId: row.external_ref_id }),
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at
  }
}

export interface NovaIntencao {
  readonly userId: string
  readonly workspaceId: string
  readonly chaveIdempotente: string
  readonly fingerprint: string
  readonly alvo: string
  readonly correlationId: string
}

export class EffectJournalRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra a intenção antes do I/O, ou reconhece a que já existe para a mesma chave.
   *
   * Três desfechos, e a distinção entre `repetida` e `conflito` é o critério 3 da issue inteiro:
   * mesmo `fingerprint` na chave existente é a mesma intenção chegando de novo (retry seguro, o
   * chamador não repete o I/O); `fingerprint` diferente é duas intenções competindo pela mesma
   * chave, e falha **antes** de qualquer I/O sair.
   */
  registrarIntencao(
    intencao: NovaIntencao,
    agora: () => string = () => new Date().toISOString()
  ): ResultadoDoRegistro {
    const existente = this.buscarPorChave(intencao.userId, intencao.chaveIdempotente)
    if (existente !== undefined) {
      return existente.fingerprint === intencao.fingerprint
        ? { tipo: 'repetida', entrada: existente }
        : { tipo: 'conflito', motivo: 'payload-diverge', existente }
    }

    const id = randomUUID()
    const timestamp = agora()

    try {
      this.db
        .prepare(
          `INSERT INTO effect_journal
             (id, user_id, workspace_id, chave_idempotente, fingerprint, alvo, correlation_id,
              estado, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`
        )
        .run(
          id,
          intencao.userId,
          intencao.workspaceId,
          intencao.chaveIdempotente,
          intencao.fingerprint,
          intencao.alvo,
          intencao.correlationId,
          timestamp,
          timestamp
        )
    } catch {
      // Corrida: outra chamada gravou a mesma chave entre a leitura acima e este INSERT. Relê —
      // a linha que venceu a corrida é a resposta certa, seja repetição ou conflito.
      const concorrente = this.buscarPorChave(intencao.userId, intencao.chaveIdempotente)
      if (concorrente === undefined)
        throw new Error('Conflito no diário de efeitos sem linha concorrente legível.')
      return concorrente.fingerprint === intencao.fingerprint
        ? { tipo: 'repetida', entrada: concorrente }
        : { tipo: 'conflito', motivo: 'payload-diverge', existente: concorrente }
    }

    return {
      tipo: 'registrada',
      entrada: {
        id,
        userId: intencao.userId,
        workspaceId: intencao.workspaceId,
        chaveIdempotente: intencao.chaveIdempotente,
        fingerprint: intencao.fingerprint,
        alvo: intencao.alvo,
        correlationId: intencao.correlationId,
        estado: 'pendente',
        criadoEm: timestamp,
        atualizadoEm: timestamp
      }
    }
  }

  /**
   * Conclui a entrada: `confirmed`, `ambiguous` ou `failed`, com o `ExternalRef` quando houver.
   *
   * `WHERE id = ?` sozinho — não há proprietário a checar, ao contrário do lease: a entrada é da
   * chamada que a criou, e ninguém mais grava nela.
   */
  concluir(
    id: string,
    estado: Exclude<EstadoDoEfeito, 'pendente'>,
    externalRefId: string | undefined,
    agora: () => string = () => new Date().toISOString()
  ): void {
    this.db
      .prepare(
        'UPDATE effect_journal SET estado = ?, external_ref_id = ?, updated_at = ? WHERE id = ?'
      )
      .run(estado, externalRefId ?? null, agora(), id)
  }

  buscarPorChave(userId: string, chaveIdempotente: string): EntradaDoDiario | undefined {
    const row = this.db
      .prepare('SELECT * FROM effect_journal WHERE user_id = ? AND chave_idempotente = ?')
      .get(userId, chaveIdempotente) as EffectJournalRow | undefined

    return row === undefined ? undefined : toEntrada(row)
  }

  /** As intenções que nunca chegaram a `confirmed`/`ambiguous`/`failed` — o que a reconciliação lê. */
  listarPendentes(userId: string): readonly EntradaDoDiario[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM effect_journal WHERE user_id = ? AND estado = 'pendente' ORDER BY created_at ASC"
      )
      .all(userId) as EffectJournalRow[]

    return rows.map(toEntrada)
  }
}
