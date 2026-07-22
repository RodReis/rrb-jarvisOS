/**
 * Logger do renderer — captura e encaminha, nunca escreve.
 *
 * O renderer não tem acesso ao disco (fronteira de segurança da Fatia 01), então tudo aqui
 * atravessa a ponte tipada `window.jarvis.sendLog` e é gravado pelo winston do main.
 * A API é a mesma do main (`log.ui.info(...)`), para o call site não mudar de forma
 * conforme o processo.
 */

import {
  LOG_CATEGORIES,
  type CategoryLogger,
  type LogCategory,
  type LogContext,
  type LogLevel
} from '@shared/contracts/logging'
import { redactContext } from '@shared/contracts/logging-redaction'

function categoryLogger(category: LogCategory): CategoryLogger {
  const emit =
    (level: LogLevel) =>
    (msg: string, ctx?: LogContext): void => {
      // Sem a ponte não há para onde mandar — em teste de componente (jsdom) ela não existe,
      // e um logger que quebra a UI por não conseguir logar seria pior que o silêncio.
      if (typeof window === 'undefined' || !window.jarvis) return

      // Redige já no renderer: o main redige de novo antes de gravar (defesa em profundidade),
      // mas assim o segredo nem chega a atravessar o IPC.
      window.jarvis.sendLog({ level, category, msg, ...(ctx ? { ctx: redactContext(ctx) } : {}) })
    }

  return { error: emit('error'), warn: emit('warn'), info: emit('info') }
}

export const log = Object.fromEntries(
  LOG_CATEGORIES.map((category) => [category, categoryLogger(category)])
) as Readonly<Record<LogCategory, CategoryLogger>>
