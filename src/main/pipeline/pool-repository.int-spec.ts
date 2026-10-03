import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { CONFIG_PADRAO } from '@shared/domain/pool'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { PoolRepository } = await import('./pool-repository')
const { LeaseRepository } = await import('./lease-repository')
const { PipelineRepository } = await import('./pipeline-repository')

const USER = 'u-1'
const OUTRO = 'u-2'
const AGORA = 1_700_000_000_000

let dir: string
let db: Db
let pool: InstanceType<typeof PoolRepository>
let leases: InstanceType<typeof LeaseRepository>
let runs: InstanceType<typeof PipelineRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pool-'))
  db = openDatabase(join(dir, 'teste.db'))
  pool = new PoolRepository(db)
  leases = new LeaseRepository(db)
  runs = new PipelineRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const item = (runId: string, projectId = 'p-a') => ({
  runId,
  workspaceId: 'jarvis' as const,
  projectId,
  sliceId: `s-${runId}`,
  prioridade: 1
})

describe('configuração', () => {
  it('sem nada gravado, é a padrão: dois slots e o paralelismo desligado', () => {
    expect(pool.config(USER)).toEqual(CONFIG_PADRAO)
    expect(pool.config(USER).paralelismo).toBe(false)
  })

  it('grava e lê por usuário', () => {
    pool.definirConfig(
      USER,
      { ...CONFIG_PADRAO, paralelismo: true, porExecutor: { codex: 1 } },
      AGORA
    )
    expect(pool.config(USER)).toMatchObject({ paralelismo: true, porExecutor: { codex: 1 } })
    expect(pool.config(OUTRO)).toEqual(CONFIG_PADRAO)
  })

  it('regravar substitui, não duplica', () => {
    pool.definirConfig(USER, CONFIG_PADRAO, AGORA)
    pool.definirConfig(USER, { ...CONFIG_PADRAO, capacidadeGlobal: 3 }, AGORA + 1)
    expect(pool.config(USER).capacidadeGlobal).toBe(3)
    expect((db.prepare('SELECT COUNT(*) AS n FROM pool_config').get() as { n: number }).n).toBe(1)
  })

  it('configuração corrompida ou inválida cai no padrão seguro, nunca abre o paralelismo', () => {
    db.prepare('INSERT INTO pool_config (user_id, config, updated_at) VALUES (?, ?, ?)').run(
      USER,
      'não é json',
      'x'
    )
    expect(pool.config(USER)).toEqual(CONFIG_PADRAO)

    db.prepare('UPDATE pool_config SET config = ? WHERE user_id = ?').run(
      JSON.stringify({ capacidadeGlobal: 99, maxPorProjeto: 1, paralelismo: true }),
      USER
    )
    expect(pool.config(USER)).toEqual(CONFIG_PADRAO)
  })
})

describe('fila persistida — critério 3', () => {
  it('enfileirar é idempotente: o retry devolve a mesma linha, com a idade original', () => {
    const a = pool.enfileirar(USER, item('r1'), AGORA)
    const b = pool.enfileirar(USER, item('r1'), AGORA + 60_000)

    expect(b).toEqual(a)
    expect(b.enfileiradoEm).toBe(AGORA)
    expect((db.prepare('SELECT COUNT(*) AS n FROM pool_fila').get() as { n: number }).n).toBe(1)
  })

  it('devolve quem espera na ordem de chegada, só do usuário', () => {
    pool.enfileirar(USER, item('r2'), AGORA + 2)
    pool.enfileirar(USER, item('r1'), AGORA + 1)
    pool.enfileirar(OUTRO, item('x1'), AGORA)

    expect(pool.esperando(USER).map((i) => i.runId)).toEqual(['r1', 'r2'])
  })

  it('guarda executor e classe', () => {
    pool.enfileirar(USER, { ...item('r1'), executor: 'codex', classe: 'docker' }, AGORA)
    expect(pool.buscarItem('r1')).toMatchObject({ executor: 'codex', classe: 'docker' })
  })

  it('adquirir tira da fila e cancelar também; um run adquirido não volta a esperar', () => {
    pool.enfileirar(USER, item('r1'), AGORA)
    pool.enfileirar(USER, item('r2'), AGORA)

    expect(pool.marcarAdquirido('r1', AGORA + 5)).toBe(true)
    expect(pool.marcarAdquirido('r1', AGORA + 6)).toBe(false)
    expect(pool.cancelar('r2', AGORA + 7)).toBe(true)
    expect(pool.cancelar('r2', AGORA + 8)).toBe(false)

    pool.enfileirar(USER, item('r1'), AGORA + 9)
    expect(pool.esperando(USER)).toEqual([])
    expect(pool.buscarItem('r1')?.estado).toBe('adquirido')
    expect(pool.buscarItem('r2')?.estado).toBe('cancelado')
  })

  it('o motivo de espera é gravado, lido de volta e só reescrito quando muda', () => {
    pool.enfileirar(USER, item('r1'), AGORA)
    const motivo = { tipo: 'limite-global', ocupados: 2, limite: 2 } as const

    pool.atualizarMotivo('r1', motivo, AGORA + 10)
    expect(pool.buscarItem('r1')?.motivo).toEqual(motivo)
    const antes = (
      db.prepare('SELECT atualizado_em FROM pool_fila WHERE run_id = ?').get('r1') as {
        atualizado_em: number
      }
    ).atualizado_em

    pool.atualizarMotivo('r1', motivo, AGORA + 99)
    const depois = (
      db.prepare('SELECT atualizado_em FROM pool_fila WHERE run_id = ?').get('r1') as {
        atualizado_em: number
      }
    ).atualizado_em
    expect(depois).toBe(antes)

    pool.atualizarMotivo('r1', { tipo: 'sem-prova-de-independencia' }, AGORA + 100)
    expect(pool.buscarItem('r1')?.motivo).toEqual({ tipo: 'sem-prova-de-independencia' })
  })

  it('motivo ilegível no banco não derruba a leitura', () => {
    pool.enfileirar(USER, item('r1'), AGORA)
    db.prepare("UPDATE pool_fila SET motivo = 'lixo' WHERE run_id = 'r1'").run()
    expect(pool.buscarItem('r1')?.motivo).toBeUndefined()
  })

  it('reabrir o banco preserva fila, posição e motivo', () => {
    pool.enfileirar(USER, item('r1'), AGORA)
    pool.enfileirar(USER, item('r2'), AGORA + 1)
    pool.atualizarMotivo('r2', { tipo: 'paralelismo-desligado', ocupados: 1 }, AGORA + 2)
    pool.registrarVez(USER, 'p-a', AGORA + 3)
    db.close()

    db = openDatabase(join(dir, 'teste.db'))
    const reaberto = new PoolRepository(db)
    expect(reaberto.esperando(USER).map((i) => i.runId)).toEqual(['r1', 'r2'])
    expect(reaberto.buscarItem('r2')?.motivo).toEqual({
      tipo: 'paralelismo-desligado',
      ocupados: 1
    })
    expect(reaberto.vezes(USER)).toEqual({ 'p-a': AGORA + 3 })
  })
})

describe('itens dos escritores de um run', () => {
  it('lista os escritores do run, e só deles', () => {
    pool.enfileirar(USER, item('r1'), AGORA)
    pool.enfileirar(USER, item('r1:api'), AGORA)
    pool.enfileirar(USER, item('r1:ui'), AGORA)
    pool.enfileirar(USER, item('r2:api'), AGORA)

    expect(
      pool
        .itensDoGrupo(USER, 'r1')
        .map((i) => i.runId)
        .sort()
    ).toEqual(['r1:api', 'r1:ui'])
  })

  it('o run cujo id tem ":" não puxa o escritor de outro run', () => {
    pool.enfileirar(USER, item('x:y:esc'), AGORA)
    pool.enfileirar(USER, item('x:esc'), AGORA)

    expect(pool.itensDoGrupo(USER, 'x').map((i) => i.runId)).toEqual(['x:esc'])
    expect(pool.itensDoGrupo(USER, 'x:y').map((i) => i.runId)).toEqual(['x:y:esc'])
  })

  it('não vaza o item de outro usuário', () => {
    pool.enfileirar(USER, item('r1:api'), AGORA)

    expect(pool.itensDoGrupo('u-outro', 'r1')).toEqual([])
  })

  it('o prefixo é literal: % e _ no id do run não casam outros', () => {
    pool.enfileirar(USER, item('r_1:api'), AGORA)
    pool.enfileirar(USER, item('rx1:api'), AGORA)

    expect(pool.itensDoGrupo(USER, 'r_1').map((i) => i.runId)).toEqual(['r_1:api'])
  })
})

describe('a vez de cada projeto', () => {
  it('registrar atualiza, não duplica, e é por usuário', () => {
    pool.registrarVez(USER, 'p-a', AGORA)
    pool.registrarVez(USER, 'p-a', AGORA + 10)
    pool.registrarVez(USER, 'p-b', AGORA + 5)
    pool.registrarVez(OUTRO, 'p-a', AGORA + 99)

    expect(pool.vezes(USER)).toEqual({ 'p-a': AGORA + 10, 'p-b': AGORA + 5 })
    expect(pool.vezes(OUTRO)).toEqual({ 'p-a': AGORA + 99 })
  })
})

describe('fencing token — monotônico e nunca reutilizado', () => {
  it('só cresce, de um em um, por usuário', () => {
    expect([pool.proximoToken(USER), pool.proximoToken(USER), pool.proximoToken(USER)]).toEqual([
      1, 2, 3
    ])
    expect(pool.proximoToken(OUTRO)).toBe(1)
  })

  it('sobrevive à liberação do lease e ao reinício', () => {
    const t1 = pool.proximoToken(USER)
    leases.adquirir(USER, { proprietario: 'r1', recurso: 'wip:slot:1', fencingToken: t1 }, AGORA)
    leases.liberarSlot(USER, 'wip:slot:1', 'r1', t1)
    db.close()

    db = openDatabase(join(dir, 'teste.db'))
    expect(new PoolRepository(db).proximoToken(USER)).toBe(t1 + 1)
  })
})

describe('leases dos slots', () => {
  it('o token fica no lease; leases fora do pool não têm token', () => {
    const slot = leases.adquirir(
      USER,
      { proprietario: 'r1', recurso: 'wip:slot:1', fencingToken: 7 },
      AGORA
    )
    const wt = leases.adquirir(USER, { proprietario: 'r1', recurso: 'worktree:r1' }, AGORA)

    expect(slot?.fencingToken).toBe(7)
    expect(leases.buscar(USER, 'wip:slot:1')?.fencingToken).toBe(7)
    expect(wt?.fencingToken).toBeUndefined()
    expect(leases.buscar(USER, 'worktree:r1')?.fencingToken).toBeUndefined()
  })

  it('cada slot é um recurso: o mesmo slot não é adquirido duas vezes, slots diferentes sim', () => {
    expect(
      leases.adquirir(USER, { proprietario: 'r1', recurso: 'wip:slot:1', fencingToken: 1 }, AGORA)
    ).toBeDefined()
    expect(
      leases.adquirir(USER, { proprietario: 'r2', recurso: 'wip:slot:1', fencingToken: 2 }, AGORA)
    ).toBeUndefined()
    expect(
      leases.adquirir(USER, { proprietario: 'r2', recurso: 'wip:slot:2', fencingToken: 2 }, AGORA)
    ).toBeDefined()
  })

  it('lista só os slots e acha o slot de um run', () => {
    leases.adquirir(USER, { proprietario: 'r1', recurso: 'wip:slot:2', fencingToken: 1 }, AGORA)
    leases.adquirir(USER, { proprietario: 'r1', recurso: 'worktree:r1' }, AGORA)
    leases.adquirir(USER, { proprietario: 'r2', recurso: 'wip:slot:1', fencingToken: 2 }, AGORA + 1)
    leases.adquirir(OUTRO, { proprietario: 'x', recurso: 'wip:slot:1', fencingToken: 1 }, AGORA)

    expect(leases.listarSlots(USER).map((l) => l.recurso)).toEqual(['wip:slot:2', 'wip:slot:1'])
    expect(leases.buscarSlotDoRun(USER, 'r1')?.recurso).toBe('wip:slot:2')
    expect(leases.buscarSlotDoRun(USER, 'r9')).toBeUndefined()
  })

  it('renovar e liberar o slot exigem o token vigente', () => {
    leases.adquirir(USER, { proprietario: 'r1', recurso: 'wip:slot:1', fencingToken: 5 }, AGORA)

    expect(leases.renovarSlot(USER, 'wip:slot:1', 'r1', 4, AGORA + 10)).toBe(false)
    expect(leases.renovarSlot(USER, 'wip:slot:1', 'r1', 6, AGORA + 10)).toBe(false)
    expect(leases.renovarSlot(USER, 'wip:slot:1', 'r2', 5, AGORA + 10)).toBe(false)
    expect(leases.renovarSlot(USER, 'wip:slot:1', 'r1', 5, AGORA + 10)).toBe(true)
    expect(leases.buscar(USER, 'wip:slot:1')?.heartbeatEm).toBe(AGORA + 10)

    expect(leases.liberarSlot(USER, 'wip:slot:1', 'r1', 4)).toBe(false)
    expect(leases.buscar(USER, 'wip:slot:1')).toBeDefined()
    expect(leases.liberarSlot(USER, 'wip:slot:1', 'r1', 5)).toBe(true)
  })

  it('um dono antigo não derruba nem renova o lease de quem veio depois', () => {
    leases.adquirir(USER, { proprietario: 'r1', recurso: 'wip:slot:1', fencingToken: 1 }, AGORA)
    leases.removerReconciliado(USER, 'wip:slot:1')
    leases.adquirir(USER, { proprietario: 'r1', recurso: 'wip:slot:1', fencingToken: 2 }, AGORA + 5)

    // O mesmo run, o mesmo recurso — e o token antigo já não vale.
    expect(leases.renovarSlot(USER, 'wip:slot:1', 'r1', 1, AGORA + 9)).toBe(false)
    expect(leases.liberarSlot(USER, 'wip:slot:1', 'r1', 1)).toBe(false)
    expect(leases.buscar(USER, 'wip:slot:1')?.fencingToken).toBe(2)
  })
})

describe('transição condicionada ao fencing token — critério 4', () => {
  const escopo = { userId: USER, workspaceId: 'jarvis' as const, projectId: 'p-a' }
  const novoRun = (): string =>
    runs.criar(escopo, { sliceId: 's1', estado: 'RUNNING' }, new Date(AGORA)).id

  it('com o token vigente, a transição acontece', () => {
    const id = novoRun()
    leases.adquirir(USER, { proprietario: id, recurso: 'wip:slot:1', fencingToken: 3 }, AGORA)

    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA + 1), 3)).toBe(
      true
    )
    expect(runs.buscar(id)?.estado).toBe('VALIDATING')
  })

  it('com token antigo ou futuro, não acontece e o run não muda', () => {
    const id = novoRun()
    leases.adquirir(USER, { proprietario: id, recurso: 'wip:slot:1', fencingToken: 3 }, AGORA)

    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA + 1), 2)).toBe(
      false
    )
    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA + 1), 4)).toBe(
      false
    )
    expect(runs.buscar(id)?.estado).toBe('RUNNING')
  })

  it('o dono antigo que perdeu o lease não confirma progresso, mesmo com o slot de volta ao mesmo run', () => {
    const id = novoRun()
    leases.adquirir(USER, { proprietario: id, recurso: 'wip:slot:1', fencingToken: 1 }, AGORA)
    leases.removerReconciliado(USER, 'wip:slot:1')
    leases.adquirir(USER, { proprietario: id, recurso: 'wip:slot:1', fencingToken: 2 }, AGORA + 10)

    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA + 11), 1)).toBe(
      false
    )
    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA + 11), 2)).toBe(
      true
    )
  })

  it('sem lease de slot, ou com o lease de outro run, não transiciona', () => {
    const id = novoRun()
    const outro = novoRun()
    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA), 1)).toBe(false)

    leases.adquirir(USER, { proprietario: outro, recurso: 'wip:slot:1', fencingToken: 1 }, AGORA)
    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA), 1)).toBe(false)
  })

  it('o token de um lease que não é de slot não vale', () => {
    const id = novoRun()
    leases.adquirir(USER, { proprietario: id, recurso: 'worktree:x', fencingToken: 9 }, AGORA)
    expect(runs.transicionarComFencing(id, 'RUNNING', 'VALIDATING', new Date(AGORA), 9)).toBe(false)
  })

  it('o estado de origem continua conferido: o compare-and-set da V1 vale também aqui', () => {
    const id = novoRun()
    leases.adquirir(USER, { proprietario: id, recurso: 'wip:slot:1', fencingToken: 1 }, AGORA)
    expect(runs.transicionarComFencing(id, 'VALIDATING', 'PR_CI', new Date(AGORA), 1)).toBe(false)
  })
})

describe('métricas e decisões — critério de ocupação, espera e decisões', () => {
  it('conta decisões por tipo na janela, com a mediana e a máxima da espera', () => {
    const dec = (
      decisao: 'adquirido' | 'liberado' | 'reconciliado' | 'cancelado',
      em: number,
      esperaMs?: number
    ) =>
      pool.registrarDecisao(
        USER,
        {
          runId: `r${em}`,
          projectId: 'p-a',
          decisao,
          ...(esperaMs === undefined ? {} : { esperaMs })
        },
        em
      )

    dec('adquirido', AGORA + 1, 100)
    dec('adquirido', AGORA + 2, 300)
    dec('adquirido', AGORA + 3, 200)
    dec('liberado', AGORA + 4)
    dec('reconciliado', AGORA + 5)
    dec('cancelado', AGORA + 6)
    dec('adquirido', AGORA - 99_999, 9_999) // fora da janela

    const m = pool.metricas(USER, AGORA, AGORA + 10)
    expect(m.decisoes).toEqual({ adquirido: 3, liberado: 1, reconciliado: 1, cancelado: 1 })
    expect(m.espera).toEqual({ amostras: 3, medianaMs: 200, maximaMs: 300 })
  })

  it('a mediana de um número par de amostras é a média das duas do meio', () => {
    pool.registrarDecisao(
      USER,
      { runId: 'a', projectId: 'p', decisao: 'adquirido', esperaMs: 100 },
      AGORA
    )
    pool.registrarDecisao(
      USER,
      { runId: 'b', projectId: 'p', decisao: 'adquirido', esperaMs: 300 },
      AGORA
    )
    expect(pool.metricas(USER, AGORA, AGORA).espera.medianaMs).toBe(200)
  })

  it('sem aquisição, não inventa espera; a fila mostra tamanho e idade do mais antigo', () => {
    pool.enfileirar(USER, item('r1'), AGORA)
    pool.enfileirar(USER, item('r2'), AGORA + 4_000)

    const m = pool.metricas(USER, AGORA, AGORA + 10_000)
    expect(m.espera).toEqual({ amostras: 0 })
    expect(m.fila).toEqual({ tamanho: 2, maisAntigoHaMs: 10_000 })
  })

  it('fila vazia não tem idade, e a métrica é por usuário', () => {
    pool.registrarDecisao(
      OUTRO,
      { runId: 'x', projectId: 'p', decisao: 'adquirido', esperaMs: 5 },
      AGORA
    )
    const m = pool.metricas(USER, AGORA - 1, AGORA + 1)
    expect(m.fila).toEqual({ tamanho: 0 })
    expect(m.decisoes.adquirido).toBe(0)
  })
})
