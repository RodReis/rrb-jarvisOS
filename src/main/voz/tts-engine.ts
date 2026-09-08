/**
 * O contrato de síntese de fala (SPEC-Voz-02, critério 1).
 *
 * Espelha `stt-engine.ts` pela mesma razão: o app fala com `TtsEngine`, nunca com o Piper. Se as
 * vozes cloud voltarem ao escopo (o épico #193 as tirou), elas entram como outra implementação
 * desta interface — não como refatoração de quem já consome.
 *
 * ## Por que áudio e visemes saem juntos
 *
 * Separar em duas chamadas permitiria a uma delas faltar. A boca do mascote (F04) precisa da
 * timeline do **mesmo** áudio que está tocando; duas chamadas abririam a porta para uma
 * dessincronizar da outra silenciosamente, que é o defeito mais caro de achar depois.
 */

import type { DesfechoDaFala, SpeechHandle, VozInstalada } from '@shared/domain/visemes'

export type { DesfechoDaFala, VozInstalada }

/**
 * O engine de síntese. Implementação concreta importa o runtime dela; ninguém mais.
 *
 * `disponivel()` é separado de `speak()` pelo mesmo motivo do STT: "a voz existe?" pede download,
 * "a síntese falhou?" pede nova tentativa. São ações diferentes na tela.
 */
export interface TtsEngine {
  /** Sintetiza o texto na voz pedida. Pode lançar — quem chama trata. */
  readonly speak: (texto: string, voz: string) => Promise<SpeechHandle>
  /** Se o runtime e ao menos uma voz estão prontos **agora**. */
  readonly disponivel: () => Promise<boolean>
  /** As vozes instaladas, para o preview e a escolha de default em Settings. */
  readonly vozes: () => Promise<readonly VozInstalada[]>
  /** Encerra o que o engine mantiver vivo. Idempotente. */
  readonly encerrar: () => Promise<void>
}

/**
 * Sintetiza um enunciado, traduzindo tudo em desfecho tratado.
 *
 * `sem-texto` existe pelo mesmo motivo que `sem-audio` no STT: o spike mediu que o Piper devolve
 * **zero chunks** para string vazia, e chamar o engine nesse caso gastaria a inicialização para
 * receber um erro que culpa o engine por um acidente de quem chamou.
 */
export async function falar(
  engine: TtsEngine,
  texto: string,
  voz: string
): Promise<DesfechoDaFala> {
  if (texto.trim() === '') return { estado: 'sem-texto' }

  try {
    if (!(await engine.disponivel())) return { estado: 'indisponivel' }

    return { estado: 'ok', fala: await engine.speak(texto, voz) }
  } catch (erro) {
    return { estado: 'falhou', motivo: erro instanceof Error ? erro.message : String(erro) }
  }
}
