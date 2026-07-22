/**
 * Hash-chain do AuditEvent (ADR-004, camada 2: **detectar**).
 *
 * Regra pura: sem Electron, sem SQLite, sem IO — mas **não** mora em `src/shared`, porque
 * usa `node:crypto` e `src/shared` é compilado também para o renderer, que não tem acesso
 * a Node (fronteira de segurança da Fatia 01). O tipo `AuditEvent` fica em shared, onde a
 * UI o consome; a criptografia fica aqui, no main, onde ela pode existir.
 *
 * A chave HMAC **entra por parâmetro**, nunca é lida daqui. Em produção quem a fornece é
 * o `safeStorage`/DPAPI (SPEC-03); em teste, uma chave fixa. Ler `safeStorage` neste
 * módulo o prenderia ao Electron e tornaria o critério de aceite 3 (forja ao vivo →
 * `verifyChain` acusa) impossível de testar sem subir o app inteiro.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuditEvent } from '@shared/domain/entities'

/** `prev_hash` do primeiro evento de cada usuário. Fixo e público — não é segredo. */
export const GENESIS_HASH = 'genesis'

/** O que entra no HMAC. Subconjunto do evento: tudo menos o próprio `hash`. */
export type ChainableEvent = Omit<AuditEvent, 'hash'>

/**
 * Serialização canônica — a mesma entrada tem de produzir sempre os mesmos bytes, ou a
 * recomputação falharia contra um evento honesto.
 *
 * Por isso: ordem de campos fixa (não a de inserção), chaves do `payload` ordenadas, e
 * separador `\n` que não pode aparecer nos valores escapados pelo `JSON.stringify`.
 * `workspace_id` ausente vira string vazia em vez de sumir do texto — senão um evento sem
 * workspace e outro com `workspace_id: ''` gerariam o mesmo hash.
 */
export function canonicalize(event: ChainableEvent): string {
  return [
    event.user_id,
    event.workspace_id ?? '',
    event.type,
    stableStringify(event.payload),
    event.created_at,
    String(event.seq),
    event.prev_hash
  ].join('\n')
}

/** `JSON.stringify` com chaves ordenadas em qualquer profundidade. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)

  return `{${entries.join(',')}}`
}

/** HMAC-SHA-256 do conteúdo canônico. A chave é o que impede recomputar a cadeia forjada. */
export function computeHash(event: ChainableEvent, key: Buffer | string): string {
  return createHmac('sha256', key).update(canonicalize(event), 'utf8').digest('hex')
}

/**
 * Compara hashes sem vazar, pelo tempo de resposta, *onde* eles divergem.
 *
 * Num app local-first o ganho é modesto, mas comparar segredo derivado com `===` é o tipo
 * de detalhe que vira hábito — e o custo aqui é uma linha.
 */
function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** O que `verifyChain` devolve: íntegra, ou a primeira quebra encontrada. */
export type ChainVerification =
  | { readonly ok: true; readonly checked: number }
  | {
      readonly ok: false
      readonly checked: number
      /** `seq` do primeiro evento quebrado. */
      readonly brokenAt: number
      readonly reason: 'hash-invalido' | 'prev-hash-nao-encadeia' | 'seq-fora-de-ordem'
      readonly detail: string
    }

/**
 * Re-caminha a cadeia de um usuário e recomputa cada elo, reportando a **primeira** quebra.
 *
 * Detecta as três formas de adulterar: conteúdo editado (o `hash` deixa de bater), evento
 * removido ou reordenado (o `seq` pula), e cadeia recortada (o `prev_hash` não aponta para
 * o elo anterior). Espera os eventos ordenados por `seq` — quem chama vem do `ORDER BY`.
 */
export function verifyChain(
  events: readonly AuditEvent[],
  key: Buffer | string
): ChainVerification {
  let prevHash = GENESIS_HASH
  let expectedSeq = 1

  for (const event of events) {
    if (event.seq !== expectedSeq) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAt: event.seq,
        reason: 'seq-fora-de-ordem',
        detail: `esperado seq ${expectedSeq}, encontrado ${event.seq} — evento removido ou reordenado`
      }
    }

    if (event.prev_hash !== prevHash) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAt: event.seq,
        reason: 'prev-hash-nao-encadeia',
        detail: `prev_hash do evento ${event.seq} não aponta para o hash do anterior`
      }
    }

    const { hash, ...chainable } = event
    if (!hashesEqual(hash, computeHash(chainable, key))) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAt: event.seq,
        reason: 'hash-invalido',
        detail: `conteúdo do evento ${event.seq} foi alterado após a gravação`
      }
    }

    prevHash = event.hash
    expectedSeq += 1
  }

  return { ok: true, checked: events.length }
}
