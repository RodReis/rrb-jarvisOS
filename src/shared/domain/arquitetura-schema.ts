/**
 * O contrato de saída do modelo para os quatro documentos de arquitetura (SPEC-Jornada-04).
 *
 * Mesma resposta que `prd-schema.ts` deu para a fatia anterior, pela mesma razão: com prosa,
 * "todo módulo/fluxo carrega origem" viraria promessa que alguém teria de ler e julgar. Com JSON
 * por afirmação, a origem é um campo, e um campo ou está lá ou não está.
 *
 * O que muda aqui, e por quê:
 *
 *  - **Duas instruções de sistema, não uma.** Os documentos e a análise de coerência são tarefas
 *    opostas: uma escreve o que o sistema será, a outra procura onde o desenho e o requisito não
 *    se encontram. Fundi-las faria uma instrução ensinar dois esquemas — o mesmo motivo que
 *    separou `SISTEMA_DAS_CONTRADICOES` de `SISTEMA_DO_PRD`.
 *  - **O prompt enumera as jornadas com o anexo e o hash.** É o que permite ao modelo usar
 *    origem `prototipo` e citar uma âncora que existe: sem a lista no pedido, todo fluxo citaria
 *    tela inventada, e o validador recusaria a saída inteira por um problema que o pedido causou.
 *  - **O prompt diz quais seções exigem protótipo.** A regra mais dura do validador (critério 2)
 *    é dita antes de o modelo escrever, e não só verificada depois: cada saída recusada custa uma
 *    chamada, e o validador continua sendo a garantia — o prompt é a economia.
 *  - **O parser não conserta.** Forma errada é saída inválida; um parser tolerante que
 *    completasse uma âncora ausente inventaria a procedência que o critério 2 exige.
 */

import type { DocumentoDaArquitetura } from './arquitetura'
import { SECOES_DA_ARQUITETURA } from './arquitetura'
import type { AfirmacaoDaArquitetura, AjusteProposto } from './arquitetura-gerada'
import {
  ORIGENS_POR_DOCUMENTO_DA_ARQUITETURA,
  SECOES_DE_FLUXO,
  isDocumentoDaArquitetura,
  isOrigemDaArquitetura,
  isTipoDeAjuste
} from './arquitetura-gerada'

/** Uma jornada do protótipo, como o pedido a apresenta ao modelo — com a âncora pronta. */
export interface JornadaParaOModelo {
  readonly jornada: string
  readonly anexo: string
  readonly hash: string
}

/** Um requisito do PRD aceito, como o pedido o apresenta. */
export interface RequisitoParaOModelo {
  readonly id: string
  readonly secao: string
  readonly texto: string
}

/**
 * A instrução de sistema da geração dos quatro documentos.
 *
 * **Enumera seções e origens a partir das constantes**, nunca de listas escritas à mão aqui: uma
 * seção nova entraria no prompt sozinha, e uma segunda lista divergiria no dia em que alguém
 * mexesse só numa delas — mesma disciplina de `SISTEMA_DO_PRD` com `SECOES_DO_PRD`.
 */
export const SISTEMA_DA_ARQUITETURA = [
  'Você recebe o PRD aceito de um projeto e os protótipos que o dono desenhou, e produz quatro',
  'documentos estruturados: ARCHITECTURE, DECISIONS, TESTING e REVIEW.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"afirmacoes":[{"id":"a-1","documento":"ARCHITECTURE|DECISIONS|TESTING|REVIEW",',
  '  "secao":"<seção>","texto":"<uma frase>",',
  '  "origem":"prd|prototipo|decisao|proposto",',
  '  "referencia":"<id do requisito do PRD ou da decisão>",',
  '  "ancora":{"anexo":"<caminho do protótipo>","hash":"<hash do protótipo>",',
  '            "jornada":"<a tela, exatamente como listada>"}}]}',
  '',
  ...documentosESecoes(),
  '',
  'Regras de origem, e elas são o ponto dos documentos:',
  '- "prd": o PRD aceito afirma isso. Exige "referencia" com o ID do requisito.',
  '  O ID tem de ser um dos listados no pedido — inventar um ID reprova a saída inteira.',
  '- "prototipo": a tela existe no protótipo anexado. Exige "ancora" com o anexo, o hash e a',
  '  jornada **exatamente como aparecem na lista do pedido**. Nunca cite tela fora dela.',
  '- "decisao": veio de uma escolha registrada no refinamento. Exige "referencia" com o id.',
  '- "proposto": você inferiu. É o que o dono do projeto vai revisar item a item.',
  '',
  ...secoesQueExigemPrototipo(),
  '',
  'O DECISIONS registra as decisões estruturais como ADRs: o contexto, a decisão e a',
  'consequência. As que vieram do refinamento usam origem "decisao"; as que você propõe usam',
  '"proposto" e são escritas como proposta, nunca como decisão já tomada.',
  '',
  'O TESTING descreve a estratégia de evidência deste projeto; o REVIEW, como revisar o código',
  'dele. Nunca traga processo, labels, papéis, ferramentas ou fluxo de trabalho de outro',
  'projeto — descreva só o que decorre do PRD, dos protótipos e das decisões deste.',
  '',
  'Nunca proponha por conta própria requisito legal, regulatório, de consentimento, aceite',
  'duplo, termos de uso, política de privacidade, tratamento de dados pessoais ou sensíveis,',
  'compliance ou classificação jurídica de domínio. Se o PRD não disse, isso não entra —',
  'nem como "proposto".'
].join('\n')

/** As seções válidas por documento, derivadas de `SECOES_DA_ARQUITETURA`. Fonte única. */
function documentosESecoes(): readonly string[] {
  return [
    'Seções válidas por documento:',
    ...Object.entries(SECOES_DA_ARQUITETURA).map(
      ([doc, secoes]) => `- ${doc}: ${secoes.join(', ')}.`
    ),
    '',
    'Origens admitidas por documento:',
    ...Object.entries(ORIGENS_POR_DOCUMENTO_DA_ARQUITETURA).map(
      ([doc, o]) => `- ${doc}: ${o.join(', ')}.`
    )
  ]
}

/**
 * A regra do critério 2, dita ao modelo — derivada de `SECOES_DE_FLUXO`, não repetida à mão.
 *
 * Sem esta parte do prompt, o modelo escreveria fluxos `proposto` com naturalidade e a saída
 * inteira seria recusada por uma regra que ninguém lhe contou.
 */
function secoesQueExigemPrototipo(): readonly string[] {
  const linhas = Object.entries(SECOES_DE_FLUXO).flatMap(([doc, secoes]) =>
    (secoes ?? []).map((secao) => `- ${doc} § ${secao}`)
  )

  return [
    'REGRA MAIS DURA, e ela reprova a saída inteira quando quebrada:',
    'nestas seções toda afirmação usa origem "prototipo" e cita a âncora —',
    ...linhas,
    'Um fluxo que nenhum protótipo desenhou não é descrito, nem como "proposto".',
    'Se a tela não está na lista de jornadas do pedido, ela não existe para você.'
  ]
}

/**
 * O pedido de geração: os requisitos com os ids, as jornadas com as âncoras, as decisões e a
 * correção.
 *
 * **As âncoras entram completas.** É o que torna as origens `prd` e `prototipo` verificáveis: o
 * validador exige que `referencia` exista no PRD aceito e que `ancora` bata com um anexo do gate,
 * e o modelo só consegue preenchê-las se souber o que citar. Sem os ids e os hashes no pedido,
 * todo módulo viraria `proposto` — e a distinção entre "o PRD pediu", "o PI desenhou" e "a IA
 * inferiu" desapareceria justo onde ela mais importa.
 */
export function promptDaArquitetura(entrada: {
  readonly requisitos: readonly RequisitoParaOModelo[]
  readonly jornadas: readonly JornadaParaOModelo[]
  readonly decisoes?: readonly {
    readonly id: string
    readonly pergunta: string
    readonly resposta: string
  }[]
  readonly correcao?: readonly string[]
}): string {
  const partes: string[] = [
    'PRD ACEITO (cite estes IDs em "referencia" quando a origem for "prd"):',
    '',
    ...entrada.requisitos.map((r) => `- [${r.id}] (${r.secao}) ${r.texto}`),
    '',
    'JORNADAS DOS PROTÓTIPOS (origem "prototipo" — use estes valores exatos na "ancora"):',
    ''
  ]

  if (entrada.jornadas.length === 0) {
    // Sem jornada não há fluxo a prometer, e dizê-lo é melhor que deixar a lista vazia: um
    // modelo diante de uma seção sem itens preenche; diante da proibição explícita, não.
    partes.push(
      'Nenhuma. Não descreva fluxo algum: as seções que exigem protótipo ficam sem afirmações.'
    )
  } else {
    partes.push(
      ...entrada.jornadas.map(
        (j) => `- jornada: "${j.jornada}" | anexo: ${j.anexo} | hash: ${j.hash}`
      )
    )
  }

  if (entrada.decisoes !== undefined && entrada.decisoes.length > 0) {
    partes.push(
      '',
      'DECISÕES DO REFINAMENTO (origem "decisao", cite o id em "referencia"):',
      ...entrada.decisoes.map((d) => `- [${d.id}] ${d.pergunta} → ${d.resposta}`)
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
 * A instrução de sistema da **análise de coerência** entre protótipos e PRD (critério 4).
 *
 * Separada porque a tarefa é oposta à da geração: ali o modelo descreve o sistema; aqui ele
 * procura onde o desenho e o requisito não se encontram. E o formato de saída carrega a
 * observação e a recomendação, **nunca a correção** — a spec é explícita em que nada é aplicado
 * ao anexo e que o PI autoriza cada ajuste.
 *
 * É o que devolve, por leitura semântica, o aviso que a M8-F05 perdeu: lá a comparação
 * PRD × protótipo foi desligada porque o PRD composto não tinha telas nomeadas para comparar, e
 * a comparação literal produzia ruído em todo projeto.
 */
export const SISTEMA_DA_COERENCIA = [
  'Você recebe os requisitos de um PRD aceito e as telas dos protótipos desenhados, e procura',
  'onde os dois não se encontram.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"ajustes":[{"id":"j-1","tipo":"tela-sem-requisito|requisito-sem-tela|estado-ausente",',
  '  "jornada":"<a tela, quando o ajuste fala de uma>",',
  '  "requisito":"<id do requisito, quando o ajuste fala de um>",',
  '  "observacao":"<o que não se encontra>",',
  '  "recomendacao":"<o que o dono do projeto pode fazer>"}]}',
  '',
  '- "tela-sem-requisito": o protótipo desenha algo que nenhum requisito pede.',
  '- "requisito-sem-tela": o PRD pede algo que nenhuma tela atende.',
  '- "estado-ausente": a tela existe, mas um estado que o requisito implica não aparece nela',
  '  (vazio, carregando, erro, bloqueio).',
  '',
  'Não corrija nada. Não reescreva o protótipo nem o requisito. Sua saída é a observação e a',
  'recomendação; quem decide é o dono do projeto, e o desenho dele permanece como está.',
  '',
  'Diferença de nome, de ordem ou de vocabulário não é incoerência. Só reporte quando faltar',
  'de fato comportamento de um lado ou do outro.',
  '',
  'Se estiver tudo coerente, devolva {"ajustes":[]}.'
].join('\n')

/** O pedido da análise: os requisitos com os ids e as telas, para o modelo poder citá-los. */
export function promptDaCoerencia(entrada: {
  readonly requisitos: readonly RequisitoParaOModelo[]
  readonly jornadas: readonly JornadaParaOModelo[]
}): string {
  return [
    'REQUISITOS DO PRD:',
    '',
    ...entrada.requisitos.map((r) => `- [${r.id}] (${r.secao}) ${r.texto}`),
    '',
    'TELAS DOS PROTÓTIPOS:',
    '',
    ...(entrada.jornadas.length === 0
      ? ['Nenhuma tela foi desenhada.']
      : entrada.jornadas.map((j) => `- "${j.jornada}" (em ${j.anexo})`)),
    '',
    'Liste os ajustes, ou devolva a lista vazia.'
  ].join('\n')
}

/** Remove a cerca de código que modelos produzem por hábito. Ver `prd-schema.ts`. */
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

function ancoraValida(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>

  return (
    typeof a['anexo'] === 'string' &&
    typeof a['hash'] === 'string' &&
    typeof a['jornada'] === 'string'
  )
}

function afirmacaoValida(v: unknown): v is AfirmacaoDaArquitetura {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  const ancora = a['ancora']

  return (
    typeof a['id'] === 'string' &&
    typeof a['texto'] === 'string' &&
    typeof a['secao'] === 'string' &&
    isDocumentoDaArquitetura(a['documento']) &&
    isOrigemDaArquitetura(a['origem']) &&
    (a['referencia'] === undefined || typeof a['referencia'] === 'string') &&
    (ancora === undefined || ancoraValida(ancora))
  )
}

function ajusteValido(v: unknown): v is AjusteProposto {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>

  return (
    typeof a['id'] === 'string' &&
    isTipoDeAjuste(a['tipo']) &&
    typeof a['observacao'] === 'string' &&
    typeof a['recomendacao'] === 'string' &&
    (a['jornada'] === undefined || typeof a['jornada'] === 'string') &&
    (a['requisito'] === undefined || typeof a['requisito'] === 'string')
  )
}

/**
 * Lê a saída dos documentos. **Não conserta nada** — devolve `undefined` quando a forma não
 * confere, e o serviço decide o que fazer com isso.
 *
 * Uma entrada malformada invalida a saída inteira, em vez de ser descartada em silêncio: os
 * documentos precisam ser o que o modelo produziu, não o que sobrou depois de um filtro.
 */
export function lerArquiteturaDoModelo(
  bruto: string
): readonly AfirmacaoDaArquitetura[] | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const afirmacoes = raiz['afirmacoes']
  if (!Array.isArray(afirmacoes)) return undefined
  if (!afirmacoes.every(afirmacaoValida)) return undefined

  return afirmacoes
}

/**
 * Lê a saída da análise de coerência.
 *
 * Lista vazia é resultado legítimo — "está tudo coerente" —, e por isso ela **não** é confundida
 * com `undefined`: aquele é "a saída não tem forma", e o serviço trata os dois de modo diferente.
 * Sem a distinção, uma análise que não saiu pareceria "nenhum ajuste", e o PI aceitaria o pacote
 * achando que a IA leu os protótipos.
 */
export function lerAjustesDoModelo(bruto: string): readonly AjusteProposto[] | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const ajustes = raiz['ajustes']
  if (!Array.isArray(ajustes)) return undefined
  if (!ajustes.every(ajusteValido)) return undefined

  return ajustes
}

/** Os documentos que a saída cobriu — o que a tela usa para saber o que ficou vazio. */
export function documentosCobertosNaArquitetura(
  afirmacoes: readonly AfirmacaoDaArquitetura[]
): readonly DocumentoDaArquitetura[] {
  return [...new Set(afirmacoes.map((a) => a.documento))]
}
