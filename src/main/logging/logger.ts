/**
 * Logger do main — o **escritor único** dos arquivos (SPEC-Fundacao-06, ADR-005).
 *
 * O renderer nunca toca no disco: ele captura com `electron-log` e encaminha por IPC, e o
 * que chega aqui é gravado por este winston. Dois donos do mesmo arquivo dariam rotação
 * corrompida — daí "escritor único" ser regra, não preferência.
 */

import { mkdirSync } from 'node:fs'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import {
  LOG_CATEGORIES,
  LOG_LEVELS,
  LOG_RETENTION_DAYS,
  type CategoryLogger,
  type LogCategory,
  type LogInput,
  type LogLevel,
  type LogRecord
} from '@shared/contracts/logging'
import { redactContext } from '@shared/contracts/logging-redaction'

/** Espaço ativo. A Fatia 02 (WorkspaceSwitcher) passa a atualizar isto na troca. */
let currentWorkspace: LogRecord['workspace'] = 'sistema'

export function setCurrentWorkspace(workspace: LogRecord['workspace']): void {
  currentWorkspace = workspace
}

export function getCurrentWorkspace(): LogRecord['workspace'] {
  return currentWorkspace
}

/**
 * Um arquivo por nível, porque a retenção é por nível (info 3d / warn 7d / error 10d).
 *
 * `level: 'info'` num transport do winston significa "info **e tudo mais severo**", então um
 * único transport por nível colocaria os `error` também no arquivo de info — e eles seriam
 * podados em 3 dias em vez de 10. O filtro abaixo restringe cada transport ao seu nível exato.
 */
function exactLevel(level: LogLevel): winston.Logform.Format {
  return winston.format((info) => (info.level === level ? info : false))()
}

/** Formato de arquivo: JSON puro, uma linha por registro, já redigido. */
const fileFormat = winston.format.combine(
  winston.format((info) => {
    const record = info as unknown as LogRecord
    return {
      ...record,
      ctx: redactContext(record.ctx ?? {})
    } as unknown as winston.Logform.TransformableInfo
  })(),
  winston.format.json()
)

function buildTransport(level: LogLevel, dirname: string): DailyRotateFile {
  return new DailyRotateFile({
    dirname,
    filename: `${level}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    // `maxFiles` com sufixo `d` é retenção em dias; sem o sufixo seria contagem de arquivos.
    maxFiles: `${LOG_RETENTION_DAYS[level]}d`,
    zippedArchive: true,
    level,
    format: winston.format.combine(exactLevel(level), fileFormat)
  })
}

let logger: winston.Logger | undefined

/**
 * Cria o logger e os arquivos em `logsDir` (em produção, `userData/logs` — fora do repo).
 * Idempotente: chamar de novo devolve a instância existente, para não empilhar transports.
 *
 * `console` liga o transport legível de dev. Quem chama passa `!app.isPackaged`, e não
 * `NODE_ENV`: no app empacotado a variável costuma vir vazia, e o console ficaria ligado em
 * produção. É a mesma lição da Fatia 01 — o sinal confiável no Electron é `app.isPackaged`.
 * O parâmetro mantém este módulo testável sem carregar o Electron.
 */
export function initLogger(logsDir: string, { console = false } = {}): winston.Logger {
  if (logger) return logger

  mkdirSync(logsDir, { recursive: true })

  logger = winston.createLogger({
    level: 'info',
    transports: LOG_LEVELS.map((level) => buildTransport(level, logsDir))
  })

  if (console) {
    logger.add(
      new winston.transports.Console({
        level: 'debug',
        format: winston.format.combine(
          winston.format(
            (info) =>
              ({
                ...info,
                ctx: redactContext((info as unknown as LogRecord).ctx ?? {})
              }) as unknown as winston.Logform.TransformableInfo
          )(),
          winston.format.printf((info) => {
            const record = info as unknown as LogRecord
            const ctx =
              Object.keys(record.ctx ?? {}).length > 0 ? ` ${JSON.stringify(record.ctx)}` : ''
            return `[${record.level}] ${record.category} · ${record.msg}${ctx}`
          })
        )
      })
    )
  }

  return logger
}

/** Grava um registro já completo. É por aqui que a ponte do renderer entra. */
export function writeLog(input: LogInput & { readonly source: LogRecord['source'] }): void {
  if (!logger) return

  const record: LogRecord = {
    ts: new Date().toISOString(),
    level: input.level,
    category: input.category,
    ...(input.direction ? { direction: input.direction } : {}),
    workspace: input.workspace ?? currentWorkspace,
    msg: input.msg,
    ctx: input.ctx ?? {},
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    pid: process.pid,
    source: input.source
  }

  logger.log(record as unknown as winston.LogEntry)
}

function categoryLogger(category: LogCategory): CategoryLogger {
  const emit =
    (level: LogLevel) =>
    (msg: string, ctx?: LogRecord['ctx']): void =>
      writeLog({ level, category, msg, ...(ctx ? { ctx } : {}), source: 'main' })

  return { error: emit('error'), warn: emit('warn'), info: emit('info') }
}

/**
 * Um child logger por categoria: `log.ipc.info('...')` no call site, sem repetir a categoria.
 * Todas as categorias do contrato existem aqui, inclusive as que ainda não têm fluxo
 * (`ai`, `agent`, `integracao`) — é o que garante assinatura idêntica quando elas nascerem.
 */
export const log = Object.fromEntries(
  LOG_CATEGORIES.map((category) => [category, categoryLogger(category)])
) as Readonly<Record<LogCategory, CategoryLogger>>

/** Fecha os transports. Usado no encerramento do app e no teardown dos testes. */
export function closeLogger(): void {
  logger?.close()
  logger = undefined
}
