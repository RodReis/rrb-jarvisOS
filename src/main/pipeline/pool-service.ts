/**
 * O scheduler do pool de execução (SPEC-Scheduler-01).
 *
 * A pergunta que este serviço responde: **quem roda agora, e com que direito de continuar
 * rodando?** O núcleo (`@shared/domain/pool`) decide quem cabe; este serviço executa a decisão no
 * banco, entrega a posse (um lease em `wip:slot:<n>` com fencing token) e conta o que aconteceu.
 *
 * Quatro decisões governam o desenho:
 *
 *  - **O ciclo é uma transação.** Decidir, adquirir o lease, ativar o run e registrar são um
 *    passo só: ou tudo acontece ou nada (critério 3). Um crash no meio não deixa slot preso a um
 *    run que não avançou, nem run avançado sem slot — o `ROLLBACK` desfaz o que o processo
 *    morrendo não terminou.
 *  - **Nada em memória.** Configuração, fila, vez de cada projeto, sequência do token: tudo no
 *    banco. Reiniciar é abrir outra instância deste serviço sobre o mesmo arquivo.
 *  - **O token é a credencial do dono.** `renovar`, `liberar` e `confirmarProgresso` exigem o
 *    token vigente (critério 4): um dono que perdeu o lease e voltou carrega um token que já
 *    não vale. O token nunca aparece na vista nem na auditoria.
 *  - **O consumidor decide como "ativar".** O serviço não sabe o que é um run; quem o instancia
 *    passa `ativar`, que leva o run ao estado de execução dentro da transação. Se `ativar`
 *    recusa, a aquisição é desfeita — slot nunca fica preso a um run que não pôde avançar.
 *
 * O que este serviço **não** faz: não executa o run, não decide gates (recebe-os por `gates`),
 * não prova independência (recebe `prova`; sem ela, o segundo run do projeto espera) e não
 * libera lease expirado — isso é da reconciliação (regra 3).
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Lease } from '@shared/domain/lease'
import type {
  ConfigDoPool,
  ItemDaFila,
  ItemEmEspera,
  ProvaDeIndependencia,
  ResultadoDaConfig,
  SlotOcupado
} from '@shared/domain/pool'
import type { ItemNaVista, SlotNaVista, VistaDoPool } from '@shared/domain/pool-vista'
import { estadoDoLease } from '@shared/domain/lease'
import {
  CAPACIDADE_MAXIMA_DO_POOL,
  SEM_PROVA,
  capacidadeEfetiva,
  decidirPool,
  recursoDoSlot,
  tokenConfere,
  validarConfig
} from '@shared/domain/pool'
import { irmaosNoPool } from '@shared/domain/squad-execucao'
import type { AuditRepository } from '../storage/audit-repository'
import type { LeaseRepository } from './lease-repository'
import type { ItemPersistido, NovoItem, PoolRepository } from './pool-repository'

/** A janela das métricas da vista: as últimas 24 horas. */
export const JANELA_DAS_METRICAS_MS = 24 * 60 * 60 * 1000

export interface Aquisicao {
  readonly runId: string
  readonly projectId: string
  readonly recurso: string
  /** A credencial do dono do slot. Quem a recebe é quem executa o run — não vai para a vista. */
  readonly fencingToken: number
  readonly lease: Lease
}

export interface ResultadoDoCiclo {
  readonly adquiridos: readonly Aquisicao[]
  readonly espera: readonly ItemEmEspera[]
}

export interface PoolDeps {
  /** Para a transação do ciclo. É o mesmo banco dos repositórios. */
  readonly db: Database
  readonly pool: PoolRepository
  readonly leases: LeaseRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /** Os gates que ainda impedem o item. Vazio = elegível. Quem sabe é o `FilaService`. */
  readonly gates?: (item: ItemPersistido) => readonly string[]
  /**
   * Leva o run ao estado de execução, **dentro da transação do ciclo**. `false` desfaz a
   * aquisição. Sem ela, o serviço só reparte slots (é o que os testes do núcleo do serviço usam).
   */
  readonly ativar?: (item: ItemPersistido) => boolean
  /** A prova de independência da M12-F02. Padrão: sem prova, o segundo run do projeto espera. */
  readonly prova?: ProvaDeIndependencia
  readonly agora?: () => number
}

export class PoolService {
  private readonly agora: () => number
  /** A prova que o pool usa: a de quem injetou, mais a dos irmãos (escritores do mesmo run). */
  private readonly prova: ProvaDeIndependencia

  constructor(private readonly deps: PoolDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
    const injetada = deps.prova ?? SEM_PROVA
    this.prova = (item, ativos) => irmaosNoPool(item.runId, ativos) || injetada(item, ativos)
  }

  configuracao(): ConfigDoPool {
    return this.deps.pool.config(this.deps.userId())
  }

  /**
   * Troca a configuração. **Reduzir não derruba run ativo** (regra 2): nada aqui toca leases —
   * a capacidade menor só impede novas aquisições até os ocupados caírem abaixo do teto.
   */
  configurar(bruto: unknown): ResultadoDaConfig {
    const validada = validarConfig(bruto)
    if (!validada.ok) return validada

    const userId = this.deps.userId()
    this.deps.pool.definirConfig(userId, validada.config, this.agora())
    this.deps.audit.append({
      user_id: userId,
      workspace_id: this.deps.workspaceId(),
      type: 'pool-config',
      payload: { ...validada.config }
    })
    return validada
  }

  /** Põe o run na fila. Idempotente: o retry devolve a linha original, com a idade original. */
  enfileirar(item: NovoItem): ItemPersistido {
    return this.deps.pool.enfileirar(this.deps.userId(), item, this.agora())
  }

  /** O run deixa a fila sem ter adquirido. Quem já adquiriu não é cancelado aqui: libera. */
  cancelar(runId: string): boolean {
    const item = this.deps.pool.buscarItem(runId)
    if (item === undefined || item.userId !== this.deps.userId()) return false

    const agora = this.agora()
    return this.deps.db.transaction((): boolean => {
      if (!this.deps.pool.cancelar(runId, agora)) return false
      this.deps.pool.registrarDecisao(
        item.userId,
        { runId, projectId: item.projectId, decisao: 'cancelado' },
        agora
      )
      return true
    })()
  }

  /**
   * Cancela o que o run ainda tem na fila: o item dele e o dos escritores que esperavam. Quem já
   * tem slot não é tocado — a liberação de cancelamento e bloqueio é da M12-F05.
   */
  cancelarDoRun(runId: string): boolean {
    const itens = this.deps.pool.itensDoGrupo(this.deps.userId(), runId).map((i) => i.runId)
    return [runId, ...itens].map((id) => this.cancelar(id)).some(Boolean)
  }

  /** Solta o slot do run e o dos escritores que sobraram: o run terminou e não há quem os use. */
  encerrarDoRun(runId: string): boolean {
    const itens = this.deps.pool.itensDoGrupo(this.deps.userId(), runId).map((i) => i.runId)
    return [runId, ...itens].map((id) => this.encerrar(id)).some(Boolean)
  }

  /** O run já foi adquirido pelo pool alguma vez? Quem nunca foi não tem token a apresentar. */
  adquiriu(runId: string): boolean {
    return this.deps.pool.buscarItem(runId)?.estado === 'adquirido'
  }

  /** O slot que o run detém, se detém. */
  slotDoRun(runId: string): Lease | undefined {
    return this.deps.leases.buscarSlotDoRun(this.deps.userId(), runId)
  }

  /**
   * Um ciclo do scheduler: decide, adquire e ativa — numa transação só. Idempotente: rodar de novo
   * sem mudança no estado não adquire nada e não reescreve nada.
   */
  ciclo(): ResultadoDoCiclo {
    return this.deps.db.transaction((): ResultadoDoCiclo => this.executarCiclo())()
  }

  private executarCiclo(): ResultadoDoCiclo {
    const userId = this.deps.userId()
    const agora = this.agora()
    const { pool, leases } = this.deps

    const slots = leases.listarSlots(userId)
    const esperando = pool.esperando(userId)
    const decisao = decidirPool(
      {
        config: pool.config(userId),
        itens: esperando.map((i) => this.comoItem(i)),
        ocupados: slots.map((l) => this.comoOcupado(l, agora)),
        ultimoServidoEm: pool.vezes(userId)
      },
      this.prova
    )

    const emUso = new Set(slots.map((l) => l.recurso))
    const adquiridos: Aquisicao[] = []
    for (const runId of decisao.adquirir) {
      const item = esperando.find((i) => i.runId === runId)
      const recurso = proximoSlotLivre(emUso)
      if (item === undefined || recurso === undefined) continue

      const aquisicao = this.adquirir(item, recurso, agora)
      if (aquisicao === undefined) continue
      emUso.add(recurso)
      adquiridos.push(aquisicao)
    }

    const { espera } = decisao
    for (const e of espera) pool.atualizarMotivo(e.runId, e.motivo, agora)
    return { adquiridos, espera }
  }

  /** Adquire o lease do slot para o item e ativa o run. `undefined` se não pôde, sem deixar rastro. */
  private adquirir(item: ItemPersistido, recurso: string, agora: number): Aquisicao | undefined {
    const { pool, leases } = this.deps
    const fencingToken = pool.proximoToken(item.userId)
    const lease = leases.adquirir(
      item.userId,
      { proprietario: item.runId, recurso, projectId: item.projectId, fencingToken },
      agora
    )
    if (lease === undefined) return undefined

    if (this.deps.ativar !== undefined && !this.deps.ativar(item)) {
      // O run não podia avançar: o slot volta, e o item sai da fila em vez de ficar tentando.
      leases.liberarSlot(item.userId, recurso, item.runId, fencingToken)
      pool.cancelar(item.runId, agora)
      pool.registrarDecisao(
        item.userId,
        { runId: item.runId, projectId: item.projectId, decisao: 'cancelado' },
        agora
      )
      return undefined
    }

    pool.marcarAdquirido(item.runId, agora)
    pool.registrarVez(item.userId, item.projectId, agora)
    pool.registrarDecisao(
      item.userId,
      {
        runId: item.runId,
        projectId: item.projectId,
        decisao: 'adquirido',
        esperaMs: Math.max(0, agora - item.enfileiradoEm)
      },
      agora
    )
    this.auditarLease('adquirido', lease)
    return { runId: item.runId, projectId: item.projectId, recurso, fencingToken, lease }
  }

  /** Renova o heartbeat. Só o dono com o token vigente renova. */
  renovar(runId: string, fencingToken: number): boolean {
    const lease = this.slotDoRun(runId)
    if (lease === undefined || !tokenConfere(lease.fencingToken, fencingToken)) return false
    return this.deps.leases.renovarSlot(
      lease.user_id,
      lease.recurso,
      runId,
      fencingToken,
      this.agora()
    )
  }

  /** Libera o slot ao fim do run. Só o dono com o token vigente libera. */
  liberar(runId: string, fencingToken: number): boolean {
    const lease = this.slotDoRun(runId)
    if (lease === undefined || !tokenConfere(lease.fencingToken, fencingToken)) return false

    const agora = this.agora()
    return this.deps.db.transaction((): boolean => {
      if (!this.deps.leases.liberarSlot(lease.user_id, lease.recurso, runId, fencingToken)) {
        return false
      }
      this.deps.pool.registrarDecisao(
        lease.user_id,
        { runId, projectId: lease.projectId ?? '', decisao: 'liberado' },
        agora
      )
      this.auditarLease('liberado', lease)
      return true
    })()
  }

  /**
   * O run **terminou** (a máquina de estados já o autorizou): solta o slot dele, sem exigir o token.
   * Não é roubo — o dono morreu por um caminho legítimo, e segurar o slot até a próxima
   * reconciliação (que só roda no boot) travaria a fila. Só o slot do próprio run é solto.
   */
  encerrar(runId: string): boolean {
    const lease = this.slotDoRun(runId)
    if (lease === undefined) return false

    const agora = this.agora()
    return this.deps.db.transaction((): boolean => {
      if (!this.deps.leases.removerReconciliado(lease.user_id, lease.recurso)) return false
      this.deps.pool.registrarDecisao(
        lease.user_id,
        { runId, projectId: lease.projectId ?? '', decisao: 'liberado' },
        agora
      )
      this.auditarLease('liberado', lease)
      return true
    })()
  }

  /**
   * Quem apresenta este token ainda é o dono do slot? (critério 4.) O dono antigo — o que perdeu o
   * lease, mesmo que o mesmo run o tenha readquirido — apresenta um token que já não é o vigente.
   */
  confirmarProgresso(runId: string, fencingToken: number): boolean {
    return tokenConfere(this.slotDoRun(runId)?.fencingToken, fencingToken)
  }

  /** A reconciliação liberou este slot: o pool só registra, a decisão foi dela. */
  registrarReconciliado(lease: Lease): void {
    this.deps.pool.registrarDecisao(
      lease.user_id,
      { runId: lease.proprietario, projectId: lease.projectId ?? '', decisao: 'reconciliado' },
      this.agora()
    )
  }

  /**
   * A vista de quem olha de fora: slots, fila com a posição e o motivo de cada item, e as
   * métricas (critério 5). **Só leitura** — nada aqui adquire, renova nem libera, e o token não
   * sai daqui.
   */
  vista(workspace: WorkspaceId = this.deps.workspaceId()): VistaDoPool {
    const userId = this.deps.userId()
    const agora = this.agora()
    const { pool, leases } = this.deps

    const config = pool.config(userId)
    const slots = leases.listarSlots(userId)
    const esperando = pool.esperando(userId)
    const decisao = decidirPool(
      {
        config,
        itens: esperando.map((i) => this.comoItem(i)),
        ocupados: slots.map((l) => this.comoOcupado(l, agora)),
        ultimoServidoEm: pool.vezes(userId)
      },
      this.prova
    )

    const porRun = new Map(esperando.map((i) => [i.runId, i]))
    const naVista = (
      runId: string,
      posicao: number,
      motivo: ItemNaVista['motivo']
    ): ItemNaVista => {
      const i = porRun.get(runId) as ItemPersistido
      return {
        runId,
        projectId: i.projectId,
        sliceId: i.sliceId,
        posicao,
        motivo,
        enfileiradoEm: i.enfileiradoEm,
        esperandoHaMs: Math.max(0, agora - i.enfileiradoEm)
      }
    }
    const doWorkspace = (runId: string): boolean => porRun.get(runId)?.workspaceId === workspace
    const aAdquirir = decisao.adquirir
      .map((runId, k) => ({
        runId,
        posicao: k + 1,
        motivo: { tipo: 'pronto-para-adquirir' } as const
      }))
      .filter((x) => doWorkspace(x.runId))
    const aEsperar = decisao.espera
      .map((e) => ({
        runId: e.runId,
        posicao: e.posicao + decisao.adquirir.length,
        motivo: e.motivo
      }))
      .filter((x) => doWorkspace(x.runId))

    return {
      config,
      capacidadeEfetiva: capacidadeEfetiva(config),
      // Só os slots dos runs deste workspace: o pool é um por usuário, mas quem olha o NOA não
      // enxerga o run do JARVIS OS. O lease sem item (V1 em voo) não tem dono conhecido e fica fora.
      ocupados: slots
        .filter((l) => this.deps.pool.buscarItem(l.proprietario)?.workspaceId === workspace)
        .map((l) => this.comoSlotNaVista(l, agora)),
      fila: [...aAdquirir, ...aEsperar].map((x) => naVista(x.runId, x.posicao, x.motivo)),
      metricas: {
        ocupacao: { ocupados: slots.length, capacidade: capacidadeEfetiva(config) },
        ...pool.metricas(userId, agora - JANELA_DAS_METRICAS_MS, agora)
      },
      geradoEm: agora
    }
  }

  private comoItem(i: ItemPersistido): ItemDaFila {
    return {
      runId: i.runId,
      projectId: i.projectId,
      sliceId: i.sliceId,
      prioridade: i.prioridade,
      enfileiradoEm: i.enfileiradoEm,
      ...(i.executor === undefined ? {} : { executor: i.executor }),
      ...(i.classe === undefined ? {} : { classe: i.classe }),
      gatesAbertos: this.deps.gates?.(i) ?? []
    }
  }

  private comoOcupado(lease: Lease, agora: number): SlotOcupado {
    const dono = this.deps.pool.buscarItem(lease.proprietario)
    return {
      runId: lease.proprietario,
      projectId: lease.projectId ?? dono?.projectId ?? '',
      ...(dono?.executor === undefined ? {} : { executor: dono.executor }),
      ...(dono?.classe === undefined ? {} : { classe: dono.classe }),
      estado: estadoDoLease(lease, agora) === 'expirado' ? 'expirado' : 'vigente'
    }
  }

  private comoSlotNaVista(lease: Lease, agora: number): SlotNaVista {
    return {
      recurso: lease.recurso,
      runId: lease.proprietario,
      projectId: lease.projectId ?? '',
      estado: estadoDoLease(lease, agora) === 'expirado' ? 'expirado' : 'vigente',
      heartbeatEm: lease.heartbeatEm,
      expiraEm: lease.expiraEm
    }
  }

  /** O workspace do run na fila; o do ciclo só quando o lease não tem item (V1 em voo). */
  private workspaceDoRun(runId: string): WorkspaceId {
    return this.deps.pool.buscarItem(runId)?.workspaceId ?? this.deps.workspaceId()
  }

  private auditarLease(acao: 'adquirido' | 'liberado', lease: Lease): void {
    this.deps.audit.append({
      user_id: lease.user_id,
      workspace_id: this.workspaceDoRun(lease.proprietario),
      type: 'pipeline-lease',
      // O token não entra: é a credencial do dono, e a auditoria não é lugar de credencial.
      payload: {
        acao,
        recurso: lease.recurso,
        proprietario: lease.proprietario,
        projectId: lease.projectId ?? null
      }
    })
  }
}

/** O primeiro `wip:slot:<n>` que não está em uso, ou `undefined` se todos estão. */
function proximoSlotLivre(emUso: ReadonlySet<string>): string | undefined {
  for (let i = 1; i <= CAPACIDADE_MAXIMA_DO_POOL; i++) {
    if (!emUso.has(recursoDoSlot(i))) return recursoDoSlot(i)
  }
  return undefined
}
