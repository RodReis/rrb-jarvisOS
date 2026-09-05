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

/** O brief e os documentos do pacote: uma lista de afirmações com origem. */
export const SCHEMA_DAS_AFIRMACOES = envelopeDeLista('afirmacoes')

/** As contradições entre documentos do pacote. */
export const SCHEMA_DAS_CONTRADICOES = envelopeDeLista('contradicoes')

/** Os ajustes de coerência entre a arquitetura e o protótipo. */
export const SCHEMA_DOS_AJUSTES = envelopeDeLista('ajustes')

/** O roadmap: os MVPs, cada um com as suas fatias. */
export const SCHEMA_DO_ROADMAP = envelopeDeLista('mvps')

/** A spec de uma fatia: um documento só. */
export const SCHEMA_DA_SPEC = envelopeDeObjeto('spec')
