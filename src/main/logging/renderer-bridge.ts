/**
 * Ponte renderer → main para logs (SPEC-Fundacao-06, ADR-005).
 *
 * O renderer captura com `electron-log` e encaminha; aqui o registro é repassado ao winston,
 * que é o **escritor único**. Por isso os transports de arquivo do próprio `electron-log`
 * ficam desligados: dois donos do mesmo arquivo quebrariam a rotação.
 *
 * Há dois caminhos de entrada, de propósito:
 *  - `window.jarvis.sendLog(...)` — chamada explícita e tipada, o caminho normal do nosso código;
 *  - `electron-log` — pega o que passa por `console.*` do renderer, inclusive de dependências,
 *    que nunca conheceriam a nossa ponte.
 */

import electronLog from 'electron-log/main'
import type { LogCategory, LogLevel } from '@shared/contracts/logging'
import { writeLog } from './logger'

/** `electron-log` tem níveis que o contrato não grava; mapeiam para o mais próximo. */
function toContractLevel(level: string): LogLevel | undefined {
  if (level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  if (level === 'info' || level === 'verbose' || level === 'debug' || level === 'silly') {
    return 'info'
  }
  return undefined
}

export function initRendererLogBridge(): void {
  // Arquivo desligado: quem grava é o winston. Não é otimização — é a regra do escritor único.
  electronLog.transports.file.level = false
  electronLog.transports.console.level = false

  const winstonTransport = (message: { level: string; data: unknown[] }): void => {
    const level = toContractLevel(message.level)
    if (!level) return

    const [first, ...rest] = message.data
    const msg = typeof first === 'string' ? first : JSON.stringify(first)

    writeLog({
      level,
      // Vindo do console do renderer, a origem é a UI — a categoria segue isso.
      category: 'ui' satisfies LogCategory,
      msg,
      ...(rest.length > 0 ? { ctx: { detalhes: rest } } : {}),
      source: 'renderer'
    })
  }

  // `level`/`transforms` são o formato de transport que o electron-log espera; sem eles ele
  // ignora o transport em silêncio. `transforms: []` = nada a transformar antes de repassar.
  winstonTransport.level = 'silly' as const
  winstonTransport.transforms = []

  electronLog.transports['winston'] = winstonTransport as never

  // Injeta o bridge do electron-log nas sessões, para capturar `console.*` do renderer.
  electronLog.initialize({ spyRendererConsole: true })
}
