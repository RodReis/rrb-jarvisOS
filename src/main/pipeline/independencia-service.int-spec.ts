import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { LockRepository } = await import('./lock-repository')
const { PoolRepository } = await import('./pool-repository')
const { IndependenciaService } = await import('./independencia-service')

const USER = 'u-1'
const AGORA = 1_700_000_000_000

let dir: string
let db: Db
let locks: InstanceType<typeof LockRepository>
let pool: InstanceType<typeof PoolRepository>
let writeSets: Map<string, string[] | undefined>
let dependencias: Map<string, string[] | undefined>
let servico: InstanceType<typeof IndependenciaService>

const montar = (): InstanceType<typeof IndependenciaService> =>
  new IndependenciaService({
    db,
    locks,
    pool,
    userId: () => USER,
    fonte: (item) => writeSets.get(item.runId),
    dependencias: (item) => dependencias.get(item.runId) ?? [],
    agora: () => AGORA
  })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-indep-'))
  db = openDatabase(join(dir, 'teste.db'))
  locks = new LockRepository(db)
  pool = new PoolRepository(db)
  writeSets = new Map()
  dependencias = new Map()
  servico = montar()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const item = (runId: string, projectId = 'p') => {
  pool.enfileirar(
    USER,
    { runId, workspaceId: 'jarvis', projectId, sliceId: `s-${runId}`, prioridade: 1 },
    AGORA
  )
  return pool.buscarItem(runId)!
}

const veredito = (runId: string, ativos: string[]) =>
  servico.prova(
    {
      runId,
      projectId: 'p',
      sliceId: `s-${runId}`,
      prioridade: 1,
      enfileiradoEm: AGORA,
      gatesAbertos: []
    },
    ativos
  )

describe('prova — critérios 1, 2 e 4', () => {
  it('write sets disjuntos e sem recurso global: independentes, com fingerprint', () => {
    item('a')
    item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/web'])

    const v = veredito('b', ['a'])

    expect(v).toMatchObject({ independente: true, razoes: [] })
    expect((v as { fingerprint: string }).fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('lockfile comum, sem dependência: não executam juntas (critério 1)', () => {
    item('a')
    item('b')
    writeSets.set('a', ['src/api', 'package-lock.json'])
    writeSets.set('b', ['src/web', 'package-lock.json'])

    const v = veredito('b', ['a'])

    expect(v).toMatchObject({ independente: false })
    expect(JSON.stringify((v as { razoes: unknown }).razoes)).toContain('recurso-exclusivo')
  })

  it('a fonte sem resposta é prova incompleta: sequencial (regra 1)', () => {
    item('a')
    item('b')
    writeSets.set('a', ['src/api'])

    const v = veredito('b', ['a'])

    expect(v).toMatchObject({
      independente: false,
      razoes: [{ tipo: 'write-set-desconhecido', runId: 'b' }]
    })
  })

  it('run que o pool não conhece (lease V1) é desconhecido, nunca independente', () => {
    item('b')
    writeSets.set('b', ['src/web'])
    expect(veredito('b', ['fantasma'])).toMatchObject({ independente: false })
  })

  it('dependência entre as fatias bloqueia, mesmo com write sets disjuntos', () => {
    item('a')
    item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/web'])
    dependencias.set('b', ['s-a'])

    expect(veredito('b', ['a'])).toMatchObject({
      independente: false,
      razoes: [{ tipo: 'dependencia', runId: 'b', aposRunId: 'a' }]
    })
  })

  it('critério 4: reexecução com o mesmo snapshot dá a mesma prova e o mesmo fingerprint, mesmo em outra instância', () => {
    item('a')
    item('b')
    writeSets.set('a', ['src/api', 'package-lock.json'])
    writeSets.set('b', ['package-lock.json', 'src/web'])

    const primeira = veredito('b', ['a'])
    const outra = montar()
    const segunda = outra.prova(
      {
        runId: 'b',
        projectId: 'p',
        sliceId: 's-b',
        prioridade: 1,
        enfileiradoEm: AGORA,
        gatesAbertos: []
      },
      ['a']
    )

    expect(segunda).toEqual(primeira)
  })

  it('o fingerprint muda quando o write set muda', () => {
    item('a')
    item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/web'])
    const antes = veredito('b', ['a']) as { fingerprint: string }
    writeSets.set('b', ['src/web2'])
    const depois = veredito('b', ['a']) as { fingerprint: string }
    expect(depois.fingerprint).not.toBe(antes.fingerprint)
  })

  it('ativo que já adquiriu é lido das travas, inclusive o que ele expandiu', () => {
    const a = item('a')
    item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/web'])
    servico.aoAdquirir(a, [], { provar: false }, AGORA)
    // a fonte muda depois; a verdade do ativo é o que ele travou.
    writeSets.set('a', ['outra/coisa'])
    expect(veredito('b', ['a'])).toMatchObject({ independente: true })

    servico.expandir(a, ['src/web/x'], AGORA)
    expect(veredito('b', ['a'])).toMatchObject({ independente: false })
  })
})

describe('aoAdquirir — registra o escopo, as travas e a prova usada', () => {
  it('o primeiro run do projeto trava o write set e registra o escopo, sem prova', () => {
    const a = item('a')
    writeSets.set('a', ['src/api', 'package-lock.json'])

    const r = servico.aoAdquirir(a, [], { provar: true }, AGORA)

    expect(r).toEqual({ ok: true })
    expect(locks.travasDoRun('a')).toEqual({
      caminhos: ['package-lock.json', 'src/api'],
      recursos: ['lockfile']
    })
    expect(locks.escopo('a')?.conhecido).toBe(true)
    expect(locks.provasDoRun('a')).toEqual([])
  })

  it('o segundo run registra a prova com fingerprint, razões e contra quem valeu', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/web'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)

    const r = servico.aoAdquirir(b, ['a'], { provar: true }, AGORA)

    expect(r).toEqual({ ok: true })
    const [prova] = locks.provasDoRun('b')
    expect(prova).toMatchObject({ independente: true, contra: ['a'], razoes: [] })
    expect(prova.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('fonte sem resposta: o run adquire sem travas e fica registrado como escopo desconhecido', () => {
    const a = item('a')
    const r = servico.aoAdquirir(a, [], { provar: true }, AGORA)
    expect(r).toEqual({ ok: true })
    expect(locks.escopo('a')).toMatchObject({ conhecido: false })
    expect(locks.travasDoRun('a')).toEqual({ caminhos: [], recursos: [] })
  })

  it('prova negativa para quem deveria prová-la: recusa e não deixa trava nenhuma', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/api/x'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)

    const r = servico.aoAdquirir(b, ['a'], { provar: true }, AGORA)

    expect(r.ok).toBe(false)
    expect(locks.travasDoRun('b')).toEqual({ caminhos: [], recursos: [] })
    expect(locks.provasDoRun('b')).toHaveLength(0)
  })

  it('irmãos (provar:false) não precisam de prova, mas as travas continuam valendo', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['src/api/x'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)

    const r = servico.aoAdquirir(b, ['a'], { provar: false }, AGORA)

    expect(r.ok).toBe(false)
  })
})

describe('expandir — critério 3: o novo path só é escrito depois do lock confirmado', () => {
  it('path livre: adquire, registra a expansão e invalida as provas que contavam com o run', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['docs/guia'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)
    servico.aoAdquirir(b, ['a'], { provar: true }, AGORA)

    const r = servico.expandir(a, ['src/shared'], AGORA + 5)

    expect(r).toMatchObject({ ok: true })
    expect(locks.travasDoRun('a').caminhos).toEqual(['src/api', 'src/shared'])
    expect(locks.expansoesDoRun('a')[0]).toMatchObject({
      resultado: 'adquirida',
      caminhos: ['src/shared']
    })
    expect(locks.provasDoRun('b')[0].invalidadaEm).toBe(AGORA + 5)
  })

  it('path que outro run trava: conflito, nada gravado e a expansão fica registrada', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/api'])
    writeSets.set('b', ['docs/guia'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)
    servico.aoAdquirir(b, ['a'], { provar: true }, AGORA)

    const r = servico.expandir(b, ['src/api/novo.ts'], AGORA + 5)

    expect(r).toMatchObject({ ok: false, motivo: 'conflito' })
    expect(locks.travasDoRun('b').caminhos).toEqual(['docs/guia'])
    expect(locks.expansoesDoRun('b')[0]).toMatchObject({ resultado: 'conflito' })
    // conflito não é mudança estrutural: a prova de quem contava com b segue valendo.
    expect(locks.provasDoRun('b')[0]?.invalidadaEm).toBeUndefined()
  })

  it('recurso global que outro run segura: conflito, mesmo com o caminho livre', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/api', 'package-lock.json'])
    writeSets.set('b', ['docs/guia'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)
    servico.aoAdquirir(b, ['a'], { provar: true }, AGORA)

    const r = servico.expandir(b, ['yarn.lock'], AGORA + 5)

    expect(r).toMatchObject({ ok: false, motivo: 'conflito' })
  })

  it('caminho inválido: recusa sem tocar em nada', () => {
    const a = item('a')
    writeSets.set('a', ['src/api'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)

    expect(servico.expandir(a, ['../fora'], AGORA)).toEqual({
      ok: false,
      motivo: 'caminho-invalido'
    })
    expect(servico.expandir(a, [], AGORA)).toEqual({ ok: false, motivo: 'caminho-invalido' })
    expect(locks.expansoesDoRun('a')).toEqual([])
  })

  it('run de escopo desconhecido pode expandir, e continua desconhecido para a prova', () => {
    const a = item('a')
    item('b')
    writeSets.set('b', ['docs/guia'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)

    const r = servico.expandir(a, ['src/api'], AGORA)

    expect(r).toMatchObject({ ok: true })
    expect(locks.escopo('a')?.conhecido).toBe(false)
    expect(veredito('b', ['a'])).toMatchObject({ independente: false })
  })
})

describe('revisão — irmãos e nova tentativa', () => {
  it('F3: os irmãos do candidato não entram na prova, mesmo com um run de fora ativo', () => {
    item('X')
    // Os escritores de um run são da mesma fatia: o pool os isenta da prova entre si.
    for (const id of ['R:w1', 'R:w3']) {
      pool.enfileirar(
        USER,
        { runId: id, workspaceId: 'jarvis', projectId: 'p', sliceId: 's-R', prioridade: 1 },
        AGORA
      )
    }
    writeSets.set('X', ['docs/x'])
    writeSets.set('R:w1', ['src/a'])
    writeSets.set('R:w3', ['src/c'])

    const v = veredito('R:w3', ['X', 'R:w1'])

    expect(v).toMatchObject({ independente: true })
  })

  it('F3: o run de fora continua sendo provado contra o irmão do candidato', () => {
    item('X')
    item('R:w1')
    writeSets.set('X', ['src/a/y'])
    writeSets.set('R:w1', ['src/a'])
    expect(veredito('X', ['R:w1'])).toMatchObject({ independente: false })
  })

  it('F1: o conflito de uma aquisição não bloqueia a próxima tentativa do mesmo id', () => {
    const a = item('a')
    const b = item('b')
    writeSets.set('a', ['src/a'])
    writeSets.set('b', ['src/b'])
    servico.aoAdquirir(a, [], { provar: true }, AGORA)
    servico.aoAdquirir(b, ['a'], { provar: true }, AGORA)
    expect(servico.expandir(a, ['src/b/x'], AGORA)).toMatchObject({ ok: false, motivo: 'conflito' })
    expect(servico.expandir(a, ['src/livre'], AGORA)).toEqual({ ok: false, motivo: 'bloqueado' })

    // A liberação encerra a aquisição; a nova tentativa do mesmo id começa limpa.
    servico.soltar('a')
    servico.soltar('b')
    servico.aoAdquirir(a, [], { provar: true }, AGORA + 10)

    expect(servico.expandir(a, ['src/livre'], AGORA + 11)).toMatchObject({ ok: true })
    // O histórico do conflito antigo continua gravado.
    expect(locks.expansoesDoRun('a').map((e) => e.resultado)).toEqual(['conflito', 'adquirida'])
  })
})
