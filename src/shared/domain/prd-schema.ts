/**
 * O contrato de saída do modelo para os três documentos (SPEC-Jornada-03, § Geração).
 *
 * Mesma resposta que `brief-schema.ts` deu para a fatia anterior, pela mesma razão: com prosa,
 * "toda afirmação carrega origem" viraria promessa que alguém teria de ler e julgar. Com JSON
 * por afirmação, a origem é um campo, e um campo ou está lá ou não está.
 *
 * O que muda aqui, e por quê:
 *
 *  - **Três instruções de sistema, não uma.** Termo de pesquisa, documentos e contradições são
 *    tarefas diferentes com formatos de saída diferentes; fundi-las faria uma instrução ensinar
 *    três esquemas, e o modelo escolheria um por conta própria — o mesmo motivo que separou
 *    `SISTEMA_DAS_PERGUNTAS` de `SISTEMA_DO_BRIEF`.
 *  - **O prompt enumera as fontes extraídas com as URLs.** É o que permite ao modelo usar
 *    origem `evidencia` e citar URL que existe: sem a lista no pedido, toda síntese sobre o
 *    mercado citaria endereço inventado, e o validador recusaria a saída inteira por um
 *    problema que o pedido causou.
 *  - **O parser não conserta.** Forma errada é saída inválida; um parser tolerante que
 *    completasse origem ausente inventaria a procedência que o critério 1 exige.
 */

import { IDIOMA_DA_SAIDA } from './idioma-da-geracao'
import type { DocumentoDoPacote } from './pacote-estrutural'
import type { AfirmacaoDoPrd, ContradicaoDoPrd } from './prd'
import {
  ETAPA_DA_CONTRADICAO,
  ORIGENS_POR_DOCUMENTO,
  SECOES_DO_PRD,
  isDocumentoDoPrd,
  isOrigemDoPrd
} from './prd'

/**
 * A instrução de sistema do **termo de pesquisa** (critério 3, decisão 2 do PI).
 *
 * Existe porque o campo livre vazio da M8-F04 foi descartado: o PI editava um termo que ninguém
 * propôs, a partir de um brief que ele acabou de aceitar. O modelo propõe; o PI edita e
 * confirma; a pesquisa só roda depois disso.
 *
 * Saída de **uma linha**, e não JSON: é um valor único que vai direto para um campo de texto, e
 * embrulhá-lo num objeto só criaria uma forma a mais para o parser errar.
 */
export const SISTEMA_DO_TERMO = [
  'Você recebe o brief de um projeto e propõe UM termo de busca de mercado.',
  IDIOMA_DA_SAIDA,
  '',
  'Responda com o termo e nada mais: sem aspas, sem explicação, sem pontuação final.',
  '',
  'O termo serve para encontrar alternativas, concorrentes e o cenário em que este projeto',
  'existe. Escreva-o como alguém pesquisaria de fato: 3 a 8 palavras, sem operadores de busca.',
  '',
  'Não inclua o nome do projeto — ele ainda não existe no mercado, e buscar por ele devolve',
  'nada. Busque a categoria, o problema e o público.'
].join('\n')

/** O pedido do termo: o brief inteiro, em texto, para o modelo achar a categoria. */
export function promptDoTermo(afirmacoesDoBrief: readonly string[]): string {
  return [
    'BRIEF DO PROJETO:',
    '',
    ...afirmacoesDoBrief.map((a) => `- ${a}`),
    '',
    'Proponha o termo de busca de mercado.'
  ].join('\n')
}

/**
 * A instrução de sistema da geração dos três documentos.
 *
 * **Enumera seções e origens a partir das constantes**, nunca de listas escritas à mão aqui: uma
 * seção nova entraria no prompt sozinha, e uma segunda lista divergiria no dia em que alguém
 * mexesse só numa delas — mesma disciplina de `SISTEMA_DO_BRIEF` com `BLOCOS_DO_BRIEF`.
 *
 * As proibições são ditas **antes** de o modelo escrever, e não só verificadas depois: cada
 * saída recusada custa uma chamada, e o validador continua sendo a garantia — o prompt é a
 * economia.
 */
export const SISTEMA_DO_PRD = [
  'Você recebe o brief aceito de um projeto e produz três documentos estruturados: PRD,',
  IDIOMA_DA_SAIDA,
  'LANDSCAPE e CONVENTION.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"afirmacoes":[{"id":"a-1","documento":"PRD|LANDSCAPE|CONVENTION","secao":"<seção>",',
  '  "texto":"<uma frase>","origem":"brief|decisao|evidencia|proposto",',
  '  "referencia":"<id da afirmação do brief ou da decisão>",',
  '  "fontes":["<url extraída>"]}]}',
  '',
  ...DOCUMENTOS_E_SECOES(),
  '',
  'Regras de origem, e elas são o ponto dos documentos:',
  '- "brief": o brief aceito afirma isso. Exige "referencia" com o ID da afirmação do brief.',
  '  O ID tem de ser um dos listados no pedido — inventar um ID reprova a saída inteira.',
  '- "decisao": veio de uma escolha registrada. Exige "referencia" com o id da decisão.',
  '- "evidencia": você sintetizou a partir das fontes extraídas listadas no pedido. Exige',
  '  "fontes" com as URLs **exatamente como aparecem na lista**. Nunca cite URL fora dela.',
  '- "proposto": você inferiu. É o que o dono do projeto vai revisar item a item.',
  '',
  'O LANDSCAPE fala de terceiros: toda afirmação sobre concorrente, alternativa ou mercado usa',
  'origem "evidencia" e cita as fontes. Conclusão sua sem fonte só entra como "proposto", e',
  'escrita como hipótese ("é possível que...", "indício de..."), nunca como fato.',
  '',
  'A CONVENTION descreve as entidades, os estados, as invariantes e o vocabulário **deste**',
  'projeto. Nunca traga processo, labels, papéis ou fluxo de trabalho de outro projeto.',
  '',
  'Nunca proponha por conta própria requisito legal, regulatório, de consentimento, aceite',
  'duplo, termos de uso, política de privacidade, tratamento de dados pessoais ou sensíveis,',
  'compliance ou classificação jurídica de domínio. Se o brief não disse, isso não entra —',
  'nem como "proposto".'
].join('\n')

/** As seções válidas por documento, derivadas de `SECOES_DO_PRD`. Fonte única da lista. */
function DOCUMENTOS_E_SECOES(): readonly string[] {
  return [
    'Seções válidas por documento:',
    ...Object.entries(SECOES_DO_PRD).map(([doc, secoes]) => `- ${doc}: ${secoes.join(', ')}.`),
    '',
    'Origens admitidas por documento:',
    ...Object.entries(ORIGENS_POR_DOCUMENTO).map(([doc, o]) => `- ${doc}: ${o.join(', ')}.`)
  ]
}

/** Uma fonte extraída, como o pedido a apresenta ao modelo. */
export interface FonteParaOModelo {
  readonly url: string
  readonly titulo: string
  readonly trecho: string
}

/**
 * O pedido de geração: o brief com os ids, as decisões, as fontes extraídas e a correção.
 *
 * **As âncoras entram com o id.** É o que torna a origem `brief` verificável: o validador exige
 * que `referencia` exista na revisão aceita, e o modelo só consegue preenchê-la se souber quais
 * ids citar. Sem os ids no pedido, todo requisito viraria `proposto` — e a distinção entre "o
 * brief disse" e "a IA inferiu" desapareceria justo onde ela mais importa.
 */
export function promptDoPrd(entrada: {
  readonly afirmacoesDoBrief: readonly { readonly id: string; readonly texto: string }[]
  readonly decisoes?: readonly {
    readonly id: string
    readonly pergunta: string
    readonly resposta: string
  }[]
  readonly fontes?: readonly FonteParaOModelo[]
  readonly landscapeBloqueado?: boolean
  readonly correcao?: readonly string[]
}): string {
  const partes: string[] = [
    'BRIEF ACEITO (cite estes IDs em "referencia" quando a origem for "brief"):',
    '',
    ...entrada.afirmacoesDoBrief.map((a) => `- [${a.id}] ${a.texto}`)
  ]

  if (entrada.decisoes !== undefined && entrada.decisoes.length > 0) {
    partes.push(
      '',
      'DECISÕES DO REFINAMENTO (origem "decisao", cite o id em "referencia"):',
      ...entrada.decisoes.map((d) => `- [${d.id}] ${d.pergunta} → ${d.resposta}`)
    )
  }

  if (entrada.fontes !== undefined && entrada.fontes.length > 0) {
    partes.push(
      '',
      'FONTES EXTRAÍDAS (origem "evidencia" — use estas URLs exatas em "fontes"):',
      ...entrada.fontes.map((f) => `- ${f.url} — ${f.titulo}\n  "${f.trecho}"`)
    )
  }

  // Sem pesquisa, o Landscape **declara** a lacuna em vez de ficar vazio: um documento vazio
  // parece esquecimento, e um que diz o que falta é o bloqueio visível que o critério 4 pede.
  if (entrada.landscapeBloqueado === true) {
    partes.push(
      '',
      'A PESQUISA DE MERCADO NÃO PÔDE SER FEITA. Não invente cenário: o LANDSCAPE recebe apenas',
      'as incertezas e os gatilhos de revisão que decorrem do próprio brief, como "proposto".'
    )
  }

  if (entrada.correcao !== undefined && entrada.correcao.length > 0) {
    partes.push(
      '',
      'A saída anterior foi recusada pelo validador. Corrija exatamente estes pontos:',
      ...entrada.correcao.map((c) => `- ${c}`)
    )
  }

  return partes.join('\n')
}

/**
 * A instrução de sistema da detecção de **contradições** (critério 6).
 *
 * Separada porque a tarefa é oposta à da geração: ali o modelo afirma; aqui ele procura onde
 * duas afirmações não podem ser verdadeiras ao mesmo tempo. E o formato de saída carrega a
 * **pergunta e a recomendação**, nunca a correção — corrigir em silêncio escolheria pelo PI, e é
 * exatamente o que o critério 6 proíbe.
 */
export const SISTEMA_DAS_CONTRADICOES = [
  'Você recebe as afirmações de três documentos e do brief que os originou, e procura',
  IDIOMA_DA_SAIDA,
  'contradições: pares de afirmações que não podem ser verdadeiras ao mesmo tempo.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Cada contradição é uma **pergunta** para o dono do projeto decidir. Formato:',
  '{"contradicoes":[{"id":"c-1","afirmacoes":["<id>","<id>"],',
  '  "titulo":"<curto>","enunciado":"<a pergunta que o dono do projeto precisa responder>",',
  '  "opcoes":[{"id":"a","rotulo":"<opção>","impacto":"<o trade-off desta opção>"}],',
  '  "recomendada":"<id de uma das opções>","justificativa":"<por que esta é a recomendada>",',
  '  "aceitaTextoLivre":true|false,"delegavel":true|false}]}',
  '',
  'Regras da pergunta, e elas não são estilo — são contrato:',
  '- Entre 2 e 3 opções, mutuamente excludentes. Cada opção é um dos lados da contradição, ou',
  '  uma terceira saída concreta. Uma opção não é escolha; quatro viram formulário.',
  '- Toda opção declara "impacto": o trade-off dela. Sem isso o dono do projeto escolhe no escuro.',
  '- "recomendada" tem de ser o id de uma das opções que você ofereceu.',
  '- "delegavel": false quando a decisão for cara de reverter. Só delegue o que é seguro delegar.',
  '',
  'Não corrija nada. Não escolha por conta própria. Sua saída é a pergunta e a recomendação;',
  'quem decide é o dono do projeto.',
  '',
  'Diferença de ênfase, de detalhe ou de vocabulário não é contradição. Só reporte quando',
  'aceitar as duas afirmações tornaria o projeto impossível de construir de um jeito só.',
  '',
  'Nunca invente requisito legal, regulatório, de consentimento, aceite duplo, termos de uso,',
  'política de privacidade, dados pessoais ou sensíveis, compliance ou classificação jurídica.',
  '',
  'Se não houver contradição, devolva {"contradicoes":[]}.'
].join('\n')

/** O pedido de detecção: todas as afirmações com os ids, para o modelo poder citá-las. */
export function promptDasContradicoes(
  afirmacoes: readonly { readonly id: string; readonly texto: string }[]
): string {
  return [
    'AFIRMAÇÕES:',
    '',
    ...afirmacoes.map((a) => `- [${a.id}] ${a.texto}`),
    '',
    'Liste as contradições, ou devolva a lista vazia.'
  ].join('\n')
}

/** Remove a cerca de código que modelos produzem por hábito. Ver `lerSaidaDoModelo`. */
function semCerca(bruto: string): string {
  return bruto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

function parseObjeto(bruto: string): Record<string, unknown> | undefined {
  let json: unknown
  try {
    json = JSON.parse(semCerca(bruto))
  } catch {
    return undefined
  }

  return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : undefined
}

function afirmacaoValida(v: unknown): v is AfirmacaoDoPrd {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>

  const fontes = a['fontes']

  return (
    typeof a['id'] === 'string' &&
    typeof a['texto'] === 'string' &&
    typeof a['secao'] === 'string' &&
    isDocumentoDoPrd(a['documento']) &&
    isOrigemDoPrd(a['origem']) &&
    (a['referencia'] === undefined || typeof a['referencia'] === 'string') &&
    (fontes === undefined || (Array.isArray(fontes) && fontes.every((f) => typeof f === 'string')))
  )
}

/**
 * Lê a saída dos documentos. **Não conserta nada** — devolve `undefined` quando a forma não
 * confere, e o serviço decide o que fazer com isso.
 *
 * Uma entrada malformada invalida a saída inteira, em vez de ser descartada em silêncio: os
 * documentos precisam ser o que o modelo produziu, não o que sobrou depois de um filtro.
 */
export function lerDocumentosDoModelo(bruto: string): readonly AfirmacaoDoPrd[] | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const afirmacoes = raiz['afirmacoes']
  if (!Array.isArray(afirmacoes)) return undefined
  if (!afirmacoes.every(afirmacaoValida)) return undefined

  return afirmacoes
}

function opcaoValida(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o['id'] === 'string' &&
    typeof o['rotulo'] === 'string' &&
    typeof o['impacto'] === 'string'
  )
}

/** A forma que o modelo devolve: a pergunta da M8-F03 mais as afirmações — sem `etapa`. */
function contradicaoValida(v: unknown): v is Omit<ContradicaoDoPrd, 'etapa'> {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  const afirmacoes = c['afirmacoes']

  return (
    typeof c['id'] === 'string' &&
    Array.isArray(afirmacoes) &&
    afirmacoes.every((a) => typeof a === 'string') &&
    typeof c['titulo'] === 'string' &&
    typeof c['enunciado'] === 'string' &&
    Array.isArray(c['opcoes']) &&
    c['opcoes'].every(opcaoValida) &&
    typeof c['recomendada'] === 'string' &&
    typeof c['justificativa'] === 'string' &&
    typeof c['aceitaTextoLivre'] === 'boolean' &&
    typeof c['delegavel'] === 'boolean'
  )
}

/**
 * Lê as contradições como perguntas (emenda E1). **Forma, não contrato**: o número de opções, a
 * recomendada existir e a invariante 9 são do validador (`validarContratoDaPergunta`), que o
 * serviço roda antes de gravar — mesma divisão do refinamento.
 */
export function lerContradicoesDoModelo(bruto: string): readonly ContradicaoDoPrd[] | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const contradicoes = raiz['contradicoes']
  if (!Array.isArray(contradicoes)) return undefined
  if (!contradicoes.every(contradicaoValida)) return undefined

  return contradicoes.map((c) => ({ ...c, etapa: ETAPA_DA_CONTRADICAO }))
}

/**
 * Lê o termo de pesquisa proposto.
 *
 * A saída é uma linha; o que chega com aspas, cerca ou várias linhas é normalizado para a
 * primeira linha não vazia. Aqui **normalizar é diferente de consertar**: o termo vai para um
 * campo que o PI edita antes de confirmar, então uma proposta imperfeita custa uma edição, não
 * uma afirmação sem origem.
 */
export function lerTermoDoModelo(bruto: string): string | undefined {
  const linha = semCerca(bruto)
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^["'`]|["'`]$/g, '')
        .trim()
    )
    .find((l) => l.length > 0)

  return linha === undefined || linha.length === 0 ? undefined : linha
}

/** Os documentos que a saída cobriu — o que a tela usa para saber o que ficou vazio. */
export function documentosCobertos(
  afirmacoes: readonly AfirmacaoDoPrd[]
): readonly DocumentoDoPacote[] {
  return [...new Set(afirmacoes.map((a) => a.documento))]
}
