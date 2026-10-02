/**
 * O que o pool mostra para quem olha de fora: a fila, os slots e as métricas (SPEC-Scheduler-01,
 * critério 5: "UI/API explica qual limite ou gate mantém cada item na fila").
 *
 * **Só leitura, e sem capacidade embutida.** A vista não carrega o fencing token — ele é a
 * credencial do dono do slot, e quem só olha não precisa dela. Não existe canal que adquira,
 * libere ou renove slot a pedido do renderer: quem move o pool é o main.
 */

import type { ConfigDoPool, MotivoDeEspera } from './pool'

export interface SlotNaVista {
  readonly recurso: string
  readonly runId: string
  readonly projectId: string
  /** `expirado` ainda ocupa o slot: só a reconciliação o libera. */
  readonly estado: 'vigente' | 'expirado'
  readonly heartbeatEm: number
  readonly expiraEm: number
}

export interface ItemNaVista {
  readonly runId: string
  readonly projectId: string
  readonly sliceId: string
  /** A ordem em que o pool atenderia, a partir de 1. */
  readonly posicao: number
  /**
   * Por que o item espera — ou `pronto-para-adquirir`: cabe agora e só falta o próximo ciclo do
   * scheduler. Nunca um motivo vazio: quem olha sempre sabe o que o segura.
   */
  readonly motivo: MotivoDeEspera | { readonly tipo: 'pronto-para-adquirir' }
  readonly enfileiradoEm: number
  readonly esperandoHaMs: number
}

export interface PoolMetricas {
  readonly ocupacao: { readonly ocupados: number; readonly capacidade: number }
  readonly fila: { readonly tamanho: number; readonly maisAntigoHaMs?: number }
  /** Quanto os runs adquiridos na janela esperaram. Ausente sem nenhuma aquisição. */
  readonly espera: {
    readonly amostras: number
    readonly medianaMs?: number
    readonly maximaMs?: number
  }
  /** As decisões do scheduler na janela, por tipo. */
  readonly decisoes: Readonly<
    Record<'adquirido' | 'liberado' | 'reconciliado' | 'cancelado', number>
  >
}

export interface VistaDoPool {
  readonly config: ConfigDoPool
  /** A capacidade que vale agora: 1 com o paralelismo desligado. */
  readonly capacidadeEfetiva: number
  readonly ocupados: readonly SlotNaVista[]
  readonly fila: readonly ItemNaVista[]
  readonly metricas: PoolMetricas
  readonly geradoEm: number
}
