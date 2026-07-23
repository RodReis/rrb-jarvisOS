/**
 * Camada `ui` do design system (SPEC-DesignSystem-01).
 *
 * Componentes de base, sem conhecimento de domínio. Depende de `tokens` + Radix + Lucide;
 * **nada** acima dela (patterns) nem fora do DS (produto, Supabase, Electron main).
 *
 * Este barril é a **superfície pública da camada**: quem consome importa daqui, e é o que
 * mantém o Radix encapsulado — reexportar o primitivo aqui anularia o encapsulamento.
 */

export { Alternador } from './Alternador'
