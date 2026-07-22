/**
 * Contrato de logging — a forma de todo registro, nos dois processos.
 *
 * Governado pelo ADR-005 e detalhado na SPEC-Fundacao-06; o contrato em prosa vive em
 * `docs/CONVENTION.md` §3. Este arquivo é a versão executável dele: mora em `src/shared`
 * porque precisa ser testável sem carregar o Electron e porque renderer e main falam a
 * mesma língua na ponte IPC.
 *
 * Fronteira que este contrato preserva (ADR-004): log é observabilidade efêmera, rotaciona
 * e some. `AuditEvent` é evidência permanente. Um evento pode gerar os dois; um nunca
 * substitui o outro, e os stores são separados.
 */

/** Níveis gravados em arquivo. `debug` existe só em dev (console), fora da produção. */
export const LOG_LEVELS = ['error', 'warn', 'info'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * Categorias do contrato. As três primeiras ainda não têm fluxo na fundação (`ai`, `agent`
 * e `integracao` nascem em MVPs posteriores) — estão aqui de propósito: definir a assinatura
 * agora é o que faz o log de in/out já nascer padronizado quando o subsistema existir.
 */
export const LOG_CATEGORIES = [
  'integracao',
  'ai',
  'agent',
  'db',
  'auth',
  'ipc',
  'ui',
  'sistema'
] as const

export type LogCategory = (typeof LOG_CATEGORIES)[number]

/**
 * Espaço a que o registro pertence. `sistema` cobre o que não tem espaço de usuário —
 * `Desenvolvimento` não é workspace de usuário (CONVENTION §2), então não entra aqui.
 */
export type LogWorkspace = 'noa' | 'jarvis' | 'sistema'

/** Sentido do fluxo, para casar entrada e saída de uma mesma operação via `correlationId`. */
export type LogDirection = 'in' | 'out'

/** Processo que originou o registro. O renderer nunca escreve em disco — só o main. */
export type LogSource = 'main' | 'renderer'

/** Contexto estruturado. O detalhe técnico vive aqui; `msg` fica curta e sem segredo. */
export type LogContext = Record<string, unknown>

/**
 * O registro estruturado, um objeto por linha no arquivo.
 *
 * `msg` é uma frase curta em **pt-BR**, sem stack trace e sem segredo — o stack vai em
 * `ctx.stack`. Os campos que o chamador não fornece (`ts`, `pid`, `source`, `workspace`)
 * são preenchidos pelo logger, por isso `LogInput` abaixo é o que se passa na chamada.
 */
export interface LogRecord {
  /** ISO-8601. */
  readonly ts: string
  readonly level: LogLevel
  readonly category: LogCategory
  readonly direction?: LogDirection
  readonly workspace: LogWorkspace
  /** Frase curta em pt-BR. Sem stack, sem segredo. */
  readonly msg: string
  readonly ctx: LogContext
  /** Casa `in` com `out` de uma mesma operação. */
  readonly correlationId?: string
  readonly pid: number
  readonly source: LogSource
}

/** O que o chamador informa; o logger completa o resto do `LogRecord`. */
export interface LogInput {
  readonly level: LogLevel
  readonly category: LogCategory
  readonly msg: string
  readonly ctx?: LogContext
  readonly direction?: LogDirection
  readonly workspace?: LogWorkspace
  readonly correlationId?: string
}

/**
 * Assinatura do logger, igual nos dois processos. Um child logger por categoria mantém a
 * chamada curta no call site (`log.ipc.info('...')`) sem repetir a categoria a cada linha.
 */
export interface CategoryLogger {
  error(msg: string, ctx?: LogContext): void
  warn(msg: string, ctx?: LogContext): void
  info(msg: string, ctx?: LogContext): void
}

/**
 * Chaves cujo **valor** nunca é gravado, em qualquer profundidade do `ctx`.
 *
 * Comparação é case-insensitive: um payload externo pode chegar como `Authorization` ou
 * `apiKey`, e uma lista sensível a maiúscula deixaria passar. Ver `redact()` em
 * `src/shared/contracts/logging-redaction.ts`.
 */
export const REDACTED_KEYS = [
  'token',
  'password',
  'secret',
  'authorization',
  'accessToken',
  'refreshToken',
  'apiKey'
] as const

/**
 * Classificações de `sensitivity` (CONVENTION §2) que nunca vão para o log.
 * `personal | financial | health` são mascaradas: JARVIS não loga esses sem aprovação.
 */
export const REDACTED_SENSITIVITIES = [
  'credential',
  'secret',
  'personal',
  'financial',
  'health'
] as const

/** Marcador que substitui o valor removido — deixa visível *que* houve redaction. */
export const REDACTED_PLACEHOLDER = '[redigido]'

/** Retenção em dias, por nível (SPEC-Fundacao-06; decisão do PI em 2026-07-21). */
export const LOG_RETENTION_DAYS: Readonly<Record<LogLevel, number>> = {
  info: 3,
  warn: 7,
  error: 10
}
