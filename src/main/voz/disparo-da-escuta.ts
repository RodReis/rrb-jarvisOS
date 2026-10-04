/**
 * O que acontece quando um gatilho da escuta dispara (SPEC-Escuta-01, critérios 6 e 7).
 *
 * Mora fora do `index.ts` para que a regra mais sensível da fatia tenha contrafactual: com a sessão
 * **bloqueada** a janela não sobe — a lock screen é outra sessão, e subir a janela exporia a
 * conversa a quem passasse. A tela é avisada nos dois casos, porque é ela quem conduz o turno; com
 * a sessão bloqueada ela responde só por voz.
 */

import type { DisparoDaEscuta } from '@shared/domain/voz'
import type { EventoDeEscuta } from './escuta-service'

export interface DepsDoDisparo {
  /** Traz a janela à frente, no Command Center. */
  readonly revelarJanela: () => void
  readonly avisarTela: (disparo: DisparoDaEscuta) => void
}

export function criarAoDispararDaEscuta(deps: DepsDoDisparo): (evento: EventoDeEscuta) => void {
  return ({ gatilho, sessaoBloqueada, fimDoGatilhoMs }) => {
    if (!sessaoBloqueada) {
      try {
        deps.revelarJanela()
      } catch {
        // Janela destruída ou fechando: o turno ainda pode seguir pela voz, e o aviso abaixo não
        // pode depender de a janela ter subido.
      }
    }
    // A confiança do detector fica no main; o timestamp serve só à medição de latência.
    deps.avisarTela({
      gatilho,
      sessaoBloqueada,
      ...(fimDoGatilhoMs === undefined ? {} : { fimDoGatilhoMs })
    })
  }
}
