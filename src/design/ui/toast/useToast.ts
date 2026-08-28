import { createContext, useContext } from 'react'
import type { TomSemantico } from '../semantica'

/**
 * Motor de Toasts (SPEC-DesignSystem-03b, README §5; critério 2).
 *
 * O contrato que os componentes consomem. A implementação (fila, timers, dedupe) vive no
 * `ToastProvider`; aqui ficam só os tipos e o hook, para que um componente possa disparar um
 * toast sem conhecer como a fila é gerida.
 *
 * A regra do protótipo (README §5): **todo** feedback de sistema — info/warn/error/success —
 * passa por aqui. Nada de `alert`, banner inline ad-hoc ou `console` para falar com o usuário.
 */

export type TomToast = TomSemantico

export interface Toast {
  readonly id: number
  readonly tom: TomToast
  readonly titulo: string
  readonly mensagem?: string
  /** Duração em ms até o auto-dismiss. Default 4200 (README §5.1). */
  readonly duracao: number
  /** Carimbo de horário HH:MM:SS, fixado no disparo. */
  readonly stamp: string
}

/** O que o consumidor passa para disparar — id e stamp são do motor. */
export interface EntradaToast {
  readonly tom: TomToast
  readonly titulo: string
  readonly mensagem?: string
  readonly duracao?: number
}

export interface ControleToast {
  readonly toasts: readonly Toast[]
  readonly disparar: (entrada: EntradaToast) => void
  readonly descartar: (id: number) => void
  /** Pausa o auto-dismiss (hover/foco) e retoma — a11y: quem lê devagar não perde a mensagem. */
  readonly pausar: (id: number) => void
  readonly retomar: (id: number) => void
}

export const ToastContexto = createContext<ControleToast | null>(null)

/**
 * Dispara e controla toasts.
 *
 * Lança fora do provider: um `disparar` que silenciasse sem provider faria feedback sumir sem
 * rastro — o oposto do que um sistema de notificação existe para garantir.
 */
export function useToast(): ControleToast {
  const ctx = useContext(ToastContexto)
  if (ctx === null) {
    throw new Error('useToast precisa de um <ToastProvider> acima na árvore.')
  }
  return ctx
}

/** Máximo de toasts simultâneos — README §5.1, decisão registrada na spec. */
export const MAX_TOASTS = 5

/** Duração padrão até o auto-dismiss — README §5.1. */
export const DURACAO_PADRAO = 4200
