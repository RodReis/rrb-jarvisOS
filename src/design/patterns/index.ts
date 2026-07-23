/**
 * Camada `patterns` do design system (SPEC-DesignSystem-01).
 *
 * Composições recorrentes montadas sobre `ui`. É o topo da pirâmide do DS — nada dentro
 * do design system depende desta camada.
 */

export { LinhaDeAjuste } from './LinhaDeAjuste'

// AppShell e navegação (SPEC-DesignSystem-04a) — F04a
export {
  AppShell,
  GRID,
  NavigationGroup,
  Rail,
  ShellFooter,
  Sidebar,
  TopBar,
  WorkspaceSwitcher,
  type AppShellProps,
  type GrupoDeNavegacao,
  type ItemDeNavegacao,
  type ItemDoRail
} from './AppShell'

// Seletor de acento da CHOICE (SPEC-DesignSystem-06) — F06
export { AccentSwatchSelector } from './AccentSwatchSelector'

// Padrões operacionais (SPEC-DesignSystem-04b) — F04b
export { redigirLinhas, redigirTexto, REDIGIDO } from './redigir'

export {
  ApprovalDialog,
  LogViewer,
  OfflineBanner,
  PendingSyncNotice,
  RiskIndicator,
  RuntimeUnavailable,
  SensitiveActionSummary,
  StatusOperacional,
  SyncStatus,
  type AcaoSensivel,
  type EstadoOperacional,
  type EstadoSync,
  type NivelDeRisco
} from './Operacionais'

export {
  MaskedCredentialSummary,
  MENSAGEM_BYOK,
  ProviderSetup,
  ProviderValidationStatus,
  RemoveCredentialDialog,
  type CredencialMascarada
} from './Providers'
