/**
 * O contrato de transcrição local (SPEC-Voz-01, critério 1).
 *
 * O app fala com `SttEngine`, nunca com faster-whisper. Trocar de engine é escrever outra
 * implementação e injetá-la — não é refatoração, que é o invariante do épico #193. É o mesmo
 * desenho do `AiAdapter` (SPEC-Providers-02), pela mesma razão: o dia em que whisper.cpp ou um
 * serviço novo fizer mais sentido, quem muda é uma linha de composição.
 *
 * ## Por que os desfechos são fechados, e não exceções
 *
 * Quem chama isto é o IPC. Exceção atravessando a ponte chega ao renderer como erro opaco, e a
 * UI não tem o que dizer além de "algo falhou" — enquanto o critério 2 pede **próxima ação**.
 * Cada desfecho aqui corresponde a uma ação diferente na tela:
 *
 * | desfecho | o que a tela oferece |
 * |---|---|
 * | `ok` | mostra o texto |
 * | `sem-audio` | nada; o clique foi curto demais |
 * | `indisponivel` | **baixar** o runtime/modelo |
 * | `falhou` | **tentar de novo** |
 *
 * Fundir `indisponivel` com `falhou` daria à primeira execução do app a ação errada: quem nunca
 * baixou o runtime veria "tentar de novo", que nunca vai funcionar.
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
 * O engine de transcrição. Implementação concreta importa o runtime dela; ninguém mais.
 *
 * `disponivel()` é separado de `transcribe()` porque as duas perguntas têm respostas diferentes
 * na tela: "o runtime existe?" pede download, "a transcrição falhou?" pede nova tentativa.
 */
export interface SttEngine {
  /** Transcreve PCM 16 kHz mono. Pode lançar — quem chama trata. */
  readonly transcribe: (pcm: Int16Array) => Promise<ResultadoDaTranscricao>
  /** Se o runtime e o modelo estão prontos **agora**. */
  readonly disponivel: () => Promise<boolean>
  /** Encerra o que o engine mantiver vivo. Idempotente. */
  readonly encerrar: () => Promise<void>
}

/** O desfecho de uma transcrição, do ponto de vista de quem vai desenhar a tela. */
export type DesfechoDaTranscricao =
  | { readonly estado: 'ok'; readonly resultado: ResultadoDaTranscricao }
  | { readonly estado: 'sem-audio' }
  | { readonly estado: 'indisponivel' }
  | { readonly estado: 'falhou'; readonly motivo: string }

/**
 * Transcreve um enunciado, traduzindo tudo em desfecho tratado.
 *
 * **O áudio não fica.** Ele entra como argumento, é repassado ao engine e sai de escopo — não há
 * campo no resultado nem variável de módulo onde ele pudesse ficar (critério 8). O buffer é do
 * chamador, e some com ele.
 */
export async function transcrever(
  engine: SttEngine,
  pcm: Int16Array
): Promise<DesfechoDaTranscricao> {
  // Clique curto demais não é falha: chamar o engine com zero amostras gastaria a inicialização
  // do sidecar para nada, e o erro voltaria culpando o engine por um acidente do usuário.
  if (pcm.length === 0) return { estado: 'sem-audio' }

  try {
    if (!(await engine.disponivel())) return { estado: 'indisponivel' }

    return { estado: 'ok', resultado: await engine.transcribe(pcm) }
  } catch (erro) {
    return { estado: 'falhou', motivo: erro instanceof Error ? erro.message : String(erro) }
  }
}
