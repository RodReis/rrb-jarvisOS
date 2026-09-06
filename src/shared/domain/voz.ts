/**
 * Os tipos da voz que atravessam a ponte (SPEC-Voz-01).
 *
 * Moram em `shared` porque main e renderer precisam dos dois lados do mesmo contrato. O que
 * **não** está aqui é tão importante quanto o que está: nenhum campo carrega caminho de modelo,
 * comando do sidecar ou PID (critério 3). A tela fala com uma capacidade, não com uma
 * implementação — é o mesmo motivo pelo qual o app fala com `SttEngine` e não com o runtime.
 */

/** Um trecho reconhecido, com os tempos que o engine reportou. */
export interface SegmentoDaFala {
  readonly inicioMs: number
  readonly fimMs: number
  readonly texto: string
}

export interface ResultadoDaTranscricao {
  readonly texto: string
  /** O idioma que o engine reconheceu — não necessariamente o pedido. */
  readonly idioma: string
  readonly segmentos: readonly SegmentoDaFala[]
}

/**
 * O desfecho de uma transcrição, do ponto de vista de quem desenha a tela.
 *
 * Cada estado corresponde a uma **próxima ação** diferente (critério 2): `indisponivel` pede
 * baixar, `falhou` pede tentar de novo, `sem-audio` não pede nada. Fundir os dois primeiros
 * daria à primeira execução do app a ação errada.
 */
export type DesfechoDaTranscricao =
  | { readonly estado: 'ok'; readonly resultado: ResultadoDaTranscricao }
  | { readonly estado: 'sem-audio' }
  | { readonly estado: 'indisponivel' }
  | { readonly estado: 'falhou'; readonly motivo: string }

export type DesfechoDoDownload =
  | { readonly estado: 'ok' }
  | { readonly estado: 'bloqueado' }
  | { readonly estado: 'hash-divergente' }
  | { readonly estado: 'falhou'; readonly motivo: string }

/** Como o engine vai calcular — a UI indica o modo (critério 7). */
export type ModoDeCompute = 'cuda' | 'cpu-int8'

/** O que falta para a voz funcionar, e como ela vai rodar. */
export interface ProntidaoDaVoz {
  readonly pronta: boolean
  /** Os ids dos artefatos que ainda faltam. Vazio quando está tudo no lugar. */
  readonly faltando: readonly string[]
  readonly compute: ModoDeCompute
}
