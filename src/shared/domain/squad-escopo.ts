/**
 * A prova de escopo de um escritor (SPEC-Squads-03, critério 2): cada escritor só altera o próprio
 * worktree, **e dentro do write set que o plano declarou**.
 *
 * O diff do worktree é o fato; o write set é o combinado. Aqui se decide se o fato cabe no
 * combinado — função pura, sobre listas de caminhos que o kernel já leu do Git. O agente não tem
 * voto: um arquivo fora do write set, um link simbólico ou um nome que o kernel não commita
 * reprova o escritor inteiro, e nada é commitado (fail closed).
 *
 * Um caminho cai na **primeira** categoria que o pega, nesta ordem: link simbólico, nome
 * inválido, fora do escopo. Assim cada caminho é contado uma vez, e a auditoria soma o que há.
 */

import { caminhoDentroDoEscopo, type PathsPermitidos } from './preflight'
import { normalizar } from './squad-plano'

export interface AlteracoesParaProva {
  /** Tudo que difere da base: modificado, criado ou removido. */
  readonly caminhos: readonly string[]
  /** Os caminhos que são link simbólico. */
  readonly simbolicos: readonly string[]
}

export interface VeredictoDoEscopo {
  readonly ok: boolean
  /** Os caminhos que o kernel pode commitar. */
  readonly dentro: readonly string[]
  /** Fora do write set. */
  readonly fugas: readonly string[]
  readonly simbolicos: readonly string[]
  /** Nome que o kernel nunca commita: segredo, reservado do Windows, diretório, começo em `-`. */
  readonly invalidos: readonly string[]
}

/**
 * `.gitattributes` e `.gitmodules` mudam como o próprio Git lê o repositório (filtros, submódulos):
 * não são trabalho do escritor, em pasta nenhuma.
 */
const ARQUIVOS_QUE_CONFIGURAM_O_GIT = /(^|\/)\.git(attributes|modules)$/i

/**
 * O nome que o kernel aceita é o que o validador do plano aceitaria: `normalizar` devolve o
 * mesmo caminho. Qualquer diferença — barra no fim, `.env`, `NUL.ts`, segmento terminado em ponto —
 * é nome que não entra no repositório por esta via. O `-` inicial casaria o gate destrutivo do
 * terminal, e o `commitar` do kernel o recusa de qualquer modo.
 */
function nomeInvalido(caminho: string): boolean {
  return (
    caminho.startsWith('-') ||
    normalizar(caminho) !== caminho ||
    ARQUIVOS_QUE_CONFIGURAM_O_GIT.test(caminho)
  )
}

export function avaliarEscopoDoEscritor(
  alteracoes: AlteracoesParaProva,
  escopo: PathsPermitidos | undefined
): VeredictoDoEscopo {
  const simbolicos = alteracoes.caminhos.filter((c) => alteracoes.simbolicos.includes(c))
  const resto = alteracoes.caminhos.filter((c) => !alteracoes.simbolicos.includes(c))
  const invalidos = resto.filter(nomeInvalido)
  const validos = resto.filter((c) => !nomeInvalido(c))

  // Sem escopo declarado não há "tudo permitido": é ausência de decisão, e o diff inteiro é fuga.
  // Lista vazia, vazia de nome ou com glob cai no mesmo lugar sem checagem à parte: nenhum segmento
  // casa, então todo caminho vira fuga.
  if (escopo === undefined) {
    return { ok: false, dentro: [], fugas: validos, simbolicos, invalidos }
  }
  const dentro = validos.filter((c) => caminhoDentroDoEscopo(c, escopo))
  const fugas = validos.filter((c) => !caminhoDentroDoEscopo(c, escopo))
  return {
    ok: fugas.length === 0 && simbolicos.length === 0 && invalidos.length === 0,
    dentro,
    fugas,
    simbolicos,
    invalidos
  }
}
