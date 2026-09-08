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

/** Uma troca da conversa. O histórico da sessão é uma lista disto (SPEC-Voz-03, critério 7). */
export interface TrocaDaConversa {
  readonly pergunta: string
  readonly resposta: string
}

/**
 * O desfecho de uma pergunta à persona (SPEC-Voz-03), do ponto de vista de quem desenha a tela
 * **e** de quem vai falar.
 *
 * `indisponivel` carrega a `proximaAcao` porque o critério 4 exige recusa **com** próxima ação,
 * visual e falada. Um estado sem texto obrigaria a tela a inventar a frase e a fala a ficar muda.
 * Ela é escolhida no main, onde se sabe qual das duas indisponibilidades ocorreu: serviço fora
 * pede subir o Ollama, modelo ausente pede `ollama pull` — próximas ações diferentes que um
 * estado só, sem texto, achataria numa frase que não resolve nem uma nem outra.
 */
export type DesfechoDaConversa =
  | { readonly estado: 'ok'; readonly resposta: string }
  | { readonly estado: 'sem-pergunta' }
  | { readonly estado: 'indisponivel'; readonly proximaAcao: string }
  | { readonly estado: 'falhou'; readonly motivo: string }

/**
 * Quantas trocas da sessão entram no contexto da conversa (SPEC-Voz-03, critério 7).
 *
 * Dez é o default cravado na spec. É configurável porque a janela troca contexto por custo: cada
 * troca a mais é prompt a mais em toda pergunta seguinte, e quem conversa longo quer o
 * follow-up funcionando enquanto quem faz perguntas soltas não quer pagar por isso.
 */
export const JANELA_PADRAO_DA_CONVERSA = 10

/** Os limites da janela. Fora deles a preferência é recusada na escrita. */
export const JANELA_MINIMA_DA_CONVERSA = 0
export const JANELA_MAXIMA_DA_CONVERSA = 50

/**
 * A janela do histórico é válida?
 *
 * Fronteira de confiança e teto por construção: cada troca guardada é prompt a mais em **toda**
 * pergunta seguinte, e um número vindo do renderer sem limite deixaria a conversa arrastar a
 * sessão inteira para dentro de cada chamada até estourar o contexto do modelo.
 *
 * Zero é válido e significa **sem histórico** — perguntas independentes, sem follow-up. É
 * escolha legítima de quem não quer pagar contexto por ela, não ausência de configuração; quem
 * quer o default deixa `null`.
 */
export function ehJanelaDaConversa(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isInteger(valor) &&
    valor >= JANELA_MINIMA_DA_CONVERSA &&
    valor <= JANELA_MAXIMA_DA_CONVERSA
  )
}
