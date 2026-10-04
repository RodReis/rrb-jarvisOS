import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import { CONFIG_PADRAO } from '@shared/domain/pool'

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
const { ReconciliacaoService } = await import('./reconciliacao-service')

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
let leases: InstanceType<typeof LeaseRepository>
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
  dir = mkdtempSync(join(tmpdir(), 'jarvis-fila-pool-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  anunciados = []
  runs = new PipelineRepository(db)
  leases = new LeaseRepository(db)
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

/** Leva um run de um projeto a `READY`. */
function pronto(projectId: string): string {
  const run = fila.criarRun(projectId, WS, 'f1')
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  return run.id
}

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado

describe('fencing token nas transições — critério 4', () => {
  it('quem detém o slot só avança o run com o token vigente', () => {
    const id = pronto('p-a')
    const { lease } = fila.adquirirSlot('p-a', WS, id)
    const token = lease?.fencingToken as number

    expect(fila.transicionar('p-a', WS, id, 'VALIDATING').reason).toBe('fencing-invalido')
    expect(fila.transicionar('p-a', WS, id, 'VALIDATING', undefined, token + 1).reason).toBe(
      'fencing-invalido'
    )
    expect(fila.transicionar('p-a', WS, id, 'VALIDATING', undefined, token - 1).reason).toBe(
      'fencing-invalido'
    )
    expect(estado(id)).toBe('RUNNING')

    expect(fila.transicionar('p-a', WS, id, 'VALIDATING', undefined, token).reason).toBe(
      'transicionado'
    )
    expect(estado(id)).toBe('VALIDATING')
  })

  it('o dono antigo que perdeu o lease não confirma progresso, e o run não muda', () => {
    const id = pronto('p-a')
    const antigo = fila.adquirirSlot('p-a', WS, id).lease?.fencingToken as number

    // O lease expira, a reconciliação o libera, e outro run adquire o slot.
    relogio += VALIDADE_DO_LEASE_MS + 1
    leases.removerReconciliado(USER, 'wip:slot:1')
    const outro = pronto('p-b')
    expect(fila.adquirirSlot('p-b', WS, outro).reason).toBe('adquirido')

    const r = fila.transicionar('p-a', WS, id, 'VALIDATING', undefined, antigo)
    expect(r.reason).toBe('fencing-invalido')
    expect(estado(id)).toBe('RUNNING')
  })

  it('run em execução que perdeu o lease não avança — com ou sem token', () => {
    const id = pronto('p-a')
    const antigo = fila.adquirirSlot('p-a', WS, id).lease?.fencingToken as number
    relogio += VALIDADE_DO_LEASE_MS + 1
    leases.removerReconciliado(USER, 'wip:slot:1')

    expect(fila.transicionar('p-a', WS, id, 'VALIDATING').reason).toBe('fencing-invalido')
    expect(fila.transicionar('p-a', WS, id, 'VALIDATING', undefined, antigo).reason).toBe(
      'fencing-invalido'
    )
    expect(estado(id)).toBe('RUNNING')
  })

  it('run que nunca passou pelo pool conclui sem token — o caminho do EntregaService de hoje', () => {
    // O construtor ainda leva o run a PR_CI direto pelo repositório; ninguém lhe deu slot nem token.
    const id = pronto('p-a')
    const agora = new Date(relogio)
    for (const para of ['RUNNING', 'VALIDATING', 'PR_CI'] as const) {
      expect(runs.transicionar(id, estado(id) as never, para, agora)).toBe(true)
    }

    expect(fila.concluir('p-a', WS, id).reason).toBe('transicionado')
    expect(['MERGED', 'AWAITING_MERGE']).toContain(estado(id))
  })

  it('cancelar é ato do PI e dispensa o token — mas o slot só cai pela reconciliação', () => {
    const a = pronto('p-a')
    const b = pronto('p-b')
    fila.adquirirSlot('p-a', WS, a)
    fila.adquirirSlot('p-b', WS, b)

    expect(fila.transicionar('p-a', WS, a, 'CANCELLED').reason).toBe('transicionado')

    // O lease fica: a reconciliação verifica container e porta antes de soltar (a regra da V1).
    expect(pool.slotDoRun(a)).toBeDefined()
    expect(estado(b)).toBe('READY')
  })

  it('o run sem slot não exige token: o fluxo de antes da aquisição segue igual', () => {
    const run = fila.criarRun('p-a', WS, 'f1')
    expect(fila.transicionar('p-a', WS, run.id, 'AWAITING_PI').reason).toBe('transicionado')
  })

  it('concluir com token errado não conclui nem solta o slot', () => {
    const id = pronto('p-a')
    const token = fila.adquirirSlot('p-a', WS, id).lease?.fencingToken as number
    fila.transicionar('p-a', WS, id, 'VALIDATING', undefined, token)
    fila.transicionar('p-a', WS, id, 'PR_CI', undefined, token)

    expect(fila.concluir('p-a', WS, id, token + 1).reason).toBe('fencing-invalido')
    expect(estado(id)).toBe('PR_CI')
    expect(pool.slotDoRun(id)).toBeDefined()

    expect(fila.concluir('p-a', WS, id, token).reason).toBe('transicionado')
    expect(pool.slotDoRun(id)).toBeUndefined()
  })
})

describe('a fila anda quando o slot é liberado', () => {
  it('o run que esperava adquire na hora, já em RUNNING, e é anunciado a quem executa', () => {
    const a = pronto('p-a')
    const b = pronto('p-b')
    const ta = fila.adquirirSlot('p-a', WS, a).lease?.fencingToken as number

    const espera = fila.adquirirSlot('p-b', WS, b)
    expect(espera.reason).toBe('ocupado')
    expect(espera.mensagem).toContain('paralelismo está desligado')
    expect(estado(b)).toBe('READY')
    anunciados = []

    expect(fila.liberarSlot('p-a', WS, a, ta)).toBe(true)

    expect(estado(b)).toBe('RUNNING')
    expect(pool.slotDoRun(b)).toBeDefined()
    expect(anunciados.map((x) => x.runId)).toEqual([b])
    expect(anunciados[0].fencingToken).toBeGreaterThan(ta)
  })

  it('a justiça decide quem espera: com A servido, B e C esperando — B (mais antigo) e depois C', () => {
    const a = pronto('p-a')
    const ta = fila.adquirirSlot('p-a', WS, a).lease?.fencingToken as number
    const b = pronto('p-b')
    relogio += 10
    fila.adquirirSlot('p-b', WS, b)
    const c = pronto('p-c')
    relogio += 10
    fila.adquirirSlot('p-c', WS, c)

    fila.liberarSlot('p-a', WS, a, ta)
    expect(estado(b)).toBe('RUNNING')
    expect(estado(c)).toBe('READY')

    const tb = pool.slotDoRun(b)?.fencingToken as number
    fila.liberarSlot('p-b', WS, b, tb)
    expect(estado(c)).toBe('RUNNING')
  })

  it('concluir libera o slot e já passa a vez ao próximo', () => {
    const a = pronto('p-a')
    const b = pronto('p-b')
    const ta = fila.adquirirSlot('p-a', WS, a).lease?.fencingToken as number
    fila.adquirirSlot('p-b', WS, b)
    fila.transicionar('p-a', WS, a, 'VALIDATING', undefined, ta)
    fila.transicionar('p-a', WS, a, 'PR_CI', undefined, ta)

    fila.concluir('p-a', WS, a, ta, true)

    expect(estado(a)).toBe('MERGED')
    expect(estado(b)).toBe('RUNNING')
  })

  it('despachar sem nada esperando não anuncia ninguém', () => {
    expect(fila.despachar()).toEqual([])
    expect(anunciados).toEqual([])
  })
})

describe('gates e elegibilidade', () => {
  it('um run que não está READY não adquire, mesmo com o slot livre, e a mensagem diz o gate', () => {
    const run = fila.criarRun('p-a', WS, 'f1')
    fila.transicionar('p-a', WS, run.id, 'AWAITING_PI')

    const r = fila.adquirirSlot('p-a', WS, run.id)

    expect(r.reason).toBe('ocupado')
    expect(r.mensagem).toContain('gate')
    expect(estado(run.id)).toBe('AWAITING_PI')
    expect(pool.slotDoRun(run.id)).toBeUndefined()
  })

  it('o gate fecha (o run chega a READY) e o despacho o adquire', () => {
    const run = fila.criarRun('p-a', WS, 'f1')
    fila.transicionar('p-a', WS, run.id, 'AWAITING_PI')
    fila.adquirirSlot('p-a', WS, run.id)

    fila.transicionar('p-a', WS, run.id, 'READY')
    expect(fila.despachar().map((x) => x.runId)).toEqual([run.id])
    expect(estado(run.id)).toBe('RUNNING')
  })

  it('run inexistente ou de outro usuário não entra na fila', () => {
    expect(fila.adquirirSlot('p-a', WS, 'nao-existe').reason).toBe('lease-inexistente')
    expect(pool.vista().fila).toEqual([])
  })

  it('um run que termina sem ter adquirido sai da fila: o pool não o ativa depois', () => {
    const a = pronto('p-a')
    const ta = fila.adquirirSlot('p-a', WS, a).lease?.fencingToken as number
    const b = pronto('p-b')
    fila.adquirirSlot('p-b', WS, b)

    expect(fila.transicionar('p-b', WS, b, 'CANCELLED').reason).toBe('transicionado')
    fila.liberarSlot('p-a', WS, a, ta)

    expect(estado(b)).toBe('CANCELLED')
    expect(pool.slotDoRun(b)).toBeUndefined()
    // E o item não fica na fila como fantasma: a vista não o mostra mais.
    expect(pool.vista().fila.some((i) => i.runId === b)).toBe(false)
  })
})

describe('precedência na fila', () => {
  const prioridadeNoBanco = (runId: string): number =>
    (
      db.prepare('SELECT prioridade FROM pool_fila WHERE run_id = ?').get(runId) as {
        prioridade: number
      }
    ).prioridade

  it('vem do roadmap: número do MVP e da fatia, na ordem em que o PI os numerou', () => {
    const id = pronto('p-a')
    fila.adquirirSlot('p-a', WS, id)
    expect(prioridadeNoBanco(id)).toBe(1 * 1_000 + 1)
  })

  it('fatia que não está no roadmap vai para o fim da fila, nunca à frente', () => {
    const run = fila.criarRun('p-a', WS, 'fatia-fora-do-roadmap')
    fila.transicionar('p-a', WS, run.id, 'AWAITING_PI')
    fila.adquirirSlot('p-a', WS, run.id)
    expect(prioridadeNoBanco(run.id)).toBe(1_000_000)
  })
})

describe('paralelismo ligado — a chave que a M12-F03 liga', () => {
  it('dois projetos rodam juntos e o terceiro espera pelo limite global', () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const a = pronto('p-a')
    const b = pronto('p-b')
    const c = pronto('p-c')

    expect(fila.adquirirSlot('p-a', WS, a).reason).toBe('adquirido')
    expect(fila.adquirirSlot('p-b', WS, b).reason).toBe('adquirido')
    const terceiro = fila.adquirirSlot('p-c', WS, c)

    expect(terceiro.reason).toBe('ocupado')
    expect(terceiro.mensagem).toContain('slots de execução estão ocupados')
    expect([estado(a), estado(b), estado(c)]).toEqual(['RUNNING', 'RUNNING', 'READY'])
  })

  it('o padrão continua um run por máquina: ligar é decisão explícita', () => {
    expect(pool.configuracao().paralelismo).toBe(false)
    const a = pronto('p-a')
    const b = pronto('p-b')
    fila.adquirirSlot('p-a', WS, a)
    expect(fila.adquirirSlot('p-b', WS, b).reason).toBe('ocupado')
  })
})

describe('reconciliação e pool', () => {
  it('o slot de um run terminado, expirado, é liberado pela reconciliação — e o pool anda', async () => {
    const a = pronto('p-a')
    const ta = fila.adquirirSlot('p-a', WS, a).lease?.fencingToken as number
    const b = pronto('p-b')
    fila.adquirirSlot('p-b', WS, b)
    fila.transicionar('p-a', WS, a, 'CANCELLED', undefined, ta)
    relogio += VALIDADE_DO_LEASE_MS + 1

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      aoLiberarSlot: (lease) => {
        pool.registrarReconciliado(lease)
        fila.despachar()
      },
      agora: () => relogio
    })

    const achados = await reconciliacao.reconcileAll()

    expect(achados.find((x) => x.recurso === 'wip:slot:1')?.decisao).toBe('liberado')
    expect(estado(b)).toBe('RUNNING')
    expect(pool.vista().metricas.decisoes.reconciliado).toBe(1)
    expect(reconciliacao.slotLivre()).toBe(false)
  })

  it('um slot expirado de run ainda ativo não cai, e continua ocupando', async () => {
    const a = pronto('p-a')
    fila.adquirirSlot('p-a', WS, a)
    relogio += VALIDADE_DO_LEASE_MS + 1
    let avisado = false

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      aoLiberarSlot: () => void (avisado = true),
      agora: () => relogio
    })
    const achados = await reconciliacao.reconcileAll()

    expect(achados.find((x) => x.recurso === 'wip:slot:1')?.decisao).toBe('bloqueado')
    expect(avisado).toBe(false)
    expect(pool.vista().ocupados[0].estado).toBe('expirado')
  })

  it('o aviso só vale para slot: um lease de worktree liberado não chama o pool', async () => {
    leases.adquirir(USER, { proprietario: 'run-morto', recurso: 'worktree:run-morto' }, AGORA)
    relogio += VALIDADE_DO_LEASE_MS + 1
    let avisado = false

    await new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      aoLiberarSlot: () => void (avisado = true),
      agora: () => relogio
    }).reconcileAll()

    expect(avisado).toBe(false)
  })
})

describe('reinício do processo', () => {
  it('a fila e o slot sobrevivem e um ciclo novo não duplica nada', () => {
    const a = pronto('p-a')
    const b = pronto('p-b')
    fila.adquirirSlot('p-a', WS, a)
    fila.adquirirSlot('p-b', WS, b)
    const antes = pool.vista()

    // "Reinicia": outra instância do pool e da fila sobre o mesmo banco.
    const audit = new AuditRepository(db, 'chave-de-teste')
    const pool2 = new PoolService({
      db,
      pool: new PoolRepository(db),
      leases,
      audit,
      userId: () => USER,
      workspaceId: () => WS,
      gates: (item) => fila2.gatesDoItem(item),
      ativar: (item) => fila2.ativarRun(item),
      agora: () => relogio
    })
    const fila2: InstanceType<typeof FilaService> = new FilaService({
      runs,
      pool: pool2,
      workspaceId: () => WS,
      audit,
      roadmap: () => ({ mvps: MVPS, slices: SLICES }),
      aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
      revisoesDoGate: () => REVISOES,
      userId: () => USER,
      mergeAutonomoLigado: () => true,
      agora: () => relogio
    })

    expect(pool2.vista()).toEqual(antes)
    expect(fila2.despachar()).toEqual([])
    expect(fila2.adquirirSlot('p-a', WS, a).reason).toBe('adquirido')
    expect((db.prepare('SELECT COUNT(*) AS n FROM lease').get() as { n: number }).n).toBe(1)
  })
})
