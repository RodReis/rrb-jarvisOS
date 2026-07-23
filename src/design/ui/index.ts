/**
 * Camada `ui` do design system (SPEC-DesignSystem-01, 03a e 03b).
 *
 * Componentes de base, sem conhecimento de domínio. Depende de `tokens` + Radix + Lucide;
 * **nada** acima dela (patterns) nem fora do DS (produto, Supabase, Electron main).
 *
 * Este barril é a **superfície pública da camada**: quem consome importa daqui, e é o que
 * mantém o Radix encapsulado — reexportar um primitivo aqui anularia o encapsulamento.
 */

export { ALTURA_CONTROLE } from './base'
export { type TomSemantico } from './semantica'

// Ações (PRD §11.1)
export { Button } from './Button'
export { IconButton } from './IconButton'
export { ButtonGroup } from './ButtonGroup'
export { Link } from './Link'

// Formulários (PRD §11.2)
export { Field, FormMessage, type AtributosDoControle } from './Field'
export { Input, PasswordInput, Textarea } from './Input'
export { Select, type OpcaoSelect } from './Select'
export { Combobox } from './Combobox'
export { Checkbox, RadioGroup, Slider, type OpcaoRadio } from './Controles'
export { Alternador } from './Alternador'

// Exibição de dados (PRD §11.4) — F03b
export { Card, Panel, Badge, Tag, Separator } from './Superficies'
export { Avatar } from './Avatar'
export { Progress, Meter, Spinner, Skeleton } from './Indicadores'
export {
  Table,
  Tree,
  Tooltip,
  TooltipProvider,
  EmptyState,
  type Coluna,
  type NoArvore
} from './Dados'

// Overlays (PRD §11.5) — F03b
export { Dialog, AlertDialog, Popover, DropdownMenu, Drawer, type ItemMenu } from './Overlays'

// Feedback (PRD §11.5) — F03b
export { InlineAlert, ErrorState, LoadingState } from './Feedback'

// Toast (README §5) — F03b
export { ToastProvider } from './toast/ToastProvider'
export { useToast, type Toast, type EntradaToast, type TomToast } from './toast/useToast'

// Notificações (PRD §12.6) — F03b
export {
  NotificationCenter,
  NotificationItem,
  UnreadIndicator,
  type Notificacao
} from './Notificacoes'
