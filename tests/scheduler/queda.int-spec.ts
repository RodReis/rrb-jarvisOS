/**
 * A queda do processo em cada fronteira, com duas fatias em voo (SPEC-Scheduler-05, PR-C —
 * critérios 3 e 6).
 *
 * "Cair" aqui é de verdade, no sentido que importa: o processo congela no ponto escolhido (nenhum
 * efeito, nenhuma resposta, nenhum heartbeat depois dele), o relógio avança além da validade dos
 * leases e **outro processo** sobe sobre o mesmo banco, a mesma origem e os mesmos containers — que
 * o Docker mantém de pé, porque a queda do app não os para. É o que o boot real enfrenta.
 *
 * O que se afirma não é "o serviço X chamou Y", e sim o **resultado**: nenhuma fatia com dois
 * merges, nenhuma branch com dois PRs, nenhum run ativo sem dono, e nada órfão ao final.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../../src/main/logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../../src/main/storage/database')
const { criarBase, envelhecer, iniciarProcesso, USER } = await import('./mundo-concorrente')
type Base = ReturnType<typeof criarBase>
type Processo = ReturnType<typeof iniciarProcesso>

/** As fronteiras do caminho de um run, na ordem em que ele as atravessa. */
const FRONTEIRAS = [
  { nome: 'aquisição do slot, antes de montar o sandbox', ponto: 'preflight' },
  { nome: 'execução, no meio da construção', ponto: 'construcao' },
  { nome: 'push feito, PR ainda não aberto', ponto: 'depois:push' },
  { nome: 'PR aberto, antes de olhar o CI', ponto: 'depois:pr.ensure' },
  { nome: 'CI, na primeira consulta', ponto: 'depois:checks.for-head' },
  { nome: 'merge: a tentativa gravada, o efeito ainda não saiu', ponto: 'antes:pr.squash-merge' },
  { nome: 'merge: a origem aplicou, a resposta se perdeu', ponto: 'depois:pr.squash-merge' }
] as const

let dir: string
let db: Db
let base: Base
let p: Processo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-queda-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  base = criarBase(dir, db)
  p = iniciarProcesso(base)
})

afterEach(() => {
  p.matar()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A fatia de cada PR, pela branch que o preflight deu ao run (`feat/<fatia>-<run>`). */
const fatiaDaBranch = (branch: string): string => branch.split('/')[1]?.split('-')[0] ?? ''

describe.each(FRONTEIRAS)('crash em: $nome', ({ ponto }) => {
  it('o boot recupera os dois runs sem duplicar run, PR nem merge, e nada fica órfão', async () => {
    base.origem.ciAutomatico = true
    p.ligarParalelismo()
    const a = p.pronto('f1')
    const b = p.pronto('f2')
    p.matarEm(ponto, a)

    const execucoes = [
      p.encadeador.executar(p.pedido(a, ['src/api'])).catch(() => undefined),
      p.encadeador.executar(p.pedido(b, ['src/web'])).catch(() => undefined)
    ]
    await p.ate(() => p.morto, 'a queda')
    // O processo morto não termina nada: o que ele deixou no meio fica como está.
    void execucoes

    // --- o boot: outro processo, a mesma origem, o mesmo banco, os mesmos containers ---
    envelhecer(base)
    const novo = iniciarProcesso(base)
    await novo.reconciliacao.reconcileAll()

    // Nenhum run ficou ativo sem dono: o que não terminou foi bloqueado com a ação de retomada.
    expect(novo.runs.listarAtivos(USER)).toEqual([])
    // E nada ficou segurando recurso nenhum.
    expect(novo.orfaos()).toEqual([])

    // --- a retomada: o PI manda refazer o que não chegou ao merge ---
    novo.ligarParalelismo()
    const retomadas: string[] = []
    for (const [fatia, run] of [
      ['f1', a],
      ['f2', b]
    ] as const) {
      if (novo.estado(run) === 'MERGED') continue
      expect(novo.estado(run)).toBe('BLOCKED')
      const proximo = novo.pronto(fatia, run)
      retomadas.push(proximo)
      const paths = fatia === 'f1' ? ['src/api'] : ['src/web']
      const r = await novo.encadeador.executar(novo.pedido(proximo, paths))
      expect(r).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    }

    // Cada fatia entrou na base **uma vez**, e cada branch tem um PR só.
    const mergeados = base.origem.merges.map((m) => base.origem.prs.get(m.numero)?.head ?? '')
    expect(mergeados.map(fatiaDaBranch).sort()).toEqual(['f1', 'f2'])
    expect(new Set(base.origem.merges.map((m) => m.numero)).size).toBe(base.origem.merges.length)
    expect(base.origem.maxMergesEmVoo).toBe(1)
    expect(base.origem.mergesAtrasados).toEqual([])
    const cabecas = [...base.origem.prs.values()].map((x) => x.head)
    expect(new Set(cabecas).size).toBe(cabecas.length)

    expect(novo.runs.listarAtivos(USER)).toEqual([])
    expect(novo.orfaos()).toEqual([])
    novo.matar()
  })
})
