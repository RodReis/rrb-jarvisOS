/**
 * Uma chamada ao ponto único de IA com prazo, cancelamento e teto de saída (SPEC-Squads-03/04).
 *
 * É o miolo que o worker, o integrador e o revisor dividem: junta o relógio do executor, o sinal de
 * quem cancela e o teto de bytes da saída num só `AbortController`, e devolve um **estado
 * terminal** — nunca lança. O que o modelo escreveu é **dado não confiável**: quem chama valida.
 *
 * A causa que disparou primeiro vale mais que o resultado que chegou junto: `cancelada` não vira
 * `concluida` por uma corrida entre o sinal e o último evento do stream.
 */

import { TIMEOUT_PADRAO_MS, type AiRequest, type CostEvent } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiCallContext } from '../ai/call-provider'
import type { ChamadorDeIa } from './squad-gerador'

/** Mais que isto de saída é um modelo fora de controle, não um resultado. */
export const MAX_BYTES_DA_SAIDA = 256 * 1024
export const MS_POR_MINUTO = 60_000
/** Margem para o relógio do executor disparar antes do relógio do ponto único. */
const MARGEM_DO_PRAZO_MS = 2_000
/** O que do erro do provider vai para a auditoria: o bastante para diagnosticar, nada de corpo cru. */
export const MAX_MOTIVO_AUDITADO = 160

export interface PedidoDeChamada {
  readonly ia: ChamadorDeIa
  readonly request: AiRequest
  readonly userId: string
  readonly workspace: WorkspaceId
  /** O prazo pedido; o efetivo é o menor entre ele e o teto do ponto único. */
  readonly prazoMs: number
  readonly signal?: AbortSignal
}

export type ResultadoDaChamada =
  | { readonly ok: true; readonly texto: string; readonly custo?: CostEvent }
  | {
      readonly ok: false
      readonly estado: 'timeout' | 'cancelada' | 'falhou' | 'invalida'
      readonly motivo: string
      readonly custo?: CostEvent
    }

type Falha = Extract<ResultadoDaChamada, { ok: false }>

const falha = (
  causa: 'timeout' | 'cancelada' | undefined,
  erro: string | undefined,
  custo: CostEvent | undefined
): Falha => {
  const com = custo === undefined ? {} : { custo }
  if (causa === 'timeout') return { ok: false, estado: 'timeout', motivo: 'prazo-do-plano', ...com }
  if (causa === 'cancelada') return { ok: false, estado: 'cancelada', motivo: 'cancelada', ...com }
  return {
    ok: false,
    estado: 'falhou',
    motivo: (erro ?? 'a chamada falhou').slice(0, MAX_MOTIVO_AUDITADO),
    ...com
  }
}

export async function chamarModelo(pedido: PedidoDeChamada): Promise<ResultadoDaChamada> {
  const prazoMs = Math.min(pedido.prazoMs, TIMEOUT_PADRAO_MS)
  const controle = new AbortController()
  let causa: 'timeout' | 'cancelada' | undefined
  const estourar = setTimeout(() => {
    causa ??= 'timeout'
    controle.abort()
  }, prazoMs)
  const cancelar = (): void => {
    causa ??= 'cancelada'
    controle.abort()
  }
  if (pedido.signal?.aborted === true) cancelar()
  else pedido.signal?.addEventListener('abort', cancelar)

  const ctx: AiCallContext = {
    userId: pedido.userId,
    workspace: pedido.workspace,
    signal: controle.signal,
    timeoutMs: prazoMs + MARGEM_DO_PRAZO_MS
  }

  try {
    let texto = ''
    for await (const evento of pedido.ia.call(pedido.request, ctx)) {
      if (evento.tipo === 'chunk') {
        texto += evento.texto
        if (Buffer.byteLength(texto, 'utf8') > MAX_BYTES_DA_SAIDA) {
          controle.abort()
          return { ok: false, estado: 'invalida', motivo: 'saida-grande-demais' }
        }
        continue
      }
      const custo = evento.custo
      if (causa !== undefined) return falha(causa, undefined, custo)
      if (evento.estado === 'falhou') return falha(causa, evento.erro, custo)
      return { ok: true, texto, ...(custo === undefined ? {} : { custo }) }
    }
    return falha(causa, 'o stream terminou sem desfecho', undefined)
  } finally {
    clearTimeout(estourar)
    pedido.signal?.removeEventListener('abort', cancelar)
  }
}
