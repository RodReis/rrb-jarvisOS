import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PADRAO, capacidadeEfetiva } from '@shared/domain/pool'
import type { ConfigDoPool } from '@shared/domain/pool'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { PoolRepository } = await import('./pool-repository')
const { PoolService } = await import('./pool-service')

const USER = 'u-1'
const OUTRO = 'u-2'
const AGORA = 1_700_000_000_000
const PARALELO: ConfigDoPool = { ...CONFIG_PADRAO, paralelismo: true }

let dir: string
let db: Db
let relogio: number
let gatesAbertos: Map<string, string[]>
let ativados: string[]
let ativarOk: boolean
let leases: InstanceType<typeof LeaseRepository>
let pool: InstanceType<typeof PoolRepository>
let audit: InstanceType<typeof AuditRepository>
let servico: InstanceType<typeof PoolService>

function montar(userId = USER): InstanceType<typeof PoolService> {
  return new PoolService({
    db,
    pool,
    leases,
    audit,
    userId: () => userId,
    workspaceId: () => 'jarvis',
    gates: (item) => gatesAbertos.get(item.runId) ?? [],
    ativar: (item) => {
      ativados.push(item.runId)
      return ativarOk
    },
    agora: () => relogio
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pool-svc-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  gatesAbertos = new Map()
  ativados = []
  ativarOk = true
  leases = new LeaseRepository(db)
  pool = new PoolRepository(db)
  audit = new AuditRepository(db, 'chave-de-teste')
  servico = montar()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const run = (runId: string, projectId = 'p-a', prioridade = 1) => ({
  runId,
  workspaceId: 'jarvis' as const,
  projectId,
  sliceId: `s-${runId}`,
  prioridade
})

const contar = (tabela: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n

describe('ciclo — capacidade e posse (critério 1)', () => {
  it('com o paralelismo desligado, um só run adquire, mesmo de projetos diferentes', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))

    const r = servico.ciclo()

    expect(r.adquiridos).toHaveLength(1)
    expect(r.adquiridos[0].recurso).toBe('wip:slot:1')
    expect(r.espera).toHaveLength(1)
    expect(r.espera[0].motivo).toEqual({ tipo: 'paralelismo-desligado', ocupados: 1 })
    expect(contar('lease')).toBe(1)
  })

  it('com o paralelismo ligado, dois slots distintos e tokens distintos e crescentes', () => {
    servico.configurar(PARALELO)
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    servico.enfileirar(run('c1', 'p-c'))

    const r = servico.ciclo()

    expect(r.adquiridos.map((a) => a.recurso).sort()).toEqual(['wip:slot:1', 'wip:slot:2'])
    const tokens = r.adquiridos.map((a) => a.fencingToken)
    expect(new Set(tokens).size).toBe(2)
    expect(tokens[1]).toBeGreaterThan(tokens[0])
    expect(r.espera).toHaveLength(1)
    expect(r.espera[0].motivo).toEqual({ tipo: 'limite-global', ocupados: 2, limite: 2 })
  })

  it('o run adquirido é ativado dentro do ciclo e sai da fila', () => {
    servico.enfileirar(run('a1'))
    servico.ciclo()
    expect(ativados).toEqual(['a1'])
    expect(pool.buscarItem('a1')?.estado).toBe('adquirido')
    expect(pool.esperando(USER)).toEqual([])
  })

  it('é idempotente: repetir sem mudança não adquire nem reescreve nada', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    servico.ciclo()
    const decisoes = contar('pool_decisao')
    const tokens = (db.prepare('SELECT ultimo FROM pool_sequencia').get() as { ultimo: number })
      .ultimo

    const segundo = servico.ciclo()

    expect(segundo.adquiridos).toEqual([])
    expect(contar('pool_decisao')).toBe(decisoes)
    expect(
      (db.prepare('SELECT ultimo FROM pool_sequencia').get() as { ultimo: number }).ultimo
    ).toBe(tokens)
    expect(ativados).toHaveLength(1)
  })

  it('o motivo de espera fica gravado no item', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    servico.ciclo()
    const esperando = pool.esperando(USER)[0]
    expect(esperando.motivo).toEqual({ tipo: 'paralelismo-desligado', ocupados: 1 })
  })
})

describe('gates — capacidade livre não torna ninguém elegível (regra 1)', () => {
  it('o item com gate aberto não adquire, e adquire quando o gate fecha', () => {
    servico.configurar(PARALELO)
    gatesAbertos.set('a1', ['dependencia'])
    servico.enfileirar(run('a1'))

    expect(servico.ciclo().adquiridos).toEqual([])
    expect(pool.buscarItem('a1')?.motivo).toEqual({ tipo: 'gate', gates: ['dependencia'] })

    gatesAbertos.delete('a1')
    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['a1'])
  })
})

describe('justiça entre projetos — critério 2', () => {
  it('dois projetos continuamente elegíveis alternam a cada slot liberado', () => {
    const servidos: string[] = []
    for (let i = 0; i < 6; i++) {
      servico.enfileirar(run(`a${i}`, 'p-a', i))
      servico.enfileirar(run(`b${i}`, 'p-b', i))
    }

    for (let rodada = 0; rodada < 8; rodada++) {
      relogio += 1_000
      const r = servico.ciclo()
      for (const a of r.adquiridos) {
        servidos.push(a.projectId)
        servico.liberar(a.runId, a.fencingToken)
      }
    }

    const a = servidos.filter((p) => p === 'p-a').length
    const b = servidos.filter((p) => p === 'p-b').length
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
    expect(a + b).toBe(8)
    // Alternou de verdade: nunca dois seguidos do mesmo projeto enquanto o outro espera.
    for (let i = 1; i < servidos.length; i++) expect(servidos[i]).not.toBe(servidos[i - 1])
  })

  it('a precedência do roadmap vale dentro do projeto', () => {
    servico.enfileirar(run('tarde', 'p-a', 9))
    servico.enfileirar(run('cedo', 'p-a', 1))
    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['cedo'])
  })
})

describe('lease expirado ocupa o slot até a reconciliação (regra 3)', () => {
  it('não reatribui o slot expirado; depois de reconciliado, o próximo adquire', () => {
    servico.enfileirar(run('a1', 'p-a'))
    const primeira = servico.ciclo().adquiridos[0]
    servico.enfileirar(run('b1', 'p-b'))

    relogio += VALIDADE_DO_LEASE_MS + 1
    const durante = servico.ciclo()
    expect(durante.adquiridos).toEqual([])
    expect(durante.espera[0].motivo).toEqual({ tipo: 'aguardando-reconciliacao', runIds: ['a1'] })
    expect(leases.buscar(USER, primeira.recurso)?.proprietario).toBe('a1')

    leases.removerReconciliado(USER, primeira.recurso)
    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['b1'])
  })

  it('o slot expirado aparece como expirado na vista, ainda ocupando', () => {
    servico.enfileirar(run('a1'))
    servico.ciclo()
    relogio += VALIDADE_DO_LEASE_MS + 1
    const v = servico.vista()
    expect(v.ocupados[0]).toMatchObject({ runId: 'a1', estado: 'expirado' })
    expect(v.metricas.ocupacao.ocupados).toBe(1)
  })

  it('renovar mantém o lease vigente', () => {
    servico.enfileirar(run('a1'))
    const a = servico.ciclo().adquiridos[0]
    relogio += VALIDADE_DO_LEASE_MS - 1
    expect(servico.renovar('a1', a.fencingToken)).toBe(true)
    relogio += VALIDADE_DO_LEASE_MS - 1
    expect(servico.vista().ocupados[0].estado).toBe('vigente')
  })
})

describe('configuração', () => {
  it('reduzir a capacidade não derruba run ativo e só impede novas aquisições', () => {
    servico.configurar(PARALELO)
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    const dois = servico.ciclo().adquiridos
    expect(dois).toHaveLength(2)

    servico.configurar({ ...PARALELO, capacidadeGlobal: 1 })
    servico.enfileirar(run('c1', 'p-c'))
    expect(servico.ciclo().adquiridos).toEqual([])
    expect(contar('lease')).toBe(2)

    servico.liberar('a1', dois.find((a) => a.runId === 'a1')?.fencingToken as number)
    expect(servico.ciclo().adquiridos).toEqual([])
    servico.liberar('b1', dois.find((a) => a.runId === 'b1')?.fencingToken as number)
    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['c1'])
  })

  it('configuração inválida devolve todos os erros e não grava nada', () => {
    const r = servico.configurar({ capacidadeGlobal: 0, maxPorProjeto: 0, paralelismo: 'x' })
    expect(r.ok).toBe(false)
    expect(servico.configuracao()).toEqual(CONFIG_PADRAO)
    expect(contar('pool_config')).toBe(0)
  })

  it('a troca de configuração é auditada, e ligar o paralelismo fica registrado', () => {
    servico.configurar(PARALELO)
    const evento = audit.list(USER).find((e) => e.type === 'pool-config')
    expect(evento?.payload).toMatchObject({ paralelismo: true, capacidadeGlobal: 2 })
  })

  it('é por usuário', () => {
    servico.configurar(PARALELO)
    expect(montar(OUTRO).configuracao()).toEqual(CONFIG_PADRAO)
  })
})

describe('crash antes e depois da aquisição — critério 3', () => {
  it('se ativar lança no meio do ciclo, nada persiste: sem lease, sem token, item ainda na fila', () => {
    servico.enfileirar(run('a1'))
    const quebra = new PoolService({
      db,
      pool,
      leases,
      audit,
      userId: () => USER,
      workspaceId: () => 'jarvis',
      ativar: () => {
        throw new Error('crash no meio')
      },
      agora: () => relogio
    })

    expect(() => quebra.ciclo()).toThrow('crash no meio')

    expect(contar('lease')).toBe(0)
    expect(contar('pool_sequencia')).toBe(0)
    expect(contar('pool_vez')).toBe(0)
    expect(contar('pool_decisao')).toBe(0)
    expect(pool.buscarItem('a1')?.estado).toBe('esperando')

    // E o ciclo seguinte funciona normalmente, com o primeiro token.
    expect(servico.ciclo().adquiridos[0].fencingToken).toBe(1)
  })

  it('se ativar recusa o run, a aquisição é desfeita e o item sai da fila', () => {
    ativarOk = false
    servico.enfileirar(run('a1'))

    const r = servico.ciclo()

    expect(r.adquiridos).toEqual([])
    expect(contar('lease')).toBe(0)
    expect(pool.buscarItem('a1')?.estado).toBe('cancelado')
    expect(pool.vezes(USER)).toEqual({})
    expect(
      (db.prepare('SELECT decisao FROM pool_decisao').get() as { decisao: string }).decisao
    ).toBe('cancelado')
  })

  it('depois do commit, uma instância nova vê o lease e não adquire de novo (sem duplicar run)', () => {
    servico.enfileirar(run('a1'))
    const antes = servico.ciclo().adquiridos[0]

    const novo = montar()
    const r = novo.ciclo()

    expect(r.adquiridos).toEqual([])
    expect(novo.slotDoRun('a1')?.fencingToken).toBe(antes.fencingToken)
    expect(contar('lease')).toBe(1)
    expect(ativados).toEqual(['a1'])
  })

  it('reiniciar o processo preserva posição, lease e motivo de espera', () => {
    servico.configurar(PARALELO)
    for (const [id, p] of [
      ['a1', 'p-a'],
      ['b1', 'p-b'],
      ['c1', 'p-c'],
      ['d1', 'p-d']
    ] as const) {
      relogio += 10
      servico.enfileirar(run(id, p))
    }
    servico.ciclo()
    const antes = servico.vista()
    db.close()

    db = openDatabase(join(dir, 'teste.db'))
    leases = new LeaseRepository(db)
    pool = new PoolRepository(db)
    audit = new AuditRepository(db, 'chave-de-teste')
    const reiniciado = montar()
    const depois = reiniciado.vista()

    expect(depois.ocupados).toEqual(antes.ocupados)
    expect(depois.fila).toEqual(antes.fila)
    expect(reiniciado.ciclo().adquiridos).toEqual([])
    expect(contar('lease')).toBe(2)
  })
})

describe('fencing token — critério 4', () => {
  it('só o token vigente renova, libera e confirma progresso', () => {
    servico.enfileirar(run('a1'))
    const { fencingToken } = servico.ciclo().adquiridos[0]

    for (const errado of [fencingToken - 1, fencingToken + 1, 0, Number.NaN]) {
      expect(servico.renovar('a1', errado)).toBe(false)
      expect(servico.liberar('a1', errado)).toBe(false)
      expect(servico.confirmarProgresso('a1', errado)).toBe(false)
    }
    expect(servico.confirmarProgresso('a1', fencingToken)).toBe(true)
    expect(servico.liberar('a1', fencingToken)).toBe(true)
  })

  it('o dono antigo não confirma progresso depois de perder o lease, mesmo que o run readquira', () => {
    servico.enfileirar(run('a1'))
    const antigo = servico.ciclo().adquiridos[0]

    // Perde o lease: a reconciliação o remove depois de expirar.
    relogio += VALIDADE_DO_LEASE_MS + 1
    leases.removerReconciliado(USER, antigo.recurso)
    expect(servico.confirmarProgresso('a1', antigo.fencingToken)).toBe(false)

    // O mesmo run volta à fila e readquire: o token novo é outro.
    pool.cancelar('a1', relogio)
    db.prepare("DELETE FROM pool_fila WHERE run_id = 'a1'").run()
    servico.enfileirar(run('a1'))
    const novo = servico.ciclo().adquiridos[0]

    expect(novo.fencingToken).toBeGreaterThan(antigo.fencingToken)
    expect(servico.confirmarProgresso('a1', antigo.fencingToken)).toBe(false)
    expect(servico.renovar('a1', antigo.fencingToken)).toBe(false)
    expect(servico.liberar('a1', antigo.fencingToken)).toBe(false)
    expect(servico.confirmarProgresso('a1', novo.fencingToken)).toBe(true)
  })

  it('o token nunca é reutilizado, nem depois de liberar tudo', () => {
    const vistos = new Set<number>()
    for (let i = 0; i < 5; i++) {
      servico.enfileirar(run(`r${i}`, `p-${i}`))
      const a = servico.ciclo().adquiridos[0]
      expect(vistos.has(a.fencingToken)).toBe(false)
      vistos.add(a.fencingToken)
      servico.liberar(a.runId, a.fencingToken)
    }
    expect([...vistos]).toEqual([1, 2, 3, 4, 5])
  })

  it('o token não vai para a auditoria nem para a vista', () => {
    servico.enfileirar(run('a1'))
    const a = servico.ciclo().adquiridos[0]
    servico.liberar('a1', a.fencingToken)

    const eventos = audit.list(USER).filter((e) => e.type === 'pipeline-lease')
    expect(eventos.map((e) => e.payload.acao)).toEqual(['adquirido', 'liberado'])
    for (const e of eventos) expect(JSON.stringify(e.payload)).not.toMatch(/token|fencing/i)

    servico.enfileirar(run('b1'))
    servico.ciclo()
    expect(JSON.stringify(servico.vista())).not.toMatch(/token|fencing/i)
  })

  it('o run sem slot não tem o que confirmar', () => {
    servico.enfileirar(run('a1'))
    expect(servico.confirmarProgresso('a1', 1)).toBe(false)
    expect(servico.confirmarProgresso('inexistente', 1)).toBe(false)
  })
})

describe('vista — critério 5', () => {
  it('explica, por item, o que o segura — e mostra o que está pronto para adquirir', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    gatesAbertos.set('c1', ['aprovacao-do-pi'])
    servico.enfileirar(run('c1', 'p-c'))

    const v = servico.vista()

    expect(v.fila.map((i) => [i.runId, i.posicao, i.motivo.tipo])).toEqual([
      ['a1', 1, 'pronto-para-adquirir'],
      ['b1', 2, 'paralelismo-desligado'],
      ['c1', 3, 'gate']
    ])
    expect(v.capacidadeEfetiva).toBe(1)
  })

  it('traz ocupação, espera e decisões como métricas', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    relogio += 5_000
    const a = servico.ciclo().adquiridos[0]
    relogio += 1_000
    const v = servico.vista()

    expect(v.metricas.ocupacao).toEqual({ ocupados: 1, capacidade: 1 })
    expect(v.metricas.fila.tamanho).toBe(1)
    expect(v.metricas.espera).toMatchObject({ amostras: 1, medianaMs: 5_000, maximaMs: 5_000 })
    expect(v.metricas.decisoes.adquirido).toBe(1)

    servico.liberar(a.runId, a.fencingToken)
    expect(servico.vista().metricas.decisoes.liberado).toBe(1)
  })

  it('as métricas olham só as últimas 24 horas', () => {
    const DIA = 24 * 60 * 60 * 1000
    pool.registrarDecisao(
      USER,
      { runId: 'velho', projectId: 'p-a', decisao: 'adquirido', esperaMs: 9_000 },
      AGORA - DIA - 1
    )
    pool.registrarDecisao(
      USER,
      { runId: 'novo', projectId: 'p-a', decisao: 'adquirido', esperaMs: 100 },
      AGORA - DIA + 1
    )

    const m = servico.vista().metricas
    expect(m.decisoes.adquirido).toBe(1)
    expect(m.espera).toMatchObject({ amostras: 1, maximaMs: 100 })
  })

  it('é só leitura: chamar não muda o banco', () => {
    servico.enfileirar(run('a1'))
    servico.enfileirar(run('b1', 'p-b'))
    const foto = (): string =>
      JSON.stringify(
        ['lease', 'pool_fila', 'pool_decisao', 'pool_sequencia', 'pool_vez'].map((t) =>
          db.prepare(`SELECT * FROM ${t}`).all()
        )
      )
    const antes = foto()
    servico.vista()
    servico.vista()
    expect(foto()).toBe(antes)
  })

  it('é por usuário', () => {
    servico.enfileirar(run('a1'))
    servico.ciclo()
    expect(montar(OUTRO).vista().ocupados).toEqual([])
  })
})

describe('escopo de workspace e de usuário', () => {
  const noa = (runId: string, projectId = 'p-noa') => ({
    ...run(runId, projectId),
    workspaceId: 'noa' as const
  })

  it('a vista mostra só o workspace de quem olha, mas a capacidade continua sendo uma só', () => {
    servico.configurar(PARALELO)
    servico.enfileirar(run('j1', 'p-j')) // jarvis
    servico.enfileirar(noa('n1'))
    servico.enfileirar(noa('n2', 'p-noa2'))
    servico.ciclo() // j1 e n1 adquirem; n2 espera
    servico.enfileirar(noa('n3', 'p-noa3'))

    const jarvis = servico.vista('jarvis')
    expect(jarvis.ocupados.map((s) => s.runId)).toEqual(['j1'])
    expect(jarvis.fila).toEqual([])

    const doNoa = servico.vista('noa')
    expect(doNoa.ocupados.map((s) => s.runId)).toEqual(['n1'])
    expect(doNoa.fila.map((i) => i.runId).sort()).toEqual(['n2', 'n3'])
    // O número de slots em uso é do pool inteiro: um por usuário, não um por espaço.
    expect(doNoa.metricas.ocupacao.ocupados).toBe(2)
    // Sem argumento, vale o workspace do serviço — o que o canal IPC usa.
    expect(servico.vista().ocupados.map((s) => s.runId)).toEqual(['j1'])
  })

  it('a auditoria do lease leva o workspace do run, não o do ciclo', () => {
    servico.enfileirar(noa('n1'))
    servico.ciclo() // o serviço roda como `jarvis`, o run é do `noa`

    const evento = audit.list(USER).find((e) => e.type === 'pipeline-lease')
    expect(evento?.workspace_id).toBe('noa')
  })

  it('o run que já é de outro usuário não volta a quem tenta enfileirá-lo', () => {
    servico.enfileirar(run('r1'))
    const intruso = montar('u-outro')

    expect(() => intruso.enfileirar(run('r1'))).toThrow(/outro usuário/)
    expect(pool.esperando('u-outro')).toEqual([])
  })
})

describe('cancelar e liberar', () => {
  it('cancelar tira da fila, registra a decisão e não cancela quem já adquiriu', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    servico.ciclo()

    expect(servico.cancelar('b1')).toBe(true)
    expect(servico.cancelar('b1')).toBe(false)
    expect(servico.cancelar('a1')).toBe(false)
    expect(servico.cancelar('inexistente')).toBe(false)
    expect(servico.vista().metricas.decisoes.cancelado).toBe(1)
  })

  it('um usuário não cancela o run de outro', () => {
    servico.enfileirar(run('a1'))
    expect(montar(OUTRO).cancelar('a1')).toBe(false)
    expect(pool.buscarItem('a1')?.estado).toBe('esperando')
  })

  it('liberar devolve o slot e o ciclo seguinte o dá a quem espera', () => {
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    const a = servico.ciclo().adquiridos[0]
    servico.liberar(a.runId, a.fencingToken)
    expect(servico.ciclo().adquiridos.map((x) => x.runId)).toEqual(['b1'])
  })

  it('encerrar solta o slot do run que terminou, sem token, e só o dele', () => {
    servico.configurar(PARALELO)
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))
    servico.ciclo()

    expect(servico.encerrar('a1')).toBe(true)
    expect(servico.encerrar('a1')).toBe(false)
    expect(servico.encerrar('nunca-teve')).toBe(false)

    expect(servico.slotDoRun('a1')).toBeUndefined()
    expect(servico.slotDoRun('b1')).toBeDefined()
    expect(servico.vista().metricas.decisoes.liberado).toBe(1)
    const eventos = audit.list(USER).filter((e) => e.type === 'pipeline-lease')
    expect(eventos.map((e) => e.payload.acao)).toEqual(['adquirido', 'adquirido', 'liberado'])
  })

  it('registrar a reconciliação conta a decisão', () => {
    servico.enfileirar(run('a1'))
    servico.ciclo()
    const lease = leases.listarSlots(USER)[0]
    servico.registrarReconciliado(lease)
    expect(servico.vista().metricas.decisoes.reconciliado).toBe(1)
  })
})

/** Gerador pseudoaleatório determinístico: a propriedade é reproduzível pela semente. */
function aleatorio(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('invariantes sob sequências aleatórias de operações', () => {
  it('nunca há mais donos que a capacidade, nem dois slots por run, nem token repetido', () => {
    for (const semente of [1, 2, 3, 4, 5, 6, 7, 8]) {
      db.exec(
        'DELETE FROM lease; DELETE FROM pool_fila; DELETE FROM pool_decisao; DELETE FROM pool_sequencia; DELETE FROM pool_vez; DELETE FROM pool_config'
      )
      relogio = AGORA
      const rand = aleatorio(semente)
      const config: ConfigDoPool = {
        ...CONFIG_PADRAO,
        paralelismo: rand() < 0.6,
        capacidadeGlobal: 1 + Math.floor(rand() * 3),
        maxPorProjeto: 1 + Math.floor(rand() * 2)
      }
      servico.configurar(config)
      const donos = new Map<string, number>()
      const tokensVistos = new Set<number>()
      let n = 0

      for (let passo = 0; passo < 120; passo++) {
        relogio += Math.floor(rand() * 5_000)
        const dado = rand()
        if (dado < 0.45) {
          servico.enfileirar(run(`r${n++}`, `p-${Math.floor(rand() * 3)}`, Math.floor(rand() * 4)))
        } else if (dado < 0.8) {
          for (const a of servico.ciclo().adquiridos) {
            expect(tokensVistos.has(a.fencingToken), `semente ${semente}: token repetido`).toBe(
              false
            )
            tokensVistos.add(a.fencingToken)
            donos.set(a.runId, a.fencingToken)
          }
        } else if (donos.size > 0) {
          const [runId, token] = [...donos.entries()][Math.floor(rand() * donos.size)]
          servico.liberar(runId, token)
          donos.delete(runId)
        }

        const slots = leases.listarSlots(USER)
        expect(slots.length, `semente ${semente} passo ${passo}`).toBeLessThanOrEqual(
          capacidadeEfetiva(config)
        )
        expect(new Set(slots.map((l) => l.proprietario)).size).toBe(slots.length)
        expect(new Set(slots.map((l) => l.recurso)).size).toBe(slots.length)
        const doProjeto = new Map<string, number>()
        for (const l of slots)
          doProjeto.set(l.projectId ?? '', (doProjeto.get(l.projectId ?? '') ?? 0) + 1)
        for (const c of doProjeto.values())
          expect(c).toBeLessThanOrEqual(Math.min(config.maxPorProjeto, capacidadeEfetiva(config)))
      }
    }
  })
})
