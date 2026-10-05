/**
 * Duas fatias ao mesmo tempo, de ponta a ponta (SPEC-Scheduler-05, PR-C — critérios 1, 2, 4, 5 e 6).
 *
 * Os serviços são os reais, compostos como o `main/index.ts` os compõe (ver `mundo-concorrente.ts`);
 * o que é dublê é o que fica fora do processo: a origem (GitHub, com estado), o Docker e o Git. O
 * que se prova aqui nenhum teste de uma peça só prova: que o pool, a prova de independência, o
 * encadeador, a entrega e a seção crítica do merge **concordam** quando há dois runs vivos.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../../src/main/logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../../src/main/storage/database')
const { criarBase, iniciarProcesso, PROJETO, USER, WS } = await import('./mundo-concorrente')
type Base = ReturnType<typeof criarBase>
type Processo = ReturnType<typeof iniciarProcesso>

let dir: string
let db: Db
let base: Base
let p: Processo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-concorrente-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  base = criarBase(dir, db)
  p = iniciarProcesso(base)
})

afterEach(() => {
  p.matar()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('critérios 1 e 2 — dois PRs, um merge por vez, a segunda fatia rebaseia e revalida', () => {
  it('as duas chegam a PR juntas, mergeiam em série e a segunda entra sobre a base nova', async () => {
    p.ligarParalelismo()
    const a = p.pronto('f1')
    const b = p.pronto('f2')
    // Os dois PRs ficam prontos para o merge ao mesmo tempo; o primeiro entra, o segundo chega
    // depois de a base andar — o instante exato em que a origem exige o rebase.
    const mergeA = p.segurarMerge(a)
    const mergeB = p.segurarMerge(b)

    const execA = p.encadeador.executar(p.pedido(a, ['src/api']))
    const execB = p.encadeador.executar(p.pedido(b, ['src/web']))

    await p.ate(() => base.origem.totalDePrs === 2, 'os dois PRs publicados')
    // Concorrência de verdade: os dois seguram slot, com travas e prova de independência.
    expect(p.leases.listarSlots(USER)).toHaveLength(2)
    expect(p.locks.travasDoRun(a).caminhos).toEqual(['src/api'])
    expect(p.locks.travasDoRun(b).caminhos).toEqual(['src/web'])
    expect(p.locks.provasDoRun(b)[0]).toMatchObject({ independente: true, contra: [a] })

    const baseAntes = base.origem.baseSha
    base.origem.liberarCi(1)
    base.origem.liberarCi(2)
    await mergeA.chegou
    await mergeB.chegou

    mergeA.liberar()
    const resultadoA = await execA
    expect(resultadoA).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    expect(base.origem.baseSha).not.toBe(baseAntes)

    // A segunda avaliou o gate com a base antiga: agora a origem já andou.
    const headAntes = base.origem.prs.get(2)?.headSha
    mergeB.liberar()
    const resultadoB = await execB
    expect(resultadoB).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })

    // Merge serializado: nunca dois na origem ao mesmo tempo, e na ordem em que entraram.
    expect(base.origem.maxMergesEmVoo).toBe(1)
    expect(base.origem.mergesAtrasados).toEqual([])
    expect(base.origem.merges.map((m) => m.numero)).toEqual([1, 2])
    // A segunda rebaseou (a branch recebeu a base nova) e revalidou (o head é outro, e o CI dele
    // fechou antes do merge).
    expect(base.origem.chamadasDe(GITHUB_OPERATIONS.updateBranch)).toHaveLength(1)
    const prB = base.origem.prs.get(2)
    expect(prB?.headSha).not.toBe(headAntes)
    expect(prB?.merged).toBe(true)
    expect(prB?.ciVerde.has(prB.headSha)).toBe(true)
    // E ninguém publicou duas vezes: dois runs, dois PRs, dois merges.
    expect(base.origem.totalDePrs).toBe(2)
    expect(p.efeitos.pushes.map((x) => x.runId).sort()).toEqual([a, b].sort())

    expect(p.estado(a)).toBe('MERGED')
    expect(p.estado(b)).toBe('MERGED')
    expect(p.ledger.buscar(USER, a)?.mergeSha).toBe(base.origem.merges[0]?.mergeSha)
    expect(p.ledger.buscar(USER, b)?.mergeSha).toBe(base.origem.merges[1]?.mergeSha)
    // Critério 6: nada sobrou.
    expect(p.orfaos()).toEqual([])
  })
})

describe('critério 1 — a corrida de verdade: dois PRs verdes ao mesmo tempo, sem ninguém segurando', () => {
  it('a origem nunca vê dois merges juntos, e nenhum PR entra sobre uma base que não continha', async () => {
    p.ligarParalelismo()
    base.origem.ciAutomatico = true
    const a = p.pronto('f1')
    const b = p.pronto('f2')

    const [resultadoA, resultadoB] = await Promise.all([
      p.encadeador.executar(p.pedido(a, ['src/api'])),
      p.encadeador.executar(p.pedido(b, ['src/web']))
    ])

    expect(resultadoA).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    expect(resultadoB).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    // O que a serialização garante é medido na origem, não no código que a implementa.
    expect(base.origem.maxMergesEmVoo).toBe(1)
    expect(base.origem.merges).toHaveLength(2)
    // E nenhum PR entrou sobre uma base que ele não continha: o CI dele nunca viu aquele commit.
    expect(base.origem.mergesAtrasados).toEqual([])
    // Cada merge deixou a base num commit novo; o segundo só entrou sobre o primeiro.
    const [primeiro, segundo] = base.origem.merges
    expect(primeiro?.mergeSha).not.toBe(segundo?.mergeSha)
    expect(base.origem.baseSha).toBe(segundo?.mergeSha)
    expect(p.orfaos()).toEqual([])
  })
})

describe('critério 2 — o PR que já estava aberto atrás da base', () => {
  it('só a comparação com a origem o impede de entrar sem o commit do vizinho', async () => {
    // O caso comum, e o que a base lida duas vezes não vê: o CI da segunda fatia só fecha **depois**
    // do merge da primeira, então a avaliação já lê a base nova — avaliação e lease concordam. O PR,
    // porém, foi aberto antes e não contém aquele commit. O merge autônomo roda como o dono, e a
    // proteção `strict` não barra o admin: quem impede é a pipeline, perguntando à origem.
    p.ligarParalelismo()
    const a = p.pronto('f1')
    const b = p.pronto('f2')
    const execA = p.encadeador.executar(p.pedido(a, ['src/api']))
    const execB = p.encadeador.executar(p.pedido(b, ['src/web']))
    await p.ate(() => base.origem.totalDePrs === 2, 'os dois PRs publicados')
    const prDe = (runId: string): { numero: number; headSha: string } => {
      const pr = [...base.origem.prs.values()].find((x) => p.runsPorBranch.get(x.head) === runId)
      if (pr === undefined) throw new Error('PR do run não encontrado')
      return pr
    }

    base.origem.liberarCi(prDe(a).numero)
    expect(await execA).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    const headAntes = prDe(b).headSha
    base.origem.liberarCi(prDe(b).numero)
    const resultadoB = await execB

    expect(resultadoB).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    expect(base.origem.mergesAtrasados).toEqual([])
    expect(base.origem.chamadasDe(GITHUB_OPERATIONS.updateBranch)).toHaveLength(1)
    // O CI do head novo fechou antes do merge: ela revalidou, não só rebaseou.
    expect(prDe(b).headSha).not.toBe(headAntes)
    expect(p.orfaos()).toEqual([])
  })
})

describe('critério 5 — falsa independência executa em sequência e registra o que não foi provado', () => {
  it('um lockfile comum: a segunda espera a primeira terminar, e a vista diz por quê', async () => {
    p.ligarParalelismo()
    base.origem.ciAutomatico = true
    const a = p.pronto('f1')
    const b = p.pronto('f2')
    const mergeA = p.segurarMerge(a)

    const execA = p.encadeador.executar(p.pedido(a, ['src/api', 'package-lock.json']))
    const execB = p.encadeador.executar(p.pedido(b, ['src/web', 'package-lock.json']))

    await mergeA.chegou
    // Com a primeira no meio do caminho, só um slot existe, e a segunda **não montou nada**.
    expect(p.leases.listarSlots(USER)).toHaveLength(1)
    expect(p.efeitos.pushes.map((x) => x.runId)).toEqual([a])
    expect(base.recursos.vivo(b)).toBe(false)

    // A dimensão não provada fica registrada: o motivo é estruturado e nomeia o recurso.
    const espera = p.pool.vista().fila.find((i) => i.runId === b)
    expect(espera?.motivo).toMatchObject({ tipo: 'sem-prova-de-independencia' })
    expect(JSON.stringify(espera?.motivo)).toContain('lockfile')

    mergeA.liberar()
    await execA
    const resultadoB = await execB

    expect(resultadoB).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })
    // Em sequência de verdade: o primeiro push da segunda é depois do merge da primeira, então ela
    // já nasceu sobre a base nova — nada a rebasear.
    expect(p.efeitos.pushes.map((x) => x.runId)).toEqual([a, b])
    expect(base.origem.chamadasDe(GITHUB_OPERATIONS.updateBranch)).toHaveLength(0)
    expect(base.origem.merges.map((m) => m.numero)).toEqual([1, 2])
    expect(p.orfaos()).toEqual([])
  })
})

describe('critério 4 — cancelar uma fatia não interrompe a outra nem apaga trabalho remoto', () => {
  it('a cancelada vira rascunho e preserva branch e PR; a vizinha segue e mergeia', async () => {
    p.ligarParalelismo()
    const a = p.pronto('f1')
    const b = p.pronto('f2')

    const execA = p.encadeador.executar(p.pedido(a, ['src/api']))
    const execB = p.encadeador.executar(p.pedido(b, ['src/web']))
    await p.ate(() => base.origem.totalDePrs === 2, 'os dois PRs publicados')
    const slotDeB = p.leases.buscarSlotDoRun(USER, b)
    const operacoesAntes = base.origem.chamadas.length

    const cancelado = await p.cancelamento.cancelar(PROJETO, WS, a)
    expect(cancelado).toMatchObject({ cancelado: true, rascunho: 'convertido' })
    const resultadoA = await execA

    // A cancelada: terminal, sem slot, PR **preservado** como rascunho — nada foi fechado nem
    // mergeado, e a branch segue na origem.
    expect(p.estado(a)).toBe('CANCELLED')
    expect(p.leases.buscarSlotDoRun(USER, a)).toBeUndefined()
    const prA = base.origem.prs.get(1)
    expect(prA).toMatchObject({ estado: 'open', merged: false, rascunho: true })
    expect(resultadoA).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'BLOCKED' } })
    // A única operação que saiu para a origem por causa do cancelamento foi o rascunho.
    const depois = base.origem.chamadas.slice(operacoesAntes).map((c) => c.operation)
    expect(depois).toContain(GITHUB_OPERATIONS.convertToDraft)
    expect(depois).not.toContain(GITHUB_OPERATIONS.squashMerge)

    // A vizinha: o mesmo estado, o mesmo slot, o mesmo token — e termina o trabalho.
    expect(p.estado(b)).toBe('PR_CI')
    expect(p.leases.buscarSlotDoRun(USER, b)?.fencingToken).toBe(slotDeB?.fencingToken)
    base.origem.liberarCi(2)
    const resultadoB = await execB
    expect(resultadoB).toMatchObject({ tipo: 'entrega', resultado: { estadoFinal: 'MERGED' } })

    expect(base.origem.merges.map((m) => m.numero)).toEqual([2])
    expect(base.origem.prs.get(1)?.merged).toBe(false)
    expect(p.orfaos()).toEqual([])
  })
})
