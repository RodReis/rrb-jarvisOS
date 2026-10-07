/**
 * O slot do escritor (SPEC-Squads-03, decisão 1 do PI; critérios 5 e 6 da SPEC e a regra 5).
 *
 * Cada escritor é um item do pool com id `<runId>:<escritor>` — lease e fencing token próprios.
 * O run, enquanto o Squad executa, **não** segura slot: quem ocupa é o escritor. Os escritores do
 * mesmo run são irmãos e não precisam da prova de independência entre si; escritores de runs
 * diferentes do mesmo projeto precisam, como quaisquer dois runs.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import { idDoEscritor } from '@shared/domain/squad-execucao'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PipelineRepository } = await import('./pipeline-repository')
const { LeaseRepository } = await import('./lease-repository')
const { FilaService } = await import('./fila-service')
const { PoolRepository } = await import('./pool-repository')
const { PoolService } = await import('./pool-service')

import type { Aquisicao } from './pool-service'

const USER = 'u-1'
const WS = 'jarvis' as const
const AGORA = 1_700_000_000_000

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm1', numero: 1, titulo: 'MVP 1', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const SLICES: readonly Slice[] = [
  {
    id: 'f1',
    mvpId: 'm1',
    numero: 1,
    titulo: 'Fatia 1',
    specSlug: 'spec-f1',
    detalhada: true,
    origem
  }
]
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]

let dir: string
let db: Db
let relogio: number
let runs: InstanceType<typeof PipelineRepository>
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let anunciados: Aquisicao[]

const aprovacao = (projectId: string): Approval => ({
  id: `a-${projectId}`,
  user_id: USER,
  workspace_id: WS,
  projectId,
  gate: 'SLICE_ENTRY',
  revisoes: REVISOES,
  identidade: 'sessao-1',
  autor: 'pi',
  created_at: new Date(AGORA).toISOString()
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-fila-escritor-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  anunciados = []
  runs = new PipelineRepository(db)
  const leases = new LeaseRepository(db)
  const audit = new AuditRepository(db, 'chave-de-teste')

  pool = new PoolService({
    db,
    pool: new PoolRepository(db),
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item),
    agora: () => relogio
  })
  fila = new FilaService({
    runs,
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    aoAdquirir: (a) => void anunciados.push(a),
    agora: () => relogio
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function pronto(projectId: string): string {
  const run = fila.criarRun(projectId, WS, 'f1')
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  return run.id
}

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado
const ligarParalelismo = (): void => void pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
const token = (lease: { fencingToken?: number } | undefined): number =>
  lease?.fencingToken as number

describe('o escritor adquire o slot', () => {
  it('o primeiro escritor leva o run a RUNNING e recebe lease e token próprios', () => {
    const run = pronto('p-a')

    const r = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    expect(r.reason).toBe('adquirido')
    expect(r.lease?.proprietario).toBe(idDoEscritor(run, 'api'))
    expect(typeof r.lease?.fencingToken).toBe('number')
    expect(estado(run)).toBe('RUNNING')
    // O run não segura slot: só o escritor.
    expect(pool.slotDoRun(run)).toBeUndefined()
  })

  it('repetir o pedido converge no mesmo slot, sem nova ativação do run', () => {
    const run = pronto('p-a')
    const primeiro = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    const segundo = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    expect(segundo.reason).toBe('adquirido')
    expect(segundo.lease?.fencingToken).toBe(primeiro.lease?.fencingToken)
    expect(estado(run)).toBe('RUNNING')
  })

  it('recusa run inexistente, de outro usuário e escritor com nome inválido', () => {
    const run = pronto('p-a')

    expect(fila.adquirirSlotDoEscritor('p-a', WS, 'nao-existe', 'api').reason).toBe(
      'lease-inexistente'
    )
    for (const ruim of ['a b', 'a/b', 'a:b', '', 'x'.repeat(33)]) {
      expect(fila.adquirirSlotDoEscritor('p-a', WS, run, ruim).reason).toBe('lease-inexistente')
    }
    expect(estado(run)).toBe('READY')
  })
})

describe('um slot livre — o plano de 2 escritores roda em sequência (critério 6)', () => {
  it('o segundo escritor espera e entra quando o primeiro libera, sem erro', () => {
    const run = pronto('p-a')
    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    const b = fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')

    expect(b.reason).toBe('ocupado')
    expect(b.mensagem).toContain('paralelismo está desligado')
    expect(pool.slotDoRun(idDoEscritor(run, 'ui'))).toBeUndefined()
    anunciados = []

    fila.liberarSlot('p-a', WS, idDoEscritor(run, 'api'), token(a.lease))

    expect(pool.slotDoRun(idDoEscritor(run, 'api'))).toBeUndefined()
    expect(pool.slotDoRun(idDoEscritor(run, 'ui'))).toBeDefined()
    expect(anunciados.map((x) => x.runId)).toEqual([idDoEscritor(run, 'ui')])
    expect(estado(run)).toBe('RUNNING')
  })

  it('nunca há dois escritores com slot ao mesmo tempo', () => {
    const run = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'db')

    expect(pool.vista().ocupados).toHaveLength(1)
    expect(pool.vista().fila).toHaveLength(2)
  })
})

describe('com o paralelismo ligado, os dois escritores do mesmo run rodam juntos', () => {
  beforeEach(ligarParalelismo)

  it('irmãos não precisam de prova de independência entre si', () => {
    const run = pronto('p-a')

    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    const b = fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')

    expect(a.reason).toBe('adquirido')
    expect(b.reason).toBe('adquirido')
    expect(token(a.lease)).not.toBe(token(b.lease))
    expect(pool.vista().ocupados).toHaveLength(2)
  })

  it('o terceiro escritor espera pelo limite, e entra quando um libera', () => {
    const run = pronto('p-a')
    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')

    const c = fila.adquirirSlotDoEscritor('p-a', WS, run, 'db')

    expect(c.reason).toBe('ocupado')
    fila.liberarSlot('p-a', WS, idDoEscritor(run, 'api'), token(a.lease))
    expect(pool.slotDoRun(idDoEscritor(run, 'db'))).toBeDefined()
  })

  it('escritor de OUTRO run do mesmo projeto precisa da prova, que ainda não existe', () => {
    const r1 = pronto('p-a')
    const r2 = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, r1, 'api')

    const outro = fila.adquirirSlotDoEscritor('p-a', WS, r2, 'api')

    expect(outro.reason).toBe('ocupado')
    expect(outro.mensagem).toContain('prova de independência')
    expect(estado(r2)).toBe('READY')
  })

  it('o irmão só entra quando TODOS os ativos do projeto são irmãos dele', () => {
    const r1 = pronto('p-a')
    const r2 = pronto('p-a')
    // r2 é um run comum, com slot próprio: o item do run e o do escritor de r1 não são irmãos.
    fila.adquirirSlot('p-a', WS, r2)

    const escritor = fila.adquirirSlotDoEscritor('p-a', WS, r1, 'api')

    expect(escritor.reason).toBe('ocupado')
    expect(escritor.mensagem).toContain('prova de independência')
  })

  it('escritores de projetos diferentes não se bloqueiam', () => {
    const r1 = pronto('p-a')
    const r2 = pronto('p-b')

    expect(fila.adquirirSlotDoEscritor('p-a', WS, r1, 'api').reason).toBe('adquirido')
    expect(fila.adquirirSlotDoEscritor('p-b', WS, r2, 'api').reason).toBe('adquirido')
  })
})

describe('a nova tentativa do escritor volta à fila (M9-F04)', () => {
  it('depois de liberar, o mesmo escritor pede de novo e recebe slot e token novos', () => {
    const run = pronto('p-a')
    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.liberarSlot('p-a', WS, idDoEscritor(run, 'api'), token(a.lease))

    const b = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    expect(b.reason).toBe('adquirido')
    expect(token(b.lease)).toBeGreaterThan(token(a.lease))
  })

  it('depois de cancelar a espera, o mesmo escritor pede de novo e volta à fila', () => {
    const run = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    expect(fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui').reason).toBe('ocupado')
    fila.desistirDoSlot(idDoEscritor(run, 'ui'))
    expect(pool.vista().fila).toEqual([])

    expect(fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui').reason).toBe('ocupado')

    expect(pool.vista().fila.map((i) => i.runId)).toEqual([idDoEscritor(run, 'ui')])
  })

  it('o pedido repetido de quem tem slot segue convergindo no mesmo slot', () => {
    const run = pronto('p-a')
    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    const de_novo = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    expect(token(de_novo.lease)).toBe(token(a.lease))
  })

  it('o run comum cancelado da fila não volta ao pedir de novo: o ciclo único da M12-F01 vale', () => {
    const run = pronto('p-a')
    fila.adquirirSlot('p-b', WS, pronto('p-b')) // ocupa o único slot
    expect(fila.adquirirSlot('p-a', WS, run).reason).toBe('ocupado')
    pool.cancelar(run)

    expect(fila.adquirirSlot('p-a', WS, run).reason).toBe('ocupado')
    expect(pool.vista().fila).toEqual([])
  })

  it('o run comum é de ciclo único: liberado, não volta sozinho para a fila', () => {
    const run = pronto('p-a')
    const a = fila.adquirirSlot('p-a', WS, run)
    fila.liberarSlot('p-a', WS, run, token(a.lease))

    expect(fila.adquirirSlot('p-a', WS, run).reason).toBe('ocupado')
  })
})

describe('o gate do escritor é o estado do run', () => {
  it('run que não está pronto nem rodando mantém o escritor na fila', () => {
    const run = fila.criarRun('p-a', WS, 'f1').id

    const r = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    expect(r.reason).toBe('ocupado')
    expect(pool.slotDoRun(idDoEscritor(run, 'api'))).toBeUndefined()
    expect(estado(run)).not.toBe('RUNNING')
  })

  it('o run comum já em execução não é elegível: o gate do escritor não vale para ele', () => {
    const run = pronto('p-a')
    // O caminho do construtor leva o run a RUNNING sem passar pelo pool.
    fila.transicionar('p-a', WS, run, 'RUNNING')

    const r = fila.adquirirSlot('p-a', WS, run)

    expect(r.reason).toBe('ocupado')
    expect(pool.vista().fila.map((i) => i.motivo)).toEqual([
      { tipo: 'gate', gates: ['run-nao-pronto'] }
    ])
  })

  it('run que terminou tira da fila todos os escritores que esperavam', () => {
    const run = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'db')
    expect(pool.vista().fila).toHaveLength(2)

    fila.transicionar('p-a', WS, run, 'CANCELLED')

    expect(pool.vista().fila).toEqual([])
  })

  it('run que terminou tira da fila o escritor que esperava', () => {
    const run = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')
    expect(pool.vista().fila.map((i) => i.runId)).toEqual([idDoEscritor(run, 'ui')])

    expect(fila.transicionar('p-a', WS, run, 'CANCELLED').reason).toBe('transicionado')

    expect(pool.vista().fila).toEqual([])
  })

  it('run concluído solta os slots de escritor que sobraram e passa a vez', () => {
    const run = pronto('p-a')
    const outro = pronto('p-b')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.adquirirSlotDoEscritor('p-b', WS, outro, 'api')
    expect(pool.slotDoRun(idDoEscritor(outro, 'api'))).toBeUndefined()
    fila.transicionar('p-a', WS, run, 'VALIDATING')
    fila.transicionar('p-a', WS, run, 'REVIEWING')
    fila.transicionar('p-a', WS, run, 'PR_CI')

    expect(fila.concluir('p-a', WS, run).reason).toBe('transicionado')

    expect(pool.slotDoRun(idDoEscritor(run, 'api'))).toBeUndefined()
    expect(pool.slotDoRun(idDoEscritor(outro, 'api'))).toBeDefined()
  })
})

describe('o token é do escritor, não do run', () => {
  it('só o dono do slot do escritor renova e libera, com o token dele', () => {
    const run = pronto('p-a')
    ligarParalelismo()
    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    const b = fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')
    const idA = idDoEscritor(run, 'api')

    expect(fila.renovarSlot(idA, token(a.lease))).toBe(true)
    expect(fila.renovarSlot(idA, token(b.lease))).toBe(false)
    expect(fila.renovarSlot(idA, token(a.lease) + 1)).toBe(false)

    fila.liberarSlot('p-a', WS, idA, token(b.lease))
    expect(pool.slotDoRun(idA)).toBeDefined()
    fila.liberarSlot('p-a', WS, idA, token(a.lease))
    expect(pool.slotDoRun(idA)).toBeUndefined()
  })

  it('confirmar o slot exige o token vigente: o dono antigo não confirma', () => {
    const run = pronto('p-a')
    const a = fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    const idA = idDoEscritor(run, 'api')

    expect(fila.confirmarSlot(idA, token(a.lease))).toBe(true)
    expect(fila.confirmarSlot(idA, token(a.lease) + 1)).toBe(false)
    expect(fila.confirmarSlot(idA, token(a.lease) - 1)).toBe(false)

    fila.liberarSlot('p-a', WS, idA, token(a.lease))
    expect(fila.confirmarSlot(idA, token(a.lease))).toBe(false)
    expect(fila.confirmarSlot('nao-existe', 1)).toBe(false)
  })

  it('desistir da vaga tira da fila quem esperava, e não toca em quem já tem slot', () => {
    const run = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'ui')
    const idUi = idDoEscritor(run, 'ui')
    expect(pool.vista().fila).toHaveLength(1)

    expect(fila.desistirDoSlot(idUi)).toBe(true)
    expect(pool.vista().fila).toEqual([])
    expect(fila.desistirDoSlot(idUi)).toBe(false)

    expect(fila.desistirDoSlot(idDoEscritor(run, 'api'))).toBe(false)
    expect(pool.slotDoRun(idDoEscritor(run, 'api'))).toBeDefined()
  })

  it('o run do Squad segue sem fencing nas transições: o escritor é quem carrega o token', () => {
    const run = pronto('p-a')
    fila.adquirirSlotDoEscritor('p-a', WS, run, 'api')

    expect(fila.transicionar('p-a', WS, run, 'VALIDATING').reason).toBe('transicionado')
  })
})
