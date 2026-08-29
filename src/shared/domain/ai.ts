/**
 * Contratos de providers de IA (SPEC-Providers-02).
 *
 * A regra que governa este arquivo é a mesma de `credentials.ts`, e pela mesma razão: **a
 * credencial não é campo de nenhum tipo daqui**. O adapter lê a chave do Vault dentro do main,
 * no instante da chamada; nada que atravesse o IPC tem onde ela caiba.
 *
 * Mora em `src/shared/domain` porque o renderer consome os chunks e o estado do stream, e o
 * contrato precisa ser verificável sem carregar o Electron.
 *
 * O que este arquivo **não** decide: qual provider atende qual tarefa (roteamento é a F04) e
 * se a chamada cabe no orçamento (o gate é a F03). Aqui o custo é medido e reportado.
 */

import type { WorkspaceId } from './entities'
import type { CredentialKey } from './credentials'

/**
 * Os providers que o app conhece — **dado, não lógica**, como `CREDENTIAL_KEYS`.
 *
 * Nesta fatia só a Anthropic tem adapter; a lista já é plural porque a F04 acrescenta linha
 * aqui, e um tipo que nasce singular vira `string` no primeiro provider novo. A `CredentialKey`
 * homônima não é coincidência: o provider é quem consome a credencial daquele nome.
 */
export const AI_PROVIDERS = ['anthropic'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

/**
 * Preço por **milhão de tokens**, em USD, por modelo.
 *
 * Dado semeado e versionado (spec § "tabela de preço semeada … dado versionado, não hardcode"):
 * a estimativa pré-chamada da F03 e o custo real desta fatia leem daqui, e o número aparece uma
 * vez só. Preço espalhado por call site é onde a estimativa e o custo real divergem em silêncio.
 *
 * Os valores são os da tabela pública da Anthropic; quando mudarem, muda-se esta linha — não a
 * lógica que a consome.
 */
export interface PrecoDoModelo {
  /** USD por 1M tokens de entrada. */
  readonly entrada: number
  /** USD por 1M tokens de saída. */
  readonly saida: number
}

/**
 * A tabela de preço, por provider e modelo (decisão do PI 2026-08-29: os três modelos).
 *
 * Três modelos e não um: a F03 precisa de spread para estimar, e a F04 roteia por tarefa
 * comparando custo. Semear um só faria as duas fatias começarem acrescentando linha aqui.
 */
export const TABELA_DE_PRECO: Readonly<
  Record<AiProvider, Readonly<Record<string, PrecoDoModelo>>>
> = {
  anthropic: {
    'claude-opus-5': { entrada: 5.0, saida: 25.0 },
    'claude-sonnet-5': { entrada: 2.0, saida: 10.0 },
    'claude-haiku-4-5': { entrada: 1.0, saida: 5.0 }
  }
}

/** O modelo usado quando o chamador não escolhe. */
export const MODELO_PADRAO: Readonly<Record<AiProvider, string>> = {
  anthropic: 'claude-opus-5'
}

/** A credencial que cada provider consome. Explícito para não derivar nome de string. */
export const CREDENCIAL_DO_PROVIDER: Readonly<Record<AiProvider, CredentialKey>> = {
  anthropic: 'anthropic'
}

/**
 * Teto de tokens da resposta.
 *
 * Existe como constante, e não como parâmetro do renderer, porque é insumo de **custo**: quem
 * escolhe o teto escolhe o gasto máximo da chamada, e essa não é decisão da UI. A F03 lê daqui
 * para estimar o pior caso antes de deixar a chamada sair.
 */
export const MAX_TOKENS_PADRAO = 4096

/**
 * Timeout da chamada, em milissegundos (ARCHITECTURE § Resiliência: "timeout obrigatório").
 *
 * Generoso porque streaming de resposta longa é lento por natureza — o que o timeout protege
 * não é a lentidão, é o pendurado: um stream que parou de emitir e nunca fecha seguraria o
 * `AuditEvent` de conclusão para sempre.
 */
export const TIMEOUT_PADRAO_MS = 120_000

/** O que o chamador pede. Stateless nesta fatia: o contexto é o que vem aqui (spec § Fora). */
export interface AiRequest {
  readonly provider: AiProvider
  /** Ausente = `MODELO_PADRAO[provider]`. */
  readonly model?: string
  readonly prompt: string
  /** Instrução de sistema, opcional. */
  readonly system?: string
  readonly maxTokens?: number
}

/**
 * Tokens consumidos, como o provider os reporta.
 *
 * É a fonte do **custo real** — a estimativa pré-chamada é palpite, isto é medição. Vem no fim
 * do stream (decisão do PI 2026-07-24).
 */
export interface AiUsage {
  readonly tokensEntrada: number
  readonly tokensSaida: number
}

/**
 * Custo de uma chamada — o `CostEvent` do RF-011 ("evento financeiro de execução").
 *
 * **Report-only nesta fatia** (spec, critério 3): é emitido e auditado, e não barra nada. A F03
 * liga o gate lendo exatamente estes campos, e é por isso que `estimadoUsd` existe já agora
 * mesmo sem consumidor — o gate precisa decidir **antes** de a chamada sair, quando só há
 * estimativa.
 */
export interface CostEvent {
  readonly provider: AiProvider
  readonly model: string
  readonly workspace: WorkspaceId
  /** Antes da chamada: tokens do prompt × preço + o teto de saída no pior caso. */
  readonly estimadoUsd: number
  /** Depois do stream, a partir do `usage`. Ausente quando a chamada falhou antes do fim. */
  readonly realUsd?: number
  readonly usage?: AiUsage
  /** Até o **primeiro** chunk — o que o usuário sente como "travou". */
  readonly latenciaPrimeiroChunkMs?: number
  /** Do início ao fim do stream. */
  readonly latenciaTotalMs: number
}

/**
 * Estado de um stream, como o renderer o vê (spec, critério 2).
 *
 * `falhou` é estado de primeira classe e não exceção: o renderer precisa **mostrar** que falhou,
 * e um erro que só existe como throw no main não chega à tela.
 */
export const AI_STREAM_STATES = ['streaming', 'concluido', 'falhou'] as const

export type AiStreamState = (typeof AI_STREAM_STATES)[number]

/**
 * Um evento do stream, na direção main → renderer.
 *
 * União discriminada por `tipo`, e não um objeto com todos os campos opcionais: o renderer
 * precisa saber que `chunk` sempre traz texto e que `fim` sempre traz o desfecho. Campos
 * opcionais fariam a tela testar `undefined` em vez de tratar o caso.
 *
 * O `id` casa os eventos de uma mesma chamada — é o `correlationId` do log (CONVENTION §3), o
 * mesmo valor nos dois lados, para que entrada e saída sejam casáveis na investigação.
 */
export type AiStreamEvent =
  | { readonly tipo: 'chunk'; readonly id: string; readonly texto: string }
  | {
      readonly tipo: 'fim'
      readonly id: string
      readonly estado: Extract<AiStreamState, 'concluido' | 'falhou'>
      /** Presente em `concluido`; ausente quando falhou antes de o provider reportar. */
      readonly custo?: CostEvent
      /**
       * Motivo legível em pt-BR quando `falhou`. **Nunca** carrega a credencial nem o corpo
       * cru do provider: a mensagem de erro é um caminho clássico de vazamento de chave.
       */
      readonly erro?: string
    }

/** O que o renderer recebe ao disparar a chamada — o handle para casar os eventos. */
export interface AiCallHandle {
  readonly id: string
  readonly provider: AiProvider
  readonly model: string
}

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Custo em USD de um par entrada/saída, pela tabela semeada.
 *
 * Função pura e exportada para que o teste afirme sobre o **número**, sem rede: é a mesma
 * conta que produz a estimativa e o custo real, e tê-la em dois lugares é como os dois passam
 * a discordar.
 *
 * Modelo desconhecido devolve `0` em vez de lançar: um preço faltando na tabela não é motivo
 * para derrubar uma chamada que o usuário já pagou — o custo aparece como zero, o que é
 * visível na auditoria, enquanto uma exceção aqui perderia a resposta inteira.
 */
export function calcularCustoUsd(provider: AiProvider, model: string, usage: AiUsage): number {
  const preco = TABELA_DE_PRECO[provider][model]
  if (preco === undefined) return 0

  const POR_MILHAO = 1_000_000
  return (
    (usage.tokensEntrada / POR_MILHAO) * preco.entrada +
    (usage.tokensSaida / POR_MILHAO) * preco.saida
  )
}

/**
 * Estimativa **antes** da chamada (critério 4).
 *
 * O pior caso, de propósito: tokens do prompt na entrada e o teto inteiro na saída. A F03 vai
 * gatear com este número, e uma estimativa otimista deixaria passar a chamada que estoura o
 * orçamento — o erro que importa evitar aqui é subestimar, não superestimar.
 *
 * A contagem de tokens do prompt é aproximada (≈4 caracteres por token). Aproximar é aceitável
 * porque o custo **real** vem do `usage` do provider logo depois; o que a estimativa precisa
 * ser é uma cota superior barata, não uma medição exata que exigiria uma chamada de rede só
 * para contar.
 */
export function estimarCustoUsd(
  provider: AiProvider,
  model: string,
  prompt: string,
  maxTokens: number
): number {
  const CARACTERES_POR_TOKEN = 4
  return calcularCustoUsd(provider, model, {
    tokensEntrada: Math.ceil(prompt.length / CARACTERES_POR_TOKEN),
    tokensSaida: maxTokens
  })
}
