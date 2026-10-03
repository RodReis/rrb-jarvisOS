/**
 * Adaptador do detector openWakeWord no sidecar Python (SPEC-Escuta-01).
 *
 * Converte os blocos recebidos em quadros de 1280 amostras exigidos pelo detector e mantém
 * 1500 ms de pré-roll em memória. O Python mantém o estado temporal da inferência.
 */

import { existsSync } from 'node:fs'
import { BufferCircularAudio } from './buffer-circular-audio'
import type { Sidecar } from './sidecar'
import type { WakeWordEngine, EventoWakeWordDetectado } from './wake-word-engine'
import { AMOSTRAS_PRE_ROLL, LIMIAR_PADRAO_WAKE_WORD, validarLimiar } from './wake-word-engine'

export interface ConfiguracaoDaEscuta {
  /** Diretório do modelo openWakeWord. */
  readonly modelo: string
  readonly melspec: string
  readonly embedding: string
  /** Se o runtime e o modelo estão no disco (injetado para teste sem arquivo real). */
  readonly artefatosPresentes?: () => boolean
}

export interface DepsDoEngineWake {
  readonly sidecar: Sidecar
  /** Lida a cada chamada, e não no construtor: modelo novo baixado vale na seguinte. */
  readonly configuracao: () => ConfiguracaoDaEscuta
}

/** Resposta do sidecar num detect — o que este arquivo lê dela. */
interface RespostaDaDeteccao {
  readonly ok?: unknown
  readonly confianca?: unknown
  readonly disparou?: unknown
}

export function criarEngineOpenWakeWord(deps: DepsDoEngineWake): WakeWordEngine {
  let limiar = LIMIAR_PADRAO_WAKE_WORD
  let configurado: string | undefined
  const janela = new BufferCircularAudio(AMOSTRAS_PRE_ROLL)
  let pendentes: number[] = []

  /** Envia `configurar` só quando o caminho do modelo **mudou** (critério 3 da M17-F02). */
  async function garantirConfiguracao(): Promise<void> {
    const { modelo, melspec, embedding } = deps.configuracao()
    const chave = `${modelo}|${melspec}|${embedding}`
    if (chave === configurado) return
    const resposta = await deps.sidecar.pedir({ op: 'configurar', modelo, melspec, embedding })
    if (resposta.ok !== true) throw new Error('Não foi possível configurar o detector de voz.')
    configurado = chave
  }

  return {
    async alimentar(pcm: Int16Array): Promise<EventoWakeWordDetectado | null> {
      // Janela vazia não é detecção: o sidecar não sobe e o app não dispara.
      if (pcm.length === 0) return null

      janela.adicionar(pcm)
      for (const amostra of pcm) pendentes.push(amostra)
      if (pendentes.length < 1_280) return null
      await garantirConfiguracao()
      while (pendentes.length >= 1_280) {
        const amostras = pendentes.splice(0, 1_280)
        const resposta = (await deps.sidecar.pedir({
          op: 'detectar',
          amostras
        })) as RespostaDaDeteccao
        if (resposta.ok !== true) {
          throw new Error('O detector de wake word não confirmou o processamento do áudio.')
        }
        const confianca = resposta.confianca
        if (
          typeof confianca !== 'number' ||
          !Number.isFinite(confianca) ||
          confianca < 0 ||
          confianca > 1
        ) {
          throw new Error('O detector de wake word devolveu uma confiança inválida.')
        }
        if (confianca >= limiar) {
          pendentes = []
          return { confianca, fimDaFraseMs: Date.now() }
        }
      }
      return null
    },

    async disponivel(): Promise<boolean> {
      const { modelo, melspec, embedding, artefatosPresentes } = deps.configuracao()
      const presentes =
        artefatosPresentes ??
        ((): boolean => existsSync(modelo) && existsSync(melspec) && existsSync(embedding))
      return presentes()
    },

    definirLimiar(l: number): void {
      limiar = validarLimiar(l)
    },

    obterLimiar(): number {
      return limiar
    },

    async encerrar(): Promise<void> {
      janela.limpar()
      pendentes = []
      configurado = undefined
      await deps.sidecar.encerrar()
    }
  }
}
