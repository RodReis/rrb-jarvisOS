/**
 * Contratos do vault de credenciais (SPEC-Providers-01).
 *
 * A regra que governa este arquivo: **o valor do segredo não é campo de nenhum tipo daqui**.
 * Não é omissão, é a garantia — não existindo campo onde a chave caiba, nenhum caminho de
 * serialização (IPC, log, auditoria, storage do renderer) pode carregá-la por descuido. É o
 * mesmo recurso que o DS já usa em `CredencialMascarada` (SPEC-DS-04b): quem recusa a chave
 * é o tipo, não a disciplina de quem escreve o código.
 *
 * Mora em `src/shared/domain` porque a UI de Settings consome os metadados, e o contrato
 * precisa ser verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'

/**
 * De onde a credencial veio.
 *
 * `env` é bootstrap/fallback **read-only** — o app lê `process.env` como já faz com a config
 * do Supabase, e não há caminho para editá-la pela UI. `vault` é o cofre cifrado que o
 * usuário gerencia (BYOK). Quando as duas existem para a mesma `key`+escopo, **o vault
 * vence** (decisão do Cowork na spec): o explícito do usuário tem precedência sobre o
 * bootstrap, senão adicionar a chave pela UI não teria efeito visível.
 */
export const CREDENTIAL_SOURCES = ['env', 'vault'] as const

export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number]

/**
 * Se há valor guardado para essa chave naquele escopo. `missing` é estado de primeira classe,
 * não ausência de registro: a UI precisa listar **o que falta**, por nome, sem exibir segredo
 * (RF-010) — e para isso a credencial faltante tem de ter uma linha para aparecer.
 */
export const CREDENTIAL_STATUSES = ['present', 'missing'] as const

export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

/**
 * As chaves lógicas que o app conhece — **dado, não lógica**, como a taxonomia de risco.
 *
 * Enum fechado e não texto livre por dois motivos. Primeiro, `missing` só é computável sobre
 * um conjunto conhecido: sem a lista, "o que falta" não tem resposta, porque faltar é a
 * ausência de algo esperado. Segundo, a chave vira nome de variável de ambiente
 * (`JARVIS_CREDENTIAL_<KEY>`), e nome derivado de texto livre do renderer abriria a leitura
 * de `process.env` a um valor que o renderer escolhe.
 *
 * Os adapters da F02 chegam consultando esta lista; acrescentar provider é acrescentar linha
 * aqui.
 */
export const CREDENTIAL_KEYS = ['anthropic', 'openai', 'gemini'] as const

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number]

/** Rótulo do provider para a UI. Fica junto da chave para não haver segunda fonte do nome. */
export const CREDENTIAL_PROVIDER_LABELS: Readonly<Record<CredentialKey, string>> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini'
}

/**
 * Referência a um segredo — **nunca o segredo**.
 *
 * Escopada por `user_id` + `workspace_id` (decisão do PI): NOA e JARVIS OS têm credenciais
 * próprias, e a mesma `key` lógica pode ter valores distintos em cada espaço sem se misturar
 * (invariante do LANDSCAPE "alternar sem misturar credenciais").
 *
 * É este tipo que atravessa o IPC. O valor cru existe só no main, em memória, no instante em
 * que o adapter chama o provider.
 */
export interface CredentialRef {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly key: CredentialKey
  readonly source: CredentialSource
  readonly status: CredentialStatus
  readonly created_at: string
  readonly updated_at: string
}

/**
 * O que o renderer vê: a credencial reduzida ao que a UI precisa para decidir o que mostrar.
 *
 * Espelha o `CredentialRef` sem `id`/`user_id` — a UI não endereça credencial por id (a chave
 * lógica + o espaço já identificam) e o usuário corrente é implícito. Um tipo próprio, e não
 * o `CredentialRef` direto, porque a superfície exposta ao renderer deve ser a menor que
 * responde à tela, não a maior que o main tem à mão.
 */
export interface CredentialStatusView {
  readonly key: CredentialKey
  readonly provider: string
  readonly workspace: WorkspaceId
  readonly status: CredentialStatus
  /** Ausente quando `status` é `missing`: sem valor guardado, não há fonte de onde ele venha. */
  readonly source?: CredentialSource
  /**
   * `true` quando existe valor no `.env` para esta chave/escopo — independentemente de o
   * vault estar vencendo a precedência.
   *
   * A UI precisa disso para ser honesta sobre o que acontece ao remover: apagar a chave do
   * vault com env presente **não** deixa a credencial ausente, ela volta para `env`. Sem este
   * campo, a tela prometeria uma remoção que o sistema não faz.
   */
  readonly envDisponivel: boolean
}

/**
 * Quem está mexendo na credencial (decisão do PI 2026-07-24 — "distinguir o ator").
 *
 * `usuario` é o dono agindo no Settings: auditado, **sem aprovação**. `agente` é runtime
 * querendo alterar credencial: alto risco, `requires-approval` pelo Policy Engine — e
 * **report-only** enquanto o fluxo de aprovação do MVP-004 não estiver plugado aqui, o que é
 * o que mantém o MVP-005 independente do MVP-004.
 *
 * O ator nunca vem do renderer: quem o informa é o call site no main. Um ator escolhido pela
 * UI seria um ator que o agente também poderia escolher.
 */
export const CREDENTIAL_ACTORS = ['usuario', 'agente'] as const

export type CredentialActor = (typeof CREDENTIAL_ACTORS)[number]

/** Operações auditadas sobre uma credencial. */
export const CREDENTIAL_OPERATIONS = ['set', 'remove'] as const

export type CredentialOperation = (typeof CREDENTIAL_OPERATIONS)[number]

export function isCredentialKey(value: unknown): value is CredentialKey {
  return typeof value === 'string' && (CREDENTIAL_KEYS as readonly string[]).includes(value)
}

/**
 * Nome da variável de ambiente que carrega a chave: `JARVIS_CREDENTIAL_OPENAI`.
 *
 * Prefixo próprio em vez de reusar `OPENAI_API_KEY`: o `.env` do projeto já é lido inteiro
 * para `process.env`, e casar nomes genéricos faria o vault absorver variáveis que existem
 * para outra finalidade. Um namespace explícito torna a intenção legível no arquivo.
 *
 * **Sem escopo por workspace no env**: o env é bootstrap, e um `.env` não tem espaço de
 * usuário. A mesma variável serve os dois espaços — quem quiser valores distintos por espaço
 * usa o vault, que é onde o escopo existe.
 */
export function nomeDaVariavelDeAmbiente(key: CredentialKey): string {
  return `JARVIS_CREDENTIAL_${key.toUpperCase()}`
}
