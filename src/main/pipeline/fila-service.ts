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
import type { LeaseOutcome } from '@shared/domain/lease'
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
import { idDoEscritor, lerIdDoEscritor } from '@shared/domain/squad-execucao'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { EscopoDoRun, PipelineRepository } from './pipeline-repository'
import type { Aquisicao, PoolService } from './pool-service'
import type { ItemPersistido } from './pool-repository'

/** O roadmap de um projeto, como a fila precisa dele. */
export interface RoadmapDaFila {
  readonly mvps: readonly Mvp[]
  readonly slices: readonly Slice[]
}

export interface FilaDeps {
  readonly runs: PipelineRepository
  /**
   * O pool de execução (SPEC-Scheduler-01). Substitui o slot global único da V1: quem detém o slot,
   * com que token e quem espera é do pool; a fila só decide *se* um run pode entrar nele.
   */
  readonly pool: PoolService
  readonly audit: AuditRepository
  /** O roadmap do projeto. Vem do `RoadmapRepository`, injetado para o serviço não conhecê-lo. */
  readonly roadmap: (escopo: EscopoDoRun) => RoadmapDaFila
  /** As aprovações do projeto, para o gate `SLICE_ENTRY` (critério 7). */
  readonly aprovacoes: (escopo: EscopoDoRun) => readonly Approval[]
  /** As revisões atuais do gate, para comparar hashes — a mesma fonte que a M8-F06 usa. */
  readonly revisoesDoGate: (escopo: EscopoDoRun) => readonly RevisaoAprovada[]
  readonly userId: () => string
  /** O espaço atual: o pool ativa runs por dentro do ciclo, sem o espaço de quem chamou. */
  readonly workspaceId: () => WorkspaceId
  /**
   * Avisa quem executa que um run **adquiriu** o slot (e já está em `RUNNING`). Um run que espera
   * é ativado quando outro libera, e ninguém o chamou na hora: sem este aviso ele seguraria um
   * slot sem trabalhar até o lease expirar.
   */
  readonly aoAdquirir?: (aquisicao: Aquisicao) => void
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

/** Os estados em que o run **executa**: só avança com o token de um lease vivo. */
const ESTADOS_EM_EXECUCAO: readonly EstadoDoRun[] = ['RUNNING', 'VALIDATING', 'PR_CI']

/** Os terminais em que o trabalho acabou: o slot não tem mais o que proteger. */
const DESFECHOS_CONCLUIDOS: readonly EstadoDoRun[] = ['MERGED', 'AWAITING_MERGE']

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
    bloqueio?: BloqueioExterno,
    fencingToken?: number
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

    // **Quem executa o run só o avança com o token de um lease vivo** (critério 4). Vale para o run
    // que detém um slot *e* para o que está em execução sem lease nenhum: este último é o dono
    // antigo — perdeu o lease, outro pode ter o slot —, e tratá-lo como "run sem slot" o deixaria
    // confirmar progresso sem fiscalização. Cancelar é ato do PI e dispensa o token. A conferência
    // é o próprio `UPDATE`: entre "o token confere?" e "grava" não há janela para o lease mudar.
    //
    // **Só de quem passou pelo pool.** O construtor ainda leva o run por `RUNNING → PR_CI` direto
    // pelo repositório, sem slot nem token, e o `EntregaService` o conclui por aqui: exigir token de
    // quem nunca recebeu um travaria a entrega em `PR_CI`. Migrar esse caminho é da M12-F03.
    const passouPeloPool =
      this.deps.pool.adquiriu(runId) || this.deps.pool.slotDoRun(runId) !== undefined
    const exigeToken =
      para !== 'CANCELLED' && ESTADOS_EM_EXECUCAO.includes(run.estado) && passouPeloPool
    if (exigeToken && fencingToken === undefined) {
      return {
        reason: 'fencing-invalido',
        mensagem: 'Este run está em execução: a transição exige o fencing token vigente.'
      }
    }

    const gravou =
      exigeToken && fencingToken !== undefined
        ? this.deps.runs.transicionarComFencing(
            runId,
            run.estado,
            para,
            new Date(this.agora()),
            fencingToken,
            para === 'BLOCKED' ? bloqueio : undefined
          )
        : this.deps.runs.transicionar(
            runId,
            run.estado,
            para,
            new Date(this.agora()),
            para === 'BLOCKED' ? bloqueio : undefined
          )

    // O compare-and-set falhou: outro processo transicionou este run entre a leitura e a escrita —
    // ou o token apresentado já não era o vigente (o dono antigo que perdeu o lease).
    if (!gravou) {
      return exigeToken
        ? {
            reason: 'fencing-invalido',
            mensagem: 'O token apresentado não é o vigente: este dono perdeu o slot.'
          }
        : {
            reason: 'transicao-invalida',
            mensagem: 'O run mudou de estado enquanto esta transição era decidida.'
          }
    }

    const atualizado = this.deps.runs.buscar(runId) as PipelineRun
    this.auditarTransicao(escopo, atualizado, run.estado, para, bloqueio)

    // O run terminou: sai da fila, se esperava. O slot só é solto aqui nos desfechos **concluídos**
    // — `terminal não segura a fila` —; em `BLOCKED` e `CANCELLED` o lease fica até a reconciliação
    // verificar se container e porta ainda estão em uso (a regra que a V1 já tinha). Liberar o slot
    // no cancelamento, com a limpeza dos recursos, é da M12-F05.
    if (ehTerminal(para)) {
      this.deps.pool.cancelarDoRun(runId)
      if (DESFECHOS_CONCLUIDOS.includes(para) && this.deps.pool.encerrarDoRun(runId)) {
        this.despachar()
      }
    }

    return { reason: 'transicionado', run: atualizado, mensagem: `Run em ${para}.` }
  }

  /**
   * Pede um slot do pool para um run em `READY`, e o leva a `RUNNING` (critério 2).
   *
   * O run entra na fila e o scheduler decide: com capacidade, ele adquire e avança no mesmo ciclo;
   * sem, continua esperando — e o motivo (limite global, do projeto, gate, prova de independência)
   * fica gravado na fila e na vista. **Quem tem a vez nem sempre é quem pediu**: a justiça entre
   * projetos pode dar o slot a outro run que já esperava, e este espera a próxima liberação.
   *
   * As duas coisas juntas de propósito: um slot adquirido sem o run avançar seria um recurso
   * preso a um run que não está trabalhando, e a reconciliação teria de adivinhar se aquilo é
   * progresso ou lixo. Por isso a ativação do run roda **dentro** do ciclo do pool.
   */
  adquirirSlot(projectId: string, workspaceId: WorkspaceId, runId: string): LeaseOutcome {
    return this.adquirirItem(projectId, workspaceId, runId, runId)
  }

  /**
   * Pede um slot para **um escritor** do run (SPEC-Squads-03, decisão 1 do PI): o item do pool é
   * `<runId>:<escritor>`, com lease e fencing token próprios. O run não segura slot enquanto o
   * Squad executa — quem ocupa é o escritor. O primeiro escritor adquirido leva o run de `READY`
   * a `RUNNING`; os seguintes encontram o run já em execução.
   *
   * Com a capacidade efetiva em 1 (paralelismo desligado) o segundo escritor espera o primeiro
   * liberar — o plano de dois escritores roda em sequência, sem erro (critério 6).
   */
  adquirirSlotDoEscritor(
    projectId: string,
    workspaceId: WorkspaceId,
    runId: string,
    escritor: string
  ): LeaseOutcome {
    const unidade = idDoEscritor(runId, escritor)
    const lido = lerIdDoEscritor(unidade)
    if (lido === undefined || lido.escritor !== escritor) {
      return { reason: 'lease-inexistente', mensagem: 'Escritor inválido.' }
    }
    return this.adquirirItem(projectId, workspaceId, runId, unidade)
  }

  /** O que `adquirirSlot` e `adquirirSlotDoEscritor` têm em comum: enfileirar, despachar, responder. */
  private adquirirItem(
    projectId: string,
    workspaceId: WorkspaceId,
    runId: string,
    itemId: string
  ): LeaseOutcome {
    const escopo = this.escopo(projectId, workspaceId)
    const run = this.deps.runs.buscar(runId)

    if (run === undefined || run.user_id !== escopo.userId) {
      return { reason: 'lease-inexistente', mensagem: 'Run não encontrado.' }
    }

    // **Retry depois de crash converge**: `enfileirar` devolve a linha que já existe e o ciclo não
    // readquire o que já está adquirido — repetir a chamada devolve o mesmo slot, sem tentar a
    // transição `RUNNING → RUNNING` (inválida por construção) nem liberar o slot de quem trabalha.
    this.deps.pool.enfileirar({
      runId: itemId,
      workspaceId,
      projectId,
      sliceId: run.sliceId,
      prioridade: this.prioridadeDaFatia(escopo, run.sliceId)
    })
    this.despachar()

    const lease = this.deps.pool.slotDoRun(itemId)
    if (lease === undefined) return this.esperaDe(itemId)

    return { reason: 'adquirido', lease, mensagem: 'Slot de execução adquirido.' }
  }

  /**
   * Roda um ciclo do scheduler: quem cabe adquire, é ativado e é anunciado a `aoAdquirir`. É o que
   * se chama quando algo muda — slot liberado, gate fechado, configuração alterada — para a fila
   * andar sem esperar o próximo pedido.
   */
  despachar(): readonly Aquisicao[] {
    const { adquiridos } = this.deps.pool.ciclo()
    for (const a of adquiridos) this.deps.aoAdquirir?.(a)
    return adquiridos
  }

  /** Por que o run ainda não tem slot, no formato que `adquirirSlot` devolve. */
  private esperaDe(runId: string): LeaseOutcome {
    const motivo = this.deps.pool.vista().fila.find((i) => i.runId === runId)?.motivo
    if (motivo?.tipo === 'aguardando-reconciliacao') {
      return {
        reason: 'expirado-requer-reconciliacao',
        mensagem:
          'Há um slot com lease expirado. A reconciliação precisa confirmar o estado antes de reatribuí-lo.'
      }
    }
    return { reason: 'ocupado', mensagem: mensagemDeEspera(motivo) }
  }

  /**
   * A precedência do run na fila: a do roadmap (MVP e fatia, na ordem em que o PI os numerou).
   * Fatia que não está no roadmap vai para o fim — nunca à frente de quem tem lugar nele.
   */
  private prioridadeDaFatia(escopo: EscopoDoRun, sliceId: string): number {
    const { mvps, slices } = this.deps.roadmap(escopo)
    const slice = slices.find((s) => s.id === sliceId)
    const mvp = mvps.find((m) => m.id === slice?.mvpId)
    return slice === undefined || mvp === undefined ? 1_000_000 : mvp.numero * 1_000 + slice.numero
  }

  /**
   * Os gates que ainda seguram um item da fila: o run precisa estar `READY` (a aprovação do PI e as
   * dependências da fatia já passaram). Vazio = elegível. Capacidade livre não torna ninguém
   * elegível (regra 1 da SPEC-Scheduler-01).
   */
  gatesDoItem(item: ItemPersistido): readonly string[] {
    const escritor = lerIdDoEscritor(item.runId)
    const run = this.deps.runs.buscar(escritor?.runId ?? item.runId)
    // `READY` já exige as dependências concluídas (a transição confere), e concluído não regride:
    // o que segura um item é o run ainda não estar pronto. O escritor também entra com o run já
    // em execução — o primeiro escritor o levou até lá.
    const aceitos: readonly string[] = escritor === undefined ? ['READY'] : ['READY', 'RUNNING']
    return run === undefined || !aceitos.includes(run.estado) ? ['run-nao-pronto'] : []
  }

  /**
   * A ativação pelo pool: `READY → RUNNING`, sem token (o lease acabou de nascer). Para o escritor
   * é o run que avança, e só uma vez: o segundo escritor encontra o run já em `RUNNING`.
   */
  ativarRun(item: ItemPersistido): boolean {
    const runId = lerIdDoEscritor(item.runId)?.runId ?? item.runId
    if (runId !== item.runId && this.deps.runs.buscar(runId)?.estado === 'RUNNING') return true
    return (
      this.transicionar(item.projectId, item.workspaceId, runId, 'RUNNING').reason ===
      'transicionado'
    )
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
  concluir(
    projectId: string,
    workspaceId: WorkspaceId,
    runId: string,
    fencingToken?: number
  ): TransicaoOutcome {
    const terminal = this.deps.mergeAutonomoLigado(projectId) ? 'MERGED' : 'AWAITING_MERGE'
    // O terminal já solta o slot e passa a vez (ver `transicionarCom`): `AWAITING_MERGE` também
    // terminou, e segurar o slot travaria a fila até o próximo boot.
    return this.transicionar(projectId, workspaceId, runId, terminal, undefined, fencingToken)
  }

  /** Renova o heartbeat do slot. Só o dono com o token vigente renova. */
  renovarSlot(runId: string, fencingToken: number): boolean {
    return this.deps.pool.renovar(runId, fencingToken)
  }

  /**
   * Libera o slot ao fim do run — só com o token vigente — e já roda um ciclo, para a fila andar:
   * o próximo run que espera adquire na hora, e não no próximo pedido de alguém.
   */
  liberarSlot(
    _projectId: string,
    _workspaceId: WorkspaceId,
    runId: string,
    fencingToken: number
  ): boolean {
    const liberou = this.deps.pool.liberar(runId, fencingToken)
    if (liberou) this.despachar()
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
}

/** O motivo de espera em texto, para quem chama a API do slot; a vista traz o motivo estruturado. */
function mensagemDeEspera(motivo: { readonly tipo: string } | undefined): string {
  switch (motivo?.tipo) {
    case 'paralelismo-desligado':
      return 'Outro run detém o slot de execução. O paralelismo está desligado: um run por máquina.'
    case 'limite-global':
      return 'Todos os slots de execução estão ocupados.'
    case 'limite-do-projeto':
      return 'O projeto já tem o máximo de runs em execução.'
    case 'limite-do-executor':
      return 'O executor deste run já está no limite de execuções simultâneas.'
    case 'limite-da-classe':
      return 'A classe de recurso deste run já está no limite de execuções simultâneas.'
    case 'sem-prova-de-independencia':
      return 'Outro run do mesmo projeto está em execução e não há prova de independência entre os dois.'
    case 'precedencia':
      return 'Há um run anterior do mesmo projeto esperando na frente deste.'
    case 'gate':
      return 'O run ainda tem um gate aberto (aprovação ou dependência).'
    default:
      return 'O run aguarda a vez na fila de execução.'
  }
}
