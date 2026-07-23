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
