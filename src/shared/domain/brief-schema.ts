/**
 * O contrato de saída do modelo (SPEC-Jornada-02, § Geração).
 *
 * A pergunta que este arquivo responde: **como pedir ao modelo algo que possa ser verificado?**
 *
 * A resposta é saída estruturada obrigatória, e a razão é o critério 4. Com prosa, "toda
 * afirmação carrega origem" viraria promessa em texto: alguém teria de ler o documento e julgar
 * se cada frase cita fonte — exatamente o limite que levou a M8-F04 a compor em vez de gerar.
 * Com JSON por afirmação, a origem é um campo, e um campo ou está lá ou não está.
 *
 * Duas decisões que valem nomear:
 *
 *  - **O parser não conserta.** JSON malformado, campo faltando ou tipo errado devolvem
 *    `undefined`, e quem chamou trata como saída inválida. Um parser tolerante — que
 *    completasse origem ausente com `proposto`, digamos — inventaria a procedência que o
 *    critério 4 existe para exigir.
 *  - **O prompt de sistema descreve o schema e proíbe explicitamente o que o validador recusa.**
 *    Pedir e depois barrar é desperdício de chamada; dizer antes reduz a rodada de correção que
 *    o serviço paga.
 */

import type { Afirmacao, BlocoDoBrief, Pendencia } from './brief'
import { BLOCOS_DO_BRIEF, isBlocoDoBrief, isOrigemDaAfirmacao } from './brief'

/**
 * A instrução de sistema da geração do brief.
 *
 * **Enumera os blocos a partir da constante**, não numa lista escrita à mão: um bloco novo no
 * schema entraria no prompt sozinho, e uma segunda lista aqui divergiria no dia em que alguém
 * mexesse só numa delas.
 *
 * A proibição da invariante 9 é dita **antes** de o modelo escrever, e não só verificada
 * depois: cada saída recusada custa uma chamada, e o validador continua sendo a garantia — o
 * prompt é só a economia.
 */
export const SISTEMA_DO_BRIEF = [
  'Você recebe o prompt de um projeto escrito pelo dono dele e produz um brief estruturado.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"afirmacoes":[{"id":"a-1","bloco":"<bloco>","texto":"<uma frase>","origem":"prompt|decisao|proposto","referencia":"<id da decisão, só quando origem=decisao>"}],',
  ' "pendencias":[{"bloco":"<bloco>","pergunta":"<o que falta saber>","material":true|false}]}',
  '',
  `Blocos válidos: ${BLOCOS_DO_BRIEF.join(', ')}.`,
  '',
  'Regras de origem, e elas são o ponto do documento:',
  '- "prompt": o dono do projeto escreveu isso no texto dele. Use quando a afirmação está lá.',
  '- "decisao": veio de uma escolha registrada. Exige o campo "referencia" com o id da decisão.',
  '- "proposto": você inferiu. Use só quando de fato inferiu, e nunca para o que segue abaixo.',
  '',
  'Nunca proponha por conta própria requisito legal, regulatório, de consentimento, aceite',
  'duplo, termos de uso, política de privacidade, tratamento de dados pessoais ou sensíveis,',
  'compliance ou classificação jurídica de domínio. Se o dono do projeto não disse, isso não',
  'entra no brief — nem como "proposto". Uma pendência é a resposta certa nesse caso.',
  '',
  'Marque "material": true na pendência que impede começar a construir, e false na que pode',
  'ficar aberta. Não invente pendência para preencher bloco: se o prompt responde, afirme.'
].join('\n')

/** Uma decisão do refinamento, como o brief precisa citá-la. */
export interface DecisaoDoRefinamento {
  readonly id: string
  readonly pergunta: string
  readonly resposta: string
}

/**
 * O pedido enviado ao modelo, com as decisões do refinamento e a correção quando há.
 *
 * **As decisões entram com o id.** É o que torna a origem `decisao` verificável: o validador
 * exige `referencia` nessa origem, e o modelo só consegue preenchê-la se souber qual id citar.
 * Sem os ids no pedido, toda afirmação vinda de uma resposta do PI viraria `proposto` — e a
 * distinção entre "o PI decidiu" e "a IA inferiu" desapareceria justo onde ela mais importa.
 */
export function promptDaGeracao(
  promptDoPi: string,
  decisoes: readonly DecisaoDoRefinamento[] = [],
  correcao?: readonly string[]
): string {
  const base = ['PROMPT DO PROJETO:', '', promptDoPi]

  if (decisoes.length > 0) {
    base.push(
      '',
      'DECISÕES DO REFINAMENTO (use origem "decisao" e cite o id em "referencia"):',
      ...decisoes.map((d) => `- [${d.id}] ${d.pergunta} → ${d.resposta}`)
    )
  }

  if (correcao === undefined || correcao.length === 0) return base.join('\n')

  // A correção diz **o quê** o validador recusou. "Tente de novo" sem o motivo é jogar dado, e
  // gasta a única rodada extra que o serviço admite.
  return [
    ...base,
    '',
    'A saída anterior foi recusada pelo validador. Corrija exatamente estes pontos:',
    ...correcao.map((c) => `- ${c}`)
  ].join('\n')
}

/**
 * A instrução de sistema da geração de **perguntas** de refinamento (SPEC-Jornada-02).
 *
 * Separada de `SISTEMA_DO_BRIEF` porque a tarefa é outra: lá o modelo afirma o que já sabe;
 * aqui ele declara o que **não** sabe. Fundir as duas faria uma única instrução tentar
 * ensinar dois formatos de saída, e o modelo escolheria um deles por conta própria.
 *
 * A proibição da invariante 9 se repete — e precisa se repetir: uma pergunta inventada sobre
 * consentimento é tão danosa quanto uma afirmação inventada, porque a resposta do PI a ela
 * viraria origem `decisao` e passaria pelo validador do brief limpa.
 */
export const SISTEMA_DAS_PERGUNTAS = [
  'Você recebe o prompt de um projeto e gera as perguntas que faltam para entendê-lo.',
  '',
  'Responda **somente** com JSON válido, sem cercas de código e sem texto antes ou depois.',
  '',
  'Formato:',
  '{"perguntas":[{"bloco":"<bloco>","porQue":"<por que precisa saber isto>",',
  '  "titulo":"<curto>","enunciado":"<a pergunta>",',
  '  "opcoes":[{"id":"a","rotulo":"<opção>","impacto":"<o trade-off desta opção>"}],',
  '  "recomendada":"<id de uma das opções>","justificativa":"<por que esta é a recomendada>",',
  '  "aceitaTextoLivre":true|false,"delegavel":true|false}]}',
  '',
  `Blocos válidos: ${BLOCOS_DO_BRIEF.join(', ')}.`,
  '',
  'Regras da pergunta, e elas não são estilo — são contrato:',
  '- Entre 2 e 3 opções, mutuamente excludentes. Uma opção não é escolha; quatro viram formulário.',
  '- Toda opção declara "impacto": o trade-off dela. Sem isso o dono do projeto escolhe no escuro.',
  '- "recomendada" tem de ser o id de uma das opções que você ofereceu.',
  '- "delegavel": false quando a decisão for cara de reverter. Só delegue o que é seguro delegar.',
  '',
  'Pergunte **apenas** sobre os blocos que o prompt não responde. Se o prompt já diz, não',
  'pergunte de novo — o brief vai afirmar aquilo com origem "prompt".',
  '',
  'Nunca invente requisito legal, regulatório, de consentimento, aceite duplo, termos de uso,',
  'política de privacidade, dados pessoais ou sensíveis, compliance ou classificação jurídica.',
  'Não pergunte sobre isso se o dono do projeto não trouxe o assunto.'
].join('\n')

/** O pedido de geração de perguntas: o prompt e os blocos que ainda faltam. */
export function promptDasPerguntas(promptDoPi: string, blocosEmAberto: readonly string[]): string {
  return [
    'PROMPT DO PROJETO:',
    '',
    promptDoPi,
    '',
    `BLOCOS AINDA SEM RESPOSTA: ${blocosEmAberto.join(', ')}.`,
    '',
    'Gere uma pergunta para cada bloco acima que o prompt realmente não responda.'
  ].join('\n')
}

interface SaidaBruta {
  readonly afirmacoes: readonly Afirmacao[]
  readonly pendencias: readonly Pendencia[]
}

function afirmacaoValida(v: unknown): v is Afirmacao {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>

  return (
    typeof a['id'] === 'string' &&
    typeof a['texto'] === 'string' &&
    isBlocoDoBrief(a['bloco']) &&
    isOrigemDaAfirmacao(a['origem']) &&
    (a['referencia'] === undefined || typeof a['referencia'] === 'string')
  )
}

function pendenciaValida(v: unknown): v is Pendencia {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>

  return (
    isBlocoDoBrief(p['bloco']) &&
    typeof p['pergunta'] === 'string' &&
    typeof p['material'] === 'boolean'
  )
}

/**
 * Lê a saída do modelo. **Não conserta nada** — devolve `undefined` quando a forma não confere.
 *
 * Um parser tolerante seria a porta que o critério 4 fecha: completar origem ausente com um
 * default inventaria a procedência que o validador exige. Aqui, forma errada é saída inválida, e
 * o serviço decide o que fazer com isso.
 *
 * Tolera **uma** coisa, e só ela: cerca de código em volta do JSON. Modelos a produzem por
 * hábito mesmo quando instruídos a não fazê-lo, e recusar por causa de três crases gastaria a
 * rodada de correção com um problema que não é de conteúdo.
 */
export function lerSaidaDoModelo(bruto: string): SaidaBruta | undefined {
  const semCerca = bruto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let json: unknown
  try {
    json = JSON.parse(semCerca)
  } catch {
    return undefined
  }

  if (typeof json !== 'object' || json === null) return undefined

  const raiz = json as Record<string, unknown>
  const afirmacoes = raiz['afirmacoes']
  const pendencias = raiz['pendencias'] ?? []

  if (!Array.isArray(afirmacoes) || !Array.isArray(pendencias)) return undefined

  // Uma entrada malformada invalida a saída inteira, em vez de ser descartada em silêncio: o
  // brief precisa ser o que o modelo produziu, não o que sobrou dele depois de um filtro.
  if (!afirmacoes.every(afirmacaoValida)) return undefined
  if (!pendencias.every(pendenciaValida)) return undefined

  return { afirmacoes, pendencias }
}

/**
 * Lê a saída de perguntas do modelo. **Não conserta nada**, mesma postura de
 * `lerSaidaDoModelo`: forma errada é saída inválida, e o serviço decide o que fazer.
 *
 * O que sai daqui ainda **não** é confiável — é só bem formado. Quem decide se cada pergunta
 * cumpre o contrato é `validarPerguntaGerada`, que roda depois: este parser garante os tipos,
 * aquele garante as regras.
 */
export function lerPerguntasDoModelo(bruto: string): readonly PerguntaBruta[] | undefined {
  const semCerca = bruto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let json: unknown
  try {
    json = JSON.parse(semCerca)
  } catch {
    return undefined
  }

  if (typeof json !== 'object' || json === null) return undefined

  const perguntas = (json as Record<string, unknown>)['perguntas']
  if (!Array.isArray(perguntas)) return undefined
  if (!perguntas.every(perguntaBrutaValida)) return undefined

  return perguntas
}

/** Uma pergunta como o modelo a devolve — sem `id` e sem `etapa`, que quem persiste atribui. */
export interface PerguntaBruta {
  readonly bloco: BlocoDoBrief
  readonly porQue: string
  readonly titulo: string
  readonly enunciado: string
  readonly opcoes: readonly {
    readonly id: string
    readonly rotulo: string
    readonly impacto: string
  }[]
  readonly recomendada: string
  readonly justificativa: string
  readonly aceitaTextoLivre: boolean
  readonly delegavel: boolean
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

function perguntaBrutaValida(v: unknown): v is PerguntaBruta {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>

  return (
    isBlocoDoBrief(p['bloco']) &&
    typeof p['porQue'] === 'string' &&
    typeof p['titulo'] === 'string' &&
    typeof p['enunciado'] === 'string' &&
    Array.isArray(p['opcoes']) &&
    p['opcoes'].every(opcaoValida) &&
    typeof p['recomendada'] === 'string' &&
    typeof p['justificativa'] === 'string' &&
    typeof p['aceitaTextoLivre'] === 'boolean' &&
    typeof p['delegavel'] === 'boolean'
  )
}

/** O bloco que uma pergunta gerada preenche, para o refinamento saber o que ainda falta. */
export function blocosCobertos(saida: SaidaBruta): readonly BlocoDoBrief[] {
  return [
    ...new Set([...saida.afirmacoes.map((a) => a.bloco), ...saida.pendencias.map((p) => p.bloco)])
  ]
}
