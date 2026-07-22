import { describe, expect, it } from 'vitest'
import {
  GENESIS_HASH,
  canonicalize,
  computeHash,
  verifyChain,
  type ChainableEvent
} from './audit-chain'
import type { AuditEvent } from '@shared/domain/entities'

const CHAVE = 'chave-de-teste-nao-usada-em-producao'

/** Monta uma cadeia válida de N eventos, como o repositório faria. */
function cadeia(quantidade: number, chave: string | Buffer = CHAVE): AuditEvent[] {
  const eventos: AuditEvent[] = []
  let prev = GENESIS_HASH

  for (let i = 1; i <= quantidade; i += 1) {
    const semHash: ChainableEvent = {
      id: `evt-${i}`,
      user_id: 'u-1',
      type: 'login',
      payload: { tentativa: i },
      created_at: `2026-07-22T10:0${i}:00.000Z`,
      seq: i,
      prev_hash: prev
    }
    const hash = computeHash(semHash, chave)
    eventos.push({ ...semHash, hash })
    prev = hash
  }

  return eventos
}

describe('canonicalize', () => {
  it('produz a mesma saída independentemente da ordem das chaves do payload', () => {
    // Se a serialização dependesse da ordem de inserção, um evento honesto falharia na
    // recomputação só por ter sido remontado a partir do JSON do banco.
    const base = {
      id: 'e',
      user_id: 'u',
      type: 'login' as const,
      created_at: '2026-07-22T10:00:00.000Z',
      seq: 1,
      prev_hash: GENESIS_HASH
    }

    expect(canonicalize({ ...base, payload: { a: 1, b: 2 } })).toBe(
      canonicalize({ ...base, payload: { b: 2, a: 1 } })
    )
  })

  it('distingue workspace ausente de workspace vazio', () => {
    const base = {
      id: 'e',
      user_id: 'u',
      type: 'login' as const,
      payload: {},
      created_at: '2026-07-22T10:00:00.000Z',
      seq: 1,
      prev_hash: GENESIS_HASH
    }

    // Sem o placeholder, os dois colapsariam no mesmo texto — e no mesmo hash.
    expect(canonicalize(base)).toBe(canonicalize({ ...base }))
    expect(canonicalize({ ...base, workspace_id: 'noa' })).not.toBe(canonicalize(base))
  })

  it('ordena chaves aninhadas em qualquer profundidade', () => {
    const base = {
      id: 'e',
      user_id: 'u',
      type: 'login' as const,
      created_at: '2026-07-22T10:00:00.000Z',
      seq: 1,
      prev_hash: GENESIS_HASH
    }

    expect(canonicalize({ ...base, payload: { x: { a: 1, b: 2 } } })).toBe(
      canonicalize({ ...base, payload: { x: { b: 2, a: 1 } } })
    )
  })
})

describe('computeHash', () => {
  it('muda quando qualquer campo do conteúdo muda', () => {
    const [evento] = cadeia(1)
    const { hash, ...base } = evento!

    expect(computeHash({ ...base, type: 'logout' }, CHAVE)).not.toBe(hash)
    expect(computeHash({ ...base, payload: { outro: true } }, CHAVE)).not.toBe(hash)
    expect(computeHash({ ...base, seq: 99 }, CHAVE)).not.toBe(hash)
  })

  it('muda quando a chave muda — é HMAC, não hash puro', () => {
    // O ponto do ADR-004: sem a chave, quem editar uma linha não recomputa a cadeia.
    const [evento] = cadeia(1)
    const { hash, ...base } = evento!

    expect(computeHash(base, 'outra-chave')).not.toBe(hash)
  })
})

describe('verifyChain', () => {
  it('aceita uma cadeia íntegra', () => {
    const resultado = verifyChain(cadeia(5), CHAVE)

    expect(resultado).toEqual({ ok: true, checked: 5 })
  })

  it('aceita cadeia vazia', () => {
    expect(verifyChain([], CHAVE)).toEqual({ ok: true, checked: 0 })
  })

  it('acusa conteúdo adulterado, apontando o primeiro evento quebrado', () => {
    // Critério de aceite 3 da SPEC-04, na forma pura: alterar o payload sem poder
    // recomputar o hash (não se tem a chave) deixa a cadeia detectavelmente quebrada.
    const eventos = cadeia(4)
    eventos[2] = { ...eventos[2]!, payload: { tentativa: 'forjado' } }

    const resultado = verifyChain(eventos, CHAVE)

    expect(resultado.ok).toBe(false)
    expect(resultado).toMatchObject({ brokenAt: 3, reason: 'hash-invalido', checked: 2 })
  })

  it('acusa evento removido pelo salto no seq', () => {
    const eventos = cadeia(4)
    eventos.splice(1, 1)

    const resultado = verifyChain(eventos, CHAVE)

    expect(resultado).toMatchObject({ ok: false, brokenAt: 3, reason: 'seq-fora-de-ordem' })
  })

  it('acusa cadeia recortada pelo prev_hash que não encadeia', () => {
    const eventos = cadeia(3)
    eventos[1] = { ...eventos[1]!, prev_hash: 'hash-inventado' }

    const resultado = verifyChain(eventos, CHAVE)

    expect(resultado).toMatchObject({ ok: false, brokenAt: 2, reason: 'prev-hash-nao-encadeia' })
  })

  it('acusa a cadeia inteira quando verificada com a chave errada', () => {
    const resultado = verifyChain(cadeia(3), 'chave-do-atacante')

    expect(resultado).toMatchObject({ ok: false, brokenAt: 1, reason: 'hash-invalido' })
  })

  it('rejeita cadeia que não começa no genesis', () => {
    const eventos = cadeia(2)
    eventos[0] = { ...eventos[0]!, prev_hash: 'nao-genesis' }

    expect(verifyChain(eventos, CHAVE)).toMatchObject({
      ok: false,
      brokenAt: 1,
      reason: 'prev-hash-nao-encadeia'
    })
  })
})
