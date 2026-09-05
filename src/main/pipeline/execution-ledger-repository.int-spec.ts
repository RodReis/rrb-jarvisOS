/**
 * O ledger contra o SQLite real (SPEC-Entrega-06, critérios 1, 2, 5 e 9).
 *
 * Banco real, não dublê: o que se prova aqui é que a prova sobrevive à ida e volta pelo disco —
 * o `UNIQUE(user_id, run_id)` recusando a regravação, o escopo por usuário, e os campos que
 * viram JSON e voltam com a mesma forma. Um repositório dublado devolveria o objeto que recebeu
 * e concordaria com qualquer serialização, inclusive uma que perdesse os artefatos.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'
import type { ArtefatoRetido } from '@shared/domain/retencao'
import { openDatabase } from '../storage/database'
import { ExecutionLedgerRepository } from './execution-ledger-repository'

const USER = 'user-1'
const RUN = 'run-1'

let dir: string
let db: Db
let repo: ExecutionLedgerRepository

function ledger(over: Partial<ExecutionLedger> = {}): ExecutionLedger {
  return {
    runId: RUN,
    userId: USER,
    projectId: 'proj-1',
    estadoFinal: 'MERGED',
    duracaoMs: 1000,
    tentativas: 2,
    tokens: 300,
    creditos: 4,
    custoUsd: 1.25,
    eventos: [{ em: '2026-09-02T00:00:00.000Z', oQue: 'run-iniciado' }],
    headSha: 'a'.repeat(40),
    mergeSha: 'b'.repeat(40),
    checks: [{ nome: 'validacao', conclusao: 'success' }],
    artefatos: [{ nome: 'reports/TESTS.md', hash: 'c'.repeat(64), bytes: 2048 }],
    encerradoEm: '2026-09-02T00:10:00.000Z',
    ...over
  }
}

function artefato(over: Partial<ArtefatoRetido> = {}): ArtefatoRetido {
  return {
    id: 'art-1',
    runId: RUN,
    hash: 'c'.repeat(64),
    bytes: 2048,
    criadoEm: '2026-08-01T00:00:00.000Z',
    fixado: false,
    estadoDoRun: 'MERGED',
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-ledger-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new ExecutionLedgerRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ExecutionLedgerRepository', () => {
  it('grava e lê o ledger inteiro, artefatos e eventos inclusive', () => {
    const original = ledger()
    repo.registrar(original)
    expect(repo.buscar(USER, RUN)).toEqual(original)
  })

  it('devolve undefined quando o run não tem ledger', () => {
    expect(repo.buscar(USER, 'inexistente')).toBeUndefined()
  })

  it('não vaza ledger de outro usuário', () => {
    repo.registrar(ledger())
    expect(repo.buscar('outro-usuario', RUN)).toBeUndefined()
  })

  it('recusa regravar o mesmo run: o ledger é a prova, não um rascunho', () => {
    repo.registrar(ledger())
    expect(() => repo.registrar(ledger({ custoUsd: 99 }))).toThrow()
  })

  /**
   * SPEC-Fases-05, critério 5: provider e modelo sobrevivem à ida e volta ao banco.
   *
   * O teste acima (`grava e lê o ledger inteiro`) já compara o objeto todo, mas o `ledger()` da
   * fixture não traz o par — sem este caso, colunas ausentes no INSERT passariam despercebidas.
   */
  it('grava e lê o provider e o modelo que executaram o run', () => {
    repo.registrar(ledger({ provider: 'claude-code', modelo: 'claude-opus-5' }))

    const lido = repo.buscar(USER, RUN)
    expect(lido?.provider).toBe('claude-code')
    expect(lido?.modelo).toBe('claude-opus-5')
  })

  /**
   * Run gravado antes desta fatia lê de volta **sem** o par, e não com string vazia.
   *
   * É o que sustenta as colunas anuláveis da migração 38: ausência aqui significa "run anterior
   * ao modelo por fase", um fato histórico — e `''` faria o painel exibir um campo vazio como se
   * fosse um modelo sem nome.
   */
  it('preserva a ausência do par em run gravado antes do modelo por fase', () => {
    repo.registrar(ledger({ provider: undefined, modelo: undefined }))

    const lido = repo.buscar(USER, RUN)
    expect(lido?.provider).toBeUndefined()
    expect(lido?.modelo).toBeUndefined()
  })

  it('preserva a ausência de merge SHA em AWAITING_MERGE', () => {
    const esperando = ledger({ estadoFinal: 'AWAITING_MERGE', mergeSha: undefined })
    repo.registrar(esperando)
    const lido = repo.buscar(USER, RUN)
    expect(lido?.mergeSha).toBeUndefined()
    expect(lido?.estadoFinal).toBe('AWAITING_MERGE')
  })

  it('lista os artefatos vivos, na ordem de criação', () => {
    repo.registrarArtefato(USER, artefato({ id: 'novo', criadoEm: '2026-08-10T00:00:00.000Z' }))
    repo.registrarArtefato(USER, artefato({ id: 'velho', criadoEm: '2026-08-01T00:00:00.000Z' }))
    expect(repo.listarArtefatos(USER).map((a) => a.id)).toEqual(['velho', 'novo'])
  })

  it('marca artefato expirado sem apagar a linha — o hash continua sendo prova', () => {
    repo.registrarArtefato(USER, artefato())
    repo.marcarExpirado(USER, 'art-1')

    expect(repo.listarArtefatos(USER)).toHaveLength(0)

    const row = db
      .prepare('SELECT hash, expirado_em FROM artefato_retido WHERE id = ?')
      .get('art-1') as { hash: string; expirado_em: string | null }
    expect(row.expirado_em).not.toBeNull()
    expect(row.hash).toBe('c'.repeat(64))
  })

  it('não expira artefato de outro usuário', () => {
    repo.registrarArtefato(USER, artefato())
    repo.marcarExpirado('outro-usuario', 'art-1')
    expect(repo.listarArtefatos(USER)).toHaveLength(1)
  })

  it('guarda pendência de limpeza para a reconciliação encontrar', () => {
    repo.registrarPendencia(USER, {
      runId: RUN,
      recurso: 'container',
      identificador: 'jarvisos-run-1',
      motivo: 'docker indisponível',
      em: '2026-09-02T00:11:00.000Z'
    })

    const pendencias = repo.listarPendencias(USER)
    expect(pendencias).toHaveLength(1)
    expect(pendencias[0]?.recurso).toBe('container')
    expect(pendencias[0]?.identificador).toBe('jarvisos-run-1')
  })

  it('não vaza pendência de outro usuário', () => {
    repo.registrarPendencia(USER, {
      runId: RUN,
      recurso: 'worktree',
      identificador: 'C:/tmp/wt',
      motivo: 'em uso',
      em: '2026-09-02T00:11:00.000Z'
    })
    expect(repo.listarPendencias('outro-usuario')).toEqual([])
  })
})
