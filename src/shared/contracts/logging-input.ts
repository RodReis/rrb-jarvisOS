/**
 * Validação do registro que chega do renderer.
 *
 * O renderer é fronteira de confiança: o que atravessa o IPC é entrada externa, mesmo sendo
 * nosso próprio código do outro lado. Um `category` fora do contrato viraria arquivo com
 * categoria inventada; um `msg` gigante viraria log ilegível. Valida-se aqui, e o que não
 * casa com o contrato é descartado — não "corrigido em silêncio".
 */

import {
  LOG_CATEGORIES,
  LOG_LEVELS,
  type LogCategory,
  type LogInput,
  type LogLevel
} from './logging'

const levels = new Set<string>(LOG_LEVELS)
const categories = new Set<string>(LOG_CATEGORIES)
const workspaces = new Set(['noa', 'jarvis', 'sistema'])
const directions = new Set(['in', 'out'])

/** Teto de tamanho da mensagem. `msg` é frase curta por contrato; o detalhe vai em `ctx`. */
const MAX_MSG_LENGTH = 2000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Devolve o registro normalizado, ou `undefined` se não casar com o contrato.
 * `undefined` é descarte deliberado: gravar um registro malformado polui a evidência.
 */
export function parseLogInput(value: unknown): LogInput | undefined {
  if (!isPlainObject(value)) return undefined

  const { level, category, msg, ctx, direction, workspace, correlationId } = value

  if (typeof level !== 'string' || !levels.has(level)) return undefined
  if (typeof category !== 'string' || !categories.has(category)) return undefined
  if (typeof msg !== 'string' || msg.length === 0) return undefined

  if (ctx !== undefined && !isPlainObject(ctx)) return undefined
  if (direction !== undefined && (typeof direction !== 'string' || !directions.has(direction))) {
    return undefined
  }
  if (workspace !== undefined && (typeof workspace !== 'string' || !workspaces.has(workspace))) {
    return undefined
  }
  if (correlationId !== undefined && typeof correlationId !== 'string') return undefined

  return {
    level: level as LogLevel,
    category: category as LogCategory,
    msg: msg.slice(0, MAX_MSG_LENGTH),
    ...(ctx ? { ctx } : {}),
    ...(direction ? { direction: direction as 'in' | 'out' } : {}),
    ...(workspace ? { workspace: workspace as 'noa' | 'jarvis' | 'sistema' } : {}),
    ...(correlationId ? { correlationId } : {})
  }
}
