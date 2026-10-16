import type { PublishOutcome } from './release-publisher'
import type {
  CancelOutcome,
  PromotionOutcome,
  RecoveryOutcome,
  RollbackOutcome
} from './release-promotion-service'

/**
 * Código de saída do comando `release:promote` (SPEC-Release-04 e 05): 0 = fez o que foi pedido,
 * 5 = aguarda a lane, o lease de outro executor ou o provedor e basta repetir, 3 = falhou ou exige
 * ação do operador (a evidência diz qual). Uso inválido (2) nasce no parser, antes de qualquer efeito.
 */

export type DesfechoDoComando =
  | { readonly evento: 'merge' | 'resume'; readonly resultado: PromotionOutcome }
  | { readonly evento: 'cancel'; readonly resultado: CancelOutcome }
  | { readonly evento: 'rollback'; readonly resultado: RollbackOutcome }
  | { readonly evento: 'recover'; readonly resultado: RecoveryOutcome }
  | { readonly evento: 'publish'; readonly resultado: PublishOutcome }
  | {
      readonly evento: 'verify'
      readonly resultado: { readonly ok: boolean; readonly problems: readonly string[] }
    }

export const CODIGO_OK = 0
export const CODIGO_FALHOU = 3
export const CODIGO_AGUARDA = 5

export function codigoDeSaida(desfecho: DesfechoDoComando): number {
  switch (desfecho.evento) {
    case 'merge':
    case 'resume':
      if (desfecho.resultado.state === 'completed') return CODIGO_OK
      return desfecho.resultado.state === 'waiting' ? CODIGO_AGUARDA : CODIGO_FALHOU
    case 'cancel':
      if (desfecho.resultado.state === 'cancelled') return CODIGO_OK
      return desfecho.resultado.state === 'requested' ? CODIGO_AGUARDA : CODIGO_FALHOU
    case 'rollback':
      if (desfecho.resultado.state === 'rolled-back') return CODIGO_OK
      return desfecho.resultado.state === 'waiting' ? CODIGO_AGUARDA : CODIGO_FALHOU
    case 'recover':
      return desfecho.resultado.state === 'paused' ? CODIGO_FALHOU : CODIGO_OK
    case 'publish':
      if (desfecho.resultado.state === 'published') return CODIGO_OK
      return desfecho.resultado.state === 'pending' ? CODIGO_AGUARDA : CODIGO_FALHOU
    case 'verify':
      return desfecho.resultado.ok ? CODIGO_OK : CODIGO_FALHOU
  }
}
