/**
 * O isolamento concorrente (SPEC-Scheduler-03): cada run é dono **exclusivo** dos seus recursos, e
 * depois de um crash cada recurso é reencontrado e reconciliado sem afetar o de outro run.
 *
 * A pergunta que este serviço responde: **o que este run tem, o que é dele de fato, e o que pode
 * ser devolvido com segurança?** A resposta vem do inventário durável (`recurso_run`) conferido
 * contra o que o Docker e o Git realmente têm — nunca de glob de nome nem de suposição.
 *
 * ## Quatro regras que este arquivo cumpre
 *
 *  1. **Intenção antes, confirmação depois.** `planejar` grava antes de criar; `confirmar` marca
 *     depois. Um crash no meio deixa `planejado`, e a reconciliação olha o mundo antes de agir.
 *  2. **Posse provada, não presumida.** Antes de parar um container ou remover uma rede, a label
 *     `jarvisos.run` precisa ser a do run. Dono diferente ou ausente vira pendência: ninguém perde
 *     nada, mas alguém precisa olhar.
 *  3. **Falha de detecção não é ausência.** Docker que não lista, não inspeciona ou não responde
 *     nunca vira "lista vazia", "sandbox limpo" ou "recurso removido" — vira `indeterminado` ou
 *     pendência, e o recurso continua inventariado.
 *  4. **A porta só volta depois da parada confirmada.** Liberar o lease antes de o container sair
 *     deixaria o próximo run alocar a porta que o anterior ainda publica.
 *
 * O worktree é removido **sem `--force`**: trabalho que o kernel não registrou não se destrói. A
 * branch nunca é apagada (ela é o trabalho entregue); sai do inventário, mas o Git a preserva.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import {
  escanearSandbox,
  escolherPorta,
  FAIXA_DE_PORTAS,
  labelsDoRecurso,
  type AchadoDoScanner,
  type EntradaDoScanner,
  type FaixaDePortas,
  type IdentidadeDoRun,
  type TipoDeRecurso
} from '@shared/domain/isolamento'
import type { PendenciaDeLimpeza, RecursoLimpavel } from '@shared/domain/limpeza'
import { recursoDaPorta, recursoDoContainer, recursoDoWorktree } from '@shared/domain/preflight'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { RecursosGeridos } from './docker-runner'
import type { ExecutionLedgerRepository } from './execution-ledger-repository'
import type { InventarioRepository, RecursoDoRun } from './inventario-repository'
import type { LeaseRepository } from './lease-repository'
import type { AchadoDaReconciliacao } from './reconciliacao-service'

/** O que o isolamento precisa do Docker — a fronteira que o teste substitui por um mundo em memória. */
export interface DockerDoIsolamento {
  readonly portasEmUso: (cwd: string) => ReadonlySet<number> | undefined
  readonly listarGeridos: (cwd: string) => RecursosGeridos | undefined
  readonly inspecionarSandbox: (container: string, cwd: string) => EntradaDoScanner | undefined
  readonly parar: (nome: string, cwd: string) => boolean
  readonly removerRede: (nome: string, cwd: string) => boolean
}

export interface GitDoIsolamento {
  readonly run: (
    args: readonly string[],
    cwd: string,
    workspaceId: WorkspaceId
  ) => { readonly ok: boolean }
}

export interface IsolamentoDeps {
  readonly docker: DockerDoIsolamento
  readonly git: GitDoIsolamento
  readonly inventario: InventarioRepository
  readonly leases: LeaseRepository
  readonly ledger: ExecutionLedgerRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /** O run ainda está em execução? Run ativo nunca é tocado pela reconciliação. */
  readonly runAtivo: (runId: string) => boolean
  readonly worktreeExiste: (caminho: string) => boolean
  /** Descarta o que o sandbox deixou no worktree (`.gitmeta`) — não é trabalho a preservar. */
  readonly descartarArtefatos: (caminho: string) => void
  /** Cria a raiz do perfil do run (com o diretório `claude` dentro). */
  readonly prepararPerfil: (raiz: string) => boolean
  readonly removerDiretorio: (caminho: string) => void
  /** Tenta o bind no host: `true` se a porta está livre. Cobre o processo que não é Docker. */
  readonly portaLivreNoHost: (porta: number) => boolean
  /**
   * Espera entre duas consultas ao Docker. O `docker stop` de um container `--rm` volta antes de o
   * container sumir da listagem (fica "em remoção"); o padrão dorme de verdade, o teste injeta nada.
   */
  readonly aguardar?: (ms: number) => void
  /** O cwd dos comandos Docker (uma raiz permitida pela allowlist de diretórios). */
  readonly cwd: () => string
  readonly faixa?: FaixaDePortas
  readonly agora?: () => number
}

/**
 * `causa` separa **porta tomada** (`indisponivel`: tente outra) de **não deu para verificar**
 * (`sem-verificacao`: o Docker não respondeu, e tentar outra porta repetiria a mesma pergunta sem
 * resposta). Quem aloca aborta no segundo caso em vez de queimar a faixa inteira.
 */
export type ResultadoDaReserva =
  | { readonly ok: true; readonly porta: number }
  | {
      readonly ok: false
      readonly motivo: string
      readonly causa: 'indisponivel' | 'sem-verificacao'
    }

export interface OpcoesDaLiberacao {
  /**
   * Preserva o worktree e a branch. O escritor de um Squad acabou, mas o kernel ainda commita,
   * integra e remove o worktree pelo `SquadGit`; devolver rede, sidecar, perfil e portas já, e deixar
   * o worktree para quem o usa.
   */
  readonly preservarWorktree?: boolean
}

const PAUSA_ENTRE_CONSULTAS_MS = 200
const CONSULTAS_DE_CONFIRMACAO = 5

/** Dorme de verdade, sem ocupar a CPU: o `stop` de um container `--rm` leva um instante a sumir. */
const dormir = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export interface ResultadoDoScanner {
  readonly estado: 'limpo' | 'achados' | 'indeterminado'
  readonly achados: readonly AchadoDoScanner[]
}

export interface ResultadoDaLiberacao {
  readonly removidos: readonly TipoDeRecurso[]
  readonly pendencias: readonly PendenciaDeLimpeza[]
}

export class IsolamentoService {
  private readonly agora: () => number
  private readonly faixa: FaixaDePortas
  private readonly aguardar: (ms: number) => void

  constructor(private readonly deps: IsolamentoDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
    this.faixa = deps.faixa ?? FAIXA_DE_PORTAS
    this.aguardar = deps.aguardar ?? dormir
  }

  /** Cria a raiz do perfil do run. O preflight a chama depois de registrar a intenção. */
  prepararPerfil(raiz: string): boolean {
    return this.deps.prepararPerfil(raiz)
  }

  // ─── o ciclo de um recurso ─────────────────────────────────────────────────────────────────────

  /** Grava a intenção de criar. `undefined` quando o identificador já é de outro run. */
  planejar(
    identidade: IdentidadeDoRun,
    tipo: TipoDeRecurso,
    identificador: string,
    detalhes?: Readonly<Record<string, string>>
  ): RecursoDoRun | undefined {
    return this.deps.inventario.planejar(
      this.deps.userId(),
      {
        runId: identidade.runId,
        projectId: identidade.projectId,
        tipo,
        identificador,
        labels: labelsDoRecurso(identidade),
        ...(detalhes === undefined ? {} : { detalhes })
      },
      this.agora()
    )
  }

  /** O recurso existe de fato: `planejado` → `criado`. */
  confirmar(id: number): boolean {
    return this.deps.inventario.mudarEstado(this.deps.userId(), id, 'criado', this.agora())
  }

  /** O inventário conhece recurso vivo deste run? Run anterior à SPEC-Scheduler-03 não tem. */
  inventariado(runId: string): boolean {
    return this.deps.inventario.listarDoRun(this.deps.userId(), runId).length > 0
  }

  // ─── portas ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Reserva **uma porta específica** (a que o projeto declara) para o run.
   *
   * A ordem é a segurança: o lease vem primeiro, porque o `UNIQUE` fecha a corrida entre dois runs;
   * só depois se pergunta ao Docker e ao host. Qualquer recusa devolve o lease que acabou de ser
   * tomado. Docker que não responde recusa — alocar sem saber o que está publicado é a colisão.
   */
  reservarPorta(identidade: IdentidadeDoRun, porta: number): ResultadoDaReserva {
    return this.reservar(identidade, porta, () => this.deps.docker.portasEmUso(this.deps.cwd()))
  }

  /** `emUso` é uma função para só consultar o Docker **depois** de o lease estar tomado. */
  private reservar(
    identidade: IdentidadeDoRun,
    porta: number,
    emUso: () => ReadonlySet<number> | undefined
  ): ResultadoDaReserva {
    const userId = this.deps.userId()
    const recurso = recursoDaPorta(porta)
    const atual = this.deps.leases.buscar(userId, recurso)

    // Retomada: o próprio run repetindo uma reserva já confirmada. A porta está em uso pelo
    // container dele mesmo, e perguntar ao Docker agora a recusaria.
    if (atual?.proprietario === identidade.runId) {
      const registrada = this.deps.inventario.buscar(userId, 'porta', String(porta))
      if (registrada?.runId === identidade.runId && registrada.estado === 'criado') {
        return { ok: true, porta }
      }
    }

    const tomou =
      atual?.proprietario === identidade.runId
        ? atual
        : this.deps.leases.adquirir(
            userId,
            { proprietario: identidade.runId, recurso, projectId: identidade.projectId },
            this.agora()
          )
    if (tomou === undefined) {
      return { ok: false, motivo: `A porta ${porta} já é de outro run.`, causa: 'indisponivel' }
    }

    const barreira = this.barreiraDaPorta(porta, emUso())
    const registro =
      barreira === undefined ? this.planejar(identidade, 'porta', String(porta)) : undefined
    if (barreira !== undefined || registro === undefined) {
      this.deps.leases.liberar(userId, recurso, identidade.runId)
      return (barreira ?? {
        motivo: `A porta ${porta} já está no inventário de outro run.`,
        causa: 'indisponivel' as const
      }) as ResultadoDaReserva
    }

    this.confirmar(registro.id)
    return { ok: true, porta }
  }

  /**
   * Aloca uma porta **inédita**: fora do que containers publicam ou têm configurado, do que outro
   * run reservou (mesmo com lease expirado — só a reconciliação o devolve) e do que o host ocupa.
   * Consulta o Docker **uma vez**; a faixa inteira não custa mil rodadas de `docker ps`.
   */
  alocarPorta(identidade: IdentidadeDoRun): ResultadoDaReserva {
    const emUso = this.deps.docker.portasEmUso(this.deps.cwd())
    if (emUso === undefined) {
      return {
        ok: false,
        motivo: 'O Docker não respondeu: não dá para saber que porta está livre.',
        causa: 'sem-verificacao'
      }
    }

    const userId = this.deps.userId()
    const indisponiveis = new Set<number>(emUso)
    for (const lease of this.deps.leases.listar(userId)) {
      const numero = numeroDaPorta(lease.recurso)
      if (numero !== undefined) indisponiveis.add(numero)
    }
    for (const recurso of this.deps.inventario.listarAtivos(userId)) {
      if (recurso.tipo === 'porta') indisponiveis.add(Number(recurso.identificador))
    }

    for (;;) {
      const porta = escolherPorta(this.faixa, indisponiveis)
      if (porta === undefined) {
        return { ok: false, motivo: 'A faixa de portas acabou.', causa: 'indisponivel' }
      }
      const reserva = this.reservar(identidade, porta, () => emUso)
      if (reserva.ok || reserva.causa === 'sem-verificacao') return reserva
      indisponiveis.add(porta)
    }
  }

  private barreiraDaPorta(
    porta: number,
    emUso: ReadonlySet<number> | undefined
  ):
    | {
        readonly ok: false
        readonly motivo: string
        readonly causa: 'indisponivel' | 'sem-verificacao'
      }
    | undefined {
    if (emUso === undefined) {
      return {
        ok: false,
        motivo: 'O Docker não respondeu: a porta não pôde ser verificada.',
        causa: 'sem-verificacao'
      }
    }
    if (emUso.has(porta)) {
      return {
        ok: false,
        motivo: `A porta ${porta} está publicada ou configurada por um container.`,
        causa: 'indisponivel'
      }
    }
    if (!this.deps.portaLivreNoHost(porta)) {
      return { ok: false, motivo: `A porta ${porta} está ocupada no host.`, causa: 'indisponivel' }
    }
    return undefined
  }

  // ─── o scanner ─────────────────────────────────────────────────────────────────────────────────

  /**
   * O container carrega credencial proibida? Não conseguir inspecionar é `indeterminado` — nunca
   * `limpo`. O relatório vai para a auditoria **sem os valores**, só a origem e a referência.
   */
  escanear(container: string): ResultadoDoScanner {
    const entrada = this.deps.docker.inspecionarSandbox(container, this.deps.cwd())
    const resultado: ResultadoDoScanner =
      entrada === undefined
        ? { estado: 'indeterminado', achados: [] }
        : (() => {
            const achados = escanearSandbox(entrada)
            return { estado: achados.length === 0 ? 'limpo' : 'achados', achados } as const
          })()

    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'pipeline-transition',
      payload: {
        isolamento: 'scanner',
        container,
        estado: resultado.estado,
        achados: resultado.achados.map((a) => ({ origem: a.origem, referencia: a.referencia }))
      }
    })
    return resultado
  }

  // ─── devolver os recursos ──────────────────────────────────────────────────────────────────────

  /**
   * Devolve ao sistema os recursos **do run**, na ordem que a dependência exige: containers
   * (sidecar e executor) → rede → worktree → perfil → portas → branch. Idempotente: o que já foi
   * removido não volta a aparecer.
   *
   * Container que não parou segura o que ele monta: **worktree e perfil não são removidos de baixo
   * de um container vivo**, e a porta só volta depois da parada confirmada.
   */
  liberarRun(runId: string, opcoes: OpcoesDaLiberacao = {}): ResultadoDaLiberacao {
    const userId = this.deps.userId()
    const cwd = this.deps.cwd()
    const recursos = this.deps.inventario.listarDoRun(userId, runId)
    const removidos: TipoDeRecurso[] = []
    const pendencias: PendenciaDeLimpeza[] = []
    const geridos = recursos.some((r) => ['container', 'sidecar', 'rede'].includes(r.tipo))
      ? this.deps.docker.listarGeridos(cwd)
      : undefined

    const de = (...tipos: TipoDeRecurso[]): RecursoDoRun[] =>
      recursos.filter((r) => tipos.includes(r.tipo))

    for (const r of de('sidecar', 'container')) {
      this.liberarContainer(r, geridos, cwd, removidos, pendencias)
    }
    for (const r of de('rede')) this.liberarRede(r, geridos, cwd, removidos, pendencias)

    const containerPendente = pendencias.some(
      (p) => p.recurso === 'container' || p.recurso === 'sidecar'
    )
    if (!containerPendente) {
      if (opcoes.preservarWorktree !== true) {
        for (const r of de('worktree')) this.liberarWorktree(r, removidos, pendencias)
      }
      for (const r of de('perfil')) this.liberarPerfil(r, removidos, pendencias)
    }
    for (const r of de('porta')) {
      // Porta só volta depois da parada confirmada (regra 4).
      if (containerPendente) continue
      this.deps.leases.liberar(userId, recursoDaPorta(Number(r.identificador)), runId)
      this.baixar(r, removidos)
    }
    if (opcoes.preservarWorktree !== true) {
      for (const r of de('branch')) this.baixar(r, removidos)
    }

    if (removidos.length > 0 || pendencias.length > 0) {
      this.deps.audit.append({
        user_id: userId,
        workspace_id: this.deps.workspaceId(),
        type: 'pipeline-lease',
        payload: {
          acao: 'isolamento-liberado',
          runId,
          removidos: removidos.join(','),
          pendencias: pendencias.length
        }
      })
    }
    return { removidos, pendencias }
  }

  /**
   * Devolve o run **e as unidades de sandbox dele** (`<run>-<escritor>-…`, o que o Squad registra no
   * lugar do `runId`). Prefixo por segmento, como `runOuUnidadeAtiva`: `run-10` não é de `run-1`.
   */
  liberarRunEUnidades(runId: string): ResultadoDaLiberacao {
    const removidos: TipoDeRecurso[] = []
    const pendencias: PendenciaDeLimpeza[] = []
    const alvos = this.deps.inventario
      .runsComRecurso(this.deps.userId())
      .filter((id) => id === runId || id.startsWith(`${runId}-`))

    for (const alvo of alvos.length === 0 ? [runId] : alvos) {
      const r = this.liberarRun(alvo)
      removidos.push(...r.removidos)
      pendencias.push(...r.pendencias)
    }
    return { removidos, pendencias }
  }

  /**
   * O recurso Docker sumiu da listagem? Reconsulta algumas vezes, porque o `docker stop` de um
   * container `--rm` volta antes de ele sair da lista. `indeterminado` quando a listagem falha:
   * não ver o recurso porque o Docker não respondeu **não** é ele ter sumido.
   */
  private confirmarAusencia(
    tipo: 'containers' | 'redes',
    nome: string,
    cwd: string
  ): 'ausente' | 'presente' | 'indeterminado' {
    for (let tentativa = 0; tentativa < CONSULTAS_DE_CONFIRMACAO; tentativa += 1) {
      const lista = this.deps.docker.listarGeridos(cwd)
      if (lista === undefined) return 'indeterminado'
      if (!lista[tipo].some((r) => r.nome === nome)) return 'ausente'
      this.aguardar(PAUSA_ENTRE_CONSULTAS_MS)
    }
    return 'presente'
  }

  private liberarContainer(
    r: RecursoDoRun,
    geridos: RecursosGeridos | undefined,
    cwd: string,
    removidos: TipoDeRecurso[],
    pendencias: PendenciaDeLimpeza[]
  ): void {
    // Sem a listagem não há prova de que o container não existe — nem para o que ficou `planejado`
    // num crash entre o `docker run` e a confirmação. É pendência, nunca "removido".
    if (geridos === undefined) {
      this.pendencia(
        r,
        'O Docker não listou os recursos: a posse não pôde ser provada.',
        pendencias
      )
      return
    }
    const achado = geridos.containers.find((c) => c.nome === r.identificador)
    if (achado === undefined) {
      this.baixar(r, removidos)
      // O lease do container é do **container**: o sidecar ausente não o solta, porque o executor
      // pode ainda estar de pé e a parada dele ainda nem foi tentada.
      if (r.tipo === 'container') this.soltarLease(r, recursoDoContainer(r.runId))
      return
    }
    if (achado.runId !== r.runId) {
      this.pendencia(r, donoDiferente(achado.runId), pendencias)
      return
    }
    if (!this.deps.docker.parar(r.identificador, cwd)) {
      this.pendencia(r, 'O Docker recusou parar o container.', pendencias)
      return
    }
    const depois = this.confirmarAusencia('containers', r.identificador, cwd)
    if (depois !== 'ausente') {
      this.pendencia(
        r,
        depois === 'presente'
          ? 'O container continua existindo depois de parado.'
          : 'O Docker não respondeu: a parada não pôde ser confirmada.',
        pendencias
      )
      return
    }
    this.baixar(r, removidos, true)
    if (r.tipo === 'container') this.soltarLease(r, recursoDoContainer(r.runId))
  }

  private liberarRede(
    r: RecursoDoRun,
    geridos: RecursosGeridos | undefined,
    cwd: string,
    removidos: TipoDeRecurso[],
    pendencias: PendenciaDeLimpeza[]
  ): void {
    if (geridos === undefined) {
      this.pendencia(
        r,
        'O Docker não listou os recursos: a posse não pôde ser provada.',
        pendencias
      )
      return
    }
    const achada = geridos.redes.find((n) => n.nome === r.identificador)
    if (achada === undefined) {
      this.baixar(r, removidos)
      return
    }
    if (achada.runId !== r.runId) {
      this.pendencia(r, donoDiferente(achada.runId), pendencias)
      return
    }
    if (!this.deps.docker.removerRede(r.identificador, cwd)) {
      this.pendencia(r, 'O Docker não removeu a rede.', pendencias)
      return
    }
    if (this.confirmarAusencia('redes', r.identificador, cwd) !== 'ausente') {
      this.pendencia(r, 'A remoção da rede não pôde ser confirmada.', pendencias)
      return
    }
    this.baixar(r, removidos)
  }

  private liberarWorktree(
    r: RecursoDoRun,
    removidos: TipoDeRecurso[],
    pendencias: PendenciaDeLimpeza[]
  ): void {
    const repositorio = r.detalhes['repositorio']
    if (repositorio === undefined) {
      this.pendencia(r, 'O inventário não guarda o repositório do worktree.', pendencias)
      return
    }
    if (!this.deps.worktreeExiste(r.identificador)) {
      // Já não está no disco: só o registro do Git pode ter sobrado.
      this.deps.git.run(['worktree', 'prune'], repositorio, this.deps.workspaceId())
      this.baixar(r, removidos)
      this.soltarLease(r, recursoDoWorktree(r.runId))
      return
    }
    try {
      this.deps.descartarArtefatos(r.identificador)
    } catch {
      this.pendencia(r, 'O caminho do worktree não tem a forma de um worktree de run.', pendencias)
      return
    }
    // Sem `--force`: o que o Git recusa é trabalho que o kernel não registrou. O `--` fecha as
    // opções: um caminho nunca é lido como flag.
    const removeu = this.deps.git.run(
      ['worktree', 'remove', '--', r.identificador],
      repositorio,
      this.deps.workspaceId()
    )
    if (!removeu.ok) {
      this.pendencia(r, 'O Git recusou remover o worktree.', pendencias)
      return
    }
    this.baixar(r, removidos)
    this.soltarLease(r, recursoDoWorktree(r.runId))
  }

  private liberarPerfil(
    r: RecursoDoRun,
    removidos: TipoDeRecurso[],
    pendencias: PendenciaDeLimpeza[]
  ): void {
    try {
      this.deps.removerDiretorio(r.identificador)
    } catch {
      this.pendencia(r, 'Não foi possível remover o diretório do perfil.', pendencias)
      return
    }
    this.baixar(r, removidos)
  }

  private baixar(r: RecursoDoRun, removidos: TipoDeRecurso[], viaParado = false): void {
    const userId = this.deps.userId()
    if (viaParado) this.deps.inventario.mudarEstado(userId, r.id, 'parado', this.agora())
    this.deps.inventario.mudarEstado(userId, r.id, 'removido', this.agora())
    removidos.push(r.tipo)
  }

  private soltarLease(r: RecursoDoRun, recurso: string): void {
    this.deps.leases.liberar(this.deps.userId(), recurso, r.runId)
  }

  private pendencia(r: RecursoDoRun, motivo: string, pendencias: PendenciaDeLimpeza[]): void {
    const pendencia: PendenciaDeLimpeza = {
      runId: r.runId,
      recurso: r.tipo as RecursoLimpavel,
      identificador: r.identificador,
      motivo,
      em: new Date(this.agora()).toISOString()
    }
    this.registrar(pendencia)
    pendencias.push(pendencia)
  }

  /** Registra uma pendência uma vez só: o mesmo recurso não reaparece a cada boot. */
  private registrar(pendencia: PendenciaDeLimpeza): void {
    const userId = this.deps.userId()
    const jaExiste = this.deps.ledger
      .listarPendencias(userId)
      .some((p) => p.runId === pendencia.runId && p.identificador === pendencia.identificador)
    if (!jaExiste) this.deps.ledger.registrarPendencia(userId, pendencia)
  }

  // ─── reconciliar depois de um crash ────────────────────────────────────────────────────────────

  /**
   * Reconcilia o inventário com o mundo, no boot. Run ativo não é tocado; run morto tem seus
   * recursos devolvidos; recurso gerido no Docker **sem registro** é reportado como pendência e
   * nunca destruído — limpeza só atinge o que está ligado a um run reconciliado (regra 4 da SPEC).
   */
  async reconciliar(): Promise<readonly AchadoDaReconciliacao[]> {
    const userId = this.deps.userId()
    const achados: AchadoDaReconciliacao[] = []

    for (const runId of this.deps.inventario.runsComRecurso(userId)) {
      if (this.deps.runAtivo(runId)) {
        achados.push({
          recurso: `run:${runId}`,
          decisao: 'bloqueado',
          motivo: 'Run ainda ativo: os recursos dele não são tocados.'
        })
        continue
      }
      const { removidos, pendencias } = this.liberarRun(runId)
      achados.push(
        pendencias.length === 0
          ? {
              recurso: `run:${runId}`,
              decisao: 'liberado',
              motivo: `Recursos devolvidos: ${removidos.join(', ') || 'nenhum a remover'}.`
            }
          : {
              recurso: `run:${runId}`,
              decisao: 'bloqueado',
              motivo: `${pendencias.length} recurso(s) não puderam ser devolvidos: ${pendencias
                .map((p) => `${p.recurso} ${p.identificador}`)
                .join('; ')}.`
            }
      )
    }

    achados.push(...this.orfaos())
    log.agent.info('Reconciliação do isolamento concluída', { achados: achados.length })
    return achados
  }

  private orfaos(): AchadoDaReconciliacao[] {
    const userId = this.deps.userId()
    const geridos = this.deps.docker.listarGeridos(this.deps.cwd())
    if (geridos === undefined) {
      return [
        {
          recurso: 'docker',
          decisao: 'bloqueado',
          motivo: 'O Docker não listou os recursos geridos: órfãos não puderam ser verificados.'
        }
      ]
    }

    const achados: AchadoDaReconciliacao[] = []
    const registrado = (tipos: TipoDeRecurso[], nome: string): boolean =>
      tipos.some((tipo) => this.deps.inventario.buscar(userId, tipo, nome) !== undefined)
    const reportar = (
      tipo: 'container' | 'rede',
      nome: string,
      runId: string | undefined
    ): void => {
      const motivo = `Recurso gerido sem registro no inventário (run declarado: ${runId ?? 'nenhum'}). Não foi tocado.`
      this.registrar({
        runId: runId ?? 'desconhecido',
        recurso: tipo,
        identificador: nome,
        motivo,
        em: new Date(this.agora()).toISOString()
      })
      achados.push({ recurso: `${tipo}:${nome}`, decisao: 'bloqueado', motivo })
    }

    for (const c of geridos.containers) {
      if (!registrado(['container', 'sidecar'], c.nome)) reportar('container', c.nome, c.runId)
    }
    for (const n of geridos.redes) {
      if (!registrado(['rede'], n.nome)) reportar('rede', n.nome, n.runId)
    }
    return achados
  }
}

const donoDiferente = (dono: string | undefined): string =>
  `O recurso pertence ao run ${dono ?? 'desconhecido'}, não a este.`

function numeroDaPorta(recurso: string): number | undefined {
  const numero = /^porta:(\d+)$/.exec(recurso)?.[1]
  return numero === undefined ? undefined : Number(numero)
}
