/**
 * O prompt e o brief contra o SQLite real (SPEC-Jornada-02, § Banco).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o repositório devolver o objeto —
 * o banco tem de confirmar o que ficou gravado.
 *
 * As garantias que só este nível alcança:
 *  - **Append-only por ausência de método.** Editar o prompt insere outra linha; a anterior
 *    continua lá. É o que sustenta "reproduzir qual revisão o PI aceitou" (critério 4).
 *  - **O `hash` UNIQUE do brief** reconhece que regerar sem mudar nada é o mesmo brief.
 *  - **`marcarCommit` não toca conteúdo nem hash** — a linha continua descrevendo o que foi
 *    gravado, e ganha só o ponteiro para a revisão.
 *  - **JSON corrompido vira lista vazia visível**, não exceção nem silêncio.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Afirmacao } from '@shared/domain/brief'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { BriefRepository } = await import('./brief-repository')
const { blocosEmAberto } = await import('@shared/domain/brief')

const USER = 'u-1'
const PROJETO = 'p-1'
const WS = 'jarvis' as const

let dir: string
let db: Db
let repo: InstanceType<typeof BriefRepository>

function prompt(
  over: Record<string, unknown> = {}
): Parameters<InstanceType<typeof BriefRepository>['registrarPrompt']>[0] {
  return {
    id: 'pr-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    texto: 'Quero um app que organize minhas leituras.',
    hash: 'h'.repeat(64),
    commitHash: null,
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  }
}

function afirmacao(over: Partial<Afirmacao> = {}): Afirmacao {
  return {
    id: 'a-1',
    bloco: 'problema-usuarios-resultado',
    texto: 'O usuário é um leitor que perde o fio das leituras.',
    origem: 'prompt',
    ...over
  }
}

function brief(
  over: Record<string, unknown> = {}
): Parameters<InstanceType<typeof BriefRepository>['registrarBrief']>[0] {
  return {
    id: 'b-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    promptId: 'pr-1',
    afirmacoes: [afirmacao()],
    pendencias: [],
    hash: 'b'.repeat(64),
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-03T10:05:00.000Z',
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-brief-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new BriefRepository(db)
  logCat.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('prompt do PI', () => {
  it('grava e lê o texto exatamente como o PI escreveu', () => {
    repo.registrarPrompt(prompt())

    expect(repo.promptVigente(USER, PROJETO)?.texto).toBe(
      'Quero um app que organize minhas leituras.'
    )
  })

  it('editar o prompt insere outra linha e preserva a anterior', () => {
    // Append-only por ausência de método: não há `update`, então a revisão antiga sobrevive.
    repo.registrarPrompt(prompt())
    repo.registrarPrompt(
      prompt({ id: 'pr-2', texto: 'Outro rumo.', created_at: '2026-09-03T11:00:00.000Z' })
    )

    expect(repo.listarPrompts(USER, PROJETO)).toHaveLength(2)
    expect(repo.promptVigente(USER, PROJETO)?.texto).toBe('Outro rumo.')
  })

  it('projeto sem prompt devolve undefined em vez de estourar', () => {
    expect(repo.promptVigente(USER, 'nao-existe')).toBeUndefined()
  })

  it('marcarCommit aponta a revisão sem tocar texto nem hash', () => {
    repo.registrarPrompt(prompt())
    repo.marcarCommitDoPrompt(USER, 'pr-1', 'abc1234')

    const vigente = repo.promptVigente(USER, PROJETO)
    expect(vigente?.commitHash).toBe('abc1234')
    expect(vigente?.texto).toBe('Quero um app que organize minhas leituras.')
    expect(vigente?.hash).toBe('h'.repeat(64))
  })
})

describe('brief gerado', () => {
  it('grava as afirmações com a origem de cada uma', () => {
    repo.registrarBrief(
      brief({
        afirmacoes: [
          afirmacao({ id: 'a-1', origem: 'prompt' }),
          afirmacao({ id: 'a-2', origem: 'decisao', referencia: 'd-9' }),
          afirmacao({ id: 'a-3', origem: 'proposto' })
        ]
      })
    )

    const lido = repo.briefVigente(USER, PROJETO)
    expect(lido?.afirmacoes.map((a) => a.origem)).toEqual(['prompt', 'decisao', 'proposto'])
    expect(lido?.afirmacoes[1]?.referencia).toBe('d-9')
  })

  it('guarda a procedência: qual prompt e qual pacote de contexto', () => {
    // Sem isso, um brief seria texto sem origem — e o critério 7 pede reproduzir o que foi
    // enviado ao modelo.
    repo.registrarBrief(brief())

    const lido = repo.briefVigente(USER, PROJETO)
    expect(lido?.promptId).toBe('pr-1')
    expect(lido?.contextPackId).toBe('pack-1')
  })

  it('o hash é UNIQUE — regerar o mesmo conteúdo não cria revisão nova', () => {
    repo.registrarBrief(brief())

    expect(() => repo.registrarBrief(brief({ id: 'b-2' }))).toThrow()
  })

  it('conteúdo diferente gera revisão nova', () => {
    repo.registrarBrief(brief())
    repo.registrarBrief(
      brief({
        id: 'b-2',
        hash: 'c'.repeat(64),
        created_at: '2026-09-03T11:00:00.000Z',
        afirmacoes: [afirmacao({ texto: 'Outra leitura do problema.' })]
      })
    )

    expect(repo.listarBriefs(USER, PROJETO)).toHaveLength(2)
    expect(repo.briefVigente(USER, PROJETO)?.id).toBe('b-2')
  })

  it('acha o brief pelo hash — é como a invalidação de gate o compara', () => {
    repo.registrarBrief(brief())

    expect(repo.findBriefByHash(USER, 'b'.repeat(64))?.id).toBe('b-1')
    expect(repo.findBriefByHash(USER, 'z'.repeat(64))).toBeUndefined()
  })

  it('grava pendências, distinguindo material de não material', () => {
    repo.registrarBrief(
      brief({
        pendencias: [
          { bloco: 'dominio-e-dados', pergunta: 'Qual base?', material: true },
          { bloco: 'riscos-e-decisoes-abertas', pergunta: 'Qual SLA?', material: false }
        ]
      })
    )

    const lido = repo.briefVigente(USER, PROJETO)
    expect(lido?.pendencias.map((p) => p.material)).toEqual([true, false])
  })
})

describe('resiliência de leitura', () => {
  it('JSON corrompido vira lista vazia, não exceção', () => {
    repo.registrarBrief(brief())
    db.prepare('UPDATE project_brief SET afirmacoes = ? WHERE id = ?').run('{quebrado', 'b-1')

    const lido = repo.briefVigente(USER, PROJETO)

    expect(lido?.afirmacoes).toEqual([])
    expect(logCat.warn).toHaveBeenCalled()
  })

  it('e a lista vazia é visível: o brief corrompido pede regeneração, não passa em silêncio', () => {
    // A diferença que importa em relação a `parseRespostas`: lá o rascunho perdido é invisível.
    // Aqui, um brief sem afirmação nenhuma acusa os dez blocos descobertos e não passa no gate.
    repo.registrarBrief(brief())
    db.prepare('UPDATE project_brief SET afirmacoes = ? WHERE id = ?').run('{quebrado', 'b-1')

    const lido = repo.briefVigente(USER, PROJETO)!
    expect(blocosEmAberto(lido)).toHaveLength(10)
  })

  it('escopo por usuário: o brief de outro usuário não vaza', () => {
    repo.registrarBrief(brief())

    expect(repo.briefVigente('outro-usuario', PROJETO)).toBeUndefined()
  })
})
