/**
 * A persistência do PRD contra o SQLite real (SPEC-Jornada-03).
 *
 * O que este nível prova, e nenhum outro: que a tabela **é** append-only na prática, que o hash
 * UNIQUE reconhece conteúdo idêntico, e que uma linha corrompida não impede o PI de reabrir o
 * projeto — os três são decisões de desenho que só o banco confirma.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrdRegistrado } from '@shared/domain/prd'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { PrdRepository } = await import('./prd-repository')

const USER = 'u-1'
const PROJETO = 'p-1'

let dir: string
let db: Db
let repo: InstanceType<typeof PrdRepository>

function revisao(over: Partial<PrdRegistrado> = {}): PrdRegistrado {
  return {
    id: 'r-1',
    user_id: USER,
    workspace_id: 'jarvis',
    projectId: PROJETO,
    briefHash: 'hash-do-brief',
    afirmacoes: [
      {
        id: 'a-1',
        documento: 'PRD',
        secao: 'Escopo',
        texto: 'Organiza leituras.',
        origem: 'brief',
        referencia: 'b-1'
      }
    ],
    contradicoes: [],
    hash: 'h-1',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-prd-repo-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new PrdRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('PrdRepository', () => {
  it('grava e devolve a revisão inteira, com origem por afirmação', () => {
    repo.registrar(revisao())

    const lida = repo.vigente(USER, PROJETO)

    expect(lida?.afirmacoes[0]?.origem).toBe('brief')
    expect(lida?.afirmacoes[0]?.referencia).toBe('b-1')
  })

  it('conteúdo idêntico é a mesma revisão: devolve a existente, sem estourar no UNIQUE', () => {
    const primeira = repo.registrar(revisao())
    const segunda = repo.registrar(revisao({ id: 'r-2' }))

    expect(segunda.id).toBe(primeira.id)
    expect(repo.listar(USER, PROJETO)).toHaveLength(1)
  })

  it('conteúdo diferente cria revisão nova, sem apagar a anterior — append-only', () => {
    repo.registrar(revisao())
    repo.registrar(revisao({ id: 'r-2', hash: 'h-2', created_at: '2026-09-03T11:00:00.000Z' }))

    expect(repo.listar(USER, PROJETO)).toHaveLength(2)
    expect(repo.vigente(USER, PROJETO)?.id).toBe('r-2')
  })

  it('guarda o bloqueio do Landscape com os cinco campos', () => {
    repo.registrar(
      revisao({
        bloqueioDoLandscape: {
          causa: 'sem-termo-de-pesquisa',
          evidencia: 'Nenhum termo confirmado.',
          tentativas: 0,
          porQueNaoSeguir: 'Sem fonte não há o que afirmar.',
          retomada: 'Confirme um termo.'
        }
      })
    )

    expect(repo.vigente(USER, PROJETO)?.bloqueioDoLandscape?.retomada).toBe('Confirme um termo.')
  })

  it('sem bloqueio, o campo fica ausente — não `null` disfarçado de objeto', () => {
    repo.registrar(revisao())

    expect(repo.vigente(USER, PROJETO)?.bloqueioDoLandscape).toBeUndefined()
  })

  it('marcarCommit aponta para o Git sem tocar conteúdo nem hash', () => {
    repo.registrar(revisao())
    repo.marcarCommit(USER, 'r-1', 'abc1234')

    const lida = repo.vigente(USER, PROJETO)

    expect(lida?.commitHash).toBe('abc1234')
    expect(lida?.hash).toBe('h-1')
    expect(lida?.afirmacoes).toHaveLength(1)
  })

  it('JSON corrompido devolve lista vazia em vez de impedir a leitura do projeto', () => {
    repo.registrar(revisao())
    db.prepare("UPDATE project_prd SET afirmacoes = 'não é json'").run()

    const lida = repo.vigente(USER, PROJETO)

    // A lista vazia é **visível**: um PRD sem afirmação nenhuma pede regeneração na tela, e o
    // que se evita aqui é o projeto ficar impossível de abrir.
    expect(lida?.afirmacoes).toEqual([])
    expect(lida?.hash).toBe('h-1')
  })

  it('o escopo é por usuário: outro user_id não enxerga a revisão', () => {
    repo.registrar(revisao())

    expect(repo.vigente('outro', PROJETO)).toBeUndefined()
    expect(repo.findByHash('outro', 'h-1')).toBeUndefined()
  })
})
