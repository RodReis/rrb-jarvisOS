/** Contrato da chegada. A fonte de mídia é escolhida pelo main, nunca por texto livre do renderer. */
export interface ConfiguracaoDasBoasVindas {
  readonly ativa: boolean
  readonly janelaInicio: number
  readonly janelaFim: number
  readonly tetoDaPersonaMs: number
  readonly frases: {
    readonly manha: string
    readonly tarde: string
    readonly noite: string
  }
  readonly midiaAtiva: boolean
  readonly midia: { readonly tipo: 'arquivo' | 'pasta'; readonly caminho: string } | null
}

export interface EstadoDasBoasVindas {
  readonly ultimoDiaDesbloqueado?: string
  readonly ultimoDesbloqueioMs?: number
  readonly ultimoPeriodoSaudado?: string
}

export interface EventoBoasVindas {
  readonly tipo: 'boas-vindas'
  readonly hora: string
  readonly ausenciaMs: number | null
}

export type ReproducaoDasBoasVindas =
  | { readonly id: string; readonly acao: 'fala'; readonly texto: string }
  | {
      readonly id: string
      readonly acao: 'midia'
      readonly dados: Uint8Array
      readonly tipo: string
    }
