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
import type { TaskType } from './routing'

/**
 * Os providers que o app conhece — **dado, não lógica**, como `CREDENTIAL_KEYS`.
 *
 * A F04 acrescentou os três previstos: `gemini` (HTTP cloud), `ollama` (HTTP local, grátis) e
 * `claude-code` (subprocess app-managed, rota de assinatura). A `CredentialKey` homônima não é
 * coincidência onde existe: o provider é quem consome a credencial daquele nome — e `ollama` e
 * `claude-code` **não têm** credencial, o que o `CREDENCIAL_DO_PROVIDER` registra explicitamente.
 */
export const AI_PROVIDERS = ['anthropic', 'gemini', 'ollama', 'claude-code'] as const

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
  },
  gemini: {
    'gemini-2.5-pro': { entrada: 1.25, saida: 10.0 },
    'gemini-2.5-flash': { entrada: 0.3, saida: 2.5 }
  },
  // **Zero é o preço, não um valor faltando.** O Ollama roda no `localhost` do próprio
  // usuário: não há cobrança por token, e a estimativa da F03 devolve US$ 0,00 — o que faz a
  // rota local passar pelo gate de orçamento sempre, que é exatamente a preferência
  // "local/offline quando viável" do RF-011 valendo na conta.
  ollama: {
    'llama3.1': { entrada: 0, saida: 0 },
    'qwen2.5-coder': { entrada: 0, saida: 0 }
  },
  // Rota de **assinatura** (plano Claude MAX pelo CLI), `unmetered` por emenda do PI de
  // 2026-08-29: registra uso sem valor monetário. Zero aqui não é "de graça" — é "não se
  // converte em USD". Converter seria número inventado, e o gate barraria com base nele.
  'claude-code': {
    'claude-opus-5': { entrada: 0, saida: 0 },
    'claude-sonnet-5': { entrada: 0, saida: 0 }
  }
}

/**
 * As rotas que **não** têm custo monetário por chamada, e por isso a `BudgetPolicy` não barra
 * (SPEC-Providers-03, emenda do PI de 2026-08-29; SPEC-Providers-04).
 *
 * Duas razões distintas sob a mesma marca: o `ollama` roda na máquina do usuário (grátis de
 * fato) e o `claude-code` é assinatura (pago por mês, não por chamada). O que as une é o que
 * importa aqui — **não existe USD por chamada a somar**, e uma estimativa em dólar seria
 * inventada.
 *
 * Dado e não `if`: o gate pergunta "esta rota é medida?" em vez de listar providers, e
 * acrescentar um provider grátis passa a ser acrescentar uma linha aqui.
 */
export const ROTAS_UNMETERED: readonly AiProvider[] = ['ollama', 'claude-code']

/** `true` quando a rota registra uso sem valor monetário — a `BudgetPolicy` não a barra. */
export function isRotaUnmetered(provider: AiProvider): boolean {
  return ROTAS_UNMETERED.includes(provider)
}

/**
 * De onde o provider responde (RF-011: "origem local/cloud" na tela de providers).
 *
 * Não é detalhe cosmético: é o insumo da preferência "local/offline quando viável" do
 * roteamento, e o que o usuário lê para saber se o prompt saiu da máquina dele.
 */
export const ORIGEM_DO_PROVIDER: Readonly<Record<AiProvider, 'local' | 'cloud'>> = {
  anthropic: 'cloud',
  gemini: 'cloud',
  ollama: 'local',
  // `local` no sentido que importa aqui: o processo roda nesta máquina. O CLI fala com a
  // Anthropic por dentro, mas quem o app executa é um binário local — e é isso que a tela
  // precisa dizer para o usuário entender o que está acontecendo no computador dele.
  'claude-code': 'local'
}

/** O modelo usado quando o chamador não escolhe. */
export const MODELO_PADRAO: Readonly<Record<AiProvider, string>> = {
  anthropic: 'claude-opus-5',
  gemini: 'gemini-2.5-pro',
  ollama: 'llama3.1',
  'claude-code': 'claude-opus-5'
}

/**
 * A credencial que cada provider consome, ou `undefined` quando não consome nenhuma.
 *
 * `undefined` explícito e não chave ausente do mapa: `ollama` fala com o `localhost` e
 * `claude-code` usa a sessão do próprio CLI — os dois **não têm** credencial no Vault, e o
 * `Record` completo obriga quem acrescentar provider a decidir isso em vez de esquecer.
 */
export const CREDENCIAL_DO_PROVIDER: Readonly<Record<AiProvider, CredentialKey | undefined>> = {
  anthropic: 'anthropic',
  gemini: 'gemini',
  ollama: undefined,
  'claude-code': undefined
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
  /**
   * O provider, quando o chamador **escolhe** um explicitamente.
   *
   * Opcional desde a F04: com `taskType`, quem escolhe é o `ProviderRoute` — e é esse o
   * caminho normal. O provider explícito continua existindo para o painel de teste do
   * Settings, onde o ponto é justamente falar com um provider específico.
   *
   * Um dos dois tem de vir. Sem nenhum, a chamada não sabe para onde ir; o ponto único recusa
   * com mensagem em vez de escolher um por conta própria.
   */
  readonly provider?: AiProvider
  /** Ausente = o modelo ativo do provider escolhido (F04) ou `MODELO_PADRAO`. */
  readonly model?: string
  /**
   * O tipo de tarefa, quando a escolha do provider é do **roteamento** (SPEC-Providers-04).
   *
   * O chamador declara o tipo; o `ProviderRoute` decide quem atende, com preferência local e
   * fallback por disponibilidade. Agentes que declarem o tipo sozinhos são Corte 3+/4.
   */
  readonly taskType?: TaskType
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

/**
 * O que o renderer recebe ao disparar a chamada — o handle para casar os eventos.
 *
 * `provider` e `model` são **opcionais desde a F04**: quando a chamada é roteada por
 * `taskType`, quem atende só se sabe depois da seleção, que acontece dentro do serviço. O
 * handle deixou de afirmar o que o handler não tinha como saber — e quem precisa do provider
 * escolhido o lê no `CostEvent` do evento `fim`, onde ele é fato medido e não previsão.
 */
export interface AiCallHandle {
  readonly id: string
  readonly provider?: AiProvider
  readonly model?: string
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
