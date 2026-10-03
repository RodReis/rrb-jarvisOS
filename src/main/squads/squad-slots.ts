/**
 * Os slots dos escritores, do ponto de vista de quem executa (SPEC-Squads-03, regra 5).
 *
 * O pool decide quem tem a vez; este gerente faz o executor **esperar** a dele sem sondar o banco:
 * quem não cabe agora fica numa promessa, e o `aoAdquirir` do `FilaService` — chamado quando um
 * slot libera e o ciclo do pool atende a fila — a acorda. É o contrato que a M12-F01 deixou para a
 * F03: o executor recebe o token em `adquirirSlotDoEscritor` e em `aoAdquirir`, e o usa para
 * renovar, confirmar e liberar.
 *
 * **O escritor nunca roda fora do pool**: sem slot, a promessa continua pendente até o sinal de
 * cancelamento — e cancelar tira o item da fila, para uma liberação posterior não o adquirir para
 * ninguém.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import { idDoEscritor } from '@shared/domain/squad-execucao'
import type { FilaService } from '../pipeline/fila-service'
import type { Aquisicao } from '../pipeline/pool-service'

export type FilaParaOEscritor = Pick<
  FilaService,
  'adquirirSlotDoEscritor' | 'renovarSlot' | 'confirmarSlot' | 'liberarSlot' | 'desistirDoSlot'
>

export type ResultadoDoSlot =
  | { readonly ok: true; readonly unidade: string; readonly fencingToken: number }
  | { readonly ok: false; readonly motivo: 'cancelada' | 'indisponivel' }

export interface PedidoDeSlot {
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly runId: string
  readonly escritor: string
  readonly signal?: AbortSignal
}

interface Espera {
  readonly acordar: (fencingToken: number) => void
  readonly cancelar: () => void
}

export class GerenteDeSlots {
  /** Quem espera cada unidade. Lista, porque duas chamadas à mesma unidade esperam a mesma vez. */
  private readonly espera = new Map<string, Espera[]>()

  constructor(private readonly fila: FilaParaOEscritor) {}

  /** Pede o slot e espera por ele. Não lança: o desfecho ruim é `ok: false`. */
  adquirir(pedido: PedidoDeSlot): Promise<ResultadoDoSlot> {
    if (pedido.signal?.aborted === true) {
      return Promise.resolve({ ok: false, motivo: 'cancelada' })
    }
    const unidade = idDoEscritor(pedido.runId, pedido.escritor)
    const r = this.fila.adquirirSlotDoEscritor(
      pedido.projectId,
      pedido.workspaceId,
      pedido.runId,
      pedido.escritor
    )
    if (r.reason === 'adquirido') {
      const fencingToken = r.lease?.fencingToken
      return Promise.resolve(
        fencingToken === undefined
          ? { ok: false, motivo: 'indisponivel' }
          : { ok: true, unidade, fencingToken }
      )
    }
    if (r.reason === 'lease-inexistente') {
      return Promise.resolve({ ok: false, motivo: 'indisponivel' })
    }

    // `ocupado` e `expirado-requer-reconciliacao`: espera o anúncio do pool, ou o cancelamento. O
    // registro vem logo depois do pedido, no mesmo laço de eventos: nada pode anunciar no meio.
    return new Promise<ResultadoDoSlot>((resolver) => {
      const fim = (resultado: ResultadoDoSlot): void => {
        pedido.signal?.removeEventListener('abort', aoCancelar)
        resolver(resultado)
      }
      const aguardo: Espera = {
        acordar: (fencingToken) => fim({ ok: true, unidade, fencingToken }),
        cancelar: () => fim({ ok: false, motivo: 'cancelada' })
      }
      const aoCancelar = (): void => {
        this.sair(unidade, aguardo)
        // O item da fila é um só por unidade: só desiste da vaga quem era o último a esperá-la.
        if (!this.espera.has(unidade)) this.fila.desistirDoSlot(unidade)
        aguardo.cancelar()
      }
      this.entrar(unidade, aguardo)
      pedido.signal?.addEventListener('abort', aoCancelar)
    })
  }

  /** O ponto de ligação com o `aoAdquirir` do `FilaService`: acorda quem esperava a unidade. */
  anunciar(aquisicao: Aquisicao): void {
    const esperando = this.espera.get(aquisicao.runId)
    if (esperando === undefined) return
    this.espera.delete(aquisicao.runId)
    for (const e of esperando) e.acordar(aquisicao.fencingToken)
  }

  /**
   * O run terminou e o pool tirou a unidade da fila: quem a esperava não vai ser atendido. O item já
   * saiu da fila, então aqui só se acorda quem esperava — não há vaga a devolver.
   */
  cancelarEspera(unidade: string): void {
    const esperando = this.espera.get(unidade)
    if (esperando === undefined) return
    this.espera.delete(unidade)
    for (const e of esperando) e.cancelar()
  }

  renovar(unidade: string, fencingToken: number): boolean {
    return this.fila.renovarSlot(unidade, fencingToken)
  }

  confirmar(unidade: string, fencingToken: number): boolean {
    return this.fila.confirmarSlot(unidade, fencingToken)
  }

  liberar(
    projectId: string,
    workspaceId: WorkspaceId,
    unidade: string,
    fencingToken: number
  ): boolean {
    return this.fila.liberarSlot(projectId, workspaceId, unidade, fencingToken)
  }

  private entrar(unidade: string, aguardo: Espera): void {
    this.espera.set(unidade, [...(this.espera.get(unidade) ?? []), aguardo])
  }

  private sair(unidade: string, aguardo: Espera): void {
    const resto = (this.espera.get(unidade) ?? []).filter((a) => a !== aguardo)
    if (resto.length === 0) this.espera.delete(unidade)
    else this.espera.set(unidade, resto)
  }
}
