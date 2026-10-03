/**
 * O retrabalho do Squad (SPEC-Squads-04, ADR-006 decisão 10): quando TESTE ou REVIEWER reprova, o
 * trabalho volta ao DEVELOPER — dentro do limite da M9-F04, contado **por run** (decisão do PI de
 * 2026-10-03), e só com o que é novo.
 *
 * O limite não é reimplementado aqui: é `proximaTentativaPermitida`, a fonte única da M9-F04.
 */

import { proximaTentativaPermitida, type ClassificacaoDeFalha } from './attempt'
import {
  bloqueia,
  type AchadoRegistrado,
  type CategoriaDeAchado,
  type Severidade
} from './squad-achado'

export interface ReprovaDaEtapa {
  readonly origem: 'teste' | 'revisao'
  /** Só a suíte tem classificação; a causa externa não é culpa do que o escritor escreveu. */
  readonly classificacao?: ClassificacaoDeFalha
}

export type DecisaoDoRetrabalho =
  | { readonly tipo: 'voltar'; readonly proximaTentativa: number }
  | {
      readonly tipo: 'parar'
      readonly motivo: 'tentativas-esgotadas' | 'falha-externa' | 'tentativa-invalida'
    }

/**
 * `tentativaAtual` é a tentativa do DEVELOPER que acabou de ser reprovada (1 é a inicial). Esgotado
 * o limite a issue para com motivo para o PI; não existe "aceitar mesmo assim" (regra 1).
 */
export function decidirRetrabalho(
  tentativaAtual: number,
  reprova: ReprovaDaEtapa
): DecisaoDoRetrabalho {
  if (!Number.isInteger(tentativaAtual) || tentativaAtual < 1) {
    return { tipo: 'parar', motivo: 'tentativa-invalida' }
  }
  if (reprova.classificacao === 'externo') return { tipo: 'parar', motivo: 'falha-externa' }
  if (!proximaTentativaPermitida(tentativaAtual)) {
    return { tipo: 'parar', motivo: 'tentativas-esgotadas' }
  }
  return { tipo: 'voltar', proximaTentativa: tentativaAtual + 1 }
}

export interface CorrecaoParaOEscritor {
  readonly assinatura: string
  readonly severidade: Severidade
  readonly categoria: CategoriaDeAchado
  readonly arquivo: string
  readonly trecho: string
  readonly impacto: string
  readonly correcao: string
}

const ORDEM: Readonly<Record<Severidade, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/**
 * Os achados **aceitos**, deduplicados por assinatura e do mais grave ao menos grave. É a única
 * entrada de correção do DEVELOPER (regra 5): nada de quem achou, nem do debate entre revisores.
 */
export function correcoesParaOEscritor(
  achados: readonly AchadoRegistrado[]
): readonly CorrecaoParaOEscritor[] {
  const vistas = new Set<string>()
  const correcoes: CorrecaoParaOEscritor[] = []
  for (const a of achados) {
    if (a.estado !== 'accepted' || !bloqueia(a.severidade) || vistas.has(a.assinatura)) continue
    vistas.add(a.assinatura)
    correcoes.push({
      assinatura: a.assinatura,
      severidade: a.severidade,
      categoria: a.categoria,
      arquivo: a.arquivo,
      trecho: a.trecho,
      impacto: a.impacto,
      correcao: a.correcao
    })
  }
  return correcoes.sort((x, y) => ORDEM[x.severidade] - ORDEM[y.severidade])
}
