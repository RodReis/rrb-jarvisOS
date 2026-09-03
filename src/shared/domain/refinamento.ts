/**
 * O refinamento por perguntas geradas (SPEC-Jornada-02, § Refinamento).
 *
 * A pergunta que este arquivo responde: **o que a geração de perguntas devolve, quando ela
 * devolve algo diferente de uma lista de perguntas?**
 *
 * A mecânica de responder — contradição, delegação, retomada — é 100% a do `wizard.ts` da
 * M8-F03: nenhuma daquelas funções depende do catálogo ser estático, e refazê-las aqui
 * duplicaria uma máquina que já existe e já tem suíte própria. O que muda é só **de onde o
 * catálogo vem**: lá é código versionado; aqui é gerado por projeto e persistido assim que sai
 * do modelo.
 */

import type { PerguntaGerada } from './pergunta-gerada'

/** Por que a geração de perguntas não produziu nada novo. Fechado, mesma postura de `brief.ts`. */
export const RESULTADOS_DA_GERACAO_DE_PERGUNTAS = [
  'geradas',
  'nada-a-perguntar',
  'bloqueado-sem-rota',
  'saida-invalida',
  'sem-prompt'
] as const

export type ResultadoDaGeracaoDePerguntas = (typeof RESULTADOS_DA_GERACAO_DE_PERGUNTAS)[number]

export interface GeracaoDePerguntasOutcome {
  readonly resultado: ResultadoDaGeracaoDePerguntas
  readonly perguntas?: readonly PerguntaGerada[]
  readonly mensagem: string
  readonly acao?: string
  readonly problemas?: readonly string[]
}
