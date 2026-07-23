/**
 * Camada `ui` do design system (SPEC-DesignSystem-01 e 03a).
 *
 * Componentes de base, sem conhecimento de domínio. Depende de `tokens` + Radix + Lucide;
 * **nada** acima dela (patterns) nem fora do DS (produto, Supabase, Electron main).
 *
 * Este barril é a **superfície pública da camada**: quem consome importa daqui, e é o que
 * mantém o Radix encapsulado — reexportar um primitivo aqui anularia o encapsulamento.
 */

export { ALTURA_CONTROLE } from './base'

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
