/**
 * O contrato de saída do modelo para o roadmap e para a SPEC da primeira fatia
 * (SPEC-Jornada-05).
 *
 * Mesma resposta que `prd-schema.ts` e `arquitetura-schema.ts` deram para as fatias anteriores,
 * pela mesma razão: com prosa, *"todo MVP e toda fatia têm origem"* viraria promessa que alguém
 * teria de ler e julgar. Com JSON por item, a origem é um campo, e um campo ou está lá ou não
 * está.
 *
 * O que muda aqui, e por quê:
 *
 *  - **Duas instruções de sistema, não uma.** O roadmap e a SPEC são tarefas de granularidade
 *    oposta: uma recorta o projeto inteiro em entregas, a outra desce ao detalhe executável de
 *    uma delas. E são **momentos** diferentes — a SPEC só existe depois de o PI escolher o MVP
 *    no `MVP_ENTRY`. Fundi-las produziria SPEC para um MVP que talvez não entre na fila.
 *  - **O pedido enumera os ids do PRD e da arquitetura.** É o que permite ao modelo usar as
 *    origens ancoradas e citar uma referência que existe: sem a lista no pedido, todo MVP viraria
 *    `proposto`, e a distinção entre "o PRD pediu" e "a IA inferiu" sumiria justo onde ela decide
 *    o que entra na fila.
 *  - **O pedido diz que o grafo é validado por máquina.** A regra mais dura (§ 2: ciclo ou
 *    dependência ausente reprova antes de gravar) é dita antes de o modelo escrever, e não só
 *    verificada depois: cada saída recusada custa uma chamada, e o validador continua sendo a
 *    garantia — o prompt é a economia.
 *  - **O parser não conserta.** Forma errada é saída inválida; um parser tolerante que
 *    completasse uma referência ausente inventaria a procedência que o critério 2 exige.
 */

import { IDIOMA_DA_SAIDA } from './idioma-da-geracao'
import type {
  FatiaGerada,
  MvpGerado,
  OpcaoDaSpec,
  PerguntaDaSpec,
  SpecGerada
} from './roadmap-gerado'
import {
  MAXIMO_DE_OPCOES_DA_SPEC,
  MINIMO_DE_OPCOES_DA_SPEC,
  ORIGENS_DO_ROADMAP,
  isOrigemDoRoadmap
} from './roadmap-gerado'

/** Uma afirmação de origem, como o pedido a apresenta ao modelo — com o id pronto para citar. */
export interface AfirmacaoParaOModelo {
  readonly id: string
  readonly secao: string
  readonly texto: string
}

/**
 * A instrução de sistema da geração do roadmap.
 *
 * **Enumera as origens a partir da constante**, nunca de uma lista escrita à mão aqui: uma
 * origem nova entraria no prompt sozinha, e uma segunda lista divergiria no dia em que alguém
 * mexesse só numa delas — mesma disciplina de `SISTEMA_DA_ARQUITETURA` com `SECOES_DE_FLUXO`.
 */
export const SISTEMA_DO_ROADMAP = [
  'Você recebe o PRD aceito de um projeto e a arquitetura aprovada dele, e propõe o roadmap:',
  IDIOMA_DA_SAIDA,
  'os MVPs, o que cada um entrega, de quais outros ele depende e quais fatias ele prevê.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"mvps":[{"id":"mvp-1","numero":1,"titulo":"<nome curto>",',
  '  "tese":"<o que este MVP entrega>",',
  '  "resultado":"<o resultado observável quando ele fecha>",',
  '  "dependeDe":["<id de outro MVP desta lista>"],',
  `  "origem":"${ORIGENS_DO_ROADMAP.join('|')}",`,
  '  "referencia":"<id da afirmação do PRD ou da arquitetura>",',
  '  "fatias":[{"id":"f-1","numero":1,"titulo":"<a fatia>",',
  '             "origem":"...","referencia":"..."}]}]}',
  '',
  'Regras de origem, e elas são o ponto do roadmap:',
  '- "prd": o PRD aceito pede isso. Exige "referencia" com o ID da afirmação do PRD.',
  '- "arquitetura": os documentos técnicos aprovados decorrem nisso. Exige "referencia" com o',
  '  ID da afirmação da arquitetura.',
  '- "proposto": você inferiu. **Não** leva "referencia" — inferência não tem fonte a citar.',
  'Todo ID citado tem de ser um dos listados no pedido. Inventar um ID reprova a saída inteira.',
  '',
  'REGRA MAIS DURA, e ela reprova a saída inteira quando quebrada:',
  'as dependências formam um grafo **sem ciclo**, e todo id em "dependeDe" existe nesta mesma',
  'lista de MVPs. O grafo é conferido por um validador determinístico antes de qualquer',
  'gravação — não há como convencê-lo com texto. Um ciclo é um roadmap em que nada pode',
  'começar.',
  '',
  'Cada MVP prevê ao menos uma fatia. As fatias são o checklist do MVP: títulos curtos, na',
  'ordem em que fazem sentido ser executadas. Não escreva a especificação delas aqui — só a',
  'primeira fatia do MVP que o dono escolher receberá especificação, e isso é um passo à parte.',
  '',
  'Nunca traga processo, labels, papéis, ferramentas ou fluxo de trabalho de outro projeto —',
  'descreva só o que decorre do PRD e da arquitetura deste.',
  '',
  'Nunca proponha por conta própria requisito legal, regulatório, de consentimento, aceite',
  'duplo, termos de uso, política de privacidade, tratamento de dados pessoais ou sensíveis,',
  'compliance ou classificação jurídica de domínio. Se o PRD não disse, isso não entra —',
  'nem como "proposto".'
].join('\n')

/**
 * O pedido do roadmap: as afirmações com os ids, e o que já está congelado.
 *
 * **`congelados` é o critério 6 tomando forma de pedido** (decisão do PI de 2026-09-03): o MVP
 * que já entrou na fila é apresentado como decidido, e o modelo propõe em volta dele. Sem isso, a
 * regeneração produziria um roadmap que ignora o que o PI já aceitou — e casar os dois depois
 * dependeria de o modelo repetir o mesmo título, que é justamente o que não se pode exigir.
 */
export function promptDoRoadmap(entrada: {
  readonly requisitos: readonly AfirmacaoParaOModelo[]
  readonly arquitetura: readonly AfirmacaoParaOModelo[]
  readonly congelados?: readonly { readonly id: string; readonly titulo: string }[]
  readonly correcao?: readonly string[]
}): string {
  const partes: string[] = [
    'PRD ACEITO (cite estes IDs em "referencia" quando a origem for "prd"):',
    '',
    ...entrada.requisitos.map((r) => `- [${r.id}] (${r.secao}) ${r.texto}`),
    '',
    'ARQUITETURA APROVADA (cite estes IDs quando a origem for "arquitetura"):',
    '',
    ...entrada.arquitetura.map((a) => `- [${a.id}] (${a.secao}) ${a.texto}`)
  ]

  if (entrada.congelados !== undefined && entrada.congelados.length > 0) {
    partes.push(
      '',
      'JÁ DECIDIDO PELO DONO DO PROJETO — repita estes MVPs exatamente com estes ids e',
      'títulos, e proponha os demais em volta deles:',
      ...entrada.congelados.map((c) => `- [${c.id}] ${c.titulo}`)
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
 * A instrução de sistema da **SPEC da primeira fatia** (§ 5).
 *
 * Separada da do roadmap porque é outro momento: só acontece depois do `MVP_ENTRY`, sobre a
 * fatia que o MVP escolhido prevê primeiro. E porque a tarefa é outra — descer ao detalhe
 * executável de uma fatia, não recortar o projeto.
 *
 * **As perguntas abertas são exigidas no prompt, não só no validador.** Uma SPEC sem pergunta
 * seria recusada de qualquer forma; dizê-lo antes economiza a chamada que a recusa custaria.
 */
export const SISTEMA_DA_SPEC = [
  'Você recebe o MVP que o dono do projeto escolheu para entrar na fila e a primeira fatia',
  IDIOMA_DA_SAIDA,
  'prevista dele, e escreve a especificação executável dessa fatia.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"spec":{"titulo":"<o título da fatia>",',
  '  "objetivo":"<o que esta fatia entrega, em uma frase>",',
  '  "fluxo":["<passo>","<passo>"],',
  '  "regras":["<regra>"],',
  '  "criteriosDeAceite":["<critério verificável>"],',
  '  "testes":["<o que provar>"],',
  '  "perguntas":[{"id":"p-1","enunciado":"<a decisão que falta>",',
  '    "opcoes":[{"id":"a","rotulo":"<opção>","impacto":"<o trade-off>"},',
  '              {"id":"b","rotulo":"<opção>","impacto":"<o trade-off>"}],',
  '    "recomendada":"a","justificativa":"<por que esta>"}]}}',
  '',
  'Cada critério de aceite é **verificável**: escrito de modo que um teste possa passar ou',
  'falhar sobre ele. "A tela fica melhor" não é critério; "a lista vazia mostra o que fazer a',
  'seguir" é.',
  '',
  'As perguntas abertas são **obrigatórias**, e ao menos uma. Elas são o que falta decidir e só',
  'o dono do projeto decide. Uma especificação sem pergunta afirma que não há nada a decidir, e',
  'isso você não tem como saber.',
  '',
  `Cada pergunta traz entre ${MINIMO_DE_OPCOES_DA_SPEC} e ${MAXIMO_DE_OPCOES_DA_SPEC} opções mutuamente excludentes, cada uma com o impacto`,
  'declarado, e a recomendada entre elas com a justificativa. Opção sem impacto é opção sem',
  'escolha.',
  '',
  'Escreva apenas sobre esta fatia. As demais fatias do MVP existem como checklist e ganharão',
  'especificação quando chegarem a vez delas.',
  '',
  'Nunca traga processo, labels, papéis, ferramentas ou fluxo de trabalho de outro projeto.',
  '',
  'Nunca proponha por conta própria requisito legal, regulatório, de consentimento, aceite',
  'duplo, termos de uso, política de privacidade, tratamento de dados pessoais ou sensíveis,',
  'compliance ou classificação jurídica de domínio.'
].join('\n')

/** O pedido da SPEC: o MVP escolhido, a fatia a detalhar e o contexto que a sustenta. */
export function promptDaSpec(entrada: {
  readonly mvp: { readonly titulo: string; readonly tese: string; readonly resultado: string }
  readonly fatia: { readonly titulo: string }
  readonly outrasFatias: readonly string[]
  readonly requisitos: readonly AfirmacaoParaOModelo[]
  readonly arquitetura: readonly AfirmacaoParaOModelo[]
  readonly correcao?: readonly string[]
}): string {
  const partes: string[] = [
    `MVP ESCOLHIDO: ${entrada.mvp.titulo}`,
    `- entrega: ${entrada.mvp.tese}`,
    `- resultado: ${entrada.mvp.resultado}`,
    '',
    `FATIA A ESPECIFICAR: ${entrada.fatia.titulo}`,
    ''
  ]

  // As demais fatias entram para o modelo saber **onde parar**: sem elas, a SPEC da primeira
  // absorveria o escopo das seguintes, e o recorte que o MVP definiu se perderia na primeira
  // entrega.
  partes.push(
    entrada.outrasFatias.length === 0
      ? 'Esta é a única fatia prevista deste MVP.'
      : `Demais fatias previstas (NÃO especifique estas): ${entrada.outrasFatias.join('; ')}.`,
    '',
    'PRD ACEITO:',
    '',
    ...entrada.requisitos.map((r) => `- [${r.id}] (${r.secao}) ${r.texto}`),
    '',
    'ARQUITETURA APROVADA:',
    '',
    ...entrada.arquitetura.map((a) => `- [${a.id}] (${a.secao}) ${a.texto}`)
  )

  if (entrada.correcao !== undefined && entrada.correcao.length > 0) {
    partes.push(
      '',
      'A saída anterior foi recusada pelo validador. Corrija exatamente estes pontos:',
      ...entrada.correcao.map((c) => `- ${c}`)
    )
  }

  return partes.join('\n')
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

function fatiaValida(v: unknown): v is FatiaGerada {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>

  return (
    typeof f['id'] === 'string' &&
    typeof f['numero'] === 'number' &&
    typeof f['titulo'] === 'string' &&
    isOrigemDoRoadmap(f['origem']) &&
    (f['referencia'] === undefined || typeof f['referencia'] === 'string')
  )
}

function mvpValido(v: unknown): v is MvpGerado {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  const dependeDe = m['dependeDe']
  const fatias = m['fatias']

  return (
    typeof m['id'] === 'string' &&
    typeof m['numero'] === 'number' &&
    typeof m['titulo'] === 'string' &&
    typeof m['tese'] === 'string' &&
    typeof m['resultado'] === 'string' &&
    Array.isArray(dependeDe) &&
    dependeDe.every((d) => typeof d === 'string') &&
    isOrigemDoRoadmap(m['origem']) &&
    (m['referencia'] === undefined || typeof m['referencia'] === 'string') &&
    Array.isArray(fatias) &&
    fatias.every(fatiaValida)
  )
}

function opcaoValida(v: unknown): v is OpcaoDaSpec {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>

  return (
    typeof o['id'] === 'string' &&
    typeof o['rotulo'] === 'string' &&
    typeof o['impacto'] === 'string'
  )
}

function perguntaValida(v: unknown): v is PerguntaDaSpec {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  const opcoes = p['opcoes']

  return (
    typeof p['id'] === 'string' &&
    typeof p['enunciado'] === 'string' &&
    typeof p['recomendada'] === 'string' &&
    typeof p['justificativa'] === 'string' &&
    Array.isArray(opcoes) &&
    opcoes.every(opcaoValida)
  )
}

function listaDeTexto(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.every((i) => typeof i === 'string') ? (v as string[]) : undefined
}

/**
 * Lê a saída do roadmap. **Não conserta nada** — devolve `undefined` quando a forma não confere,
 * e o serviço decide o que fazer com isso.
 *
 * Um MVP malformado invalida a saída inteira, em vez de ser descartado em silêncio: o roadmap
 * precisa ser o que o modelo produziu, não o que sobrou depois de um filtro — e um MVP a menos
 * mudaria o grafo que o validador confere.
 */
export function lerRoadmapDoModelo(bruto: string): readonly MvpGerado[] | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const mvps = raiz['mvps']
  if (!Array.isArray(mvps)) return undefined
  if (!mvps.every(mvpValido)) return undefined

  return mvps
}

/**
 * Lê a saída da SPEC.
 *
 * `fatiaId` **não** vem do modelo: quem sabe qual fatia está sendo especificada é o serviço, que
 * a escolheu do MVP aceito. Aceitá-lo da saída deixaria o modelo apontar a SPEC para outra fatia
 * — e o `SLICE_ENTRY` gravaria o aceite sobre a fatia errada.
 */
export function lerSpecDoModelo(bruto: string, fatiaId: string): SpecGerada | undefined {
  const raiz = parseObjeto(bruto)
  if (raiz === undefined) return undefined

  const spec = raiz['spec']
  if (typeof spec !== 'object' || spec === null) return undefined

  /*
   * O envelope duplicado, `{"spec":{"spec":{...}}}` (issue #337).
   *
   * A SPEC é a **única** saída da jornada cujo topo é um objeto; todas as outras são listas. Com
   * `--json-schema`, o CLI pede o documento pela ferramenta `StructuredOutput`, cujo argumento
   * já é o envelope `{"spec": ...}` — e o system também mostra o envelope, porque os outros
   * providers só têm o texto. O modelo cumpre os dois e escreve o envelope do system dentro do
   * argumento da ferramenta. Numa lista isso não acontece: `{"mvps":[...]}` dentro de `mvps`
   * seria um objeto onde o schema pede array, e o CLI recusa antes de sair.
   *
   * A saída medida no banco do PI trazia a SPEC inteira, com os 5.612 tokens já pagos, e três
   * tentativas foram descartadas aqui por um nível a mais. Desaninhar é o que separa "o modelo
   * não conseguiu" de "o documento chegou e nós o jogamos fora".
   */
  const aninhado = (spec as Record<string, unknown>)['spec']
  const s = (typeof aninhado === 'object' && aninhado !== null ? aninhado : spec) as Record<
    string,
    unknown
  >

  const fluxo = listaDeTexto(s['fluxo'])
  const regras = listaDeTexto(s['regras'])
  const criterios = listaDeTexto(s['criteriosDeAceite'])
  const testes = listaDeTexto(s['testes'])
  const perguntas = s['perguntas']

  if (
    typeof s['titulo'] !== 'string' ||
    typeof s['objetivo'] !== 'string' ||
    fluxo === undefined ||
    regras === undefined ||
    criterios === undefined ||
    testes === undefined ||
    !Array.isArray(perguntas) ||
    !perguntas.every(perguntaValida)
  ) {
    return undefined
  }

  return {
    fatiaId,
    titulo: s['titulo'],
    objetivo: s['objetivo'],
    fluxo,
    regras,
    criteriosDeAceite: criterios,
    testes,
    perguntas
  }
}
