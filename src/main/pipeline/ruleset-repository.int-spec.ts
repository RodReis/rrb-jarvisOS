/**
 * O histórico de snapshots do ruleset contra o SQLite real (SPEC-Entrega-05, critério 11).
 *
 * Banco real, não dublê: o que está sendo provado é que a série sobrevive à ida e volta pelo disco
 * — a ordem das observações, o escopo por usuário e o `contexts` que vira JSON e volta lista. Um
 * repositório dublado devolveria o objeto que recebeu e concordaria com qualquer serialização,
 * inclusive uma que perdesse a ordem.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SnapshotDeRuleset } from '@shared/domain/ruleset'
import { openDatabase } from '../storage/database'
import { RulesetRepository, type EscopoDoSnapshot } from './ruleset-repository'

const RUN = 'run-1'
const ESCOPO: EscopoDoSnapshot = { userId: 'u-1', workspaceId: 'jarvis', projectId: 'p-1' }

let dir: string
let db: Db
let repo: RulesetRepository

function snapshot(over: Partial<SnapshotDeRuleset> = {}): SnapshotDeRuleset {
  return {
    runId: RUN,
    branch: 'main',
    contexts: ['validacao'],
    strict: true,
    protegida: true,
    mergeQueueExigida: false,
    ref: 'RodReis/projeto/protection/main',
    observadoEm: '2026-09-02T10:00:00.000Z',
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-ruleset-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new RulesetRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('RulesetRepository', () => {
  it('devolve undefined quando o run ainda não observou a origem', () => {
    expect(repo.ultimo(ESCOPO.userId, RUN)).toBeUndefined()
    expect(repo.todos(ESCOPO.userId, RUN)).toEqual([])
  })

  it('guarda a observação inteira, com contexts, flags e data', () => {
    repo.registrar(
      ESCOPO,
      snapshot({ contexts: ['validacao', 'seguranca'], strict: false, mergeQueueExigida: true })
    )

    expect(repo.ultimo(ESCOPO.userId, RUN)).toEqual({
      runId: RUN,
      branch: 'main',
      contexts: ['validacao', 'seguranca'],
      strict: false,
      protegida: true,
      mergeQueueExigida: true,
      ref: 'RodReis/projeto/protection/main',
      observadoEm: '2026-09-02T10:00:00.000Z'
    })
  })

  it('acumula as observações em vez de sobrescrever — a série é a evidência', () => {
    repo.registrar(ESCOPO, snapshot({ contexts: ['validacao'] }))
    repo.registrar(ESCOPO, snapshot({ contexts: ['validacao', 'seguranca'] }))

    const serie = repo.todos(ESCOPO.userId, RUN)
    expect(serie).toHaveLength(2)
    expect(serie[0]?.contexts).toEqual(['validacao'])
    expect(serie[1]?.contexts).toEqual(['validacao', 'seguranca'])
    expect(repo.ultimo(ESCOPO.userId, RUN)?.contexts).toEqual(['validacao', 'seguranca'])
  })

  it('ordena pela inserção, não pela data — mesmo milissegundo não embaralha', () => {
    // A lição da M8-F02: empate na data deixava o desempate por conta do plano de consulta, e a
    // listagem mudava de ordem entre execuções. `rowid` é a ordem de inserção.
    const mesmoInstante = '2026-09-02T10:00:00.000Z'
    repo.registrar(ESCOPO, snapshot({ contexts: ['primeiro'], observadoEm: mesmoInstante }))
    repo.registrar(ESCOPO, snapshot({ contexts: ['segundo'], observadoEm: mesmoInstante }))
    repo.registrar(ESCOPO, snapshot({ contexts: ['terceiro'], observadoEm: mesmoInstante }))

    expect(repo.todos(ESCOPO.userId, RUN).map((s) => s.contexts[0])).toEqual([
      'primeiro',
      'segundo',
      'terceiro'
    ])
    expect(repo.ultimo(ESCOPO.userId, RUN)?.contexts).toEqual(['terceiro'])
  })

  it('a última observação é a que entrou por último, mesmo com data mais antiga', () => {
    // O caso que separa `rowid` de `observado_em` de verdade. Com datas empatadas, o índice
    // `(user_id, run_id, observado_em)` faz o SQLite varrer na ordem física e os dois critérios
    // coincidem por acidente do plano de consulta — um teste só de empate ficaria verde mesmo
    // ordenando pela data. Aqui as duas ordens **discordam**: a última inserida tem a data mais
    // antiga, e o relógio da origem pode de fato voltar (troca de nó, ajuste de NTP).
    //
    // O que o snapshot afirma é "a última coisa que observamos", não "a de data maior".
    repo.registrar(
      ESCOPO,
      snapshot({ contexts: ['antiga'], observadoEm: '2026-09-02T12:00:00.000Z' })
    )
    repo.registrar(
      ESCOPO,
      snapshot({ contexts: ['recente'], observadoEm: '2026-09-02T09:00:00.000Z' })
    )

    expect(repo.ultimo(ESCOPO.userId, RUN)?.contexts).toEqual(['recente'])
    expect(repo.todos(ESCOPO.userId, RUN).map((s) => s.contexts[0])).toEqual(['antiga', 'recente'])
  })

  it('não mistura snapshot de outro usuário', () => {
    repo.registrar({ ...ESCOPO, userId: 'outro' }, snapshot({ contexts: ['de-outro'] }))

    expect(repo.ultimo(ESCOPO.userId, RUN)).toBeUndefined()
    expect(repo.ultimo('outro', RUN)?.contexts).toEqual(['de-outro'])
  })

  it('não mistura snapshot de outro run do mesmo usuário', () => {
    repo.registrar(ESCOPO, snapshot({ runId: 'run-2', contexts: ['de-outro-run'] }))

    expect(repo.ultimo(ESCOPO.userId, RUN)).toBeUndefined()
    expect(repo.ultimo(ESCOPO.userId, 'run-2')?.contexts).toEqual(['de-outro-run'])
  })

  it('preserva lista vazia de contexts, que não é o mesmo que ausência de snapshot', () => {
    // A diferença é material para o gate: sem snapshot ele nem consultou a origem; com snapshot
    // de lista vazia ele consultou e a origem não exige check nenhum (critério 10).
    repo.registrar(ESCOPO, snapshot({ contexts: [], protegida: false }))

    const ultimo = repo.ultimo(ESCOPO.userId, RUN)
    expect(ultimo).toBeDefined()
    expect(ultimo?.contexts).toEqual([])
    expect(ultimo?.protegida).toBe(false)
  })
})
