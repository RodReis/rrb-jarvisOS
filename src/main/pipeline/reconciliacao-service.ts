/**
 * Reconciliação: o que sobrou de um run que morreu no meio (SPEC-Entrega-02, critérios 3 e 4).
 *
 * A pergunta que este serviço responde: **este efeito já aconteceu, ou só a intenção foi
 * registrada?**
 *
 * É a pergunta que o critério 4 faz — *"crash antes/depois de efeito converge para um único
 * resultado"* —, e ela só tem resposta porque cada fronteira registra intenção **antes** e
 * confirmação **depois** (o par `fase: 'requisicao'`/`'conclusao'` do `ConnectorService`, e o
 * `ExternalRef` que a M9-F01 grava). Um evento só no fim perderia toda chamada que morreu no
 * meio, e é justamente essa que a reconciliação existe para resolver.
 *
 * **Três desfechos, e a escolha entre eles é a regra inteira** (§ Reconciliação):
 *
 *  - **completar** quando o efeito já existe: o `ExternalRef` tem a issue, a branch está lá. Não
 *    refaço — confirmo e sigo;
 *  - **repetir** somente operação segura/idempotente: um `ensure*` pode rodar de novo sem criar
 *    um segundo recurso;
 *  - **bloquear** quando há risco ao trabalho existente. É o default para o que não sei
 *    classificar, e é deliberado: fail closed é a mesma postura do Policy Engine (ADR) e da
 *    `NaturezaDaMudanca` da M8-F06. O caro não é a reconciliação parar para perguntar; é ela
 *    apagar um worktree com trabalho dentro porque achou que era lixo.
 *
 * **`reconcileAll` é bloqueante no boot** (decisão cravada da spec): nenhum trabalho novo é
 * adquirido antes de ela terminar. Sem isso, o app pegaria a próxima fatia com um lease órfão
 * ainda de pé — e o WIP=1 valeria para os runs que ele conhece, não para a máquina.
 *
 * **O que esta fatia reconcilia, e o que fica para a M9-F03.** A spec manda consultar também
 * container e portas, mas eles não existem até a M9-F03 criá-los: aqui reconcilio SQLite, o
 * `ExternalRef` (o que a M9-F01 publicou) e os leases. O ponto de extensão é `verificadores`,
 * e a M9-F03 acrescenta o dela sem tocar neste arquivo.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import { estadoDoLease, RECURSO_WIP_GLOBAL, type Lease } from '@shared/domain/lease'
import { ehTerminal, type PipelineRun } from '@shared/domain/pipeline'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { LeaseRepository } from './lease-repository'
import type { PipelineRepository } from './pipeline-repository'

/**
 * O que a reconciliação decidiu sobre um recurso.
 *
 * `bloqueado` não é falha da reconciliação: é ela funcionando. Um recurso que não dá para
 * classificar com segurança vira pendência explícita, e o PI decide.
 */
export const DECISOES = ['completado', 'repetido', 'liberado', 'bloqueado', 'intacto'] as const

export type DecisaoDaReconciliacao = (typeof DECISOES)[number]

/** O que foi olhado, e o que se concluiu. */
export interface AchadoDaReconciliacao {
  readonly recurso: string
  readonly decisao: DecisaoDaReconciliacao
  readonly motivo: string
}

/**
 * Um verificador de recurso externo, plugável.
 *
 * Existe para a M9-F03 acrescentar container e porta sem editar este arquivo — e porque a
 * pergunta "o dono deste lease ainda está vivo?" só o dono do tipo de recurso sabe responder.
 * Devolve `true` quando o recurso **ainda está em uso** (e portanto o lease não deve cair).
 */
export interface VerificadorDeRecurso {
  readonly prefixo: string
  readonly emUso: (lease: Lease) => boolean | Promise<boolean>
}

export interface ReconciliacaoDeps {
  readonly runs: PipelineRepository
  readonly leases: LeaseRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /** Verificadores de recurso externo. A M9-F03 registra os dela aqui. */
  readonly verificadores?: readonly VerificadorDeRecurso[]
  readonly agora?: () => number
}

export class ReconciliacaoService {
  private readonly agora: () => number

  constructor(private readonly deps: ReconciliacaoDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /**
   * Reconcilia tudo o que ficou pendurado. **Bloqueante no boot.**
   *
   * A ordem é deliberada: os runs primeiro, os leases depois. Um lease órfão só é reconhecível
   * como órfão depois de eu saber que o run dono dele terminou — invertendo, eu liberaria o slot
   * de um run que ainda vou classificar como ativo.
   */
  async reconcileAll(): Promise<readonly AchadoDaReconciliacao[]> {
    const userId = this.deps.userId()
    const achados: AchadoDaReconciliacao[] = []

    for (const run of this.deps.runs.listarAtivos(userId)) {
      achados.push(this.reconciliarRun(run))
    }

    for (const lease of this.deps.leases.listar(userId)) {
      achados.push(await this.reconciliarLease(lease))
    }

    this.deps.audit.append({
      user_id: userId,
      workspace_id: this.deps.workspaceId(),
      type: 'pipeline-transition',
      payload: {
        reconciliacao: true,
        achados: achados.length,
        bloqueados: achados.filter((a) => a.decisao === 'bloqueado').length
      }
    })

    log.agent.info('Reconciliação do boot concluída', { achados: achados.length })
    return achados
  }

  /**
   * Um run em estado não-terminal depois de um reinício.
   *
   * **Não o mato, e não o avanço.** O run em `RUNNING` cujo processo morreu tem worktree e talvez
   * container de pé; decidir por ele aqui seria decidir sem olhar o disco. O que faço é
   * classificá-lo como pendência para o `FilaService` tratar quando o dono voltar — ou para o PI
   * ver na tela. Cancelar automaticamente destruiria trabalho que pode estar íntegro; avançar
   * inventaria progresso que não houve.
   */
  private reconciliarRun(run: PipelineRun): AchadoDaReconciliacao {
    if (ehTerminal(run.estado)) {
      return { recurso: `run:${run.id}`, decisao: 'intacto', motivo: 'Run já terminado.' }
    }

    return {
      recurso: `run:${run.id}`,
      decisao: 'bloqueado',
      motivo: `Run em ${run.estado} sobreviveu a um reinício. Retomada exige confirmação do estado externo.`
    }
  }

  /**
   * Um lease depois de um reinício.
   *
   * O lease **vigente** fica intacto: outro processo pode estar vivo e renovando. O **expirado**
   * é a decisão que o critério 3 reserva para aqui — e ela depende do verificador: se o recurso
   * ainda está em uso (container de pé, porta ocupada), o lease continua; se não está, e o run
   * dono não existe mais ou já terminou, o lease cai.
   *
   * Lease expirado cujo run dono **ainda está ativo** não cai: significa que o processo está
   * lento, não morto, e roubar o recurso dele criaria dois executores sobre o mesmo worktree.
   */
  private async reconciliarLease(lease: Lease): Promise<AchadoDaReconciliacao> {
    if (estadoDoLease(lease, this.agora()) === 'vigente') {
      return { recurso: lease.recurso, decisao: 'intacto', motivo: 'Lease vigente.' }
    }

    const verificador = this.deps.verificadores?.find((v) => lease.recurso.startsWith(v.prefixo))
    if (verificador !== undefined && (await verificador.emUso(lease))) {
      return {
        recurso: lease.recurso,
        decisao: 'bloqueado',
        motivo: 'Lease expirado, mas o recurso ainda está em uso. Não é seguro reatribuir.'
      }
    }

    const dono = this.deps.runs.buscar(lease.proprietario)
    if (dono !== undefined && !ehTerminal(dono.estado)) {
      return {
        recurso: lease.recurso,
        decisao: 'bloqueado',
        motivo: `O run ${dono.id} ainda está em ${dono.estado}. Expiração pode ser lentidão, não morte.`
      }
    }

    this.deps.leases.removerReconciliado(lease.user_id, lease.recurso)
    this.deps.audit.append({
      user_id: lease.user_id,
      workspace_id: this.deps.workspaceId(),
      type: 'pipeline-lease',
      payload: {
        acao: 'reconciliado',
        recurso: lease.recurso,
        proprietario: lease.proprietario
      }
    })

    return {
      recurso: lease.recurso,
      decisao: 'liberado',
      motivo:
        dono === undefined
          ? 'Lease expirado sem run dono. Liberado.'
          : `Lease expirado e o run dono terminou em ${dono.estado}. Liberado.`
    }
  }

  /** O slot global está livre depois da reconciliação? Para a tela mostrar a fila. */
  slotLivre(): boolean {
    const lease = this.deps.leases.buscar(this.deps.userId(), RECURSO_WIP_GLOBAL)
    return estadoDoLease(lease, this.agora()) === 'livre'
  }
}
