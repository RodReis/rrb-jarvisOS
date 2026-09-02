/**
 * O diário de efeitos contra o SQLite real (SPEC-Entrega-02, § Diário de efeitos; issue #209).
 *
 * Banco real, não dublê: a garantia inteira é o `UNIQUE(user_id, chave_idempotente)`, e um
 * repositório dublado concordaria com qualquer sequência de chamadas — inclusive a que o índice
 * existe para impedir.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database'
import { EffectJournalRepository, type NovaIntencao } from './effect-journal-repository'

const USER = 'u-1'
const WS = 'jarvis'

let dir: string
let db: Db
let repo: EffectJournalRepository

function intencao(over: Partial<NovaIntencao> = {}): NovaIntencao {
  return {
    userId: USER,
    workspaceId: WS,
    chaveIdempotente: 'chave-1',
    fingerprint: 'fp-1',
    alvo: 'github:issues.create',
    correlationId: 'corr-1',
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-effect-journal-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new EffectJournalRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('registrarIntencao', () => {
  it('grava a intenção como pendente antes de qualquer confirmação', () => {
    const resultado = repo.registrarIntencao(intencao())

    if (resultado.tipo !== 'registrada') throw new Error('esperava registrada')
    expect(resultado.entrada.estado).toBe('pendente')
    expect(repo.buscarPorChave(USER, 'chave-1')?.estado).toBe('pendente')
  })

  it('reconhece a repetição: mesma chave, mesmo fingerprint, não duplica linha', () => {
    repo.registrarIntencao(intencao())
    const segunda = repo.registrarIntencao(intencao())

    expect(segunda.tipo).toBe('repetida')
    const total = db.prepare('SELECT COUNT(*) AS n FROM effect_journal').get() as { n: number }
    expect(total.n).toBe(1)
  })

  it('chave igual com payload diferente é conflito — falha antes de qualquer I/O (critério 3)', () => {
    repo.registrarIntencao(intencao({ fingerprint: 'fp-1' }))
    const resultado = repo.registrarIntencao(intencao({ fingerprint: 'fp-2' }))

    expect(resultado.tipo).toBe('conflito')
    if (resultado.tipo === 'conflito') {
      expect(resultado.motivo).toBe('payload-diverge')
      expect(resultado.existente.fingerprint).toBe('fp-1')
    }
    // A linha original não foi tocada pelo conflito.
    const total = db.prepare('SELECT COUNT(*) AS n FROM effect_journal').get() as { n: number }
    expect(total.n).toBe(1)
    expect(repo.buscarPorChave(USER, 'chave-1')?.fingerprint).toBe('fp-1')
  })

  it('a mesma chave em usuários diferentes não colide', () => {
    repo.registrarIntencao(intencao({ userId: 'u-1', fingerprint: 'fp-1' }))
    const outroUsuario = repo.registrarIntencao(
      intencao({ userId: 'u-2', fingerprint: 'fp-diferente' })
    )

    expect(outroUsuario.tipo).toBe('registrada')
  })
})

describe('concluir', () => {
  it('confirma com o ExternalRef, e a entrada sai de pendentes', () => {
    const registrada = repo.registrarIntencao(intencao())
    if (registrada.tipo !== 'registrada') throw new Error('esperava registrada')

    repo.concluir(registrada.entrada.id, 'confirmed', 'ref-externa-7')

    const entrada = repo.buscarPorChave(USER, 'chave-1')
    expect(entrada?.estado).toBe('confirmed')
    expect(entrada?.externalRefId).toBe('ref-externa-7')
    expect(repo.listarPendentes(USER)).toEqual([])
  })

  it('marca ambiguous sem ExternalRef quando a chamada pode ter saído sem confirmar', () => {
    const registrada = repo.registrarIntencao(intencao())
    if (registrada.tipo !== 'registrada') throw new Error('esperava registrada')

    repo.concluir(registrada.entrada.id, 'ambiguous', undefined)

    expect(repo.buscarPorChave(USER, 'chave-1')?.estado).toBe('ambiguous')
  })

  it('marca failed e some de listarPendentes', () => {
    const registrada = repo.registrarIntencao(intencao())
    if (registrada.tipo !== 'registrada') throw new Error('esperava registrada')

    repo.concluir(registrada.entrada.id, 'failed', undefined)

    expect(repo.buscarPorChave(USER, 'chave-1')?.estado).toBe('failed')
    expect(repo.listarPendentes(USER)).toEqual([])
  })
})

describe('listarPendentes', () => {
  it('lista só o que nunca chegou a confirmed/ambiguous/failed', () => {
    const a = repo.registrarIntencao(intencao({ chaveIdempotente: 'a', fingerprint: 'fp-a' }))
    repo.registrarIntencao(intencao({ chaveIdempotente: 'b', fingerprint: 'fp-b' }))
    if (a.tipo !== 'registrada') throw new Error('esperava registrada')
    repo.concluir(a.entrada.id, 'confirmed', undefined)

    const pendentes = repo.listarPendentes(USER)

    expect(pendentes).toHaveLength(1)
    expect(pendentes[0]?.chaveIdempotente).toBe('b')
  })
})
