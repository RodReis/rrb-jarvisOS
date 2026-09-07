/**
 * O JSON da geração lido como documento (SPEC-Jornada-03 § Console).
 *
 * A pergunta que este arquivo responde: **o que o modelo está escrevendo, em forma legível,
 * enquanto ele ainda escreve?**
 *
 * O modelo devolve as afirmações como JSON, e o console mostrava isso cru — uma parede de
 * `{"afirmacoes":[{"id":"a-1",...` onde o PI deveria estar lendo o PRD nascendo. O texto existe,
 * está correto e é ilegível pela forma, não pelo conteúdo.
 *
 * ## Por que ler o que está incompleto
 *
 * Durante o streaming o JSON **não fecha**: falta o `]}` final, e a última afirmação chega pela
 * metade. Esperar o documento inteiro para só então formatar deixaria o painel vazio justamente
 * durante os segundos em que ele existe para mostrar algo — o PI olharia para "gerando" até
 * tudo terminar, que é o problema que a fatia veio resolver.
 *
 * Então a leitura é **tolerante por construção**: extrai os objetos completos que já chegaram e
 * ignora o resto. Um objeto a menos por meio segundo é invisível; um painel vazio por trinta
 * segundos não é.
 *
 * ## O que este arquivo não faz
 *
 * **Não valida.** Quem decide se a saída presta é o `validarPrd` no main, e duplicar a régua
 * aqui criaria uma segunda resposta para a mesma pergunta — que divergiria da primeira no dia em
 * que uma das duas mudasse. Aqui só se decide **como mostrar** o que chegou.
 *
 * **Não redige.** A redação é de quem exibe (`redigirTexto` no renderer), pela mesma razão que
 * o `resumoDoArgumento` não redige: escondê-la dentro de uma função de formatação faria o
 * próximo call site esquecer que ela acontece.
 */

/** Uma afirmação legível extraída da saída, com a procedência que o modelo declarou. */
export interface AfirmacaoLegivel {
  readonly id: string
  readonly documento: string
  readonly secao: string
  readonly texto: string
  readonly origem: string
}

/** Um grupo de afirmações sob o mesmo par documento/seção — o que vira um tópico na tela. */
export interface TopicoDaSaida {
  readonly documento: string
  readonly secao: string
  readonly afirmacoes: readonly AfirmacaoLegivel[]
}

/**
 * O que a leitura devolve.
 *
 * `restante` é o texto que **não** foi reconhecido como afirmação: prosa que o modelo escreveu
 * antes ou depois do JSON, ou a saída inteira quando ela não é JSON nenhum. Ele é mostrado como
 * texto normal em vez de descartado — quando a geração dá errado, é justamente essa sobra que
 * explica o motivo, e engoli-la deixaria o PI olhando para um painel vazio sem saber por quê.
 */
export interface SaidaLida {
  readonly topicos: readonly TopicoDaSaida[]
  readonly restante: string
}

/**
 * O separador da chave de agrupamento.
 *
 * Caractere de controle porque ele **não aparece** em texto decodificado de JSON: um separador
 * comum (espaço, barra) colidiria com nome de seção que o contém — "Visão Geral" e "Riscos
 * Técnicos" têm espaço —, e dois pares distintos cairiam no mesmo grupo.
 */
const SEPARADOR = '\u0001'

/**
 * Os campos que fazem de um objeto uma afirmação exibível.
 *
 * `texto` é o único obrigatório de verdade — sem ele não há o que mostrar. Os outros são
 * rótulos, e um rótulo ausente vira vazio em vez de descartar a frase: o PI perder a afirmação
 * porque o modelo esqueceu a seção seria trocar a informação pelo enfeite dela.
 */
function comoAfirmacao(valor: unknown): AfirmacaoLegivel | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined

  const bruto = valor as Record<string, unknown>
  const texto = bruto.texto

  if (typeof texto !== 'string' || texto.trim() === '') return undefined

  const comoString = (v: unknown): string => (typeof v === 'string' ? v : '')

  return {
    id: comoString(bruto.id),
    documento: comoString(bruto.documento),
    secao: comoString(bruto.secao),
    texto,
    origem: comoString(bruto.origem)
  }
}

/**
 * O MVP do roadmap, lido como afirmações (issue #337).
 *
 * O leitor reconhecia **uma** forma, a das afirmações do PRD e da arquitetura, e as outras
 * etapas caíam inteiras no `restante` — o PI viu a parede de `{"mvps":[{"id":"mvp-1"...` que o
 * console existe para não mostrar. Um MVP não tem `texto`: tem `tese` e `resultado`, que são
 * coisas diferentes e as duas precisam ser lidas.
 *
 * O par documento/seção vira o agrupamento que a tela já sabe desenhar: o MVP é a seção, e cada
 * campo dele uma linha. Nenhum componente novo — a forma legível é a mesma.
 */
function comoMvp(valor: unknown): readonly AfirmacaoLegivel[] {
  if (typeof valor !== 'object' || valor === null) return []

  const bruto = valor as Record<string, unknown>
  const titulo = bruto.titulo
  const tese = bruto.tese

  // `tese` é o que distingue um MVP de qualquer outro objeto com título — uma fatia, por
  // exemplo, que é lida junto pela varredura e não deve virar seção própria.
  if (typeof titulo !== 'string' || typeof tese !== 'string') return []

  const id = typeof bruto.id === 'string' ? bruto.id : titulo
  const linha = (campo: string, texto: unknown): AfirmacaoLegivel | undefined =>
    typeof texto === 'string' && texto.trim() !== ''
      ? { id: `${id}:${campo}`, documento: 'Roadmap', secao: titulo, texto, origem: campo }
      : undefined

  const fatias = Array.isArray(bruto.fatias) ? bruto.fatias : []
  const titulosDasFatias = fatias
    .map((f) => (typeof f === 'object' && f !== null ? (f as Record<string, unknown>).titulo : ''))
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')

  return [
    linha('entrega', tese),
    linha('resultado', bruto.resultado),
    // As fatias como uma linha só: são o checklist do MVP, e uma seção por fatia faria a tela
    // rolar o que o PI está lendo de relance.
    titulosDasFatias.length === 0 ? undefined : linha('fatias', titulosDasFatias.join(' · '))
  ].filter((l): l is AfirmacaoLegivel => l !== undefined)
}

/**
 * A SPEC da fatia, lida como afirmações (issue #337).
 *
 * Mesma razão do MVP, forma diferente: a SPEC tem listas (`fluxo`, `regras`,
 * `criteriosDeAceite`, `testes`) e é o documento que o PI lê antes de aprovar o `SLICE_ENTRY`.
 * As perguntas abertas ficam de fora: elas têm tela própria, com as opções e o impacto de cada
 * uma, e repeti-las aqui sem as opções mostraria a decisão sem o que ela decide.
 */
function comoSpec(valor: unknown): readonly AfirmacaoLegivel[] {
  if (typeof valor !== 'object' || valor === null) return []

  const bruto = valor as Record<string, unknown>
  const titulo = bruto.titulo
  const objetivo = bruto.objetivo

  if (typeof titulo !== 'string' || typeof objetivo !== 'string') return []

  const lidas: AfirmacaoLegivel[] = [
    { id: 'spec:objetivo', documento: 'SPEC', secao: titulo, texto: objetivo, origem: 'objetivo' }
  ]

  const listas: readonly (readonly [string, string])[] = [
    ['fluxo', 'passo'],
    ['regras', 'regra'],
    ['criteriosDeAceite', 'critério de aceite'],
    ['testes', 'teste']
  ]

  for (const [campo, rotulo] of listas) {
    const lista = bruto[campo]
    if (!Array.isArray(lista)) continue

    lista.forEach((item, i) => {
      if (typeof item !== 'string' || item.trim() === '') return
      lidas.push({
        id: `spec:${campo}:${i}`,
        documento: 'SPEC',
        secao: titulo,
        texto: item,
        origem: rotulo
      })
    })
  }

  return lidas
}

/**
 * Extrai **todo** objeto JSON completo de um texto, em qualquer nível de aninhamento.
 *
 * Varredura por profundidade de chaves, e não regex: uma chave dentro de string (`"a}b"`) ou uma
 * aspa escapada quebrariam qualquer regex razoável, e o texto vem de um modelo — as duas
 * aparecem. O contador só considera chave **fora** de string.
 *
 * **Coleta em todos os níveis, não só no topo.** A saída chega envelopada
 * (`{"afirmacoes":[{...},{...}]}`), e durante o streaming o envelope **nunca fecha** — só o `}`
 * final o fecharia, e ele chega por último. Coletar apenas objetos de profundidade zero devolveria
 * lista vazia durante a geração inteira, que é exatamente quando o painel precisa ter o que
 * mostrar. Cada afirmação interna já é um objeto completo assim que a própria chave dela fecha,
 * e é isso que a varredura aproveita.
 *
 * O objeto ainda aberto no fim do texto é descartado sem cerimônia: é a afirmação sendo escrita
 * agora, e ela chega inteira no próximo evento.
 */
function objetosCompletos(texto: string): readonly unknown[] {
  const achados: unknown[] = []

  /** Onde cada nível de chave começou. O topo da pilha é o objeto mais interno em aberto. */
  const aberturas: number[] = []
  let dentroDeString = false
  let escapado = false

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]

    if (dentroDeString) {
      if (escapado) escapado = false
      else if (c === '\\') escapado = true
      else if (c === '"') dentroDeString = false
      continue
    }

    if (c === '"') {
      dentroDeString = true
      continue
    }

    if (c === '{') {
      aberturas.push(i)
      continue
    }

    if (c === '}') {
      const inicio = aberturas.pop()
      if (inicio === undefined) continue

      try {
        achados.push(JSON.parse(texto.slice(inicio, i + 1)))
      } catch {
        // Objeto sintaticamente inválido: ignora. Durante o streaming isso é normal, e derrubar
        // a leitura por causa de um fragmento apagaria o que já tinha sido lido corretamente.
      }
    }
  }

  return achados
}

/**
 * Lê a saída do modelo como documento.
 *
 * Agrupa por par documento/seção **preservando a ordem de chegada** — a ordem em que o modelo
 * escreveu é a ordem em que o PI acompanha, e reordenar por nome faria o parágrafo que acabou de
 * aparecer saltar para o meio da lista.
 */
export function lerSaidaComoDocumento(texto: string): SaidaLida {
  const objetos = objetosCompletos(texto)

  const afirmacoes: AfirmacaoLegivel[] = []
  for (const objeto of objetos) {
    const direta = comoAfirmacao(objeto)
    if (direta !== undefined) {
      afirmacoes.push(direta)
      continue
    }

    /*
     * As outras formas da jornada (#337). A ordem importa só por economia: um objeto é MVP ou
     * SPEC, nunca os dois — `tese` e `objetivo` não coexistem —, e cada leitor devolve lista
     * vazia para o que não é seu.
     */
    const mvp = comoMvp(objeto)
    if (mvp.length > 0) {
      afirmacoes.push(...mvp)
      continue
    }

    const spec = comoSpec(objeto)
    if (spec.length > 0) {
      afirmacoes.push(...spec)
      continue
    }

    // O envelope `{"afirmacoes":[...]}`, quando ele fecha. Os itens já foram lidos um a um pela
    // varredura, e a deduplicação por id abaixo é o que impede a contagem dobrada.
    if (typeof objeto === 'object' && objeto !== null) {
      const lista = (objeto as Record<string, unknown>).afirmacoes
      if (Array.isArray(lista)) {
        for (const item of lista) {
          const lida = comoAfirmacao(item)
          if (lida !== undefined) afirmacoes.push(lida)
        }
      }
    }
  }

  // Sem afirmação nenhuma, o texto inteiro é o restante: pode ser prosa do modelo, pode ser uma
  // recusa. Os dois precisam ser lidos, e nenhum deve virar painel vazio.
  if (afirmacoes.length === 0) return { topicos: [], restante: texto }

  /*
   * Os grupos guardam o **par**, não uma chave que precise ser desmontada depois: remontar por
   * `split` é a etapa onde um nome com o separador dentro se perderia.
   */
  const porGrupo = new Map<
    string,
    { documento: string; secao: string; itens: AfirmacaoLegivel[] }
  >()
  const ordem: string[] = []
  const vistas = new Set<string>()

  for (const a of afirmacoes) {
    // O mesmo id chega várias vezes: a varredura relê o texto acumulado a cada evento, e o
    // envelope fechado repete o que já foi lido item a item. Sem esta guarda, a mesma frase
    // apareceria uma vez por chunk recebido.
    if (a.id !== '' && vistas.has(a.id)) continue
    if (a.id !== '') vistas.add(a.id)

    const chave = `${a.documento}${SEPARADOR}${a.secao}`
    const grupo = porGrupo.get(chave)

    if (grupo === undefined) {
      porGrupo.set(chave, { documento: a.documento, secao: a.secao, itens: [a] })
      ordem.push(chave)
    } else {
      grupo.itens.push(a)
    }
  }

  return {
    topicos: ordem.flatMap((chave) => {
      const grupo = porGrupo.get(chave)
      return grupo === undefined
        ? []
        : [{ documento: grupo.documento, secao: grupo.secao, afirmacoes: grupo.itens }]
    }),
    restante: ''
  }
}
