/**
 * Adaptador do detector próprio no sidecar Python (SPEC-Escuta-01).
 *
 * Forma janelas de 2 s e analisa a cada 250 ms. O pré-roll do turno é mantido pela captura
 * contínua no renderer; este buffer pertence só à classificação da frase.
 */

import { existsSync } from 'node:fs'
import { BufferCircularAudio } from './buffer-circular-audio'
import type { Sidecar } from './sidecar'
import type { WakeWordEngine, EventoWakeWordDetectado } from './wake-word-engine'
import { LIMIAR_PADRAO_WAKE_WORD, validarLimiar } from './wake-word-engine'

const AMOSTRAS_DA_JANELA = 32_000
const PASSO_DE_ANALISE = 4_000

export interface ConfiguracaoDaEscuta {
  /** Caminho do classificador próprio. */
  readonly modelo: string
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

export function criarEngineWakeLocal(deps: DepsDoEngineWake): WakeWordEngine {
  let limiar = LIMIAR_PADRAO_WAKE_WORD
  let configurado: string | undefined
  const janela = new BufferCircularAudio(AMOSTRAS_DA_JANELA)
  let amostrasDesdeAnalise = 0

  /** Envia `configurar` só quando o caminho do modelo **mudou** (critério 3 da M17-F02). */
  async function garantirConfiguracao(): Promise<void> {
    const { modelo } = deps.configuracao()
    if (modelo === configurado) return
    const resposta = await deps.sidecar.pedir({ op: 'configurar', modelo })
    if (resposta.ok !== true) throw new Error('Não foi possível configurar o detector de voz.')
    configurado = modelo
  }

  return {
    async alimentar(pcm: Int16Array): Promise<EventoWakeWordDetectado | null> {
      // Janela vazia não é detecção: o sidecar não sobe e o app não dispara.
      if (pcm.length === 0) return null

      janela.adicionar(pcm)
      amostrasDesdeAnalise += pcm.length
      if (janela.tamanho() < AMOSTRAS_DA_JANELA || amostrasDesdeAnalise < PASSO_DE_ANALISE) {
        return null
      }
      amostrasDesdeAnalise %= PASSO_DE_ANALISE
      await garantirConfiguracao()
      const resposta = (await deps.sidecar.pedir({
        op: 'detectar',
        amostras: Array.from(janela.obter())
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
      if (confianca < limiar) return null
      janela.limpar()
      amostrasDesdeAnalise = 0
      return { confianca, fimDaFraseMs: Date.now() }
    },

    async disponivel(): Promise<boolean> {
      const { modelo, artefatosPresentes } = deps.configuracao()
      const presentes = artefatosPresentes ?? ((): boolean => existsSync(modelo))
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
      amostrasDesdeAnalise = 0
      configurado = undefined
      await deps.sidecar.encerrar()
    }
  }
}
