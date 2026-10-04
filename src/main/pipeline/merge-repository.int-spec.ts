import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import type { WorkspaceId } from '@shared/domain/entities'

/**
 * SPEC-Scheduler-04 — as tentativas de merge no banco.
 *
 * Categoria: Banco. SQLite real: as garantias que importam (token no `WHERE`, os dois UNIQUE
 * parciais, o `EXISTS` da confirmação) são do banco, e um dublê só provaria a intenção.
 */

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { MergeRepository } = await import('./merge-repository')
const { LeaseRepository } = await import('./lease-repository')
const { PipelineRepository } = await import('./pipeline-repository')

const USER = 'u-1'
const WS = 'jarvis' as WorkspaceId
const AGORA = 1_700_000_000_000
const RECURSO = 'merge:o/r:main'
const HEAD = 'a'.repeat(40)

let dir: string
let db: Db
let merges: InstanceType<typeof MergeRepository>
let leases: InstanceType<typeof LeaseRepository>
let runs: InstanceType<typeof PipelineRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-merge-'))
  db = openDatabase(join(dir, 'teste.db'))
  merges = new MergeRepository(db)
  leases = new LeaseRepository(db)
  runs = new PipelineRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function run(estado: EstadoDoRun = 'PR_CI'): string {
  return runs.criar(
    { userId: USER, workspaceId: WS, projectId: 'p' },
    { sliceId: `s-${Math.random()}`, estado },
    new Date(AGORA)
  ).id
}

function lease(runId: string, token: number, recurso = RECURSO): void {
  leases.adquirir(
    USER,
    { proprietario: runId, recurso, projectId: 'p', fencingToken: token },
    AGORA
  )
}

const dados = (runId: string, token: number, pullRequest = 7, headSha = HEAD) => ({
  runId,
  projectId: 'p',
  recurso: RECURSO,
  pullRequest,
  headSha,
  fencingToken: token
})

describe('iniciar', () => {
  it('abre a tentativa para o dono do lease com o token vigente', () => {
    const a = run()
    lease(a, 1)

    const r = merges.iniciar(USER, dados(a, 1), AGORA)

    expect(r.tipo).toBe('iniciada')
    if (r.tipo === 'iniciada') {
      expect(r.tentativa).toMatchObject({
        runId: a,
        pullRequest: 7,
        headSha: HEAD,
        estado: 'iniciada'
      })
    }
  })

  it('recusa token que não é o vigente: o dono antigo não abre tentativa', () => {
    const a = run()
    lease(a, 2)

    expect(merges.iniciar(USER, dados(a, 1), AGORA)).toEqual({
      tipo: 'recusada',
      motivo: 'lease-perdido'
    })
  })

  it('recusa quem não tem o lease, mesmo com um token qualquer', () => {
    const a = run()

    expect(merges.iniciar(USER, dados(a, 1), AGORA)).toEqual({
      tipo: 'recusada',
      motivo: 'lease-perdido'
    })
  })

  it('recusa o lease de outro run no mesmo recurso', () => {
    const a = run()
    const b = run()
    lease(a, 1)

    expect(merges.iniciar(USER, dados(b, 1), AGORA)).toEqual({
      tipo: 'recusada',
      motivo: 'lease-perdido'
    })
  })

  it.each<EstadoDoRun>([
    'CANCELLED',
    'MERGED',
    'AWAITING_MERGE',
    'BLOCKED',
    'VALIDATING',
    'RUNNING'
  ])('recusa run em %s: só PR_CI chega ao merge, e o cancelado nunca mergeia', (estado) => {
    const a = run(estado)
    lease(a, 1)

    expect(merges.iniciar(USER, dados(a, 1), AGORA)).toEqual({
      tipo: 'recusada',
      motivo: 'run-fora-de-pr-ci'
    })
    expect(merges.iniciadas(USER)).toHaveLength(0)
  })

  it('recusa run inexistente', () => {
    expect(merges.iniciar(USER, dados('fantasma', 1), AGORA).tipo).toBe('recusada')
  })

  it('uma tentativa iniciada por base: a segunda recebe tentativa-em-aberto', () => {
    // O lease expirou e outro run o adquiriu, mas a tentativa anterior ficou `iniciada` (crash).
    // Ninguém mergeia naquela base até a reconciliação resolver: não se sabe se o merge saiu.
    const a = run()
    const b = run()
    lease(a, 1)
    merges.iniciar(USER, dados(a, 1), AGORA)
    leases.removerReconciliado(USER, RECURSO)
    lease(b, 2)

    expect(merges.iniciar(USER, dados(b, 2), AGORA)).toEqual({
      tipo: 'recusada',
      motivo: 'tentativa-em-aberto'
    })
  })

  it('o mesmo run, PR e head não abre duas tentativas vivas', () => {
    const a = run()
    lease(a, 1)
    merges.iniciar(USER, dados(a, 1), AGORA)

    expect(merges.iniciar(USER, dados(a, 1), AGORA)).toEqual({
      tipo: 'recusada',
      motivo: 'ja-tentada'
    })
  })

  it('bases diferentes do mesmo repositório não se bloqueiam', () => {
    const a = run()
    const b = run()
    lease(a, 1)
    lease(b, 2, 'merge:o/r:release')

    expect(merges.iniciar(USER, dados(a, 1), AGORA).tipo).toBe('iniciada')
    expect(merges.iniciar(USER, { ...dados(b, 2), recurso: 'merge:o/r:release' }, AGORA).tipo).toBe(
      'iniciada'
    )
  })
})

describe('confirmar', () => {
  function iniciada(token = 1): { runId: string; id: number } {
    const a = run()
    lease(a, token)
    const r = merges.iniciar(USER, dados(a, token), AGORA)
    if (r.tipo !== 'iniciada') throw new Error('esperava iniciada')
    return { runId: a, id: r.tentativa.id }
  }

  it('o dono atual confirma, e o commit de merge fica gravado', () => {
    const { id } = iniciada()

    expect(merges.confirmar(USER, id, 'm'.repeat(40), AGORA + 1)).toBe(true)
    expect(merges.buscar(USER, id)).toMatchObject({
      estado: 'confirmada',
      mergeSha: 'm'.repeat(40)
    })
  })

  it('quem perdeu o lease durante a chamada NÃO confirma (regra 2 da SPEC)', () => {
    const { id } = iniciada(1)
    leases.removerReconciliado(USER, RECURSO)
    lease(run(), 2)

    expect(merges.confirmar(USER, id, 'm'.repeat(40), AGORA + 1)).toBe(false)
    expect(merges.buscar(USER, id)?.estado).toBe('iniciada')
  })

  it('sem lease nenhum também não confirma', () => {
    const { id } = iniciada()
    leases.removerReconciliado(USER, RECURSO)

    expect(merges.confirmar(USER, id, 'm'.repeat(40), AGORA + 1)).toBe(false)
  })

  it('não confirma duas vezes nem reabre uma abandonada', () => {
    const { id } = iniciada()
    merges.confirmar(USER, id, 'm'.repeat(40), AGORA)

    expect(merges.confirmar(USER, id, 'x'.repeat(40), AGORA)).toBe(false)
    expect(merges.buscar(USER, id)?.mergeSha).toBe('m'.repeat(40))
  })

  it('a reconciliação confirma sem dono, porque a prova é a origem', () => {
    const { id } = iniciada()
    leases.removerReconciliado(USER, RECURSO)

    expect(merges.confirmarReconciliado(USER, id, 'm'.repeat(40), AGORA)).toBe(true)
    expect(merges.buscar(USER, id)?.estado).toBe('confirmada')
  })

  it('a tentativa confirmada libera a base para o próximo run', () => {
    const { id } = iniciada()
    merges.confirmar(USER, id, 'm'.repeat(40), AGORA)
    leases.removerReconciliado(USER, RECURSO)
    const b = run()
    lease(b, 2)

    expect(merges.iniciar(USER, dados(b, 2, 8), AGORA).tipo).toBe('iniciada')
  })
})

describe('abandonar', () => {
  it('abandona só a iniciada, e o head pode ser tentado de novo', () => {
    const a = run()
    lease(a, 1)
    const r = merges.iniciar(USER, dados(a, 1), AGORA)
    if (r.tipo !== 'iniciada') throw new Error('esperava iniciada')

    expect(merges.abandonar(USER, r.tentativa.id, AGORA + 1)).toBe(true)
    expect(merges.abandonar(USER, r.tentativa.id, AGORA + 2)).toBe(false)
    expect(merges.iniciar(USER, dados(a, 1), AGORA + 3).tipo).toBe('iniciada')
  })

  it('não abandona uma tentativa confirmada: merge confirmado não se desfaz', () => {
    const a = run()
    lease(a, 1)
    const r = merges.iniciar(USER, dados(a, 1), AGORA)
    if (r.tipo !== 'iniciada') throw new Error('esperava iniciada')
    merges.confirmar(USER, r.tentativa.id, 'm'.repeat(40), AGORA)

    expect(merges.abandonar(USER, r.tentativa.id, AGORA)).toBe(false)
    expect(merges.buscar(USER, r.tentativa.id)?.estado).toBe('confirmada')
  })
})

describe('consultas', () => {
  it('buscarViva acha iniciada e confirmada, e ignora abandonada', () => {
    const a = run()
    lease(a, 1)
    const r = merges.iniciar(USER, dados(a, 1), AGORA)
    if (r.tipo !== 'iniciada') throw new Error('esperava iniciada')
    expect(merges.buscarViva(USER, a, 7, HEAD)?.estado).toBe('iniciada')

    merges.abandonar(USER, r.tentativa.id, AGORA)
    expect(merges.buscarViva(USER, a, 7, HEAD)).toBeUndefined()
  })

  it('iniciadas lista o que a reconciliação do boot precisa olhar', () => {
    const a = run()
    lease(a, 1)
    merges.iniciar(USER, dados(a, 1), AGORA)

    expect(merges.iniciadas(USER).map((t) => t.runId)).toEqual([a])
  })

  it('confirmadasComRunAberto acha o merge que o run ainda não registrou', () => {
    const a = run()
    lease(a, 1)
    const r = merges.iniciar(USER, dados(a, 1), AGORA)
    if (r.tipo !== 'iniciada') throw new Error('esperava iniciada')
    merges.confirmar(USER, r.tentativa.id, 'm'.repeat(40), AGORA)

    expect(merges.confirmadasComRunAberto(USER).map((t) => t.runId)).toEqual([a])

    runs.transicionar(a, 'PR_CI', 'MERGED', new Date(AGORA))
    expect(merges.confirmadasComRunAberto(USER)).toEqual([])
  })
})

describe('emCursoDoRun — o que o cancelamento consulta', () => {
  function comTentativa(): { runId: string; id: number } {
    const a = run()
    lease(a, 1)
    const r = merges.iniciar(USER, dados(a, 1), AGORA)
    if (r.tipo !== 'iniciada') throw new Error('esperava iniciada')
    return { runId: a, id: r.tentativa.id }
  }

  it('sem tentativa, o run pode ser cancelado', () => {
    expect(merges.emCursoDoRun(USER, run())).toBe(false)
  })

  it('com a tentativa iniciada, o merge está no ar', () => {
    expect(merges.emCursoDoRun(USER, comTentativa().runId)).toBe(true)
  })

  it('confirmada com o run ainda em PR_CI: o merge aconteceu e o run não registrou', () => {
    const { runId, id } = comTentativa()
    merges.confirmar(USER, id, 'm'.repeat(40), AGORA)

    expect(merges.emCursoDoRun(USER, runId)).toBe(true)
  })

  it('confirmada e run já terminal: não há mais o que proteger, o terminal é que protege', () => {
    const { runId, id } = comTentativa()
    merges.confirmar(USER, id, 'm'.repeat(40), AGORA)
    runs.transicionar(runId, 'PR_CI', 'MERGED', new Date(AGORA))

    expect(merges.emCursoDoRun(USER, runId)).toBe(false)
  })

  it('abandonada não segura o cancelamento', () => {
    const { runId, id } = comTentativa()
    merges.abandonar(USER, id, AGORA)

    expect(merges.emCursoDoRun(USER, runId)).toBe(false)
  })

  it('só olha o próprio run', () => {
    comTentativa()

    expect(merges.emCursoDoRun(USER, run())).toBe(false)
  })
})
