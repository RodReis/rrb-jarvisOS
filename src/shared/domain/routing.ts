/**
 * Roteamento por tarefa — o `ProviderRoute` (SPEC-Providers-04, critérios 3, 4 e 6).
 *
 * A pergunta que este arquivo responde: **dado um tipo de tarefa e quem está disponível, qual
 * provider atende?** A resposta é uma função pura — a decisão não precisa de banco, rede nem
 * relógio, e testá-la sem eles é o que torna o critério 4 (fallback) afirmável sobre a regra em
 * vez de sobre a infraestrutura.
 *
 * O que **não** mora aqui: o healthcheck (que descobre quem está de pé) e a chamada em si. Este
 * módulo recebe a disponibilidade como dado e devolve a escolha.
 */

import { AI_PROVIDERS, ORIGEM_DO_PROVIDER, type AiProvider } from './ai'
import type { WorkspaceId } from './entities'

/**
 * A taxonomia semeada de tipos de tarefa (decisão do PI de 2026-07-24).
 *
 * **Dado versionado, não hardcode** — acrescentar um tipo é acrescentar uma linha aqui, e o
 * `Record` completo do `ROTEAMENTO_PADRAO` obriga quem o fizer a decidir a preferência em vez
 * de esquecer.
 *
 * O chamador declara o tipo no `request` (spec § Fora: agentes que o declaram sozinhos são
 * Corte 3+/4).
 */
export const TASK_TYPES = [
  'chat',
  'code',
  'embedding',
  'summarize',
  'vision',
  'conversa-de-voz'
] as const

export type TaskType = (typeof TASK_TYPES)[number]

/** Rótulo em pt-BR de cada tipo, para a tela não derivar texto de identificador. */
export const ROTULO_DO_TASK_TYPE: Readonly<Record<TaskType, string>> = {
  chat: 'Conversa',
  code: 'Código',
  embedding: 'Embedding',
  summarize: 'Resumo',
  vision: 'Visão',
  'conversa-de-voz': 'Conversa por voz'
}

/**
 * Uma regra de roteamento: para este tipo de tarefa, tente nesta ordem.
 *
 * **Lista ordenada e não provider único** porque o fallback (critério 4) é a razão de existir
 * da estrutura: o preferido pode estar offline, e a rota precisa saber quem vem depois. Um
 * campo `provider` com um `fallback` opcional cobriria dois níveis e travaria no terceiro.
 */
export interface ProviderRoute {
  readonly taskType: TaskType
  /** Da maior para a menor preferência. Vazia = nenhum provider atende este tipo. */
  readonly preferencia: readonly AiProvider[]
  /**
   * Quando `true`, um provider **local** disponível vence a ordem declarada (RF-011:
   * "preferência local/offline quando viável").
   *
   * Existe como toggle por rota, e não como regra global, porque a preferência é sensata para
   * `chat` e `summarize` e discutível para `code` — onde o usuário pode querer o modelo maior
   * mesmo tendo um local de pé. Quem decide isso é ele, por tipo de tarefa.
   */
  readonly preferirLocal: boolean
}

/**
 * O roteamento de quem nunca o editou.
 *
 * As escolhas: `chat` e `summarize` preferem local (barato, privado, e a qualidade basta);
 * `code` prefere o modelo forte por padrão, com o local como último recurso; `embedding` é
 * local primeiro porque indexação roda em volume e mandar o corpus para a nuvem é caro em
 * dinheiro e em privacidade; `vision` **não lista o Ollama** — o modelo local padrão não
 * atende, e listar um provider que falharia seria um fallback que não funciona.
 */
export const ROTEAMENTO_PADRAO: Readonly<Record<TaskType, ProviderRoute>> = {
  chat: { taskType: 'chat', preferencia: ['anthropic', 'gemini', 'ollama'], preferirLocal: true },
  code: {
    taskType: 'code',
    preferencia: ['claude-code', 'anthropic', 'ollama'],
    preferirLocal: false
  },
  embedding: {
    taskType: 'embedding',
    preferencia: ['ollama', 'gemini'],
    preferirLocal: true
  },
  summarize: {
    taskType: 'summarize',
    preferencia: ['gemini', 'anthropic', 'ollama'],
    preferirLocal: true
  },
  vision: { taskType: 'vision', preferencia: ['gemini', 'anthropic'], preferirLocal: false },
  /*
   * **Lista de um só, e isso é a decisão, não uma lacuna** (SPEC-Voz-03, decisão 2 do PI).
   *
   * Todas as outras rotas listam alternativas porque o fallback é a razão de existir da
   * estrutura. Esta não: o que trafega é a **fala do usuário**, transcrita, e mandá-la para a
   * nuvem quando o Ollama cai seria trocar privacidade por disponibilidade sem ninguém pedir.
   * O Done do épico #193 diz "conversa de voz completa sem nenhuma chamada cloud".
   *
   * A consequência é declarada: Ollama fora significa **recusa com próxima ação**, não degradação
   * silenciosa. O usuário pode acrescentar um provider aqui em Settings — a lista é editável como
   * as outras —, mas isso é ato dele, não default do produto.
   */
  'conversa-de-voz': {
    taskType: 'conversa-de-voz',
    preferencia: ['ollama'],
    preferirLocal: true
  }
}

/** O conjunto de regras de um escopo (`user_id` + `workspace_id`), espelhando F01 e F03. */
export interface RoutingPolicy {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly rotas: Readonly<Record<TaskType, ProviderRoute>>
}

export function roteamentoPadrao(userId: string, workspace: WorkspaceId): RoutingPolicy {
  return { user_id: userId, workspace_id: workspace, rotas: ROTEAMENTO_PADRAO }
}

/** O estado de um provider, como o healthcheck o reporta (RF-011). */
export const ESTADOS_DO_PROVIDER = ['online', 'loading', 'offline'] as const

export type EstadoDoProvider = (typeof ESTADOS_DO_PROVIDER)[number]

/** O que a tela de providers mostra por provider (critério 5). */
export interface ProviderStatus {
  readonly provider: AiProvider
  readonly estado: EstadoDoProvider
  /** O modelo que a rota usaria hoje. */
  readonly modelo: string
  readonly origem: 'local' | 'cloud'
  /** Latência do último healthcheck, em ms. Ausente quando nunca foi medida. */
  readonly latenciaMs?: number
  /** `true` quando a rota registra uso sem valor monetário (Ollama, Claude Code CLI). */
  readonly unmetered: boolean
}

/**
 * O resultado da seleção — quem atende, e **por quê**.
 *
 * O `motivo` não é cosmético: é o que o `AuditEvent` do critério 4 registra. "Caiu para o
 * segundo da lista" e "o local ganhou por preferência" são decisões diferentes, e uma
 * auditoria que só guardasse o provider escolhido não permitiria distingui-las depois.
 */
export type SelecaoDeProvider =
  | {
      readonly decisao: 'escolhido'
      readonly provider: AiProvider
      readonly motivo: 'preferido' | 'preferencia-local' | 'fallback'
      /** Os que foram pulados por estarem offline — o rastro do fallback. */
      readonly pulados: readonly AiProvider[]
    }
  | {
      readonly decisao: 'indisponivel'
      /** Todos os candidatos da rota, todos offline. */
      readonly pulados: readonly AiProvider[]
    }

/**
 * Escolhe o provider para uma tarefa, dada a rota e quem está disponível (critérios 3, 4 e 6).
 *
 * A ordem das perguntas:
 *
 * 1. **Preferência local**, quando a rota a liga: o primeiro provider **local** da lista que
 *    esteja disponível vence a ordem declarada. É a "preferência local/offline quando viável"
 *    do RF-011 — e "quando viável" é a razão de ela não ser incondicional: local offline não
 *    ganha nada.
 * 2. **A ordem declarada**, pulando quem está offline. O primeiro da lista que responde é o
 *    `preferido`; qualquer outro é `fallback`, e a distinção é o que a auditoria registra.
 * 3. **Ninguém disponível** → `indisponivel`. Não é erro nesta função: é a resposta honesta, e
 *    quem decide o que fazer a respeito (falhar com mensagem) é o ponto único.
 *
 * Provider offline **nunca** é escolhido (critério 6) — nem por preferência local, nem por
 * ordem. É o invariante que este arquivo inteiro existe para garantir.
 */
export function selecionarProvider(
  rota: ProviderRoute,
  disponiveis: ReadonlySet<AiProvider>
): SelecaoDeProvider {
  const candidatos = rota.preferencia
  const online = candidatos.filter((p) => disponiveis.has(p))

  if (online.length === 0) {
    return { decisao: 'indisponivel', pulados: candidatos }
  }

  if (rota.preferirLocal) {
    const local = online.find((p) => ORIGEM_DO_PROVIDER[p] === 'local')
    // Só conta como `preferencia-local` quando o local **não** era o primeiro de qualquer
    // forma: se era, a escolha se explica pela ordem, e rotulá-la de preferência esconderia
    // que o toggle não teve efeito nenhum ali.
    if (local !== undefined && local !== online[0]) {
      return {
        decisao: 'escolhido',
        provider: local,
        motivo: 'preferencia-local',
        pulados: candidatos.slice(0, candidatos.indexOf(local)).filter((p) => !disponiveis.has(p))
      }
    }
  }

  const escolhido = online[0] as AiProvider
  const pulados = candidatos.slice(0, candidatos.indexOf(escolhido))

  return {
    decisao: 'escolhido',
    provider: escolhido,
    // `fallback` quando alguém à frente na ordem foi pulado — que é exatamente o caso que o
    // critério 4 manda auditar.
    motivo: pulados.length === 0 ? 'preferido' : 'fallback',
    pulados
  }
}

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value)
}

/**
 * Guard da rota que atravessa o IPC (CONVENTION §2: validar na fronteira).
 *
 * Checa forma **e** o conteúdo da lista: uma preferência com string que não é provider
 * conhecido não é forma quase certa, é uma rota que nunca vai casar com adapter nenhum — e o
 * sintoma apareceria como "nenhum provider disponível", longe da causa.
 */
export function isProviderRoute(value: unknown): value is ProviderRoute {
  if (typeof value !== 'object' || value === null) return false

  const candidato = value as Record<string, unknown>
  if (!isTaskType(candidato.taskType)) return false
  if (typeof candidato.preferirLocal !== 'boolean') return false
  if (!Array.isArray(candidato.preferencia)) return false

  return candidato.preferencia.every(
    (p) => typeof p === 'string' && (AI_PROVIDERS as readonly string[]).includes(p)
  )
}
