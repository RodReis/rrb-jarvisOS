/**
 * O merge serializado contra SQLite real (SPEC-Scheduler-04, categoria Banco).
 *
 * **O GitHub entra por um dublê com estado**, e o dublê responde no formato exato do adapter real
 * (`pr.merge-state` só traz `mergeSha` com `merged: true`; `rules` e proteção separados). O que se
 * prova aqui é a *orquestração sob o lease*: quem entra na seção crítica, o que se relê da origem
 * antes de agir, o que acontece quando o processo morre antes, durante e depois do efeito.
 *
 * Um dublê que respondesse sempre "tudo igual" aprovaria qualquer sequência — inclusive a corrida
 * que o lease existe para impedir. Por isso o merge **muda a origem**: depois que um PR entra, a
 * base avança de verdade, e o segundo PR enxerga isso.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import type { RegraObservada, SnapshotDeRuleset } from '@shared/domain/ruleset'
import type { TentativaDeMerge } from './merge-repository'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { GITHUB_OPERATIONS, MENSAGEM_DE_CONFLITO_NA_ATUALIZACAO } =
  await import('@shared/domain/github-automation')
const { chaveDoMerge, recursoDoMerge } = await import('@shared/domain/merge-serializado')
const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { MergeRepository } = await import('./merge-repository')
const { PipelineRepository } = await import('./pipeline-repository')
const { PoolRepository } = await import('./pool-repository')
const { MergeService } = await import('./merge-service')

const USER = 'u-1'
const WS = 'jarvis' as WorkspaceId
const OWNER = 'RodReis'
const REPO = 'projeto-alvo'
const BASE = 'main'
const RECURSO = recursoDoMerge(OWNER, REPO, BASE)
const AGORA = 1_700_000_000_000
const SHA_BASE_0 = '0'.repeat(40)

interface Pr {
  headSha: string
  aberto: boolean
  merged: boolean
  mergeSha?: string
}

interface Origem {
  prs: Map<number, Pr>
  baseSha: string
  protecao: { contexts: string[]; strict: boolean; protegida: boolean; mergeQueue: boolean }
  rulesets: { contextsExigidos: string[]; mergeQueue: boolean; tipos: string[] }
  conflitoNaAtualizacao: boolean
  /** Quantas chamadas seguintes de cada operação devem falhar (origem fora do ar). */
  falhas: Map<string, number>
}

interface Chamada {
  operation: string
  input: Record<string, unknown>
  idempotencyKey: string | undefined
  efeito: { recurso: string; fencingToken: number } | undefined
}

let dir: string
let db: Db
let origem: Origem
let chamadas: Chamada[]
/** Gancho **dentro** do `squashMerge`: segura a chamada, ou a mata no meio. */
let duranteOMerge: ((pr: number) => Promise<void> | void) | undefined
let leases: InstanceType<typeof LeaseRepository>
let merges: InstanceType<typeof MergeRepository>
let runs: InstanceType<typeof PipelineRepository>
let aoMergear: Mock<(runId: string) => void>
let aoReconciliarMergeado: Mock<(tentativa: TentativaDeMerge) => void>

const deQuantos = (operation: string): Chamada[] =>
  chamadas.filter((c) => c.operation === operation)

function falhar(operation: string): ConnectorOutcome {
  return {
    ok: false,
    code: 'indisponivel',
    mensagem: 'origem fora do ar',
    retryable: true,
    acao: 'retentar',
    provenance: { connector: 'github', operation, obtidoEm: 'agora' }
  } as ConnectorOutcome
}

function conector(): { call: (r: ConnectorRequest, ctx?: unknown) => Promise<ConnectorOutcome> } {
  return {
    call: async (request, ctx): Promise<ConnectorOutcome> => {
      const input = (request.input ?? {}) as Record<string, unknown>
      const efeito = (ctx as { efeito?: Chamada['efeito'] } | undefined)?.efeito
      chamadas.push({
        operation: request.operation,
        input,
        idempotencyKey: request.idempotencyKey,
        efeito
      })

      const pendentes = origem.falhas.get(request.operation) ?? 0
      if (pendentes > 0) {
        origem.falhas.set(request.operation, pendentes - 1)
        return falhar(request.operation)
      }

      const ok = (data: unknown): ConnectorOutcome =>
        ({
          ok: true,
          data,
          provenance: { connector: 'github', operation: request.operation, obtidoEm: 'agora' },
          usage: { creditos: 0, latenciaMs: 1 }
        }) as unknown as ConnectorOutcome

      const numero = Number(input.pullRequest)
      const pr = origem.prs.get(numero)

      switch (request.operation) {
        case GITHUB_OPERATIONS.getMergeState:
          if (pr === undefined) return falhar(request.operation)
          return ok({
            numero,
            estado: pr.aberto ? 'open' : 'closed',
            merged: pr.merged,
            ...(pr.merged ? { mergeSha: pr.mergeSha } : {}),
            headSha: pr.headSha
          })

        case GITHUB_OPERATIONS.getCommitSha:
          return ok({ ref: input.ref, sha: origem.baseSha })

        case GITHUB_OPERATIONS.getRequiredChecks:
          return ok({
            branch: input.branch,
            contexts: [...origem.protecao.contexts],
            strict: origem.protecao.strict,
            protegida: origem.protecao.protegida,
            mergeQueueExigida: origem.protecao.mergeQueue
          })

        case GITHUB_OPERATIONS.getRulesForBranch:
          return ok({
            contextsExigidos: [...origem.rulesets.contextsExigidos],
            mergeQueue: origem.rulesets.mergeQueue,
            exigePullRequest: false,
            tipos: [...origem.rulesets.tipos]
          })

        case GITHUB_OPERATIONS.squashMerge: {
          if (pr === undefined) return falhar(request.operation)
          // O GitHub recusa o merge quando o head já não é o esperado.
          if (input.expectedHeadSha !== pr.headSha) {
            return {
              ok: false,
              code: 'validacao-invalida',
              mensagem: 'O head do pull request mudou.',
              retryable: false,
              acao: 'corrigir-entrada',
              provenance: { connector: 'github', operation: request.operation, obtidoEm: 'agora' }
            } as ConnectorOutcome
          }
          await duranteOMerge?.(numero)
          // O efeito acontece **na origem**: o PR entra e a base avança. É o que o segundo PR vê.
          pr.merged = true
          pr.aberto = false
          pr.mergeSha = `merge-${numero}`.padEnd(40, 'f')
          origem.baseSha = pr.mergeSha
          return ok({ mergeSha: pr.mergeSha, merged: true })
        }

        case GITHUB_OPERATIONS.updateBranch: {
          if (pr === undefined) return falhar(request.operation)
          if (origem.conflitoNaAtualizacao) {
            return {
              ok: false,
              code: 'validacao-invalida',
              mensagem: `${MENSAGEM_DE_CONFLITO_NA_ATUALIZACAO} detalhe`,
              retryable: false,
              acao: 'corrigir-entrada',
              provenance: { connector: 'github', operation: request.operation, obtidoEm: 'agora' }
            } as ConnectorOutcome
          }
          // A base entra na branch da fatia: o head **muda**, e os checks do head antigo deixam de valer.
          pr.headSha = `atualizado-${numero}-${origem.baseSha.slice(0, 6)}`.padEnd(40, '1')
          return ok({ aceito: true })
        }

        default:
          return ok({})
      }
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-merge-svc-'))
  db = openDatabase(join(dir, 'teste.db'))
  leases = new LeaseRepository(db)
  merges = new MergeRepository(db)
  runs = new PipelineRepository(db)
  chamadas = []
  duranteOMerge = undefined
  aoMergear = vi.fn()
  aoReconciliarMergeado = vi.fn()
  origem = {
    prs: new Map(),
    baseSha: SHA_BASE_0,
    protecao: { contexts: ['ci'], strict: false, protegida: true, mergeQueue: false },
    rulesets: { contextsExigidos: [], mergeQueue: false, tipos: [] },
    conflitoNaAtualizacao: false,
    falhas: new Map()
  }
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function servico(): InstanceType<typeof MergeService> {
  const pool = new PoolRepository(db)
  return new MergeService({
    connectors: conector() as never,
    leases,
    merges,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    proximoToken: () => pool.proximoToken(USER),
    aoMergear,
    aoReconciliarMergeado,
    agora: () => AGORA
  })
}

function runEm(estado: EstadoDoRun = 'PR_CI'): string {
  return runs.criar(
    { userId: USER, workspaceId: WS, projectId: 'p' },
    { sliceId: `s-${Math.random()}`, estado },
    new Date(AGORA)
  ).id
}

function abrirPr(numero: number, headSha: string): void {
  origem.prs.set(numero, { headSha, aberto: true, merged: false })
}

/** A regra que o `EntregaService` teria observado: a união de proteção e rulesets. */
function regraAtual(): RegraObservada {
  return {
    contexts: [
      ...new Set([...origem.protecao.contexts, ...origem.rulesets.contextsExigidos])
    ].sort(),
    strict: origem.protecao.strict,
    protegida: origem.protecao.protegida || origem.rulesets.tipos.length > 0,
    mergeQueueExigida: origem.protecao.mergeQueue || origem.rulesets.mergeQueue
  }
}

function pedidoDe(runId: string, pullRequest: number, avaliadoEm = origem.baseSha) {
  const pr = origem.prs.get(pullRequest)
  if (pr === undefined) throw new Error('PR não aberto no teste')
  const snapshot: SnapshotDeRuleset = {
    runId,
    branch: BASE,
    ...regraAtual(),
    ref: 'ref',
    observadoEm: 'agora'
  }
  return {
    runId,
    projectId: 'p',
    workspaceId: WS,
    alvo: { owner: OWNER, repo: REPO, branchBase: BASE },
    pullRequest,
    avaliacao: { headSha: pr.headSha, baseSha: avaliadoEm, snapshot }
  }
}

function segurar(): { liberar: () => void; ativo: Promise<void> } {
  let liberar!: () => void
  const ativo = new Promise<void>((resolve) => {
    liberar = resolve
  })
  return { liberar, ativo }
}

describe('o caminho feliz', () => {
  it('mergeia sob o lease, confirma a tentativa e devolve o lease', async () => {
    const a = runEm()
    abrirPr(7, 'h'.repeat(40))

    const r = await servico().tentar(pedidoDe(a, 7))

    expect(r.tipo).toBe('mergeado')
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1)
    expect(merges.buscarViva(USER, a, 7, 'h'.repeat(40))?.estado).toBe('confirmada')
    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
    expect(aoMergear).toHaveBeenCalledWith(a)
  })

  it('o merge leva o head esperado e uma chave de idempotência determinística', async () => {
    const a = runEm()
    abrirPr(7, 'h'.repeat(40))

    await servico().tentar(pedidoDe(a, 7))

    const merge = deQuantos(GITHUB_OPERATIONS.squashMerge)[0]
    expect(merge?.input.expectedHeadSha).toBe('h'.repeat(40))
    // Dono e repositório em minúsculas: a chave não muda com a caixa que o chamador escreveu.
    expect(merge?.idempotencyKey).toBe(chaveDoMerge(OWNER, REPO, 7, 'h'.repeat(40)))
  })

  it('a chamada do merge leva o lease do contexto: só o dono atual confirma o diário', async () => {
    const a = runEm()
    abrirPr(7, 'h'.repeat(40))

    await servico().tentar(pedidoDe(a, 7))

    const efeito = deQuantos(GITHUB_OPERATIONS.squashMerge)[0]?.efeito
    expect(efeito?.recurso).toBe(RECURSO)
    expect(efeito?.fencingToken).toBeGreaterThan(0)
  })

  it('o recurso é por repositório e base, sem distinguir a caixa de dono e repo', () => {
    expect(RECURSO).toBe('merge:rodreis/projeto-alvo:main')
  })
})

describe('corrida de dois PRs verdes (critérios 1 e 2)', () => {
  it('só um entra na seção crítica: o segundo recebe lease-ocupado sem tocar a origem', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    abrirPr(8, 'b'.repeat(40))
    // Os dois foram avaliados contra a mesma base e estão verdes.
    const pedidoA = pedidoDe(a, 7)
    const pedidoB = pedidoDe(b, 8)

    const preso = segurar()
    duranteOMerge = () => preso.ativo
    const emVoo = servico().tentar(pedidoA)
    await vi.waitFor(() => expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1))

    const segundo = await servico().tentar(pedidoB)

    expect(segundo).toEqual({ tipo: 'aguardar', motivo: 'lease-ocupado' })
    // O segundo nem leu nem mergeou nada: a seção crítica é exclusiva.
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1)
    expect(
      deQuantos(GITHUB_OPERATIONS.getMergeState).filter((c) => c.input.pullRequest === 8)
    ).toHaveLength(0)

    preso.liberar()
    expect((await emVoo).tipo).toBe('mergeado')
  })

  it('o segundo, depois do primeiro, vê a base nova: atualiza a branch e manda revalidar', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    abrirPr(8, 'b'.repeat(40))
    const pedidoB = pedidoDe(b, 8)
    await servico().tentar(pedidoDe(a, 7))

    const r = await servico().tentar(pedidoB)

    // Não mergeou: os checks verdes descreviam a base antiga.
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1)
    expect(deQuantos(GITHUB_OPERATIONS.updateBranch)).toHaveLength(1)
    expect(r.tipo).toBe('revalidar')
    if (r.tipo !== 'revalidar') return
    expect(r.motivo).toBe('base-atualizada')
    // O head mudou: os checks do SHA anterior não valem para ele, e o chamador os busca de novo.
    expect(r.headSha).toBeDefined()
    expect(r.headSha).not.toBe('b'.repeat(40))
    expect(r.headSha).toBe(origem.prs.get(8)?.headSha)
    // O lease foi devolvido: a base está livre para quem vier.
    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
  })

  it('o segundo mergeia depois de revalidar, contra a base e o head novos', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    abrirPr(8, 'b'.repeat(40))
    await servico().tentar(pedidoDe(a, 7))
    const revalidar = await servico().tentar(pedidoDe(b, 8, SHA_BASE_0))
    expect(revalidar.tipo).toBe('revalidar')

    // O CI rodou no head novo e a pipeline reavaliou contra a base de agora.
    const r = await servico().tentar(pedidoDe(b, 8))

    expect(r.tipo).toBe('mergeado')
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(2)
    // Um de cada vez: o segundo merge usou o head **atualizado**, nunca o antigo.
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)[1]?.input.expectedHeadSha).toBe(
      origem.prs.get(8)?.headSha
    )
  })

  it('bases diferentes do mesmo repositório não se serializam entre si', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    abrirPr(8, 'b'.repeat(40))
    const preso = segurar()
    duranteOMerge = () => preso.ativo
    const emVoo = servico().tentar(pedidoDe(a, 7))
    await vi.waitFor(() => expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1))

    duranteOMerge = undefined
    const outraBase = await servico().tentar({
      ...pedidoDe(b, 8),
      alvo: { owner: OWNER, repo: REPO, branchBase: 'release' }
    })

    expect(outraBase.tipo).not.toBe('aguardar')
    preso.liberar()
    await emVoo
  })
})

describe('o lease de outro run nunca é tomado', () => {
  it('lease vigente de outro run: aguarda', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    leases.adquirir(USER, { proprietario: b, recurso: RECURSO, fencingToken: 9 }, AGORA)

    expect(await servico().tentar(pedidoDe(a, 7))).toEqual({
      tipo: 'aguardar',
      motivo: 'lease-ocupado'
    })
  })

  it('lease EXPIRADO de outro run também aguarda: expirar não dá o direito de roubar', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    // Expirou há uma hora.
    leases.adquirir(USER, { proprietario: b, recurso: RECURSO, fencingToken: 9 }, AGORA - 3_600_000)

    expect(await servico().tentar(pedidoDe(a, 7))).toEqual({
      tipo: 'aguardar',
      motivo: 'lease-ocupado'
    })
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })

  it('o próprio lease de um crash anterior é reassumido com o mesmo token', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    leases.adquirir(USER, { proprietario: a, recurso: RECURSO, fencingToken: 5 }, AGORA - 10_000)

    const r = await servico().tentar(pedidoDe(a, 7))

    expect(r.tipo).toBe('mergeado')
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)[0]?.efeito?.fencingToken).toBe(5)
  })
})

describe('mudança entre o check e o merge (critério 3)', () => {
  it('um check novo exigido na proteção: revalida, e nada é mergeado', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.protecao.contexts.push('lint')

    const r = await servico().tentar(pedido)

    expect(r).toEqual({ tipo: 'revalidar', motivo: 'regra-mudou' })
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
  })

  it('um check exigido só por ruleset também conta: a regra é a união das duas fontes', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.rulesets = {
      contextsExigidos: ['seguranca'],
      mergeQueue: false,
      tipos: ['required_status_checks']
    }

    const r = await servico().tentar(pedido)

    expect(r).toEqual({ tipo: 'revalidar', motivo: 'regra-mudou' })
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })

  it('merge queue que passou a ser exigida: revalida, a pipeline não a contorna', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.rulesets = { contextsExigidos: [], mergeQueue: true, tipos: ['merge_queue'] }

    expect((await servico().tentar(pedido)).tipo).toBe('revalidar')
  })

  it('o head do PR andou: revalida com o head novo, sem mergear o antigo', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.prs.get(7)!.headSha = 'c'.repeat(40)

    expect(await servico().tentar(pedido)).toEqual({
      tipo: 'revalidar',
      motivo: 'head-mudou',
      headSha: 'c'.repeat(40)
    })
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })

  it('PR fechado sem merge: bloqueia com a ação de retomada', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.prs.get(7)!.aberto = false

    const r = await servico().tentar(pedido)

    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') expect(r.causa).toBe('pr-fechado')
  })

  it('base ilegível não bloqueia: a M9-F05 manda preservar o PR e explicar a limitação', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.falhas.set(GITHUB_OPERATIONS.getCommitSha, 1)

    expect((await servico().tentar(pedido)).tipo).toBe('mergeado')
  })

  it('regra ilegível não vira regra vazia: não mergeia', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.falhas.set(GITHUB_OPERATIONS.getRulesForBranch, 1)

    expect(await servico().tentar(pedido)).toEqual({
      tipo: 'aguardar',
      motivo: 'origem-indisponivel'
    })
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })

  it('PR ilegível: não mergeia, e o lease volta', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    origem.falhas.set(GITHUB_OPERATIONS.getMergeState, 1)

    expect((await servico().tentar(pedido)).tipo).toBe('aguardar')
    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
  })
})

describe('conflito ao atualizar a base (regra 4)', () => {
  it('não corrige às cegas: bloqueia com a ação de retomada e não mergeia', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    abrirPr(8, 'b'.repeat(40))
    const pedidoB = pedidoDe(b, 8)
    await servico().tentar(pedidoDe(a, 7))
    origem.conflitoNaAtualizacao = true

    const r = await servico().tentar(pedidoB)

    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') {
      expect(r.causa).toBe('conflito-na-atualizacao')
      expect(r.acao).toContain('conflito')
    }
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1)
    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
  })

  it('falha da origem na atualização não é conflito: aguarda', async () => {
    const a = runEm()
    const b = runEm()
    abrirPr(7, 'a'.repeat(40))
    abrirPr(8, 'b'.repeat(40))
    const pedidoB = pedidoDe(b, 8)
    await servico().tentar(pedidoDe(a, 7))
    origem.falhas.set(GITHUB_OPERATIONS.updateBranch, 1)

    expect((await servico().tentar(pedidoB)).tipo).toBe('aguardar')
  })
})

describe('crash antes, durante e depois do efeito (critério 4)', () => {
  it('ANTES: morre depois de gravar a intenção e antes de o merge sair — a retomada mergeia uma vez', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    duranteOMerge = () => {
      throw new Error('processo morreu')
    }
    await expect(servico().tentar(pedidoDe(a, 7))).rejects.toThrow('processo morreu')
    // O efeito **não** aconteceu, e a intenção ficou registrada.
    expect(origem.prs.get(7)?.merged).toBe(false)
    expect(merges.iniciadas(USER)).toHaveLength(1)
    duranteOMerge = undefined

    const r = await servico().tentar(pedidoDe(a, 7))

    expect(r.tipo).toBe('mergeado')
    // A origem foi consultada antes de repetir, e o merge saiu uma única vez com sucesso.
    expect(origem.prs.get(7)?.merged).toBe(true)
    expect(merges.iniciadas(USER)).toHaveLength(0)
  })

  it('DURANTE: o merge saiu na origem mas o processo morreu antes de confirmar — não repete', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    // O efeito acontece na origem e **depois** a conexão cai.
    duranteOMerge = (pr) => {
      const alvo = origem.prs.get(pr)!
      alvo.merged = true
      alvo.aberto = false
      alvo.mergeSha = 'e'.repeat(40)
      origem.baseSha = alvo.mergeSha
      throw new Error('conexão caiu depois do merge')
    }
    await expect(servico().tentar(pedidoDe(a, 7))).rejects.toThrow('conexão caiu')
    expect(merges.iniciadas(USER)).toHaveLength(1)
    duranteOMerge = undefined
    const mergesAntes = deQuantos(GITHUB_OPERATIONS.squashMerge).length

    const r = await servico().tentar(pedidoDe(a, 7))

    expect(r).toEqual({ tipo: 'mergeado', mergeSha: 'e'.repeat(40) })
    // O ponto: **nenhum segundo merge**. A origem foi consultada antes de qualquer repetição.
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(mergesAntes)
    expect(merges.iniciadas(USER)).toHaveLength(0)
    expect(aoMergear).toHaveBeenCalledWith(a)
  })

  it('DEPOIS: confirmado na origem e o run ainda em PR_CI — a reconciliação o conclui', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    await servico().tentar(pedidoDe(a, 7))
    // O crash pegou entre a confirmação e o registro no run.
    expect(runs.buscar(a)?.estado).toBe('PR_CI')

    const achados = await servico().reconciliar()

    expect(aoReconciliarMergeado).toHaveBeenCalledTimes(1)
    expect(aoReconciliarMergeado.mock.calls[0]?.[0]).toMatchObject({
      runId: a,
      estado: 'confirmada'
    })
    expect(achados.some((x) => x.decisao === 'completado')).toBe(true)
  })

  it('boot: tentativa iniciada com o PR já mergeado vira confirmada e conclui o run', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    leases.adquirir(USER, { proprietario: a, recurso: RECURSO, fencingToken: 3 }, AGORA)
    merges.iniciar(
      USER,
      {
        runId: a,
        workspaceId: WS,
        projectId: 'p',
        recurso: RECURSO,
        pullRequest: 7,
        headSha: 'a'.repeat(40),
        fencingToken: 3
      },
      AGORA
    )
    Object.assign(origem.prs.get(7)!, { merged: true, aberto: false, mergeSha: 'd'.repeat(40) })

    const achados = await servico().reconciliar()

    expect(merges.iniciadas(USER)).toHaveLength(0)
    expect(aoReconciliarMergeado).toHaveBeenCalledTimes(1)
    expect(achados[0]).toMatchObject({ decisao: 'completado', recurso: RECURSO })
    // O lease não segura mais nada: não há tentativa em aberto.
    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
  })

  it('boot: tentativa iniciada com o PR aberto é abandonada e o head pode ser tentado de novo', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    leases.adquirir(USER, { proprietario: a, recurso: RECURSO, fencingToken: 3 }, AGORA)
    merges.iniciar(
      USER,
      {
        runId: a,
        workspaceId: WS,
        projectId: 'p',
        recurso: RECURSO,
        pullRequest: 7,
        headSha: 'a'.repeat(40),
        fencingToken: 3
      },
      AGORA
    )

    const achados = await servico().reconciliar()

    expect(achados[0]?.decisao).toBe('liberado')
    expect(merges.iniciadas(USER)).toHaveLength(0)
    expect(aoReconciliarMergeado).not.toHaveBeenCalled()
  })

  it('boot: origem que não responde deixa a tentativa e o lease de pé — fail closed', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    leases.adquirir(USER, { proprietario: a, recurso: RECURSO, fencingToken: 3 }, AGORA)
    merges.iniciar(
      USER,
      {
        runId: a,
        workspaceId: WS,
        projectId: 'p',
        recurso: RECURSO,
        pullRequest: 7,
        headSha: 'a'.repeat(40),
        fencingToken: 3
      },
      AGORA
    )
    origem.falhas.set(GITHUB_OPERATIONS.getMergeState, 1)

    const achados = await servico().reconciliar()

    expect(achados[0]?.decisao).toBe('bloqueado')
    expect(merges.iniciadas(USER)).toHaveLength(1)
    expect(leases.buscar(USER, RECURSO)).toBeDefined()
  })

  it('boot: lease de merge sem tentativa em aberto é liberado, e lease de outro tipo não é tocado', async () => {
    const a = runEm()
    leases.adquirir(USER, { proprietario: a, recurso: RECURSO, fencingToken: 3 }, AGORA)
    leases.adquirir(USER, { proprietario: a, recurso: 'wip:slot:1', fencingToken: 4 }, AGORA)

    await servico().reconciliar()

    expect(leases.buscar(USER, RECURSO)).toBeUndefined()
    expect(leases.buscar(USER, 'wip:slot:1')).toBeDefined()
  })
})

describe('merge confirmado permanece confirmado (critério 5)', () => {
  it('run cancelado ANTES de a tentativa nascer: não mergeia', async () => {
    const a = runEm('CANCELLED')
    abrirPr(7, 'a'.repeat(40))

    const r = await servico().tentar(pedidoDe(a, 7))

    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') expect(r.causa).toBe('run-encerrado')
    expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
    expect(origem.prs.get(7)?.merged).toBe(false)
  })

  it('com o merge no ar, o cancelamento enxerga a tentativa e é segurado', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const preso = segurar()
    duranteOMerge = () => preso.ativo
    const emVoo = servico().tentar(pedidoDe(a, 7))
    await vi.waitFor(() => expect(deQuantos(GITHUB_OPERATIONS.squashMerge)).toHaveLength(1))

    // É o que o FilaService consulta antes de deixar o cancelamento vencer.
    expect(merges.emCursoDoRun(USER, a)).toBe(true)

    preso.liberar()
    await emVoo
    // Confirmado e ainda sem registro no run: o cancelamento continua segurado.
    expect(merges.emCursoDoRun(USER, a)).toBe(true)
    runs.transicionar(a, 'PR_CI', 'MERGED', new Date(AGORA))
    // Terminal: quem protege agora é o estado terminal do run.
    expect(merges.emCursoDoRun(USER, a)).toBe(false)
  })

  it('lease perdido durante a chamada: o merge continua confirmado, pela constatação da origem', async () => {
    const a = runEm()
    const outro = runEm()
    abrirPr(7, 'a'.repeat(40))
    duranteOMerge = () => {
      // O lease foi reconciliado e dado a outro run enquanto a chamada estava no ar.
      leases.removerReconciliado(USER, RECURSO)
      leases.adquirir(USER, { proprietario: outro, recurso: RECURSO, fencingToken: 999 }, AGORA)
    }

    const r = await servico().tentar(pedidoDe(a, 7))

    // A origem diz que mergeou; o merge não é desfeito por ter perdido o lease.
    expect(r.tipo).toBe('mergeado')
    expect(merges.buscarViva(USER, a, 7, 'a'.repeat(40))?.estado).toBe('confirmada')
    // E o lease do novo dono não foi derrubado pela devolução do antigo.
    expect(leases.buscar(USER, RECURSO)?.proprietario).toBe(outro)
  })
})

describe('merge sem confirmação na origem', () => {
  it('a chamada respondeu mas o PR não está mergeado: sem-confirmacao e a tentativa é abandonada', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    // O merge "saiu" mas a origem não o registra.
    duranteOMerge = () => {
      throw new Error('não chegou a mergear')
    }
    await expect(servico().tentar(pedidoDe(a, 7))).rejects.toThrow()
    duranteOMerge = undefined
    expect(merges.iniciadas(USER)).toHaveLength(1)

    const resolvida = await servico().reconciliar()

    expect(resolvida[0]?.decisao).toBe('liberado')
    expect(origem.prs.get(7)?.merged).toBe(false)
  })

  it('a origem não responde à confirmação: a tentativa fica aberta, nunca abandonada na aposta', async () => {
    const a = runEm()
    abrirPr(7, 'a'.repeat(40))
    const pedido = pedidoDe(a, 7)
    // A observação (1ª leitura) passa; a confirmação depois do merge (2ª leitura) falha.
    let leituras = 0
    const original = origem.falhas
    duranteOMerge = () => {
      leituras += 1
      original.set(GITHUB_OPERATIONS.getMergeState, 1)
    }

    const r = await servico().tentar(pedido)

    expect(leituras).toBe(1)
    expect(r.tipo).toBe('sem-confirmacao')
    expect(merges.iniciadas(USER)).toHaveLength(1)
  })
})
