/**
 * O `SttEngine` concreto: faster-whisper no sidecar Python (SPEC-Voz-01, critérios 1, 6 e 7).
 *
 * **Este é o único arquivo do app que sabe que existe faster-whisper.** Tudo mais fala com a
 * interface `SttEngine` — trocar por whisper.cpp é escrever outro arquivo como este e mudar a
 * linha de composição no `index.ts`, que é o invariante do épico #193.
 *
 * Ele também não sabe **transcrever**: quem faz isso é o script Python. Aqui mora a tradução
 * entre o contrato do app e o protocolo JSON por linha do sidecar, e mais nada.
 *
 * ## Por que a configuração vai a cada chamada
 *
 * O critério 6 pede que trocar modelo ou idioma em Settings valha **na chamada seguinte, sem
 * restart**. Guardar a configuração no construtor faria a mudança esperar o próximo boot do app;
 * lê-la a cada transcrição custa nada, porque o sidecar só recarrega o modelo quando a
 * configuração realmente muda.
 */

import { existsSync } from 'node:fs'
import type { Sidecar } from './sidecar'
import type { ResultadoDaTranscricao, SttEngine } from './stt-engine'
import type { ModoDeCompute } from '@shared/domain/voz'

export interface ConfiguracaoDaVoz {
  /** Diretório do modelo CTranslate2 — o que o faster-whisper abre. */
  readonly modelo: string
  /** O idioma pedido. `pt` por default (decisão do PI). */
  readonly idioma: string
}

export interface DepsDoEngine {
  readonly sidecar: Sidecar
  /** Lida a cada chamada, e não no construtor: Settings vale na seguinte (critério 6). */
  readonly configuracao: () => ConfiguracaoDaVoz
  /** Se o runtime e o modelo estão no disco. Injetada para teste sem arquivo real. */
  readonly artefatosPresentes?: () => boolean
  /** Onde o modo de compute escolhido pelo sidecar é registrado (critério 7). */
  readonly registrarCompute?: (modo: ModoDeCompute) => void
}

/** O que o sidecar devolve numa transcrição — o que este arquivo lê dela. */
interface RespostaDaTranscricao {
  readonly texto?: unknown
  readonly idioma?: unknown
  readonly segmentos?: unknown
  readonly compute?: unknown
}

export function criarEngineFasterWhisper(deps: DepsDoEngine): SttEngine {
  let configurado: string | undefined

  /*
   * Manda `configurar` só quando a configuração **mudou**.
   *
   * Reconfigurar a cada enunciado descartaria o modelo carregado toda vez (o sidecar zera o
   * modelo ao receber `configurar`, que é o que faz o critério 6 valer), e o custo de recarregar
   * o Whisper voltaria a cada frase — exatamente o que o processo de vida longa evita.
   */
  async function garantirConfiguracao(): Promise<void> {
    const config = deps.configuracao()
    const assinatura = `${config.modelo} ${config.idioma}`
    if (assinatura === configurado) return

    await deps.sidecar.pedir({ op: 'configurar', modelo: config.modelo, idioma: config.idioma })
    configurado = assinatura
  }

  return {
    async disponivel(): Promise<boolean> {
      // Presença no disco, não `pedir` ao sidecar: subir o processo Python só para descobrir
      // que o modelo falta gastaria segundos para dar a resposta que o `existsSync` dá.
      const presentes = deps.artefatosPresentes ?? ((): boolean => existsSync(deps.configuracao().modelo))
      return presentes()
    },

    async transcribe(pcm: Int16Array): Promise<ResultadoDaTranscricao> {
      await garantirConfiguracao()

      /*
       * O PCM atravessa como array de inteiros. `Array.from` é a conversão que o JSON aceita —
       * um `Int16Array` serializa como objeto indexado, que o lado Python leria como dicionário.
       *
       * O buffer **não fica**: entra como argumento, vira uma linha e sai de escopo com a
       * chamada (critério 8). Não há campo nem cache neste closure onde ele sobreviveria.
       */
      const resposta = (await deps.sidecar.pedir({
        op: 'transcrever',
        amostras: Array.from(pcm)
      })) as RespostaDaTranscricao

      if (resposta.compute === 'cuda' || resposta.compute === 'cpu-int8') {
        deps.registrarCompute?.(resposta.compute)
      }

      return {
        texto: typeof resposta.texto === 'string' ? resposta.texto : '',
        idioma: typeof resposta.idioma === 'string' ? resposta.idioma : deps.configuracao().idioma,
        segmentos: lerSegmentos(resposta.segmentos)
      }
    },

    async encerrar(): Promise<void> {
      configurado = undefined
      await deps.sidecar.encerrar()
    }
  }
}

/**
 * Lê a lista de segmentos defensivamente.
 *
 * A resposta vem de outro processo, e forma inesperada aqui derrubaria a transcrição inteira por
 * causa de um campo — o mesmo motivo pelo qual o conector lê com `?.` em vez de confiar no `ok`.
 */
function lerSegmentos(bruto: unknown): ResultadoDaTranscricao['segmentos'] {
  if (!Array.isArray(bruto)) return []

  return bruto.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const s = item as Record<string, unknown>
    if (typeof s.texto !== 'string') return []

    return [
      {
        inicioMs: typeof s.inicioMs === 'number' ? s.inicioMs : 0,
        fimMs: typeof s.fimMs === 'number' ? s.fimMs : 0,
        texto: s.texto
      }
    ]
  })
}
