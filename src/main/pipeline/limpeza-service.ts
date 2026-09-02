/**
 * A limpeza dos recursos de um run (SPEC-Entrega-06, critérios 5 e 8).
 *
 * A pergunta que este arquivo responde: **o run acabou (ou foi cancelado) — o que pode ser
 * devolvido ao sistema, e o que precisa ficar registrado por não ter sido?**
 *
 * **Verificar a posse antes de remover.** Cada recurso é conferido contra o lease: só sai o que
 * pertence a este run. Sem isso, um run que herdasse o nome de outro apagaria o worktree de um
 * trabalho vivo — e a spec é explícita em que a limpeza nunca destrói trabalho. Quando a posse
 * não confere, o recurso vira pendência em vez de remoção: alguém precisa olhar, mas ninguém
 * perde nada.
 *
 * **Falha de limpeza não desfaz merge.** Um container que não parou é um problema de disco, e
 * tratá-lo como motivo para reverter trocaria uma sobra por perda de entrega. Toda falha vira
 * `PendenciaDeLimpeza` no banco, que é o que a reconciliação do boot encontra depois.
 *
 * **A remoção do container é `docker stop` sobre um container criado com `--rm`.** `docker rm`
 * casa a política de destrutivos do MVP-004 e abriria `ApprovalRequest`, travando a limpeza num
 * gate humano — o oposto do desenvolvimento autônomo. Com `--rm` na criação (M9-F03), parar já
 * remove, sem nenhum comando destrutivo na allowlist. Decisão do PI em 2026-09-02.
 *
 * **O que este arquivo não faz:** não decide o que cada fase preserva (isso é `limpeza.ts`), não
 * apaga volume persistente e não toca branch nem PR.
 */

import type {
  PendenciaDeLimpeza,
  FaseDeCancelamento,
  RecursoLimpavel
} from '@shared/domain/limpeza'
import { planoDeLimpeza } from '@shared/domain/limpeza'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import type { SandboxPreparado } from '@shared/domain/preflight'
import {
  RECURSO_PORTA,
  recursoDoContainer,
  recursoDoWorktree
} from '@shared/domain/preflight'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { ExecutionLedgerRepository } from './execution-ledger-repository'
import type { LeaseRepository } from './lease-repository'

/**
 * O que a limpeza precisa do Docker.
 *
 * Interface mínima, e não o `DockerRunner` inteiro: é o que mantém o teste sem Docker real e o
 * que impede este serviço alcançar `criarRede`, `subir` ou qualquer outra coisa que ele não deve
 * fazer. O tipo é a fronteira.
 */
export interface DockerDaLimpeza {
  readonly parar: (nome: string, cwd: string) => boolean
  readonly matarProcesso: (container: string, cwd: string) => void
}

/** O que a limpeza precisa do Git. Só `run`, e só para remover o worktree. */
export interface GitDaLimpeza {
  readonly run: (
    args: readonly string[],
    cwd: string,
    workspaceId: WorkspaceId
  ) => { readonly ok: boolean }
}

export interface LimpezaDeps {
  readonly docker: DockerDaLimpeza
  readonly git: GitDaLimpeza
  readonly leases: LeaseRepository
  readonly ledger: ExecutionLedgerRepository
  readonly workspaceId: () => WorkspaceId
  readonly agora?: () => number
}

export interface PedidoDeLimpeza {
  readonly runId: string
  readonly userId: string
  readonly projectId: string
  /** A raiz do repositório-alvo: o cwd dos comandos de Git e Docker. */
  readonly repositorio: string
  readonly sandbox: SandboxPreparado
  readonly fase: FaseDeCancelamento
  readonly estadoFinal: EstadoDoRun
}

export interface ResultadoDaLimpeza {
  readonly removidos: readonly RecursoLimpavel[]
  readonly pendencias: readonly PendenciaDeLimpeza[]
}

export class LimpezaService {
  private readonly agora: () => number

  constructor(private readonly deps: LimpezaDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /**
   * Devolve ao sistema o que pertence a este run.
   *
   * Síncrona porque tudo que ela faz é síncrono: o `TerminalEngine` roda os comandos em bloco e o
   * SQLite é síncrono. Uma `Promise` aqui só criaria a impressão de concorrência que não existe.
   */
  limpar(pedido: PedidoDeLimpeza): ResultadoDaLimpeza {
    const plano = planoDeLimpeza(pedido.fase)
    const removidos: RecursoLimpavel[] = []
    const pendencias: PendenciaDeLimpeza[] = []

    if (plano.mataProcessos) {
      this.deps.docker.matarProcesso(pedido.sandbox.containerNome, pedido.repositorio)
    }

    // Fase que preserva o snapshot ainda tem trabalho no worktree e container: interromper não é
    // encerrar, e remover aqui obrigaria o preflight inteiro de novo na retomada.
    if (!plano.removeRecursos) {
      return { removidos, pendencias }
    }

    this.removerWorktree(pedido, removidos, pendencias)
    this.removerContainer(pedido, removidos, pendencias)
    this.liberarPortas(pedido, removidos)

    log.sistema.info('Limpeza do run concluída', {
      runId: pedido.runId,
      removidos: removidos.join(','),
      pendencias: pendencias.length
    })

    return { removidos, pendencias }
  }

  private removerWorktree(
    pedido: PedidoDeLimpeza,
    removidos: RecursoLimpavel[],
    pendencias: PendenciaDeLimpeza[]
  ): void {
    const recurso = recursoDoWorktree(pedido.runId)
    if (!this.pertenceAoRun(pedido, recurso, 'worktree', pedido.sandbox.worktreeNoHost, pendencias))
      return

    // `--force` remove o worktree mesmo com arquivo não rastreado dentro — o run terminou, e o
    // que sobrou ali é subproduto da execução, não trabalho de alguém. O que era trabalho já
    // está na branch, que esta limpeza jamais toca.
    const removeu = this.deps.git.run(
      ['worktree', 'remove', '--force', pedido.sandbox.worktreeNoHost],
      pedido.repositorio,
      this.deps.workspaceId()
    )

    if (!removeu.ok) {
      this.registrarPendencia(
        pedido,
        'worktree',
        pedido.sandbox.worktreeNoHost,
        'O Git recusou remover o worktree.',
        pendencias
      )
      return
    }

    this.deps.leases.liberar(pedido.userId, recurso, pedido.runId)
    removidos.push('worktree')
  }

  private removerContainer(
    pedido: PedidoDeLimpeza,
    removidos: RecursoLimpavel[],
    pendencias: PendenciaDeLimpeza[]
  ): void {
    const recurso = recursoDoContainer(pedido.runId)
    if (!this.pertenceAoRun(pedido, recurso, 'container', pedido.sandbox.containerNome, pendencias))
      return

    const parou = this.deps.docker.parar(pedido.sandbox.containerNome, pedido.repositorio)
    if (!parou) {
      this.registrarPendencia(
        pedido,
        'container',
        pedido.sandbox.containerNome,
        'O Docker recusou parar o container.',
        pendencias
      )
      return
    }

    this.deps.leases.liberar(pedido.userId, recurso, pedido.runId)
    removidos.push('container')
  }

  /**
   * Libera as portas deste run.
   *
   * A porta não deriva do `runId` — o recurso é `porta:<numero>` —, então a busca é pelo
   * proprietário. Rede e sidecar não têm lease próprio: eles nascem e morrem junto do container
   * (M9-F03 § Limites), e o `--rm` os deixa sem container ao qual se prender.
   */
  private liberarPortas(pedido: PedidoDeLimpeza, removidos: RecursoLimpavel[]): void {
    const portas = this.deps.leases
      .listar(pedido.userId)
      .filter(
        (lease) => lease.proprietario === pedido.runId && lease.recurso.startsWith(RECURSO_PORTA)
      )

    for (const lease of portas) {
      this.deps.leases.liberar(pedido.userId, lease.recurso, pedido.runId)
    }

    if (portas.length > 0) removidos.push('porta')
  }

  /**
   * O recurso é deste run?
   *
   * Ausência de lease **não** é pendência: o preflight pode ter falhado antes de adquiri-lo, e
   * não há nada a remover nem a reclamar. Dono diferente é pendência: alguém precisa olhar, e
   * remover seria destruir trabalho vivo.
   */
  private pertenceAoRun(
    pedido: PedidoDeLimpeza,
    recurso: string,
    tipo: RecursoLimpavel,
    identificador: string,
    pendencias: PendenciaDeLimpeza[]
  ): boolean {
    const lease = this.deps.leases.buscar(pedido.userId, recurso)
    if (lease === undefined) return false

    if (lease.proprietario !== pedido.runId) {
      this.registrarPendencia(
        pedido,
        tipo,
        identificador,
        `O recurso pertence ao run ${lease.proprietario}, não a este.`,
        pendencias
      )
      return false
    }

    return true
  }

  private registrarPendencia(
    pedido: PedidoDeLimpeza,
    recurso: RecursoLimpavel,
    identificador: string,
    motivo: string,
    pendencias: PendenciaDeLimpeza[]
  ): void {
    const pendencia: PendenciaDeLimpeza = {
      runId: pedido.runId,
      recurso,
      identificador,
      motivo,
      em: new Date(this.agora()).toISOString()
    }

    this.deps.ledger.registrarPendencia(pedido.userId, pendencia)
    pendencias.push(pendencia)
  }
}
