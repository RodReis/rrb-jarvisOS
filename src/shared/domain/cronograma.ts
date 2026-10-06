import type { PolicyDecision } from '../policies'

export type GatilhoDoCronograma =
  | { readonly tipo: 'evento'; readonly evento: 'boas-vindas' }
  | { readonly tipo: 'horario'; readonly dias: readonly number[]; readonly minuto: number }

export type AtividadeDoCronograma =
  | { readonly id: string; readonly tipo: 'falar' }
  | {
      readonly id: string
      readonly tipo: 'tocar-midia-local'
      readonly midia: { readonly tipo: 'arquivo' | 'pasta'; readonly caminho: string }
    }

export interface SequenciaDoCronograma {
  readonly id: string
  readonly nome: string
  readonly ativa: boolean
  readonly gatilho: GatilhoDoCronograma
  readonly atividades: readonly AtividadeDoCronograma[]
}

export interface ConfiguracaoDoCronograma {
  readonly versao: 1
  readonly ativa: boolean
  readonly sequencias: readonly SequenciaDoCronograma[]
}

export interface ResultadoDoCronograma {
  readonly id: string
  readonly sequenciaId: string
  readonly nome: string
  readonly iniciadoEm: string
  readonly gatilho: GatilhoDoCronograma['tipo']
  readonly atividades: readonly {
    readonly id: string
    readonly tipo: AtividadeDoCronograma['tipo']
    readonly estado: 'executada' | 'nao-executada'
    readonly motivo?: string
  }[]
}

export interface RecusaDoCronograma {
  readonly atividadeId: string
  readonly tipo: string
  readonly decisao: PolicyDecision
}
