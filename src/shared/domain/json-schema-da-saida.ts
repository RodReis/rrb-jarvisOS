/**
 * Os JSON Schemas que o CLI valida na saída (emenda E1 § Decisão 3, critério 2).
 *
 * A pergunta que este arquivo responde: **o que sobra quando o modelo desobedece o prompt?**
 *
 * Os systems já pedem "responda somente com JSON válido" desde a SPEC-Jornada-02, e o
 * `lerSaidaDoModelo` de cada domínio já recusa forma errada. O que faltava era uma barreira
 * **antes** de a resposta chegar: o `--json-schema` do CLI restringe a saída no próprio print
 * mode, e a forma vira restrição em vez de pedido. As duas barreiras coexistem de propósito —
 * esta cobre a rota do CLI; o leitor de domínio cobre todas as rotas, inclusive as que não têm
 * flag equivalente.
 *
 * ## Por que o schema acompanha o system, e não a etapa
 *
 * A tentação era um `Record<Etapa, string>`, e ele estaria **errado**: a etapa `prd` chama o
 * modelo três vezes com contratos diferentes — o termo de pesquisa (texto puro, "sem aspas, sem
 * explicação"), os documentos do pacote (`afirmacoes`) e as contradições (`contradicoes`). Um
 * schema por etapa aplicaria `afirmacoes` ao termo e quebraria a pesquisa de mercado. O schema
 * pertence ao **par system+prompt**, que é onde o formato é decidido, então é o call site que o
 * escolhe — ao lado do system que ele já passa.
 *
 * ## Por que os schemas são rasos
 *
 * Cada schema descreve o **envelope**: a chave de topo e se ela carrega lista ou objeto. Não
 * repete campo a campo o que o system já enumera, e isso é deliberado — um schema completo aqui
 * seria uma segunda cópia do contrato, divergindo do system na primeira vez que alguém mexesse
 * só num dos dois. O envelope é o que recusa prosa e cerca de código, que é o defeito
 * observado; a conferência campo a campo continua no `lerSaidaDoModelo`, onde já é testada.
 */

/** Um envelope `{ "<chave>": [ ... ] }` — a forma da maioria das saídas da jornada. */
function envelopeDeLista(chave: string): string {
  return envelope(chave, { type: 'array', items: { type: 'object' } })
}

/** Um envelope `{ "<chave>": { ... } }`. A spec da fatia é um documento só, não uma lista. */
function envelopeDeObjeto(chave: string): string {
  return envelope(chave, { type: 'object' })
}

/**
 * Um envelope de **duas** listas — o brief, que devolve afirmações e pendências juntas.
 *
 * Existe porque `additionalProperties: false` é literal: um envelope de uma chave só não
 * "tolera" a segunda, ele a **proíbe**. O CLI recusa a chave ausente do schema antes de o
 * documento existir, e o modelo cumpre a restrição escrevendo o que sobrou onde couber — no
 * caso medido, as pendências viraram afirmações `proposto` no bloco de riscos.
 *
 * As duas são `required` porque o system pede as duas. Uma lista vazia é resposta legítima
 * ("nada ficou em aberto"); a **chave** ausente não é, e é a chave que o schema cobra.
 */
function envelopeDeDuasListas(primeira: string, segunda: string): string {
  const lista = { type: 'array', items: { type: 'object' } }
  return JSON.stringify({
    type: 'object',
    properties: { [primeira]: lista, [segunda]: lista },
    required: [primeira, segunda],
    additionalProperties: false
  })
}

function envelope(chave: string, conteudo: object): string {
  return JSON.stringify({
    type: 'object',
    properties: { [chave]: conteudo },
    required: [chave],
    additionalProperties: false
  })
}

/**
 * O schema do refinamento — a geração do defeito que abriu a #271.
 *
 * O modelo recebeu o pedido de perguntas dentro da persona de agente de código e respondeu que
 * ia montar o projeto. Com o schema, essa resposta deixa de ser uma saída que o leitor recusa
 * depois: é uma saída que o CLI não emite.
 */
export const SCHEMA_DAS_PERGUNTAS = envelopeDeLista('perguntas')

/** Os documentos do pacote (PRD, arquitetura): uma lista de afirmações com origem. */
export const SCHEMA_DAS_AFIRMACOES = envelopeDeLista('afirmacoes')

/**
 * O brief: afirmações **e** pendências (SPEC-Jornada-02 § Brief).
 *
 * Separado do `SCHEMA_DAS_AFIRMACOES` porque o contrato é outro, e o do brief é o único da
 * jornada com duas chaves de topo. Reusar aquele aqui foi o defeito da #280: a pendência
 * material é o que **bloqueia o aceite** do brief, e proibi-la no schema não a fazia sumir —
 * fazia o modelo reescrevê-la como afirmação `proposto`, que não bloqueia coisa nenhuma. Um
 * documento aparentemente completo, sem o freio que a spec exige.
 */
export const SCHEMA_DO_BRIEF = envelopeDeDuasListas('afirmacoes', 'pendencias')

/** As contradições entre documentos do pacote. */
export const SCHEMA_DAS_CONTRADICOES = envelopeDeLista('contradicoes')

/** Os ajustes de coerência entre a arquitetura e o protótipo. */
export const SCHEMA_DOS_AJUSTES = envelopeDeLista('ajustes')

/** O roadmap: os MVPs, cada um com as suas fatias. */
export const SCHEMA_DO_ROADMAP = envelopeDeLista('mvps')

/** A spec de uma fatia: um documento só. */
export const SCHEMA_DA_SPEC = envelopeDeObjeto('spec')
