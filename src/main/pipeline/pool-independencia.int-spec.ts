import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
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
const { LockRepository } = await import('./lock-repository')
const { IndependenciaService } = await import('./independencia-service')
const { PoolService } = await import('./pool-service')

const USER = 'u-1'
const AGORA = 1_700_000_000_000

let dir: string
let db: Db
let relogio: number
let writeSets: Map<string, string[] | undefined>
let ativarOk: boolean
let bloqueios: { runId: string; token: number; bloqueio: BloqueioExterno }[]
let leases: InstanceType<typeof LeaseRepository>
let pool: InstanceType<typeof PoolRepository>
let locks: InstanceType<typeof LockRepository>
let audit: InstanceType<typeof AuditRepository>
let servico: InstanceType<typeof PoolService>

function montar(): InstanceType<typeof PoolService> {
  const independencia = new IndependenciaService({
    db,
    locks,
    pool,
    userId: () => USER,
    fonte: (item) => writeSets.get(item.runId),
    dependencias: () => [],
    agora: () => relogio
  })
  return new PoolService({
    db,
    pool,
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => 'jarvis',
    ativar: () => ativarOk,
    independencia,
    bloquear: (item, token, bloqueio) => {
      bloqueios.push({ runId: item.runId, token, bloqueio })
      return true
    },
    agora: () => relogio
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pool-indep-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  writeSets = new Map()
  ativarOk = true
  bloqueios = []
  leases = new LeaseRepository(db)
  pool = new PoolRepository(db)
  locks = new LockRepository(db)
  audit = new AuditRepository(db, 'chave-de-teste')
  servico = montar()
  servico.configurar({ ...CONFIG_PADRAO, paralelismo: true })
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

const motivoDe = (runId: string) => pool.buscarItem(runId)?.motivo
const nSlots = (): number => leases.listarSlots(USER).length

describe('critério 2 — write sets disjuntos, sem recurso global: slots simultâneos', () => {
  it('duas fatias do mesmo projeto adquirem juntas, com travas e prova registradas', () => {
    writeSets.set('a1', ['src/api'])
    writeSets.set('a2', ['src/web'])
    servico.enfileirar(run('a1', 'p-a', 1))
    servico.enfileirar(run('a2', 'p-a', 2))

    const r = servico.ciclo()

    expect(r.adquiridos.map((a) => a.runId)).toEqual(['a1', 'a2'])
    expect(nSlots()).toBe(2)
    expect(locks.travasDoRun('a1').caminhos).toEqual(['src/api'])
    expect(locks.travasDoRun('a2').caminhos).toEqual(['src/web'])
    expect(locks.provasDoRun('a2')[0]).toMatchObject({ independente: true, contra: ['a1'] })
  })
})

describe('critério 1 — lockfile comum: não executam juntas', () => {
  beforeEach(() => {
    writeSets.set('a1', ['src/api', 'package-lock.json'])
    writeSets.set('a2', ['src/web', 'package-lock.json'])
    servico.enfileirar(run('a1', 'p-a', 1))
    servico.enfileirar(run('a2', 'p-a', 2))
  })

  it('a segunda espera, e o motivo diz qual recurso, com o fingerprint', () => {
    const r = servico.ciclo()

    expect(r.adquiridos.map((a) => a.runId)).toEqual(['a1'])
    expect(nSlots()).toBe(1)
    const motivo = motivoDe('a2')
    expect(motivo).toMatchObject({ tipo: 'sem-prova-de-independencia' })
    expect(JSON.stringify(motivo)).toContain('lockfile')
    expect((motivo as { fingerprint: string }).fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a vista traz o mesmo motivo estruturado', () => {
    servico.ciclo()
    const item = servico.vista().fila.find((i) => i.runId === 'a2')
    expect(item?.motivo).toMatchObject({ tipo: 'sem-prova-de-independencia' })
  })

  it('quando a primeira libera, as travas saem com ela e a segunda adquire', () => {
    const [a1] = servico.ciclo().adquiridos

    expect(servico.liberar('a1', a1.fencingToken)).toBe(true)
    expect(locks.travasDoRun('a1')).toEqual({ caminhos: [], recursos: [] })

    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['a2'])
    expect(locks.travasDoRun('a2').recursos).toEqual(['lockfile'])
  })

  it('encerrar o run (terminal concluído) também solta as travas', () => {
    servico.ciclo()
    servico.encerrar('a1')
    expect(locks.travasDoRun('a1').caminhos).toEqual([])
  })
})

describe('regra 1 — dimensão desconhecida força sequencial', () => {
  it('sem write set da fonte, o segundo run do projeto espera mesmo com tudo livre', () => {
    servico.enfileirar(run('a1', 'p-a', 1))
    servico.enfileirar(run('a2', 'p-a', 2))

    const r = servico.ciclo()

    expect(r.adquiridos.map((a) => a.runId)).toEqual(['a1'])
    expect(JSON.stringify(motivoDe('a2'))).toContain('write-set-desconhecido')
    expect(locks.escopo('a1')).toMatchObject({ conhecido: false })
  })

  it('projetos diferentes seguem independentes: outro repositório, outro conjunto de travas', () => {
    writeSets.set('a1', ['src'])
    writeSets.set('b1', ['src'])
    servico.enfileirar(run('a1', 'p-a'))
    servico.enfileirar(run('b1', 'p-b'))

    expect(
      servico
        .ciclo()
        .adquiridos.map((a) => a.runId)
        .sort()
    ).toEqual(['a1', 'b1'])
  })

  it('a ativação recusada desfaz as travas junto com o slot', () => {
    writeSets.set('a1', ['src/api'])
    servico.enfileirar(run('a1'))
    ativarOk = false

    servico.ciclo()

    expect(nSlots()).toBe(0)
    expect(locks.travasDoRun('a1')).toEqual({ caminhos: [], recursos: [] })
    expect(locks.escopo('a1')).toBeUndefined()
  })
})

describe('critério 4 — o mesmo snapshot dá a mesma prova e o mesmo fingerprint', () => {
  it('duas instâncias sobre o mesmo estado explicam a espera com o mesmo fingerprint', () => {
    writeSets.set('a1', ['src/api', 'yarn.lock'])
    writeSets.set('a2', ['src/web', 'yarn.lock'])
    servico.enfileirar(run('a1', 'p-a', 1))
    servico.enfileirar(run('a2', 'p-a', 2))
    servico.ciclo()
    const primeira = motivoDe('a2')

    const outra = montar()
    relogio += 60_000
    outra.ciclo()

    expect(motivoDe('a2')).toEqual(primeira)
  })
})

describe('critério 5 — locks sobrevivem a reinício e só saem depois da reconciliação do dono', () => {
  beforeEach(() => {
    writeSets.set('a1', ['src/api'])
    writeSets.set('a2', ['src/api/x'])
    servico.enfileirar(run('a1', 'p-a', 1))
    servico.enfileirar(run('a2', 'p-a', 2))
    servico.ciclo()
  })

  it('reiniciar (nova instância sobre o mesmo banco) preserva as travas e a espera', () => {
    const reiniciado = montar()
    reiniciado.ciclo()

    expect(locks.travasDoRun('a1').caminhos).toEqual(['src/api'])
    expect(nSlots()).toBe(1)
    expect(pool.buscarItem('a2')?.estado).toBe('esperando')
  })

  it('lease expirado continua segurando: a segunda não adquire até a reconciliação', () => {
    relogio += VALIDADE_DO_LEASE_MS + 1
    const r = servico.ciclo()

    expect(r.adquiridos).toEqual([])
    expect(locks.travasDoRun('a1').caminhos).toEqual(['src/api'])
  })

  it('reconciliado o dono, as travas saem e a segunda adquire', () => {
    relogio += VALIDADE_DO_LEASE_MS + 1
    const lease = leases.buscarSlotDoRun(USER, 'a1')!
    leases.removerReconciliado(USER, lease.recurso)
    servico.registrarReconciliado(lease)

    expect(locks.travasDoRun('a1')).toEqual({ caminhos: [], recursos: [] })
    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['a2'])
  })

  it('crash entre remover o lease e soltar as travas: o próximo ciclo varre a trava órfã', () => {
    const lease = leases.buscarSlotDoRun(USER, 'a1')!
    leases.removerReconciliado(USER, lease.recurso) // o processo morreu aqui

    expect(locks.travasDoRun('a1').caminhos).toEqual(['src/api'])
    expect(servico.ciclo().adquiridos.map((a) => a.runId)).toEqual(['a2'])
    expect(locks.travasDoRun('a1')).toEqual({ caminhos: [], recursos: [] })
  })
})

describe('critério 3 — expansão conflitante pausa antes de alterar o novo path', () => {
  let a1: { fencingToken: number }
  let a2: { fencingToken: number }

  beforeEach(() => {
    writeSets.set('a1', ['src/api'])
    writeSets.set('a2', ['src/web'])
    servico.enfileirar(run('a1', 'p-a', 1))
    servico.enfileirar(run('a2', 'p-a', 2))
    ;[a1, a2] = servico.ciclo().adquiridos
  })

  it('path livre: confirma, trava e audita', () => {
    const r = servico.expandirEscopo('a1', a1.fencingToken, ['src/shared'])

    expect(r).toMatchObject({ ok: true })
    expect(locks.travasDoRun('a1').caminhos).toEqual(['src/api', 'src/shared'])
    expect(bloqueios).toEqual([])
    const eventos = audit.list(USER).filter((e) => e.type === 'pool-lock')
    expect(eventos.map((e) => e.payload.acao)).toContain('expansao-adquirida')
  })

  it('path que o outro trava: conflito, o run perdedor é bloqueado com o token e nada é gravado', () => {
    const r = servico.expandirEscopo('a2', a2.fencingToken, ['src/api/novo.ts'])

    expect(r).toMatchObject({ ok: false, motivo: 'conflito', bloqueado: true })
    expect(locks.travasDoRun('a2').caminhos).toEqual(['src/web'])
    expect(bloqueios).toHaveLength(1)
    expect(bloqueios[0]).toMatchObject({ runId: 'a2', token: a2.fencingToken })
    expect(bloqueios[0].bloqueio.causa).toBe('conflito-de-write-set')
    expect(bloqueios[0].bloqueio.evidencia).toContain('src/api')
    expect(bloqueios[0].bloqueio.tentativas).toBe(0)
    expect(bloqueios[0].bloqueio.retomada.trim()).not.toBe('')
    expect(bloqueios[0].bloqueio.porQueNaoSeguir.trim()).not.toBe('')
    const eventos = audit.list(USER).filter((e) => e.type === 'pool-lock')
    expect(eventos.map((e) => e.payload.acao)).toContain('expansao-conflito')
  })

  it('dono antigo (token que já não vale) não expande nem bloqueia ninguém', () => {
    const r = servico.expandirEscopo('a1', a1.fencingToken + 999, ['src/shared'])

    expect(r).toEqual({ ok: false, motivo: 'fencing-invalido' })
    expect(locks.expansoesDoRun('a1')).toEqual([])
    expect(bloqueios).toEqual([])
  })

  it('run sem slot não expande', () => {
    expect(servico.expandirEscopo('inexistente', 1, ['src/x'])).toEqual({
      ok: false,
      motivo: 'fencing-invalido'
    })
  })

  it('caminho inválido: recusa sem bloquear o run', () => {
    expect(servico.expandirEscopo('a1', a1.fencingToken, ['../fora'])).toEqual({
      ok: false,
      motivo: 'caminho-invalido'
    })
    expect(bloqueios).toEqual([])
  })

  it('quem perdeu a disputa não amplia mais, nem com path livre, e a recusa não grava nada', () => {
    servico.expandirEscopo('a2', a2.fencingToken, ['src/api/novo.ts'])
    const eventos = audit.list(USER).filter((e) => e.type === 'pool-lock').length

    for (let i = 0; i < 5; i++) {
      expect(servico.expandirEscopo('a2', a2.fencingToken, ['docs/livre'])).toEqual({
        ok: false,
        motivo: 'bloqueado'
      })
    }

    expect(locks.travasDoRun('a2').caminhos).toEqual(['src/web'])
    expect(locks.expansoesDoRun('a2')).toHaveLength(1)
    expect(audit.list(USER).filter((e) => e.type === 'pool-lock')).toHaveLength(eventos)
    expect(bloqueios).toHaveLength(1)
  })

  it('o teto de caminhos travados por run vale para as expansões somadas', () => {
    for (let i = 0; i < 3; i++) {
      const lote = Array.from({ length: 99 }, (_, k) => `gerado${i}/m${k}`)
      expect(servico.expandirEscopo('a1', a1.fencingToken, lote)).toMatchObject({ ok: true })
    }
    expect(
      servico.expandirEscopo('a1', a1.fencingToken, ['mais/um', 'mais/dois', 'mais/tres'])
    ).toEqual({
      ok: false,
      motivo: 'limite-de-travas'
    })
  })

  it('pedido grande demais é caminho inválido, sem gravar expansão', () => {
    const grande = Array.from({ length: 101 }, (_, k) => `x/m${k}`)
    expect(servico.expandirEscopo('a1', a1.fencingToken, grande)).toEqual({
      ok: false,
      motivo: 'caminho-invalido'
    })
    expect(locks.expansoesDoRun('a1')).toEqual([])
  })

  it('a expansão que vence invalida a prova de quem contava com o run', () => {
    servico.expandirEscopo('a1', a1.fencingToken, ['src/shared'])
    expect(locks.provasDoRun('a2')[0].invalidadaEm).toBe(AGORA)
  })
})
