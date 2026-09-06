/**
 * A fila, os leases e a reconciliação contra o SQLite real (SPEC-Entrega-02, Banco).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o serviço dizer que recusou — o
 * banco tem de confirmar que a linha não mudou. Um teste que só lesse o `reason` devolvido
 * passaria com um serviço que recusa e grava mesmo assim.
 *
 * As garantias que só este nível alcança:
 *  - **WIP=1 é global** (critério 2): o segundo run, de **outro projeto**, não adquire o slot — e
 *    a tabela `lease` continua com uma linha só;
 *  - **lease expirado não autoriza roubo** (critério 3): a aquisição recusa e a linha do dono
 *    original permanece intacta;
 *  - **crash converge** (critério 4): reconciliar duas vezes dá o mesmo resultado, e readquirir o
 *    próprio lease não duplica;
 *  - **`AWAITING_PI` sem `Approval` não vira `READY`** (critério 7), medido no banco;
 *  - **kill-switch escolhe o terminal** (critério 7), nos dois caminhos.
 *
 * O relógio é injetado e avançado à mão (`let relogio`), o padrão já estabelecido em
 * `routing-repository.int-spec.ts` e `github-auth.int-spec.ts`: `vi.useFakeTimers()` não alcança
 * o `expira_em` que o banco guarda como inteiro.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { RECURSO_WIP_GLOBAL, VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PipelineRepository } = await import('./pipeline-repository')
const { LeaseRepository } = await import('./lease-repository')
const { EffectJournalRepository } = await import('./effect-journal-repository')
const { FilaService } = await import('./fila-service')
const { ReconciliacaoService } = await import('./reconciliacao-service')
const { MergePolicyRepository } = await import('./merge-policy-repository')
const { MergePolicyService } = await import('./merge-policy-service')

const USER = 'u-1'
const WS = 'jarvis' as const
const PROJETO_A = 'p-a'
const PROJETO_B = 'p-b'
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
  },
  {
    id: 'f2',
    mvpId: 'm1',
    numero: 2,
    titulo: 'Fatia 2',
    specSlug: 'spec-f2',
    detalhada: true,
    origem
  }
]

/** As revisões que o gate `SLICE_ENTRY` cobre — o mesmo formato que a M8-F06 grava. */
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]

function aprovacaoDoPi(): Approval {
  return {
    id: 'a-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO_A,
    gate: 'SLICE_ENTRY',
    revisoes: REVISOES,
    identidade: 'sessao-1',
    autor: 'pi',
    created_at: new Date(AGORA).toISOString()
  }
}

const BLOQUEIO: BloqueioExterno = {
  causa: 'docker-indisponivel',
  evidencia: 'daemon não respondeu em 30s',
  tentativas: 2,
  porQueNaoSeguir: 'Sem sandbox, o executor rodaria no host.',
  retomada: 'Subir o Docker Desktop e retomar a fatia.'
}

let dir: string
let db: Db
let relogio: number
let aprovacoes: Approval[]
let runs: InstanceType<typeof PipelineRepository>
let leases: InstanceType<typeof LeaseRepository>
let fila: InstanceType<typeof FilaService>
let mergeLigado: boolean

function leaseNoBanco(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM lease').get() as { n: number }).n
}

function estadoNoBanco(runId: string): string | undefined {
  const row = db.prepare('SELECT estado FROM pipeline_run WHERE id = ?').get(runId) as
    { estado: string } | undefined
  return row?.estado
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-fila-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  aprovacoes = []
  mergeLigado = true

  runs = new PipelineRepository(db)
  leases = new LeaseRepository(db)

  fila = new FilaService({
    runs,
    leases,
    audit: new AuditRepository(db, 'chave-de-teste'),
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: () => aprovacoes,
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => mergeLigado,
    agora: () => relogio
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Leva um run até `READY`, com o gate aprovado. */
function runPronto(projectId = PROJETO_A, sliceId = 'f1'): string {
  aprovacoes = [aprovacaoDoPi()]
  const run = fila.criarRun(projectId, WS, sliceId)
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  return run.id
}

describe('máquina de estados contra o banco', () => {
  it('grava a transição válida e recusa a inválida sem tocar a linha', () => {
    const run = fila.criarRun(PROJETO_A, WS, 'f1')

    expect(fila.transicionar(PROJETO_A, WS, run.id, 'AWAITING_PI').reason).toBe('transicionado')
    expect(estadoNoBanco(run.id)).toBe('AWAITING_PI')

    // O pulo do critério 5, medido no banco: a linha não pode ter mudado.
    const recusa = fila.transicionar(PROJETO_A, WS, run.id, 'MERGED')

    expect(recusa.reason).toBe('transicao-invalida')
    expect(estadoNoBanco(run.id)).toBe('AWAITING_PI')
  })

  it('recusa BLOCKED sem os cinco campos e não grava bloqueio nenhum (critério 6)', () => {
    const runId = runPronto()

    const semCampos = fila.transicionar(PROJETO_A, WS, runId, 'BLOCKED', {
      causa: 'x',
      evidencia: '',
      tentativas: 1,
      porQueNaoSeguir: '',
      retomada: ''
    })

    expect(semCampos.reason).toBe('bloqueio-incompleto')
    expect(estadoNoBanco(runId)).toBe('READY')
    const row = db.prepare('SELECT bloqueio FROM pipeline_run WHERE id = ?').get(runId) as {
      bloqueio: string | null
    }
    expect(row.bloqueio).toBeNull()
  })

  it('grava o bloqueio completo com os cinco campos', () => {
    const runId = runPronto()

    expect(fila.transicionar(PROJETO_A, WS, runId, 'BLOCKED', BLOQUEIO).reason).toBe(
      'transicionado'
    )
    expect(runs.buscar(runId)?.bloqueio).toEqual(BLOQUEIO)
  })

  it('recusa qualquer transição a partir de um run terminal', () => {
    const runId = runPronto()
    fila.transicionar(PROJETO_A, WS, runId, 'BLOCKED', BLOQUEIO)

    const depois = fila.transicionar(PROJETO_A, WS, runId, 'RUNNING')

    expect(depois.reason).toBe('run-terminal')
    expect(estadoNoBanco(runId)).toBe('BLOCKED')
  })

  it('vincula a retomada ao run bloqueado em vez de reabri-lo', () => {
    const primeiro = runPronto()
    fila.transicionar(PROJETO_A, WS, primeiro, 'BLOCKED', BLOQUEIO)

    const continuacao = fila.criarRun(PROJETO_A, WS, 'f1', primeiro)

    expect(continuacao.continuaDe).toBe(primeiro)
    expect(estadoNoBanco(primeiro)).toBe('BLOCKED')
    expect(
      runs.listarDaFatia({ userId: USER, workspaceId: WS, projectId: PROJETO_A }, 'f1')
    ).toHaveLength(2)
  })
})

describe('gate SLICE_ENTRY (critério 7)', () => {
  it('não deixa AWAITING_PI virar READY sem Approval vigente', () => {
    const run = fila.criarRun(PROJETO_A, WS, 'f1')
    fila.transicionar(PROJETO_A, WS, run.id, 'AWAITING_PI')

    const recusa = fila.transicionar(PROJETO_A, WS, run.id, 'READY')

    expect(recusa.reason).toBe('sem-aprovacao-vigente')
    expect(estadoNoBanco(run.id)).toBe('AWAITING_PI')
  })

  it('recusa quando a SPEC mudou depois da aprovação: o hash não bate mais', () => {
    // É o critério 4 da M8-F06 valendo aqui: aprovar o texto antigo não aprova o novo.
    aprovacoes = [{ ...aprovacaoDoPi(), revisoes: [{ artefato: 'spec-f1', hash: 'hash-antigo' }] }]
    const run = fila.criarRun(PROJETO_A, WS, 'f1')
    fila.transicionar(PROJETO_A, WS, run.id, 'AWAITING_PI')

    expect(fila.transicionar(PROJETO_A, WS, run.id, 'READY').reason).toBe('sem-aprovacao-vigente')
  })

  it('libera READY com a aprovação vigente do PI', () => {
    aprovacoes = [aprovacaoDoPi()]
    const run = fila.criarRun(PROJETO_A, WS, 'f1')
    fila.transicionar(PROJETO_A, WS, run.id, 'AWAITING_PI')

    expect(fila.transicionar(PROJETO_A, WS, run.id, 'READY').reason).toBe('transicionado')
    expect(estadoNoBanco(run.id)).toBe('READY')
  })

  it('recusa READY quando a fatia anterior não concluiu (invariante 5)', () => {
    aprovacoes = [{ ...aprovacaoDoPi(), revisoes: REVISOES }]
    const run = fila.criarRun(PROJETO_A, WS, 'f2')
    fila.transicionar(PROJETO_A, WS, run.id, 'AWAITING_PI')

    const recusa = fila.transicionar(PROJETO_A, WS, run.id, 'READY')

    expect(recusa.reason).toBe('dependencia-aberta')
    expect(estadoNoBanco(run.id)).toBe('AWAITING_PI')
  })
})

describe('slot global de WIP (critério 2)', () => {
  it('deixa um run adquirir e o leva a RUNNING', () => {
    const runId = runPronto()

    const resultado = fila.adquirirSlot(PROJETO_A, WS, runId)

    expect(resultado.reason).toBe('adquirido')
    expect(estadoNoBanco(runId)).toBe('RUNNING')
    expect(leaseNoBanco()).toBe(1)
  })

  it('impede duas fatias simultâneas de PROJETOS DIFERENTES (WIP global)', () => {
    // A emenda 1 de 2026-08-30 na forma mais direta: o slot é da máquina, não do projeto.
    const primeiro = runPronto(PROJETO_A, 'f1')
    fila.adquirirSlot(PROJETO_A, WS, primeiro)

    const segundo = runPronto(PROJETO_B, 'f1')
    const recusa = fila.adquirirSlot(PROJETO_B, WS, segundo)

    expect(recusa.reason).toBe('ocupado')
    expect(estadoNoBanco(segundo)).toBe('READY')
    expect(leaseNoBanco()).toBe(1)
  })

  it('libera o slot e deixa o próximo run entrar', () => {
    const primeiro = runPronto(PROJETO_A, 'f1')
    fila.adquirirSlot(PROJETO_A, WS, primeiro)
    fila.liberarSlot(PROJETO_A, WS, primeiro)

    expect(leaseNoBanco()).toBe(0)

    const segundo = runPronto(PROJETO_B, 'f1')
    expect(fila.adquirirSlot(PROJETO_B, WS, segundo).reason).toBe('adquirido')
  })

  it('não deixa um run renovar o lease de outro', () => {
    const dono = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, dono)

    expect(fila.renovarSlot('run-intruso')).toBe(false)
    expect(leases.buscar(USER, RECURSO_WIP_GLOBAL)?.proprietario).toBe(dono)
  })
})

describe('lease expirado (critério 3)', () => {
  it('NÃO autoriza roubo: recusa e mantém a linha do dono original', () => {
    const dono = runPronto(PROJETO_A, 'f1')
    fila.adquirirSlot(PROJETO_A, WS, dono)

    relogio = AGORA + VALIDADE_DO_LEASE_MS + 1

    const ladrao = runPronto(PROJETO_B, 'f1')
    const recusa = fila.adquirirSlot(PROJETO_B, WS, ladrao)

    expect(recusa.reason).toBe('expirado-requer-reconciliacao')
    expect(leaseNoBanco()).toBe(1)
    expect(leases.buscar(USER, RECURSO_WIP_GLOBAL)?.proprietario).toBe(dono)
    expect(estadoNoBanco(ladrao)).toBe('READY')
  })

  it('deixa o heartbeat do dono empurrar a expiração e manter o slot', () => {
    const dono = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, dono)

    relogio = AGORA + VALIDADE_DO_LEASE_MS - 1
    expect(fila.renovarSlot(dono)).toBe(true)

    // Depois da renovação, o instante que teria expirado o lease original já não expira.
    relogio = AGORA + VALIDADE_DO_LEASE_MS + 1
    expect(leases.buscar(USER, RECURSO_WIP_GLOBAL)?.expiraEm).toBeGreaterThan(relogio)
  })
})

describe('convergência depois de crash (critério 4)', () => {
  it('readquirir o próprio lease vigente é idempotente e não duplica linha', () => {
    const runId = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, runId)

    // O retry depois de um crash entre gravar o lease e confirmar: o mesmo dono, de novo.
    const segunda = fila.adquirirSlot(PROJETO_A, WS, runId)

    // Converge para o mesmo resultado da primeira chamada, sem duplicar nem perder o lease.
    expect(segunda.reason).toBe('adquirido')
    expect(leaseNoBanco()).toBe(1)
    expect(leases.buscar(USER, RECURSO_WIP_GLOBAL)?.proprietario).toBe(runId)
    expect(estadoNoBanco(runId)).toBe('RUNNING')
  })

  it('reconciliação roda duas vezes e converge para o mesmo resultado', async () => {
    const runId = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, runId)
    // O run morreu: some do processo, mas a linha e o lease ficam.
    fila.transicionar(PROJETO_A, WS, runId, 'BLOCKED', BLOQUEIO)
    relogio = AGORA + VALIDADE_DO_LEASE_MS + 1

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      agora: () => relogio
    })

    const primeira = await reconciliacao.reconcileAll()
    const segunda = await reconciliacao.reconcileAll()

    // O lease do run terminado cai na primeira; a segunda não encontra mais nada a fazer.
    expect(primeira.some((a) => a.decisao === 'liberado')).toBe(true)
    expect(leaseNoBanco()).toBe(0)
    expect(segunda.some((a) => a.decisao === 'liberado')).toBe(false)
    expect(reconciliacao.slotLivre()).toBe(true)
  })

  it('NÃO libera lease expirado cujo run dono ainda está ativo', async () => {
    // Expiração pode ser máquina lenta, não processo morto (decisão cravada da spec).
    const runId = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, runId)
    relogio = AGORA + VALIDADE_DO_LEASE_MS + 1

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      agora: () => relogio
    })

    const achados = await reconciliacao.reconcileAll()

    expect(achados.find((a) => a.recurso === RECURSO_WIP_GLOBAL)?.decisao).toBe('bloqueado')
    expect(leaseNoBanco()).toBe(1)
  })

  it('respeita o verificador da M9-F03: recurso em uso não é liberado', async () => {
    const runId = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, runId)
    fila.transicionar(PROJETO_A, WS, runId, 'BLOCKED', BLOQUEIO)
    relogio = AGORA + VALIDADE_DO_LEASE_MS + 1

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      verificadores: [{ prefixo: 'wip:', emUso: () => true }],
      agora: () => relogio
    })

    const achados = await reconciliacao.reconcileAll()

    expect(achados.find((a) => a.recurso === RECURSO_WIP_GLOBAL)?.decisao).toBe('bloqueado')
    expect(leaseNoBanco()).toBe(1)
  })

  it('lê o EffectJournal como fonte da intenção: entrada pendente bloqueia (critério 5, issue #209)', async () => {
    const efeitos = new EffectJournalRepository(db)
    efeitos.registrarIntencao(
      {
        userId: USER,
        workspaceId: WS,
        chaveIdempotente: 'idem-orfa',
        fingerprint: 'fp-1',
        alvo: 'github:issues.create',
        correlationId: 'corr-1'
      },
      () => new Date(relogio).toISOString()
    )

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      effectJournal: efeitos,
      userId: () => USER,
      workspaceId: () => WS,
      agora: () => relogio
    })

    const achados = await reconciliacao.reconcileAll()

    expect(achados.find((a) => a.recurso === 'efeito:idem-orfa')?.decisao).toBe('bloqueado')
    // A entrada continua pendente — a reconciliação não decide sozinha se o efeito aconteceu.
    expect(efeitos.buscarPorChave(USER, 'idem-orfa')?.estado).toBe('pendente')
  })

  it('reconciliação roda duas vezes sobre uma entrada pendente do diário e converge (critério 4)', async () => {
    const efeitos = new EffectJournalRepository(db)
    efeitos.registrarIntencao(
      {
        userId: USER,
        workspaceId: WS,
        chaveIdempotente: 'idem-orfa',
        fingerprint: 'fp-1',
        alvo: 'github:issues.create',
        correlationId: 'corr-1'
      },
      () => new Date(relogio).toISOString()
    )

    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      effectJournal: efeitos,
      userId: () => USER,
      workspaceId: () => WS,
      agora: () => relogio
    })

    const primeira = await reconciliacao.reconcileAll()
    const segunda = await reconciliacao.reconcileAll()

    expect(primeira.filter((a) => a.recurso === 'efeito:idem-orfa')).toHaveLength(1)
    expect(segunda.filter((a) => a.recurso === 'efeito:idem-orfa')).toHaveLength(1)
  })

  it('sem effectJournal nas deps, a reconciliação continua funcionando (fatias sem efeito externo)', async () => {
    const reconciliacao = new ReconciliacaoService({
      runs,
      leases,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      agora: () => relogio
    })

    await expect(reconciliacao.reconcileAll()).resolves.toBeDefined()
  })
})

describe('kill-switch do merge (critério 7)', () => {
  function ateOPrCi(): string {
    const runId = runPronto()
    fila.adquirirSlot(PROJETO_A, WS, runId)
    fila.transicionar(PROJETO_A, WS, runId, 'VALIDATING')
    fila.transicionar(PROJETO_A, WS, runId, 'PR_CI')
    return runId
  }

  it('com merge autônomo LIGADO, o run termina em MERGED', () => {
    mergeLigado = true
    const runId = ateOPrCi()

    expect(fila.concluir(PROJETO_A, WS, runId).reason).toBe('transicionado')
    expect(estadoNoBanco(runId)).toBe('MERGED')
  })

  it('com merge autônomo DESLIGADO, o run termina em AWAITING_MERGE — nunca em BLOCKED', () => {
    mergeLigado = false
    const runId = ateOPrCi()

    fila.concluir(PROJETO_A, WS, runId)

    expect(estadoNoBanco(runId)).toBe('AWAITING_MERGE')
    expect(estadoNoBanco(runId)).not.toBe('BLOCKED')
  })

  it('libera o slot nos dois desfechos: terminal não segura a fila', () => {
    mergeLigado = false
    const runId = ateOPrCi()
    fila.concluir(PROJETO_A, WS, runId)

    expect(leaseNoBanco()).toBe(0)
  })

  it('AWAITING_MERGE não conta como fatia concluída para a fila', () => {
    // O PR está verde, mas não mergeou: a fatia seguinte construiria sobre base inexistente.
    mergeLigado = false
    const runId = ateOPrCi()
    fila.concluir(PROJETO_A, WS, runId)

    const concluidas = runs.fatiasConcluidas({
      userId: USER,
      workspaceId: WS,
      projectId: PROJETO_A
    })

    expect(concluidas).toHaveLength(0)
  })
})

describe('política de merge persistida', () => {
  // Sem valor default: `servico(undefined)` precisa mesmo chegar como `undefined` ao serviço —
  // um default do TS transformaria o teste do fail-closed num teste do caminho feliz.
  function servico(identidade?: string): InstanceType<typeof MergePolicyService> {
    return new MergePolicyService({
      repository: new MergePolicyRepository(db),
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      identidade: () => identidade,
      agora: () => relogio
    })
  }

  it('nasce ligado sem linha no banco: a ausência é o default', () => {
    expect(servico('sessao-1').autonomoLigado(PROJETO_A)).toBe(true)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM project_merge_policy').get() as { n: number }).n
    ).toBe(0)
  })

  it('desliga, persiste e audita a mudança como ação sensível', () => {
    const s = servico('sessao-1')

    expect(s.definir(PROJETO_A, WS, false).reason).toBe('definido')
    expect(s.autonomoLigado(PROJETO_A)).toBe(false)

    const eventos = new AuditRepository(db, 'chave-de-teste')
      .list(USER)
      .filter((e) => e.type === 'merge-policy-change')

    expect(eventos).toHaveLength(1)
  })

  it('não grava nem audita quando a política já era essa', () => {
    const s = servico('sessao-1')

    expect(s.definir(PROJETO_A, WS, true).reason).toBe('sem-mudanca')
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM project_merge_policy').get() as { n: number }).n
    ).toBe(0)
  })

  it('falha fechado sem identidade: nenhuma linha é gravada', () => {
    expect(servico(undefined).definir(PROJETO_A, WS, false).reason).toBe('sem-identidade')
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM project_merge_policy').get() as { n: number }).n
    ).toBe(0)
  })

  it('mantém o kill-switch por projeto: desligar em A não desliga em B', () => {
    const s = servico('sessao-1')
    s.definir(PROJETO_A, WS, false)

    expect(s.autonomoLigado(PROJETO_A)).toBe(false)
    expect(s.autonomoLigado(PROJETO_B)).toBe(true)
  })
})
