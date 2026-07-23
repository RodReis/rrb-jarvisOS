/**
 * Entidades mínimas da fundação (SPEC-Fundacao-04).
 *
 * Contrato antes de persistência: a UI consome estes tipos, nunca objeto solto
 * (`docs/CONVENTION.md` §2). Mora em `src/shared` porque renderer, main e testes
 * falam a mesma língua — e porque tipo precisa ser verificável sem carregar o Electron.
 *
 * Campos de escopo (CONVENTION §2): toda entidade persistida carrega `user_id`;
 * `workspace_id` quando o dado pertence a um espaço. `visibility`/`sensitivity` ficam
 * adiados por decisão da spec — as quatro entidades da fundação são infra, não dado de
 * produto. A exceção é o segredo da sessão, que é `credential` e por isso **não mora
 * aqui**: vive cifrado no `safeStorage`/DPAPI (SPEC-Fundacao-03).
 */

/**
 * Os espaços do usuário. **Enum fechado** — `Desenvolvimento` é plataforma compartilhada
 * e `Agentic OS` é área interna do JARVIS OS; nenhum dos dois é workspace (ADR-001).
 */
export const WORKSPACES = ['noa', 'jarvis'] as const

export type WorkspaceId = (typeof WORKSPACES)[number]

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && (WORKSPACES as readonly string[]).includes(value)
}

/** Idiomas suportados. `pt-BR` é o padrão do produto. */
export const LOCALES = ['pt-BR', 'en-US'] as const

export type Locale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Preferência de tema. `sistema` é o padrão (SPEC-05) — segue o SO até o usuário decidir
 * o contrário. É a preferência, não o tema resolvido: `sistema` vira claro ou escuro na
 * hora de pintar, conforme o que o SO responde naquele momento.
 */
export const THEME_PREFERENCES = ['claro', 'escuro', 'sistema'] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/** O tema efetivamente aplicado, depois de resolver `sistema`. */
export type ResolvedTheme = 'claro' | 'escuro'

/** Perfil do usuário. Sem segredo: o que o renderer pode ver por inteiro. */
export interface UserProfile {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly locale: Locale
  readonly theme: ThemePreference
}

/** O que a tela de Settings altera. Ambos opcionais: a UI muda um de cada vez. */
export interface UserPreferences {
  readonly locale?: Locale
  readonly theme?: ThemePreference
}

/**
 * Metadados da sessão local. **O token não entra aqui nem no SQLite** — mora cifrado no
 * `safeStorage` (SPEC-03). Esta tabela responde "há sessão e até quando ela vale", não
 * "qual é o segredo dela"; por isso pode ser lida sem expor credencial.
 */
export interface Session {
  readonly id: string
  readonly user_id: string
  /** ISO-8601. Depois disto, exige reautenticação. */
  readonly expires_at: string
  /** ISO-8601 da última autenticação online — base da janela de 30 dias (ADR-001). */
  readonly last_online_auth_at: string
  readonly created_at: string
}

/** Tipos de evento auditados na fundação. */
export const AUDIT_EVENT_TYPES = [
  'login',
  'logout',
  'login-offline-reuse',
  'workspace-switch',
  // SPEC-Execucao-02: toda decisão do Policy Engine gera um evento deste tipo.
  'policy-decision',
  // SPEC-Execucao-03: adicionar/remover diretório da allowlist é ação sensível (RF-019).
  // Tipo próprio, não `policy-decision`: editar a allowlist é uma mudança de configuração,
  // não a classificação de uma ação — misturar os dois sob um tipo confundiria a auditoria.
  'allowlist-change',
  // SPEC-Execucao-04: criar/alterar/ativar-desativar workflow ou automação (RF-006/007).
  // Cada um seu tipo, pela mesma razão de `allowlist-change`: são mudanças de catálogo
  // distintas, e a auditoria deve poder distingui-las sem parsear o payload.
  'workflow-change',
  'automation-change',
  // SPEC-Execucao-05: rastro de execução simulada (RF-006 "cada execução gera rastreio
  // auditável"). `execution-run` marca início/fim; `execution-step` marca cada etapa.
  'execution-run',
  'execution-step'
] as const

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/**
 * Evento de auditoria — imutável, append-only e **à prova de adulteração** (ADR-004).
 *
 * Os três últimos campos são a hash-chain: `seq` (monotônico por usuário) detecta remoção
 * e reordenação; `prev_hash` encadeia; `hash` é o HMAC-SHA-256 do conteúdo canônico + o
 * `prev_hash`. HMAC e não SHA-256 puro de propósito: sem a chave, quem editar uma linha
 * não consegue recomputar a cadeia para fechá-la de novo.
 */
export interface AuditEvent {
  readonly id: string
  readonly user_id: string
  /** Ausente em evento que não pertence a um espaço (ex.: login). */
  readonly workspace_id?: WorkspaceId
  readonly type: AuditEventType
  /** Conteúdo do evento. Nunca carrega segredo — auditoria não é lugar de credencial. */
  readonly payload: Readonly<Record<string, unknown>>
  readonly created_at: string
  /** Monotônico por `user_id`, começando em 1. */
  readonly seq: number
  /** `hash` do evento anterior do mesmo usuário; o genesis usa `GENESIS_HASH`. */
  readonly prev_hash: string
  readonly hash: string
}

/** O que o chamador informa ao auditar; a cadeia e o carimbo são do repositório. */
export interface AuditEventInput {
  readonly user_id: string
  readonly workspace_id?: WorkspaceId
  readonly type: AuditEventType
  readonly payload?: Readonly<Record<string, unknown>>
}
