/**
 * Redaction — o que nunca chega ao disco.
 *
 * Roda no main, como formato do winston, antes de escrever. Fica em `src/shared` porque é
 * regra pura (CONVENTION §3): nada de Electron, nada de IO, testável direto. O renderer
 * também importa daqui para não depender de o main ser o único a limpar — defesa em
 * profundidade barata, já que a mesma função serve os dois.
 */

import {
  REDACTED_KEYS,
  REDACTED_PLACEHOLDER,
  REDACTED_SENSITIVITIES,
  type LogContext
} from './logging'

const redactedKeys = new Set<string>(REDACTED_KEYS.map((key) => key.toLowerCase()))
const redactedSensitivities = new Set<string>(REDACTED_SENSITIVITIES)

/** Uma chave é sensível pelo nome, independentemente de caixa (`Authorization`, `apiKey`). */
function isSensitiveKey(key: string): boolean {
  return redactedKeys.has(key.toLowerCase())
}

/**
 * O objeto inteiro é redigido quando ele mesmo se declara sensível — `{ sensitivity:
 * 'credential', ... }` some por completo, não só o campo `sensitivity`. Redigir apenas o
 * rótulo deixaria o valor rotulado passar, que é exatamente o que a regra existe para impedir.
 */
function declaresSensitivePayload(value: Record<string, unknown>): boolean {
  const sensitivity = value['sensitivity']
  return typeof sensitivity === 'string' && redactedSensitivities.has(sensitivity)
}

/**
 * Remove a credencial de uma URL `https://usuario:senha@host/...`, onde quer que ela apareça.
 *
 * É a única redação que age sobre **conteúdo** e não sobre nome de campo, e a razão é que o segredo
 * aqui não está num campo: ele está no meio de uma string. O caso concreto veio da M9-F01 — o push
 * da publicação carrega o token na URL (o `ambienteControlado()` do MVP-004 não deixa variável de
 * ambiente alcançar o subprocess), e a **linha de comando é persistida**, em `execution_run` e no
 * `AuditEvent` do terminal. Sem esta regra o token vai para o banco em claro, e nenhuma chave por
 * nome o alcança.
 *
 * Fica aqui, e não no chamador, porque é a única posição que cobre todos os call sites de uma vez:
 * o `TerminalEngine` audita os args antes de executar, e uma redação feita depois — na cópia que o
 * runner devolve — chegaria tarde demais para o que já foi gravado.
 *
 * Preserva o host e o caminho: sem eles, ninguém sabe para onde o comando falhou.
 */
function redigirCredencialEmUrl(texto: string): string {
  return texto.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, `$1${REDACTED_PLACEHOLDER}@`)
}

/**
 * Devolve uma cópia sem os valores sensíveis, em qualquer profundidade.
 *
 * Estruturas cíclicas viram `'[circular]'` em vez de estourar a pilha: um erro real costuma
 * carregar objetos com referência de volta (request → socket → request), e um logger que
 * derruba o processo ao registrar a falha é pior que a falha.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redigirCredencialEmUrl(value)

  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[circular]'
  seen.add(value)

  // Error não é enumerável: `{...err}` sai vazio e a causa da falha se perde no log.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen))
  }

  const source = value as Record<string, unknown>
  if (declaresSensitivePayload(source)) return REDACTED_PLACEHOLDER

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    output[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : redact(item, seen)
  }

  return output
}

/** Aplica `redact` ao contexto de um registro, preservando o formato de objeto. */
export function redactContext(ctx: LogContext): LogContext {
  return redact(ctx) as LogContext
}
