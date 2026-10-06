import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import type { ExecutorObservado } from '@shared/domain/recuperacao'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
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
const { RecuperacaoService } = await import('./recuperacao-service')

const USER = 'u-1'
const WS = 'jarvis' as const
const AGORA = 1_700_000_000_000

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm1', numero: 1, titulo: 'MVP 1', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const SLICES: readonly Slice[] = [
  { id: 'f1', mvpId: 'm1', numero: 1, titulo: 'F1', specSlug: 'spec-f1', detalhada: true, origem },
  { id: 'f2', mvpId: 'm1', numero: 2, titulo: 'F2', specSlug: 'spec-f1', detalhada: true, origem }
]
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]

let dir: string
let db: Db
let relogio: number
let runs: InstanceType<typeof PipelineRepository>
let leases: InstanceType<typeof LeaseRepository>
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let recuperacao: InstanceType<typeof RecuperacaoService>

/** O que o "Docker" diz de cada run. O padrão é morto: o executor sumiu. */
let executores: Map<string, ExecutorObservado>
let pendenciasDoIsolamento: Map<string, readonly PendenciaDeLimpeza[]>
let liberados: string[]
/** Os runs cujo container o isolamento **para** ao devolver os recursos (o `docker stop` por label). */
let paradosAoLiberar: Set<string>
let mergesEmCurso: Set<string>

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
  dir = mkdtempSync(join(tmpdir(), 'jarvis-recuperacao-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  executores = new Map()
  pendenciasDoIsolamento = new Map()
  liberados = []
  paradosAoLiberar = new Set()
  mergesEmCurso = new Set()
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
    // Provas de independência fora de questão aqui: a recuperação é o assunto.
    prova: () => true,
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
    transacao: (fn) => db.transaction(fn)(),
    emTransacao: () => db.inTransaction,
    // O cancelamento e o bloqueio terminam o run: a recuperação devolve o que ele segurava.
    aoEncerrarSemConclusao: (runId) => void recuperacao.recolher(runId),
    agora: () => relogio
  })
  recuperacao = new RecuperacaoService({
    runs,
    leases,
    pool,
    fila,
    audit,
    userId: () => USER,
    isolamento: {
      liberarRunEUnidades: (runId) => {
        liberados.push(runId)
        if (paradosAoLiberar.has(runId)) executores.set(runId, 'morto')
        return { removidos: [], pendencias: pendenciasDoIsolamento.get(runId) ?? [] }
      }
    },
    executor: (runId) => executores.get(runId) ?? 'morto',
    mergeEmCurso: (runId) => mergesEmCurso.has(runId),
    agora: () => relogio
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function pronto(projectId: string, sliceId = 'f1'): string {
  const run = fila.criarRun(projectId, WS, sliceId)
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  return run.id
}

/** Leva um run a `RUNNING` com slot e devolve o token. */
function executando(projectId: string, sliceId = 'f1'): { id: string; token: number } {
  const id = pronto(projectId, sliceId)
  const { lease } = fila.adquirirSlot(projectId, WS, id)
  return { id, token: lease?.fencingToken as number }
}

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado
const slotDe = (runId: string): unknown => leases.buscarSlotDoRun(USER, runId)
const expirar = (): void => {
  relogio += VALIDADE_DO_LEASE_MS + 1
}

describe('recolher — o run terminou e devolve o que segurava', () => {
  it('cancelar um run em execução libera o slot e passa a vez a quem esperava', () => {
    const a = executando('p-a')
    const b = pronto('p-b')
    // Paralelismo desligado: b espera o slot de a.
    expect(fila.adquirirSlot('p-b', WS, b).reason).toBe('ocupado')

    expect(fila.transicionar('p-a', WS, a.id, 'CANCELLED').reason).toBe('transicionado')

    expect(slotDe(a.id)).toBeUndefined()
    expect(slotDe(b)).toBeDefined()
    expect(estado(b)).toBe('RUNNING')
    expect(liberados).toContain(a.id)
  })

  it('bloquear um run também devolve o slot (a liberação do bloqueio é desta fatia)', () => {
    const a = executando('p-a')

    fila.transicionar(
      'p-a',
      WS,
      a.id,
      'BLOCKED',
      {
        causa: 'ci-externo',
        evidencia: 'e',
        tentativas: 1,
        porQueNaoSeguir: 'p',
        retomada: 'r'
      },
      a.token
    )

    expect(slotDe(a.id)).toBeUndefined()
  })

  it('container que não parou segura o slot: falha de limpeza não vira liberação', () => {
    const a = executando('p-a')
    pendenciasDoIsolamento.set(a.id, [
      {
        runId: a.id,
        recurso: 'container',
        identificador: `jarvisos-run-${a.id}`,
        motivo: 'O Docker recusou parar o container.',
        em: new Date(AGORA).toISOString()
      }
    ])

    fila.transicionar('p-a', WS, a.id, 'CANCELLED')

    expect(slotDe(a.id)).toBeDefined()
  })

  it('executor ainda vivo depois da limpeza segura o slot', () => {
    const a = executando('p-a')
    executores.set(a.id, 'vivo')

    fila.transicionar('p-a', WS, a.id, 'CANCELLED')

    expect(slotDe(a.id)).toBeDefined()
  })

  it('executor indeterminado também segura o slot: falha de detecção não é ausência', () => {
    const a = executando('p-a')
    executores.set(a.id, 'desconhecido')

    fila.transicionar('p-a', WS, a.id, 'CANCELLED')

    expect(slotDe(a.id)).toBeDefined()
  })

  it('recolher é idempotente: repetir não libera de novo nem passa a vez duas vezes', () => {
    const a = executando('p-a')
    fila.transicionar('p-a', WS, a.id, 'CANCELLED')

    expect(recuperacao.recolher(a.id).recolhido).toBe(false)
    expect(liberados.filter((id) => id === a.id)).toHaveLength(1)
  })

  it('nunca recolhe run que ainda está ativo, mesmo se pedirem', () => {
    const a = executando('p-a')

    const r = recuperacao.recolher(a.id)

    expect(r.recolhido).toBe(false)
    expect(slotDe(a.id)).toBeDefined()
    expect(liberados).toHaveLength(0)
  })

  it('libera as travas do run junto com o slot (o lock cai com o dono)', () => {
    const a = executando('p-a')
    const antes = db.prepare('SELECT COUNT(*) AS n FROM pool_lock').get() as { n: number }

    fila.transicionar('p-a', WS, a.id, 'CANCELLED')

    const depois = db.prepare('SELECT COUNT(*) AS n FROM pool_lock').get() as { n: number }
    expect(depois.n).toBeLessThanOrEqual(antes.n)
    expect(depois.n).toBe(0)
  })
})

describe('backoff — o Docker é síncrono no processo principal e não pode ser martelado a cada volta', () => {
  const containerPreso = (id: string): void =>
    void pendenciasDoIsolamento.set(id, [
      {
        runId: id,
        recurso: 'container',
        identificador: `jarvisos-run-${id}`,
        motivo: 'O Docker recusou parar o container.',
        em: new Date(AGORA).toISOString()
      }
    ])

  it('recolhimento adiado só é tentado de novo depois da espera, não a cada varredura', () => {
    const a = executando('p-a')
    containerPreso(a.id)
    fila.transicionar('p-a', WS, a.id, 'CANCELLED')
    const tentativas = (): number => liberados.filter((id) => id === a.id).length
    expect(tentativas()).toBe(1)

    recuperacao.supervisionar()
    recuperacao.supervisionar()
    expect(tentativas()).toBe(1)

    relogio += 61_000
    recuperacao.supervisionar()
    expect(tentativas()).toBe(2)
  })

  it('o que destrava dentro da espera é recolhido na primeira tentativa depois dela', () => {
    const a = executando('p-a')
    containerPreso(a.id)
    fila.transicionar('p-a', WS, a.id, 'CANCELLED')
    pendenciasDoIsolamento.delete(a.id)

    relogio += 61_000
    recuperacao.supervisionar()

    expect(slotDe(a.id)).toBeUndefined()
  })

  it('a espera é por run: o adiado de um não segura o recolhimento do outro', () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const a = executando('p-a')
    const b = executando('p-b')
    containerPreso(a.id)
    fila.transicionar('p-a', WS, a.id, 'CANCELLED')
    runs.transicionar(b.id, 'RUNNING', 'CANCELLED', new Date(relogio))

    recuperacao.supervisionar()

    expect(slotDe(b.id)).toBeUndefined()
  })
})

describe('o gancho do cancelamento nunca derruba a transição que já foi commitada', () => {
  it('recolher que lança não desfaz o CANCELLED nem sai de fila.transicionar', () => {
    const a = executando('p-a')
    const original = recuperacao.recolher.bind(recuperacao)
    recuperacao.recolher = () => {
      throw new Error('sqlite ocupado')
    }

    const r = fila.transicionar('p-a', WS, a.id, 'CANCELLED')

    expect(r.reason).toBe('transicionado')
    expect(estado(a.id)).toBe('CANCELLED')
    // O slot continua preso, e a varredura o devolve na volta seguinte.
    recuperacao.recolher = original
    recuperacao.supervisionar()
    expect(slotDe(a.id)).toBeUndefined()
  })

  it('dentro de uma transação externa o gancho espera o commit: o Docker nunca roda com ela aberta', async () => {
    const a = executando('p-a')
    const durante: boolean[] = []
    const original = recuperacao.recolher.bind(recuperacao)
    recuperacao.recolher = (runId) => {
      durante.push(db.inTransaction)
      return original(runId)
    }

    db.transaction(() => {
      fila.transicionar('p-a', WS, a.id, 'CANCELLED')
      // Ainda dentro da transação: o gancho não pode ter rodado.
      expect(durante).toEqual([])
    })()
    await Promise.resolve()

    expect(durante).toEqual([false])
    expect(slotDe(a.id)).toBeUndefined()
  })
})

describe('terminal e liberação são uma transação só (limite declarado da SPEC-Scheduler-01)', () => {
  it('se a liberação do slot falha, o run NÃO fica terminal com o slot preso', () => {
    const a = executando('p-a')
    const original = pool.encerrarDoRun.bind(pool)
    pool.encerrarDoRun = () => {
      throw new Error('crash entre o UPDATE do run e a liberação')
    }

    // Um run em PR_CI concluindo: o terminal e o slot saem juntos ou nenhum dos dois.
    fila.transicionar('p-a', WS, a.id, 'VALIDATING', undefined, a.token)
    fila.transicionar('p-a', WS, a.id, 'REVIEWING', undefined, a.token)
    fila.transicionar('p-a', WS, a.id, 'PR_CI', undefined, a.token)
    expect(() => fila.concluir('p-a', WS, a.id, a.token, true)).toThrow(/crash/)

    expect(estado(a.id)).toBe('PR_CI')
    expect(slotDe(a.id)).toBeDefined()

    pool.encerrarDoRun = original
    expect(fila.concluir('p-a', WS, a.id, a.token, true).reason).toBe('transicionado')
    expect(slotDe(a.id)).toBeUndefined()
  })
})

describe('supervisionar — o dono pode estar neste processo (varredura periódica)', () => {
  it('lease vencido e sem container NÃO bloqueia: ninguém garante que o dono renova o lease', () => {
    // Run esperando o CI (sandbox já removido) ou ainda no preflight (container ainda não criado).
    const a = executando('p-a')
    expirar()

    const achados = recuperacao.supervisionar()

    expect(estado(a.id)).toBe('RUNNING')
    expect(slotDe(a.id)).toBeDefined()
    expect(achados.find((x) => x.recurso === `run:${a.id}`)?.decisao).toBe('intacto')
  })

  it('a varredura periódica não consulta o Docker quando a decisão independe dele', () => {
    const consultas: string[] = []
    // O serviço nasce antes do run: o run é deste processo, não herdado.
    const periodica = new RecuperacaoService({
      runs,
      leases,
      pool,
      fila,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      executor: (runId) => {
        consultas.push(runId)
        return 'morto'
      },
      mergeEmCurso: () => false,
      agora: () => relogio
    })
    const a = executando('p-a')
    expirar()

    periodica.supervisionar()

    expect(consultas).toEqual([])
    expect(estado(a.id)).toBe('RUNNING')
  })

  it('com a renovação do lease garantida, a varredura periódica volta a bloquear o run perdido', () => {
    const a = executando('p-a')
    const garantida = new RecuperacaoService({
      runs,
      leases,
      pool,
      fila,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      executor: () => 'morto',
      mergeEmCurso: () => false,
      renovacaoGarantida: true,
      agora: () => relogio
    })
    expirar()

    garantida.supervisionar()

    expect(estado(a.id)).toBe('BLOCKED')
  })
})

describe('supervisionar — recuperação por run, sem interromper fatia saudável', () => {
  it('run ativo com lease vigente não é tocado', () => {
    const a = executando('p-a')
    executores.set(a.id, 'morto')

    recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('RUNNING')
    expect(slotDe(a.id)).toBeDefined()
  })

  it('lease expirado e executor morto: o run vai a BLOCKED e o slot volta', () => {
    const a = executando('p-a')
    const b = pronto('p-b')
    fila.adquirirSlot('p-b', WS, b)
    expirar()

    const achados = recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('BLOCKED')
    expect(slotDe(a.id)).toBeUndefined()
    expect(achados.some((x) => x.recurso === `run:${a.id}` && x.decisao === 'liberado')).toBe(true)
    // A fila andou: quem esperava adquiriu.
    expect(estado(b)).toBe('RUNNING')
  })

  it('o bloqueio carrega os cinco campos da CONVENTION e a ação de retomada', () => {
    const a = executando('p-a')
    expirar()

    recuperacao.supervisionar({ aoSubir: true })

    const bloqueio = runs.buscar(a.id)?.bloqueio
    expect(bloqueio?.causa).toBe('executor-perdido')
    expect(bloqueio?.evidencia).toMatch(/lease/i)
    expect(bloqueio?.porQueNaoSeguir.trim()).not.toBe('')
    expect(bloqueio?.retomada).toMatch(/continuaDe|vinculado/i)
    expect(bloqueio?.tentativas).toBe(0)
  })

  it('boot: lease expirado com o container de pé (o app caiu) para o container, bloqueia o run e devolve o slot', () => {
    const a = executando('p-a')
    const b = pronto('p-b')
    fila.adquirirSlot('p-b', WS, b)
    executores.set(a.id, 'vivo')
    paradosAoLiberar.add(a.id)
    expirar()

    const achados = recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('BLOCKED')
    expect(liberados).toContain(a.id)
    expect(slotDe(a.id)).toBeUndefined()
    expect(achados.find((x) => x.recurso === `run:${a.id}`)?.decisao).toBe('liberado')
    // A causa diz a verdade: não foi "container não encontrado", foi container sem ninguém.
    const bloqueio = runs.buscar(a.id)?.bloqueio
    expect(bloqueio?.causa).toBe('executor-perdido')
    expect(bloqueio?.evidencia).toMatch(/sobreviveu|sem dono|caiu/i)
    expect(bloqueio?.retomada).toMatch(/continuaDe|vinculado/i)
    // A fila andou: quem esperava o slot adquiriu.
    expect(estado(b)).toBe('RUNNING')
  })

  it('boot: se o container não parar, o slot continua preso — nunca se passa a vez com executor de pé', () => {
    const a = executando('p-a')
    executores.set(a.id, 'vivo')
    // O isolamento não consegue parar o container: continua vivo depois da tentativa.
    expirar()

    recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('BLOCKED')
    expect(slotDe(a.id)).toBeDefined()
  })

  it('boot: lease vigente com o container de pé não é tocado — o dono renovou há pouco', () => {
    const a = executando('p-a')
    executores.set(a.id, 'vivo')

    recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('RUNNING')
    expect(liberados).toEqual([])
  })

  it('varredura periódica: lease expirado com o container de pé é lentidão, o run segue intacto', () => {
    const periodica = new RecuperacaoService({
      runs,
      leases,
      pool,
      fila,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      executor: () => 'vivo',
      mergeEmCurso: () => false,
      renovacaoGarantida: true,
      agora: () => relogio
    })
    const a = executando('p-a')
    executores.set(a.id, 'vivo')
    expirar()

    periodica.supervisionar()

    expect(estado(a.id)).toBe('RUNNING')
    expect(slotDe(a.id)).toBeDefined()
  })

  describe('o run que o boot herdou não tem dono neste processo, nem depois de o lease vencer', () => {
    const periodica = (): InstanceType<typeof RecuperacaoService> =>
      new RecuperacaoService({
        runs,
        leases,
        pool,
        fila,
        audit: new AuditRepository(db, 'chave-de-teste'),
        userId: () => USER,
        isolamento: {
          liberarRunEUnidades: (runId) => {
            liberados.push(runId)
            if (paradosAoLiberar.has(runId)) executores.set(runId, 'morto')
            return { removidos: [], pendencias: [] }
          }
        },
        executor: (runId) => executores.get(runId) ?? 'morto',
        mergeEmCurso: () => false,
        renovacaoGarantida: true,
        agora: () => relogio
      })

    it('reinício rápido: o lease ainda valia no boot; quando vence com o container de pé, a varredura bloqueia', () => {
      // O app cai e volta em menos de 30 s: no boot o slot está vigente e nada se decide. O
      // container (`sleep infinity`) segue de pé, e ninguém neste processo vai renová-lo.
      const a = executando('p-a')
      executores.set(a.id, 'vivo')
      paradosAoLiberar.add(a.id)
      const servico = periodica()
      servico.supervisionar({ aoSubir: true })
      expect(estado(a.id)).toBe('RUNNING')

      expirar()
      servico.supervisionar()

      expect(estado(a.id)).toBe('BLOCKED')
      expect(liberados).toContain(a.id)
      expect(slotDe(a.id)).toBeUndefined()
    })

    it('a varredura do boot que falhou não deixa o run desprotegido: o critério é o token, não uma passada', () => {
      // Se o boot nunca chegou a varrer (SQLite ocupado, exceção engolida pela reconciliação), o
      // run continua herdado — o teto de fencing token foi fixado quando o serviço nasceu.
      const a = executando('p-a')
      executores.set(a.id, 'vivo')
      paradosAoLiberar.add(a.id)
      const servico = periodica()
      expirar()

      servico.supervisionar()

      expect(estado(a.id)).toBe('BLOCKED')
      expect(slotDe(a.id)).toBeUndefined()
    })

    it('o run adquirido depois do boot é deste processo: lease vencido com container de pé segue sendo lentidão', () => {
      const servico = periodica()
      servico.supervisionar({ aoSubir: true })
      const a = executando('p-a')
      executores.set(a.id, 'vivo')
      expirar()

      servico.supervisionar()

      expect(estado(a.id)).toBe('RUNNING')
      expect(slotDe(a.id)).toBeDefined()
    })
  })

  it('lease expirado com executor indeterminado: nada é tocado', () => {
    const a = executando('p-a')
    executores.set(a.id, 'desconhecido')
    expirar()

    const achados = recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('RUNNING')
    expect(achados.find((x) => x.recurso === `run:${a.id}`)?.decisao).toBe('bloqueado')
  })

  it('merge em curso: o run não é bloqueado por suposição', () => {
    const a = executando('p-a')
    fila.transicionar('p-a', WS, a.id, 'VALIDATING', undefined, a.token)
    fila.transicionar('p-a', WS, a.id, 'REVIEWING', undefined, a.token)
    fila.transicionar('p-a', WS, a.id, 'PR_CI', undefined, a.token)
    mergesEmCurso.add(a.id)
    expirar()

    recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('PR_CI')
    expect(slotDe(a.id)).toBeDefined()
  })

  it('falha de um run não toca o outro: o saudável mantém slot, estado e travas', () => {
    // Capacidade 2 e prova de independência aceita: dois runs em execução ao mesmo tempo.
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const a = executando('p-a')
    const b = executando('p-b')
    expect(slotDe(b.id)).toBeDefined()

    // O heartbeat de b renova; o de a para.
    relogio += VALIDADE_DO_LEASE_MS - 1_000
    expect(fila.renovarSlot(b.id, b.token)).toBe(true)
    relogio += 2_000
    executores.set(b.id, 'vivo')

    recuperacao.supervisionar({ aoSubir: true })

    expect(estado(a.id)).toBe('BLOCKED')
    expect(slotDe(a.id)).toBeUndefined()
    expect(estado(b.id)).toBe('RUNNING')
    expect(slotDe(b.id)).toBeDefined()
    expect(liberados).not.toContain(b.id)
  })

  it('run terminal que ainda segura slot (crash entre o terminal e a liberação) é recolhido', () => {
    const a = executando('p-a')
    // Simula o crash: o run virou CANCELLED no banco, sem passar pela fila nem pelo gancho.
    runs.transicionar(a.id, 'RUNNING', 'CANCELLED', new Date(relogio))
    expect(slotDe(a.id)).toBeDefined()

    recuperacao.supervisionar({ aoSubir: true })

    expect(slotDe(a.id)).toBeUndefined()
  })

  it('a falha ao recuperar um run não impede a varredura dos outros', () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const a = executando('p-a')
    const b = executando('p-b')
    runs.transicionar(a.id, 'RUNNING', 'CANCELLED', new Date(relogio))
    runs.transicionar(b.id, 'RUNNING', 'CANCELLED', new Date(relogio))
    const original = recuperacao.recolher.bind(recuperacao)
    recuperacao.recolher = (runId) => {
      if (runId === a.id) throw new Error('sqlite ocupado')
      return original(runId)
    }

    const achados = recuperacao.supervisionar()

    expect(slotDe(b.id)).toBeUndefined()
    expect(achados.find((x) => x.recurso === `run:${a.id}`)?.decisao).toBe('bloqueado')
  })

  it('é idempotente: rodar de novo sem mudança não escreve nada', () => {
    const a = executando('p-a')
    expirar()
    recuperacao.supervisionar({ aoSubir: true })
    const eventos = (): number =>
      (db.prepare('SELECT COUNT(*) AS n FROM audit_event').get() as { n: number }).n
    const antes = eventos()

    recuperacao.supervisionar({ aoSubir: true })

    expect(eventos()).toBe(antes)
    expect(estado(a.id)).toBe('BLOCKED')
  })
})
