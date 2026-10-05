/**
 * O mundo do E2E concorrente (SPEC-Scheduler-05, PR-C).
 *
 * **Real:** SQLite com todas as migrations, `FilaService`, `PoolService` com a prova de
 * independência, `GerenteDeSlots`, `EncadeadorDeRuns`, `EntregaService`, `ConstrutorService`,
 * `MergeService`, `RecuperacaoService`, `CancelamentoService` e `ReconciliacaoService` — compostos
 * como o `src/main/index.ts` os compõe. **Dublê:** a origem (GitHub, com estado), o Docker, o Git e
 * o preflight, que só registram recursos e efeitos para o teste conferir.
 *
 * **Um "processo" é uma instância de `Processo` sobre a mesma `Base`.** O que sobrevive à queda é
 * o que vive fora do processo: o banco, a origem, o Docker (os containers continuam de pé) e o
 * disco. `matar()` congela o processo no ponto em que está — nenhum efeito, nenhuma resposta, nenhum
 * heartbeat depois dele — e `iniciarProcesso(base)` sobe outro, que só enxerga o que o banco e a
 * origem guardaram. É o que torna "recupera sem duplicar" uma afirmação sobre o resultado, e não
 * sobre a intenção de um serviço.
 */

import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import type { ExecutorObservado } from '@shared/domain/recuperacao'
import type { PathsPermitidos, PreflightOutcome, SandboxPreparado } from '@shared/domain/preflight'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { BudgetRepository } from '../../src/main/budget/budget-repository'
import { AuditRepository } from '../../src/main/storage/audit-repository'
import { GerenteDeSlots, ganchosDosSlots } from '../../src/main/squads/squad-slots'
import { CancelamentoService } from '../../src/main/pipeline/cancelamento-service'
import { ConstrutorService } from '../../src/main/pipeline/construtor-service'
import { EncadeadorDeRuns, type PedidoDeExecucao } from '../../src/main/pipeline/encadeador-de-runs'
import { EntregaService } from '../../src/main/pipeline/entrega-service'
import { ExecutionLedgerRepository } from '../../src/main/pipeline/execution-ledger-repository'
import { FilaService } from '../../src/main/pipeline/fila-service'
import { IndependenciaService } from '../../src/main/pipeline/independencia-service'
import { LeaseRepository } from '../../src/main/pipeline/lease-repository'
import { LockRepository } from '../../src/main/pipeline/lock-repository'
import { MergeRepository } from '../../src/main/pipeline/merge-repository'
import { MergeService } from '../../src/main/pipeline/merge-service'
import { PipelineRepository } from '../../src/main/pipeline/pipeline-repository'
import { PoolRepository } from '../../src/main/pipeline/pool-repository'
import { PoolService } from '../../src/main/pipeline/pool-service'
import { ReconciliacaoService } from '../../src/main/pipeline/reconciliacao-service'
import { RecuperacaoService } from '../../src/main/pipeline/recuperacao-service'
import { RulesetRepository } from '../../src/main/pipeline/ruleset-repository'
import { RunPrRepository } from '../../src/main/pipeline/run-pr-repository'
import { OrigemFalsa } from './origem-falsa'

export const USER = 'u-1'
export const WS: WorkspaceId = 'jarvis'
export const PROJETO = 'p-a'
export const OWNER = 'o'
export const REPO = 'r'
const AGORA = 1_700_000_000_000

const origemDoRoadmap: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
export const FATIAS = ['f1', 'f2', 'f3'] as const
/**
 * Uma fatia por MVP, todos independentes: dentro de um MVP as fatias são uma sequência (a fatia de
 * `numero` maior só começa quando as anteriores concluem — `fila.ts`), e fatias que rodam juntas
 * são, por definição, de MVPs que não dependem um do outro.
 */
const MVPS: readonly Mvp[] = FATIAS.map((id, i) => ({
  id: `m-${id}`,
  numero: i + 1,
  titulo: `MVP ${i + 1}`,
  tese: 't',
  estado: 'na-fila',
  dependeDe: [],
  origem: origemDoRoadmap
}))
const SLICES: readonly Slice[] = FATIAS.map((id) => ({
  id,
  mvpId: `m-${id}`,
  numero: 1,
  titulo: id.toUpperCase(),
  specSlug: `spec-${id}`,
  detalhada: true,
  origem: origemDoRoadmap
}))
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]
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

const COMANDOS = {
  test: ['npm', 'test'],
  lint: ['npm', 'run', 'lint'],
  typecheck: ['npm', 'run', 'typecheck'],
  build: ['npm', 'run', 'build']
} as const

/** Nunca resolve: o que um processo morto deixou no meio de uma chamada. */
const parar = (): Promise<never> => new Promise<never>(() => undefined)

/** Lançado por um dublê síncrono quando o processo já morreu: o código que o chama não segue. */
export class ProcessoMorto extends Error {
  constructor() {
    super('O processo morreu.')
    this.name = 'ProcessoMorto'
  }
}

/**
 * O que sobrevive a uma queda do processo e que o teste afirma ao final: containers, portas e
 * worktrees. O Docker mantém o container de pé depois que o app cai — quem o remove é a
 * recuperação, não a queda.
 */
export class Recursos {
  readonly containers = new Set<string>()
  readonly portas = new Map<number, string>()
  readonly worktrees = new Set<string>()
  /** Pendências que o "Docker" reporta ao devolver os recursos de um run (container que não parou). */
  readonly pendencias = new Map<string, readonly PendenciaDeLimpeza[]>()
  private proximaPorta = 41_000

  constructor(private readonly raiz: string) {}

  criar(runId: string): { readonly porta: number; readonly worktree: string } {
    const worktree = join(this.raiz, 'wt', runId)
    mkdirSync(worktree, { recursive: true })
    const porta = this.proximaPorta
    this.proximaPorta += 1
    this.containers.add(runId)
    this.portas.set(porta, runId)
    this.worktrees.add(runId)
    return { porta, worktree }
  }

  /** Devolve tudo o que o run segura. `false` em `pendencias` quando o "Docker" recusa parar. */
  liberarRun(runId: string): readonly string[] {
    if (this.pendencias.has(runId)) return []
    const removidos: string[] = []
    if (this.containers.delete(runId)) removidos.push(`container:${runId}`)
    for (const [porta, dono] of [...this.portas]) {
      if (dono === runId) {
        this.portas.delete(porta)
        removidos.push(`porta:${porta}`)
      }
    }
    if (this.worktrees.delete(runId)) {
      rmSync(join(this.raiz, 'wt', runId), { recursive: true, force: true })
      removidos.push(`worktree:${runId}`)
    }
    return removidos
  }

  vivo(runId: string): boolean {
    return this.containers.has(runId)
  }

  /** O que ainda está de pé, em texto: vazio é o que o critério 6 exige no fim. */
  restantes(): readonly string[] {
    const emDisco = (() => {
      try {
        return readdirSync(join(this.raiz, 'wt')).map((r) => `worktree-em-disco:${r}`)
      } catch {
        return []
      }
    })()
    return [
      ...[...this.containers].map((r) => `container:${r}`),
      ...[...this.portas].map(([p, r]) => `porta:${p}(${r})`),
      ...[...this.worktrees].map((r) => `worktree:${r}`),
      ...emDisco
    ]
  }
}

/** O que existe fora do processo: banco, origem, "Docker", disco e o relógio dos leases. */
export interface Base {
  readonly dir: string
  readonly db: Db
  readonly origem: OrigemFalsa
  readonly recursos: Recursos
  /** O relógio dos leases e da fila. Avança só quando o teste manda: a queda não envelhece sozinha. */
  relogio: number
}

export function criarBase(dir: string, db: Db): Base {
  return { dir, db, origem: new OrigemFalsa(), recursos: new Recursos(dir), relogio: AGORA }
}

/** Faz os leases de um processo morto vencerem, como o tempo faria. */
export function envelhecer(base: Base, ms = VALIDADE_DO_LEASE_MS + 1): void {
  base.relogio += ms
}

export interface Efeitos {
  /** Os pushes na ordem em que aconteceram. */
  readonly pushes: { readonly branch: string; readonly runId: string }[]
  /** As limpezas pedidas pela entrega ao terminar. */
  readonly limpezas: { readonly runId: string; readonly estadoFinal: string }[]
}

interface Armadilha {
  readonly ponto: string
  readonly runId?: string
  disparada: boolean
}

export class Processo {
  morto = false
  readonly efeitos: Efeitos = { pushes: [], limpezas: [] }
  private readonly armadilhas: Armadilha[] = []
  /** O merge de um run espera esta promessa antes de entrar na seção crítica (a corrida controlada). */
  private readonly seguraMerge = new Map<
    string,
    { readonly liberada: Promise<void>; readonly chegou: () => void }
  >()
  private relogioDaEntrega = AGORA

  readonly runs: PipelineRepository
  readonly leases: LeaseRepository
  readonly locks: LockRepository
  readonly runPrs: RunPrRepository
  readonly ledger: ExecutionLedgerRepository
  readonly pool: PoolService
  readonly fila: FilaService
  readonly gerente: GerenteDeSlots
  readonly merge: MergeService
  readonly recuperacao: RecuperacaoService
  readonly cancelamento: CancelamentoService
  readonly encadeador: EncadeadorDeRuns
  readonly entrega: EntregaService
  readonly reconciliacao: ReconciliacaoService
  readonly poolRepository: PoolRepository
  private readonly mergeRepository: MergeRepository

  constructor(readonly base: Base) {
    const { db } = base
    const agora = (): number => base.relogio
    this.runs = new PipelineRepository(db)
    this.leases = new LeaseRepository(db)
    this.locks = new LockRepository(db)
    this.runPrs = new RunPrRepository(db)
    this.ledger = new ExecutionLedgerRepository(db)
    this.poolRepository = new PoolRepository(db)
    this.mergeRepository = new MergeRepository(db)
    const audit = this.auditoria(new AuditRepository(db, 'chave-de-teste'))

    const independencia = new IndependenciaService({
      db,
      locks: this.locks,
      pool: this.poolRepository,
      userId: () => USER,
      // Como em produção: o write set previsto é o que o run em voo declarou.
      fonte: (item) => this.encadeador.writeSetPrevisto(item.runId),
      dependencias: () => [],
      agora
    })
    this.pool = new PoolService({
      db,
      pool: this.poolRepository,
      leases: this.leases,
      audit,
      userId: () => USER,
      workspaceId: () => WS,
      gates: (item) => this.fila.gatesDoItem(item),
      ativar: (item) => this.fila.ativarRun(item),
      independencia,
      bloquear: (item, fencingToken, bloqueio) =>
        this.fila.transicionar(
          item.projectId,
          item.workspaceId,
          item.runId,
          'BLOCKED',
          bloqueio,
          fencingToken
        ).reason === 'transicionado',
      agora
    })
    this.fila = new FilaService({
      ...ganchosDosSlots(() => this.gerente),
      runs: this.runs,
      pool: this.pool,
      workspaceId: () => WS,
      audit,
      roadmap: () => ({ mvps: MVPS, slices: SLICES }),
      aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
      revisoesDoGate: () => REVISOES,
      userId: () => USER,
      mergeAutonomoLigado: () => true,
      mergeEmCurso: (runId) => this.mergeRepository.emCursoDoRun(USER, runId),
      transacao: (fn) => db.transaction(fn)(),
      emTransacao: () => db.inTransaction,
      aoEncerrarSemConclusao: (runId) => {
        this.encadeador.interromper(runId)
        this.recuperacao.recolher(runId)
      },
      agora
    })
    this.gerente = new GerenteDeSlots(this.fila)

    this.merge = new MergeService({
      connectors: this.conectores(),
      leases: this.leases,
      merges: this.mergeRepository,
      audit,
      userId: () => USER,
      proximoToken: () => this.poolRepository.proximoToken(USER),
      aoMergear: (runId) => independencia.aoMergear(runId),
      aoReconciliarMergeado: (tentativa) => {
        const slot = this.leases.buscarSlotDoRun(USER, tentativa.runId)
        this.fila.concluir(
          tentativa.projectId,
          tentativa.workspaceId,
          tentativa.runId,
          slot?.fencingToken,
          true
        )
      },
      agora
    })

    this.recuperacao = new RecuperacaoService({
      runs: this.runs,
      leases: this.leases,
      pool: this.pool,
      fila: this.fila,
      audit,
      userId: () => USER,
      isolamento: {
        liberarRunEUnidades: (runId) => ({
          removidos: base.recursos.liberarRun(runId),
          pendencias: base.recursos.pendencias.get(runId) ?? []
        })
      },
      executor: (runId): ExecutorObservado => (base.recursos.vivo(runId) ? 'vivo' : 'morto'),
      mergeEmCurso: (runId) => this.mergeRepository.emCursoDoRun(USER, runId),
      renovacaoGarantida: true,
      agora
    })

    this.cancelamento = new CancelamentoService({
      runs: this.runs,
      fila: this.fila,
      prs: this.runPrs,
      connectors: this.conectores(),
      audit,
      userId: () => USER,
      interromper: (runId) => void this.encadeador.interromper(runId),
      agora
    })

    const construtor = new ConstrutorService(
      this.docker(),
      this.runs,
      audit,
      () => USER,
      () => WS,
      undefined,
      this.filaDoProcesso()
    )
    this.entrega = new EntregaService({
      prs: this.inerte(this.runPrs, ['registrar']),
      construtor,
      connectors: this.conectores() as never,
      git: this.git(),
      fila: this.filaDoProcesso() as never,
      merge: {
        tentar: async (pedido) => {
          const segura = this.seguraMerge.get(pedido.runId)
          if (segura !== undefined) {
            segura.chegou()
            await segura.liberada
          }
          return await this.merge.tentar(pedido)
        }
      },
      mergePolicy: { autonomoLigado: () => true } as never,
      ruleset: this.inerte(new RulesetRepository(db), ['registrar']),
      ledger: this.inerte(this.ledger, ['registrar']),
      limpeza: this.limpeza(),
      budget: new BudgetRepository(db),
      audit,
      userId: () => USER,
      revisar: async () => [],
      token: async () => undefined,
      // O relógio da espera do CI é **outro**: andar nele não envelhece os leases.
      agora: () => this.relogioDaEntrega,
      dormir: async (ms: number) => {
        if (this.morto) await parar()
        this.relogioDaEntrega += ms
        await new Promise((resolver) => setTimeout(resolver, 2))
        if (this.morto) await parar()
      },
      tetoDeEsperaMs: 24 * 60 * 60 * 1000
    })

    let unidade = 0
    this.encadeador = new EncadeadorDeRuns({
      slots: this.gerente,
      fila: this.filaDoProcesso(),
      runs: this.runs,
      preflight: this.preflight() as never,
      entrega: this.entrega,
      proxy: {
        registrarUnidade: () => {
          unidade += 1
          return { chave: `chave-${unidade}`, caminho: `/u/${String(unidade).padStart(32, '0')}` }
        },
        liberarUnidade: () => undefined,
        url: () => 'http://host.docker.internal:1'
      } as never,
      intervaloDoHeartbeatMs: 5
    })

    this.reconciliacao = new ReconciliacaoService({
      runs: this.runs,
      leases: this.leases,
      audit,
      userId: () => USER,
      workspaceId: () => WS,
      aoLiberarSlot: (lease) => {
        this.pool.registrarReconciliado(lease)
        this.fila.despachar()
      },
      // O inventário do "Docker": o que é de run que já não está ativo sai, o resto é intocável.
      isolamento: {
        reconciliar: async () => {
          const ativos = new Set(this.runs.listarAtivos(USER).map((r) => r.id))
          const achados: { recurso: string; decisao: 'liberado'; motivo: string }[] = []
          for (const runId of [...base.recursos.containers]) {
            if (ativos.has(runId)) continue
            base.recursos.liberarRun(runId)
            achados.push({
              recurso: `container:${runId}`,
              decisao: 'liberado',
              motivo: 'Run encerrado.'
            })
          }
          return achados
        }
      },
      merge: this.merge,
      recuperacao: {
        supervisionar: async () => [
          ...this.recuperacao.supervisionar({ aoSubir: true }),
          ...(await this.cancelamento.reconciliarRascunhos())
        ]
      },
      agora
    })
  }

  // --- a queda -------------------------------------------------------------------------------

  /** O processo morre **agora**: depois deste ponto nada que ele fazia produz efeito. */
  matar(): void {
    this.morto = true
  }

  /**
   * Arma a queda para o instante em que o `ponto` for tocado (por `runId`, se dado). Os pontos são
   * `antes:<operação>` e `depois:<operação>` para as chamadas à origem, e `preflight`, `construcao`
   * e `depois:push` para o resto.
   */
  matarEm(ponto: string, runId?: string): void {
    this.armadilhas.push({ ponto, ...(runId === undefined ? {} : { runId }), disparada: false })
  }

  private tocar(ponto: string, runId: string | undefined): boolean {
    for (const a of this.armadilhas) {
      if (a.disparada || a.ponto !== ponto) continue
      if (a.runId !== undefined && a.runId !== runId) continue
      a.disparada = true
      this.morto = true
    }
    return this.morto
  }

  /**
   * Segura o merge do run **antes** de ele entrar na seção crítica, até `liberar()`: reproduz o PR
   * que chega atrasado depois de o vizinho ter mergeado. `chegou` resolve quando o run alcança o
   * ponto (já avaliou o gate, ainda não pediu o lease) — é o que dá ao teste um instante exato.
   */
  segurarMerge(runId: string): { readonly chegou: Promise<void>; readonly liberar: () => void } {
    let liberar: () => void = () => undefined
    let marcarChegada: () => void = () => undefined
    const liberada = new Promise<void>((resolver) => (liberar = resolver))
    const chegou = new Promise<void>((resolver) => (marcarChegada = resolver))
    this.seguraMerge.set(runId, { liberada, chegou: marcarChegada })
    return { chegou, liberar }
  }

  // --- dublês --------------------------------------------------------------------------------

  /** Um objeto cujos métodos de escrita viram no-op depois da morte: o processo morto não grava. */
  private inerte<T extends object>(real: T, metodos: readonly string[]): T {
    return new Proxy(real, {
      get: (alvo, prop) => {
        const valor = Reflect.get(alvo, prop, alvo) as unknown
        if (typeof valor !== 'function') return valor
        const fn = valor as (...args: unknown[]) => unknown
        if (metodos.includes(String(prop))) {
          return (...args: unknown[]) => (this.morto ? undefined : fn.apply(alvo, args))
        }
        return fn.bind(alvo)
      }
    })
  }

  private auditoria(real: AuditRepository): AuditRepository {
    return this.inerte(real, ['append'])
  }

  /** A fila como o processo a vê: morto, ela não recebe transição, conclusão nem batida. */
  private filaDoProcesso(): Pick<FilaService, 'transicionar' | 'concluir' | 'renovarSlot'> {
    return {
      transicionar: (...args: Parameters<FilaService['transicionar']>) =>
        this.morto ? ({ reason: 'indisponivel' } as never) : this.fila.transicionar(...args),
      concluir: (...args: Parameters<FilaService['concluir']>) =>
        this.morto ? ({ reason: 'indisponivel' } as never) : this.fila.concluir(...args),
      // Morto, a batida "passa" sem tocar o banco: é o que o processo morto faz — nada. O lease
      // envelhece e a recuperação o enxerga.
      renovarSlot: (...args: Parameters<FilaService['renovarSlot']>) =>
        this.morto ? true : this.fila.renovarSlot(...args)
    }
  }

  private conectores(): { call: (request: ConnectorRequest) => Promise<ConnectorOutcome> } {
    return {
      call: async (request) => {
        if (this.morto) return await parar()
        const runId = this.runDaChamada(request)
        if (this.tocar(`antes:${request.operation}`, runId)) return await parar()
        const resposta = await this.base.origem.responder(request)
        if (this.tocar(`depois:${request.operation}`, runId)) return await parar()
        return resposta
      }
    }
  }

  /** De quem é a chamada: o PR, a branch ou o commit dela diz. */
  private runDaChamada(request: ConnectorRequest): string | undefined {
    const input = (request.input ?? {}) as Record<string, unknown>
    const { prs } = this.base.origem
    const porNumero = typeof input.pullRequest === 'number' ? prs.get(input.pullRequest) : undefined
    const porSha =
      typeof input.sha === 'string'
        ? [...prs.values()].find((pr) => pr.headSha === input.sha)
        : undefined
    const branch = typeof input.head === 'string' ? input.head : (porNumero ?? porSha)?.head
    return branch === undefined ? undefined : this.runsPorBranch.get(branch)
  }

  /** A branch de cada run, para a origem (que só sabe de branch) dizer de quem é a chamada. */
  readonly runsPorBranch = new Map<string, string>()

  private docker(): never {
    return {
      exec: (container: string, comando: readonly string[]) => {
        if (this.morto) throw new ProcessoMorto()
        const runId = container.replace(/^jarvis-/, '')
        if (comando[0] === 'claude' && this.tocar('construcao', runId)) throw new ProcessoMorto()
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      },
      matarProcesso: () => undefined
    } as never
  }

  private git(): never {
    const runDoWorktree = (cwd: string): string => cwd.split(/[\\/]/).at(-1) ?? cwd
    const empurrar = (branch: string, cwd: string): { ok: boolean } => {
      if (this.morto) throw new ProcessoMorto()
      const runId = runDoWorktree(cwd)
      this.efeitos.pushes.push({ branch, runId })
      if (this.tocar('depois:push', runId)) return { ok: true }
      return { ok: !this.falhaDePush.has(runId) }
    }
    return {
      run: () => {
        if (this.morto) throw new ProcessoMorto()
        return { ok: true }
      },
      push: (_origem: string, branch: string, cwd: string) => empurrar(branch, cwd),
      pushComToken: (_url: string, _token: string, branch: string, cwd: string) =>
        empurrar(branch, cwd)
    } as never
  }

  /** Runs cujo push a origem recusa (a rede caiu, a credencial venceu). */
  readonly falhaDePush = new Set<string>()

  private limpeza(): never {
    return {
      limpar: (pedido: { runId: string; estadoFinal: string }) => {
        if (this.morto) return { removidos: [], pendencias: [] }
        this.efeitos.limpezas.push({ runId: pedido.runId, estadoFinal: pedido.estadoFinal })
        return { removidos: this.base.recursos.liberarRun(pedido.runId), pendencias: [] }
      }
    } as never
  }

  /** O preflight dublê: monta o sandbox (registrando container, porta e worktree) e devolve a branch. */
  private preflight(): {
    preparar: (p: { runId: string; sliceId: string; tentativa: number }) => PreflightOutcome
    bloqueioDe: () => never
  } {
    return {
      preparar: ({ runId, sliceId, tentativa }) => {
        if (this.morto || this.tocar('preflight', runId)) throw new ProcessoMorto()
        const { worktree } = this.base.recursos.criar(runId)
        const branch = `feat/${sliceId}-${runId.slice(0, 8)}${tentativa > 1 ? `-t${tentativa}` : ''}`
        this.runsPorBranch.set(branch, runId)
        const sandbox: SandboxPreparado = {
          runId,
          containerNome: `jarvis-${runId}`,
          cwd: '/work',
          baseSha: this.base.origem.baseSha,
          branch,
          worktreeNoHost: worktree,
          pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'SPEC' },
          proxyUrl: 'http://172.20.0.2:8080',
          modeloDaConstrucao: { provider: 'claude-code', modelo: 'claude-opus-5' }
        }
        return { reason: 'liberado', mensagem: 'ok', sandbox }
      },
      bloqueioDe: () =>
        ({
          causa: 'docker-indisponivel',
          evidencia: 'e',
          tentativas: 0,
          porQueNaoSeguir: 'p',
          retomada: 'r'
        }) as never
    }
  }

  // --- o que o PI faz, e o que o teste observa -------------------------------------------------

  /** Liga o paralelismo (desligado por padrão) para os cenários concorrentes. */
  ligarParalelismo(capacidade = 2): void {
    this.pool.configurar({
      ...CONFIG_PADRAO,
      paralelismo: true,
      capacidadeGlobal: capacidade,
      maxPorProjeto: capacidade
    })
  }

  /** Um run `READY`, como o PI o deixa depois de aprovar a fatia. */
  pronto(sliceId: string, continuaDe?: string, projeto = PROJETO): string {
    const run = this.fila.criarRun(projeto, WS, sliceId, continuaDe)
    this.fila.transicionar(projeto, WS, run.id, 'AWAITING_PI')
    this.fila.transicionar(projeto, WS, run.id, 'READY')
    return run.id
  }

  pedido(runId: string, paths: readonly string[] = [], projeto = PROJETO): PedidoDeExecucao {
    const pathsDaSpec: PathsPermitidos | undefined =
      paths.length === 0 ? undefined : { paths, origem: 'spec', justificativa: 'SPEC' }
    void projeto
    return {
      runId,
      workspaceId: WS,
      raizOperacional: this.base.dir,
      repositorio: this.base.dir,
      base: 'main',
      alvo: { owner: OWNER, repo: REPO, branchBase: 'main' },
      issue: 7,
      titulo: `[F] ${runId}`,
      promptInicial: 'construa',
      contextPackId: 'pack-1',
      comandosDeValidacao: COMANDOS,
      ...(pathsDaSpec === undefined ? {} : { pathsDaSpec })
    }
  }

  estado(runId: string): string | undefined {
    return this.runs.buscar(runId)?.estado
  }

  /** Espera a condição valer, em vez de apostar quantos milissegundos a entrega leva. */
  async ate(condicao: () => boolean, descricao: string, tetoMs = 8_000): Promise<void> {
    const limite = Date.now() + tetoMs
    while (!condicao()) {
      if (Date.now() > limite) throw new Error(`Esgotou a espera por: ${descricao}`)
      await new Promise((resolver) => setTimeout(resolver, 3))
    }
  }

  /**
   * Tudo o que o critério 6 exige que **não** reste: lease de qualquer tipo, trava do pool,
   * container, porta, worktree e pendência de limpeza.
   */
  orfaos(): readonly string[] {
    const { db, recursos } = this.base
    const leases = this.leases.listar(USER).map((l) => `lease:${l.recurso}(${l.proprietario})`)
    const travas = (db.prepare('SELECT COUNT(*) AS n FROM pool_lock').get() as { n: number }).n
    const pendencias = this.ledger.listarPendencias(USER).map((p) => `pendencia:${p.recurso}`)
    return [
      ...leases,
      ...(travas > 0 ? [`trava-do-pool:${travas}`] : []),
      ...recursos.restantes(),
      ...pendencias
    ]
  }
}

export function iniciarProcesso(base: Base): Processo {
  return new Processo(base)
}
