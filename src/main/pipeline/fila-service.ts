/**
 * A fila de execução: seleciona trabalho aprovado e governa o slot global de WIP
 * (SPEC-Entrega-02, critérios 2, 3, 6 e 7).
 *
 * A pergunta que este serviço responde: **posso começar a construir esta fatia agora?**
 *
 * Três coisas precisam ser verdade ao mesmo tempo, e cada uma é um critério:
 *
 *  - **o PI aprovou esta revisão exata da SPEC** (critério 7): `AWAITING_PI` só sai para `READY`
 *    com `Approval` vigente do gate `SLICE_ENTRY`. É a **única** aprovação humana do run — não
 *    existe segundo "go" para construir, e inventar um seria o aceite duplicado que a invariante
 *    2 da CONVENTION §4 proíbe;
 *  - **as dependências terminaram** (invariante 5): quem responde é `dependenciasAbertas`, com a
 *    ordem implícita decidida pelo PI em 2026-08-30;
 *  - **o slot global está livre** (critério 2): um run por máquina, inclusive entre projetos
 *    diferentes.
 *
 * **A ordem em que verifico importa.** A aprovação vem antes do slot: recusar por WIP uma fatia
 * que nem estava aprovada esconderia o motivo verdadeiro, e o PI ficaria esperando um slot para
 * um trabalho que nunca poderia começar.
 *
 * **O que este serviço não faz:** não constrói (M9-F04), não prepara worktree nem container
 * (M9-F03), não mergeia (M9-F05). Ele decide *se* e *quando*, e larga o run em `RUNNING` para
 * quem constrói.
 */

import { aprovacaoVigente, type Approval, type RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { WorkspaceId } from '@shared/domain/entities'
import { dependenciasAbertas, type DependenciaAberta } from '@shared/domain/fila'
import {
  RECURSO_WIP_GLOBAL,
  estadoDoLease,
  podeAdquirir,
  type Lease,
  type LeaseOutcome
} from '@shared/domain/lease'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import {
  ehTerminal,
  transicaoPermitida,
  type EstadoDoRun,
  type PipelineRun,
  type TransicaoOutcome,
  type VistaDaFila
} from '@shared/domain/pipeline'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { EscopoDoRun, PipelineRepository } from './pipeline-repository'
import type { LeaseRepository } from './lease-repository'

/** O roadmap de um projeto, como a fila precisa dele. */
export interface RoadmapDaFila {
  readonly mvps: readonly Mvp[]
  readonly slices: readonly Slice[]
}

export interface FilaDeps {
  readonly runs: PipelineRepository
  readonly leases: LeaseRepository
  readonly audit: AuditRepository
  /** O roadmap do projeto. Vem do `RoadmapRepository`, injetado para o serviço não conhecê-lo. */
  readonly roadmap: (escopo: EscopoDoRun) => RoadmapDaFila
  /** As aprovações do projeto, para o gate `SLICE_ENTRY` (critério 7). */
  readonly aprovacoes: (escopo: EscopoDoRun) => readonly Approval[]
  /** As revisões atuais do gate, para comparar hashes — a mesma fonte que a M8-F06 usa. */
  readonly revisoesDoGate: (escopo: EscopoDoRun) => readonly RevisaoAprovada[]
  readonly userId: () => string
  /**
   * O kill-switch do merge autônomo do projeto (M9-F05, decisão do PI de 2026-08-30).
   *
   * Injetado como função, e não como o `MergePolicyService` inteiro: a fila só precisa da
   * resposta, e depender do serviço a acoplaria à auditoria da mudança de política — que é outro
   * assunto, com outro tipo de evento.
   */
  readonly mergeAutonomoLigado: (projectId: string) => boolean
  /** Relógio injetado: lease e expiração precisam ser determinísticos no teste. */
  readonly agora?: () => number
}

export class FilaService {
  private readonly agora: () => number

  constructor(private readonly deps: FilaDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  private escopo(projectId: string, workspaceId: WorkspaceId): EscopoDoRun {
    return { userId: this.deps.userId(), workspaceId, projectId }
  }

  /**
   * Cria o run de uma fatia, em `PLANNED`.
   *
   * `continuaDe` é a retomada de bloqueio: um run novo vinculado ao que travou, nunca a
   * reabertura do run terminado (§ Estados).
   */
  criarRun(
    projectId: string,
    workspaceId: WorkspaceId,
    sliceId: string,
    continuaDe?: string
  ): PipelineRun {
    const escopo = this.escopo(projectId, workspaceId)
    const run = this.deps.runs.criar(
      escopo,
      { sliceId, estado: 'PLANNED', ...(continuaDe === undefined ? {} : { continuaDe }) },
      new Date(this.agora())
    )

    this.auditarTransicao(escopo, run, undefined, 'PLANNED')
    return run
  }

  /**
   * Move o run para outro estado, validando a transição e o que ela exige.
   *
   * Toda transição passa por aqui — inclusive as que a M9-F04 e a M9-F05 farão. É o ponto único
   * onde a tabela do domínio é consultada, e é o que torna o critério 5 verificável: não existe
   * um segundo caminho que escreva `estado` sem perguntar.
   */
  transicionar(
    projectId: string,
    workspaceId: WorkspaceId,
    runId: string,
    para: EstadoDoRun,
    bloqueio?: BloqueioExterno
  ): TransicaoOutcome {
    const escopo = this.escopo(projectId, workspaceId)
    const run = this.deps.runs.buscar(runId)

    if (run === undefined || run.user_id !== escopo.userId) {
      return { reason: 'run-inexistente', mensagem: 'Run não encontrado.' }
    }

    if (ehTerminal(run.estado)) {
      return {
        reason: 'run-terminal',
        mensagem: `O run já terminou em ${run.estado}. Retomar exige uma continuação vinculada.`
      }
    }

    if (!transicaoPermitida(run.estado, para)) {
      return {
        reason: 'transicao-invalida',
        mensagem: `Um run em ${run.estado} não pode ir para ${para}.`
      }
    }

    // Critério 6: bloqueio sem os cinco campos é inválido por definição (CONVENTION §4).
    if (para === 'BLOCKED' && !this.bloqueioCompleto(bloqueio)) {
      return {
        reason: 'bloqueio-incompleto',
        mensagem:
          'Bloqueio exige causa, evidência, tentativas, por que não seguir e ação de retomada.'
      }
    }

    // Critério 7: a única aprovação humana do run. Sem ela, `READY` não acontece.
    if (run.estado === 'AWAITING_PI' && para === 'READY') {
      const vigente = aprovacaoVigente(
        this.deps.aprovacoes(escopo),
        'SLICE_ENTRY',
        this.deps.revisoesDoGate(escopo)
      )

      if (vigente === undefined) {
        return {
          reason: 'sem-aprovacao-vigente',
          mensagem: 'A revisão vigente da SPEC não tem aprovação do PI no gate SLICE_ENTRY.'
        }
      }

      const abertas = this.dependenciasDaFatia(escopo, run.sliceId)
      if (abertas.length > 0) {
        return {
          reason: 'dependencia-aberta',
          mensagem: abertas.map((d) => d.mensagem).join(' ')
        }
      }
    }

    const gravou = this.deps.runs.transicionar(
      runId,
      run.estado,
      para,
      new Date(this.agora()),
      para === 'BLOCKED' ? bloqueio : undefined
    )

    // O compare-and-set falhou: outro processo transicionou este run entre a leitura e a escrita.
    if (!gravou) {
      return {
        reason: 'transicao-invalida',
        mensagem: 'O run mudou de estado enquanto esta transição era decidida.'
      }
    }

    const atualizado = this.deps.runs.buscar(runId) as PipelineRun
    this.auditarTransicao(escopo, atualizado, run.estado, para, bloqueio)

    return { reason: 'transicionado', run: atualizado, mensagem: `Run em ${para}.` }
  }

  /**
   * Adquire o slot global de WIP para um run em `READY`, e o leva a `RUNNING` (critério 2).
   *
   * As duas coisas juntas de propósito: um slot adquirido sem o run avançar seria um recurso
   * preso a um run que não está trabalhando, e a reconciliação teria de adivinhar se aquilo é
   * progresso ou lixo.
   */
  adquirirSlot(projectId: string, workspaceId: WorkspaceId, runId: string): LeaseOutcome {
    const escopo = this.escopo(projectId, workspaceId)
    const agora = this.agora()
    const existente = this.deps.leases.buscar(escopo.userId, RECURSO_WIP_GLOBAL)

    if (!podeAdquirir(existente, runId, agora)) {
      // Critério 3: expirado **não** é o mesmo que livre. A reconciliação decide, porque a
      // expiração pode significar máquina lenta, não processo morto.
      const estado = estadoDoLease(existente, agora)
      return estado === 'expirado'
        ? {
            reason: 'expirado-requer-reconciliacao',
            ...(existente === undefined ? {} : { lease: existente }),
            mensagem:
              'O slot de WIP tem lease expirado. A reconciliação precisa confirmar o estado antes de reatribuí-lo.'
          }
        : {
            reason: 'ocupado',
            ...(existente === undefined ? {} : { lease: existente }),
            mensagem: 'Outro run detém o slot de execução. WIP=1 é global (uma fatia por máquina).'
          }
    }

    // **Retry depois de crash: o slot já é dele e o run já avançou** (critério 4).
    //
    // O crash entre `adquirir` e a confirmação deixa exatamente este estado — lease do run,
    // run em `RUNNING`. Repetir a chamada tem de devolver o mesmo resultado, e não tentar a
    // transição de novo: `RUNNING → RUNNING` é inválida por construção, e tratar essa recusa
    // como "o run não podia avançar" liberaria o slot de um run que está trabalhando.
    const jaEstavaRodando = this.deps.runs.buscar(runId)?.estado === 'RUNNING'
    if (existente?.proprietario === runId && jaEstavaRodando) {
      return {
        reason: 'adquirido',
        lease: existente,
        mensagem: 'O slot já pertencia a este run, que já estava em execução.'
      }
    }

    // Readquirir o próprio lease vigente é idempotente: o retry depois de um crash entre gravar e
    // confirmar não pode ficar travado no próprio lease (critério 4).
    const lease =
      existente?.proprietario === runId
        ? existente
        : this.deps.leases.adquirir(
            escopo.userId,
            { proprietario: runId, recurso: RECURSO_WIP_GLOBAL, projectId },
            agora
          )

    if (lease === undefined) {
      // O `UNIQUE` recusou: outro processo adquiriu entre a checagem e o INSERT. A janela que a
      // checagem em memória deixa aberta é fechada aqui, no banco.
      return {
        reason: 'ocupado',
        mensagem: 'Outro run adquiriu o slot de execução neste instante.'
      }
    }

    const transicao = this.transicionar(projectId, workspaceId, runId, 'RUNNING')
    if (transicao.reason !== 'transicionado') {
      // O run não podia avançar: devolvo o slot em vez de deixá-lo preso a um run parado.
      this.deps.leases.liberar(escopo.userId, RECURSO_WIP_GLOBAL, runId)
      return { reason: 'ocupado', mensagem: transicao.mensagem }
    }

    this.auditarLease(escopo, 'adquirido', lease)
    return { reason: 'adquirido', lease, mensagem: 'Slot de execução adquirido.' }
  }

  /**
   * Conclui um run em `PR_CI`, escolhendo o terminal pelo kill-switch do projeto (critério 7).
   *
   * **`AWAITING_MERGE` não é bloqueio nem falha** (emenda 2 de 2026-08-30): é o desfecho legítimo
   * de um projeto que decidiu não deixar a pipeline entrar sozinha na branch-base. Terminar em
   * `BLOCKED` aqui ensinaria a ler bloqueio como ruído — e `BLOCKED` é reservado a causa externa
   * ou risco, não a uma configuração que o PI escolheu.
   *
   * O merge em si é da M9-F05; esta função só decide **qual terminal** o run merece. Quem chama
   * já confirmou os checks no `head SHA` esperado — a fila não valida CI.
   */
  concluir(projectId: string, workspaceId: WorkspaceId, runId: string): TransicaoOutcome {
    const terminal = this.deps.mergeAutonomoLigado(projectId) ? 'MERGED' : 'AWAITING_MERGE'
    const resultado = this.transicionar(projectId, workspaceId, runId, terminal)

    // O slot é da máquina: segurá-lo depois do terminal travaria a fila inteira até o próximo
    // boot. Libero em qualquer dos dois desfechos — `AWAITING_MERGE` também terminou.
    if (resultado.reason === 'transicionado') {
      this.liberarSlot(projectId, workspaceId, runId)
    }

    return resultado
  }

  /** Renova o heartbeat do slot. Só o próprio dono renova (o `WHERE` do repositório garante). */
  renovarSlot(runId: string): boolean {
    return this.deps.leases.renovar(this.deps.userId(), RECURSO_WIP_GLOBAL, runId, this.agora())
  }

  /** Libera o slot ao fim do run. */
  liberarSlot(projectId: string, workspaceId: WorkspaceId, runId: string): boolean {
    const escopo = this.escopo(projectId, workspaceId)
    const lease = this.deps.leases.buscar(escopo.userId, RECURSO_WIP_GLOBAL)
    const liberou = this.deps.leases.liberar(escopo.userId, RECURSO_WIP_GLOBAL, runId)

    if (liberou && lease !== undefined) this.auditarLease(escopo, 'liberado', lease)
    return liberou
  }

  /**
   * O que a fila mostra: os runs ativos e as dependências abertas de cada fatia do projeto.
   *
   * **Só leitura.** Não existe canal que transicione run ou adquira slot a pedido do renderer —
   * seria o renderer declarando que uma fatia chegou a `MERGED`, o pulo que o critério 5 existe
   * para impedir. Quem move a pipeline é o main, a partir do que o PI aprovou no gate.
   */
  vista(projectId: string, workspaceId: WorkspaceId): VistaDaFila {
    const escopo = this.escopo(projectId, workspaceId)
    const { slices } = this.deps.roadmap(escopo)

    return {
      ativos: this.deps.runs.listarAtivos(escopo.userId),
      concluidas: this.deps.runs.fatiasConcluidas(escopo).map((c) => c.sliceId),
      bloqueadas: slices
        .map((slice) => ({
          sliceId: slice.id,
          abertas: this.dependenciasDaFatia(escopo, slice.id)
        }))
        .filter((d) => d.abertas.length > 0)
    }
  }

  /** As dependências ainda abertas de uma fatia — para a tela explicar por que ela não começa. */
  dependenciasDaFatia(escopo: EscopoDoRun, sliceId: string): readonly DependenciaAberta[] {
    const { mvps, slices } = this.deps.roadmap(escopo)
    const slice = slices.find((s) => s.id === sliceId)
    if (slice === undefined) return []

    return dependenciasAbertas(slice, mvps, slices, this.deps.runs.fatiasConcluidas(escopo))
  }

  /** Os cinco campos da CONVENTION §4. Vazio não conta: string em branco não é evidência. */
  private bloqueioCompleto(bloqueio: BloqueioExterno | undefined): boolean {
    if (bloqueio === undefined) return false

    return (
      bloqueio.causa.trim() !== '' &&
      bloqueio.evidencia.trim() !== '' &&
      bloqueio.porQueNaoSeguir.trim() !== '' &&
      bloqueio.retomada.trim() !== '' &&
      Number.isInteger(bloqueio.tentativas) &&
      bloqueio.tentativas >= 0
    )
  }

  private auditarTransicao(
    escopo: EscopoDoRun,
    run: PipelineRun,
    de: EstadoDoRun | undefined,
    para: EstadoDoRun,
    bloqueio?: BloqueioExterno
  ): void {
    this.deps.audit.append({
      user_id: escopo.userId,
      workspace_id: escopo.workspaceId,
      type: 'pipeline-transition',
      payload: {
        runId: run.id,
        projectId: escopo.projectId,
        sliceId: run.sliceId,
        de: de ?? null,
        para,
        // Só a causa: a evidência pode carregar saída de comando, e a auditoria não é log.
        ...(bloqueio === undefined ? {} : { causa: bloqueio.causa })
      }
    })

    log.agent.info('Run da pipeline mudou de estado', { runId: run.id, de: de ?? null, para })
  }

  private auditarLease(escopo: EscopoDoRun, acao: 'adquirido' | 'liberado', lease: Lease): void {
    this.deps.audit.append({
      user_id: escopo.userId,
      workspace_id: escopo.workspaceId,
      type: 'pipeline-lease',
      payload: {
        acao,
        recurso: lease.recurso,
        proprietario: lease.proprietario,
        projectId: escopo.projectId
      }
    })
  }
}
