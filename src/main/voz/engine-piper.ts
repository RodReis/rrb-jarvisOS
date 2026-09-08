/**
 * O `TtsEngine` concreto: Piper no sidecar Python (SPEC-Voz-02, critérios 1, 2 e 3).
 *
 * **Este é o único arquivo do app que sabe que existe Piper.** Tudo mais fala com a interface
 * `TtsEngine` — o dia em que uma voz cloud voltar ao escopo, ela é outro arquivo como este e uma
 * linha de composição no `index.ts`, não refatoração de quem consome.
 *
 * Ele também não sabe **sintetizar**: quem faz isso é o script Python. Aqui mora a tradução entre
 * o contrato do app e o protocolo JSON por linha do sidecar, e mais nada.
 */

import { existsSync } from 'node:fs'
import type { Sidecar } from './sidecar'
import { montarFala, type AlinhamentoDeFonema } from './timeline-de-visemes'
import type { TtsEngine, VozInstalada } from './tts-engine'
import type { SpeechHandle } from '@shared/domain/visemes'

/** Uma voz do catálogo, do ponto de vista de quem compõe o engine. */
export interface VozDoCatalogo {
  readonly id: string
  readonly rotulo: string
  /** Caminho do `.onnx` em `userData`. Nunca atravessa a ponte (critério 6). */
  readonly caminho: string
}

export interface DepsDoEnginePiper {
  readonly sidecar: Sidecar
  /** Lida a cada chamada, e não no construtor: voz baixada em Settings vale na seguinte. */
  readonly vozes: () => readonly VozDoCatalogo[]
  /** Se o arquivo da voz está no disco. Injetada para teste sem arquivo real. */
  readonly existe?: (caminho: string) => boolean
  /** Onde o caminho da timeline é registrado — o critério 3 pede que seja observável. */
  readonly registrarTimeline?: (voz: string, timeline: 'exato' | 'estimado') => void
}

/** O que o sidecar devolve numa síntese — o que este arquivo lê dela. */
interface RespostaDaFala {
  readonly sampleRate?: unknown
  readonly pcm?: unknown
  readonly fonemas?: unknown
  readonly alinhamentos?: unknown
}

export function criarEnginePiper(deps: DepsDoEnginePiper): TtsEngine {
  let configurado: string | undefined

  /**
   * O caminho que cada voz entregou da última vez.
   *
   * Por engine, e não no módulo: dois engines em teste contaminariam um ao outro, e o segundo
   * herdaria a observação do primeiro sem nunca ter falado.
   */
  const timelineObservada = new Map<string, 'exato' | 'estimado'>()

  const existe = deps.existe ?? existsSync

  /** As vozes cujo arquivo está de fato no disco. Catálogo lista o possível; isto, o instalado. */
  function instaladas(): readonly VozDoCatalogo[] {
    return deps.vozes().filter((v) => existe(v.caminho))
  }

  /*
   * Manda `configurar` só quando o conjunto de vozes **mudou**.
   *
   * O sidecar descarta a voz carregada ao receber `configurar` (é o que faz uma voz recém-baixada
   * valer sem restart), então reconfigurar a cada fala pagaria o `load` de ~1,2 s medido no spike
   * em toda frase — quinze vezes o custo da síntese em si.
   */
  async function garantirConfiguracao(): Promise<void> {
    const vozes = instaladas()
    const assinatura = vozes.map((v) => `${v.id}=${v.caminho}`).join('|')
    if (assinatura === configurado) return

    await deps.sidecar.pedir({
      op: 'configurar',
      vozes: Object.fromEntries(vozes.map((v) => [v.id, v.caminho]))
    })
    configurado = assinatura
  }

  return {
    async disponivel(): Promise<boolean> {
      // Presença no disco, não `pedir` ao sidecar: subir o Python só para descobrir que nenhuma
      // voz foi baixada gastaria segundos para dar a resposta que o `existsSync` dá.
      return instaladas().length > 0
    },

    async vozes(): Promise<readonly VozInstalada[]> {
      /*
       * O `timeline` de cada voz sai de uma medição, não de uma tabela.
       *
       * Poderia vir cravado no catálogo, mas isso seria a promessa e não o fato: o spike mediu que
       * a `edresson` perde o alinhamento **em silêncio**, e uma revisão nova do modelo pode mudar
       * isso nos dois sentidos. Aqui a resposta é sempre a última observada; enquanto não houver
       * observação, `exato` é o que o caminho default entrega.
       */
      return instaladas().map((v) => ({
        id: v.id,
        rotulo: v.rotulo,
        timeline: timelineObservada.get(v.id) ?? 'exato'
      }))
    },

    async speak(texto: string, voz: string): Promise<SpeechHandle> {
      await garantirConfiguracao()

      const resposta = (await deps.sidecar.pedir({ op: 'falar', texto, voz })) as RespostaDaFala

      const pcm = lerPcm(resposta.pcm)
      const sampleRate = typeof resposta.sampleRate === 'number' ? resposta.sampleRate : 0

      if (sampleRate <= 0 || pcm.length === 0) {
        throw new Error('O sidecar de voz devolveu áudio vazio.')
      }

      const fala = montarFala({
        pcm,
        sampleRate,
        fonemas: lerFonemas(resposta.fonemas),
        alinhamentos: lerAlinhamentos(resposta.alinhamentos)
      })

      timelineObservada.set(voz, fala.timeline)
      deps.registrarTimeline?.(voz, fala.timeline)

      return fala
    },

    async encerrar(): Promise<void> {
      configurado = undefined
      timelineObservada.clear()
      await deps.sidecar.encerrar()
    }
  }
}

/**
 * Lê o PCM defensivamente.
 *
 * A resposta vem de outro processo, e forma inesperada aqui derrubaria a fala inteira por causa de
 * um campo — o mesmo motivo pelo qual o conector lê com `?.` em vez de confiar no `ok`.
 */
function lerPcm(bruto: unknown): Int16Array {
  if (!Array.isArray(bruto)) return new Int16Array(0)

  const amostras = bruto.filter((n): n is number => typeof n === 'number')
  return Int16Array.from(amostras)
}

function lerFonemas(bruto: unknown): readonly string[] {
  if (!Array.isArray(bruto)) return []
  return bruto.filter((f): f is string => typeof f === 'string')
}

function lerAlinhamentos(bruto: unknown): readonly AlinhamentoDeFonema[] {
  if (!Array.isArray(bruto)) return []

  return bruto.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const a = item as Record<string, unknown>
    if (typeof a.fonema !== 'string' || typeof a.amostras !== 'number') return []

    return [{ fonema: a.fonema, amostras: a.amostras }]
  })
}
