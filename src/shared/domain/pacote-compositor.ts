/**
 * A composição dos três documentos a partir de decisões e evidências (SPEC-Planejamento-04).
 *
 * A pergunta que este arquivo responde: **como uma decisão do wizard vira uma linha do PRD sem
 * passar por um modelo?**
 *
 * Por composição, e a escolha é a fatia inteira. Cada seção tem uma regra fixa sobre o que a
 * alimenta — o `rotulo` da opção escolhida vira o texto do escopo, o `impacto` da opção
 * **preterida** vira o não-objetivo, a evidência extraída vira a linha do cenário. Nenhuma
 * dessas transformações inventa conteúdo: elas **reorganizam** o que o PI decidiu e o que a
 * fonte externa disse, e é por isso que os critérios 1 e 5 valem por construção em vez de
 * dependerem de auditar prosa gerada.
 *
 * **O não-objetivo sai da opção preterida, e isso é o critério 4 literal.** "PRD distingue
 * escopo de não objetivo" pede que a fronteira seja explícita; a pergunta do wizard já a
 * produziu, porque as opções são mutuamente exclusivas. Escolher `fatia-vertical` é, no mesmo
 * ato, não escolher `fundacao-ampla` — e registrar as duas metades é registrar a decisão
 * inteira. Um PRD que só listasse o escolhido perderia a informação de que houve escolha.
 *
 * **O que este arquivo não faz:** não lê disco, não chama rede e não decide se a pesquisa
 * bastou. Só monta texto a partir do que recebe — e por isso é inteiramente testável sem
 * Electron, sem banco e sem provider.
 */

import type { Decision, DecisoesPorPergunta, Pergunta } from './wizard'
import type { AfirmacaoDoPacote, DocumentoDoPacote, OrigemDaAfirmacao } from './pacote-estrutural'
import { marcaDeOrigem } from './pacote-estrutural'

/**
 * Uma fonte externa já extraída, no mínimo que a composição precisa.
 *
 * Estrutura própria, e não o `EvidenceItem` de `tavily.ts`: aquele carrega o conteúdo inteiro
 * da página (dezenas de milhares de caracteres), e a composição só precisa do que vai para o
 * documento. Depender do tipo maior arrastaria o conteúdo bruto para dentro do renderer.
 */
export interface FonteDoLandscape {
  readonly url: string
  readonly titulo: string
  readonly trecho: string
  readonly hashConteudo: string
  readonly coletadoEm: string
  readonly publicadoEm?: string
}

/** O que a composição precisa saber do projeto. */
export interface IdentidadeDoProjeto {
  readonly nome: string
  readonly slug: string
}

/**
 * O texto de uma decisão, do jeito que ele entra no documento.
 *
 * Texto livre vence a opção quando existe: o PI escreveu com as palavras dele, e substituí-las
 * pelo rótulo de uma opção que ele **não** escolheu seria trocar a decisão por outra.
 */
export function textoDaDecisao(pergunta: Pergunta, decisao: Decision): string {
  if (decisao.texto !== null && decisao.texto.trim() !== '') return decisao.texto.trim()
  const opcao = pergunta.opcoes.find((o) => o.id === decisao.escolha)
  return opcao?.rotulo ?? decisao.escolha ?? ''
}

/** As opções que o PI **não** escolheu — a outra metade da decisão (critério 4). */
export function opcoesPreteridas(
  pergunta: Pergunta,
  decisao: Decision
): readonly { readonly rotulo: string; readonly impacto: string }[] {
  return pergunta.opcoes
    .filter((o) => o.id !== decisao.escolha)
    .map((o) => ({ rotulo: o.rotulo, impacto: o.impacto }))
}

function origemDaDecisao(decisao: Decision): OrigemDaAfirmacao {
  return { tipo: 'decisao', decisaoId: decisao.id, perguntaId: decisao.perguntaId }
}

function origemDaFonte(fonte: FonteDoLandscape): OrigemDaAfirmacao {
  return { tipo: 'evidencia', url: fonte.url, hashConteudo: fonte.hashConteudo }
}

/**
 * As afirmações do PRD.
 *
 * Só as perguntas que o PRD de fato usa entram, e cada uma vira **duas** contribuições quando
 * há opção preterida: a do escopo e a do não-objetivo. A afirmação preterida carrega a **mesma**
 * origem — ela é consequência da mesma decisão, não de outra.
 */
export function afirmacoesDoPrd(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta,
  perguntasDoPrd: readonly string[]
): readonly AfirmacaoDoPacote[] {
  const afirmacoes: AfirmacaoDoPacote[] = []

  for (const perguntaId of perguntasDoPrd) {
    const decisao = decisoes[perguntaId]
    const pergunta = catalogo.find((p) => p.id === perguntaId)
    if (decisao === undefined || pergunta === undefined) continue

    afirmacoes.push({
      id: `prd-escopo-${perguntaId}`,
      secao: 'Escopo',
      texto: `**${pergunta.titulo}:** ${textoDaDecisao(pergunta, decisao)}`,
      origem: origemDaDecisao(decisao)
    })

    for (const [i, preterida] of opcoesPreteridas(pergunta, decisao).entries()) {
      afirmacoes.push({
        id: `prd-nao-objetivo-${perguntaId}-${i}`,
        secao: 'Não objetivos',
        texto: `${preterida.rotulo} — ${preterida.impacto}`,
        origem: origemDaDecisao(decisao)
      })
    }
  }

  return afirmacoes
}

/**
 * As afirmações do Landscape — uma por fonte extraída.
 *
 * **Nenhuma afirmação sem fonte.** Não há seção de "análise" composta por nós: o Landscape
 * registra o que as fontes disseram, com URL, data e hash, e a leitura é do PI. Um parágrafo de
 * síntese escrito aqui seria conclusão sem evidência — exatamente o que o critério 2 proíbe.
 */
export function afirmacoesDoLandscape(
  fontes: readonly FonteDoLandscape[]
): readonly AfirmacaoDoPacote[] {
  return fontes.map((fonte, i) => ({
    id: `landscape-fonte-${i}`,
    secao: 'Cenário',
    texto: `**[${fonte.titulo}](${fonte.url})** — ${fonte.trecho.trim()}`,
    origem: origemDaFonte(fonte)
  }))
}

/**
 * As afirmações da Convention — o vocabulário que o PI informou.
 *
 * **Só decisão do PI vira regra.** Nenhuma política deste repositório é copiada para o projeto
 * gerado (decisão cravada da spec), e por isso não há um catálogo de invariantes padrão aqui:
 * a Convention nasce pequena e cresce com o que o PI decidir, que é a diferença entre um
 * contrato de domínio e um formulário preenchido.
 */
export function afirmacoesDaConvention(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta
): readonly AfirmacaoDoPacote[] {
  return Object.values(decisoes)
    .filter((d) => d.motivo !== 'omitida')
    .map((decisao) => {
      const pergunta = catalogo.find((p) => p.id === decisao.perguntaId)
      return pergunta === undefined
        ? undefined
        : {
            id: `convention-${decisao.perguntaId}`,
            secao: 'Vocabulário e regras informadas',
            texto: `**${pergunta.titulo}** — ${textoDaDecisao(pergunta, decisao)}`,
            origem: origemDaDecisao(decisao)
          }
    })
    .filter((a): a is AfirmacaoDoPacote => a !== undefined)
}

/** Agrupa as afirmações por seção, preservando a ordem de entrada dentro de cada uma. */
function porSecao(
  afirmacoes: readonly AfirmacaoDoPacote[]
): readonly (readonly [string, readonly AfirmacaoDoPacote[]])[] {
  const mapa = new Map<string, AfirmacaoDoPacote[]>()
  for (const a of afirmacoes) {
    const atual = mapa.get(a.secao)
    if (atual === undefined) mapa.set(a.secao, [a])
    else atual.push(a)
  }
  return [...mapa.entries()]
}

/**
 * Renderiza um documento em Markdown.
 *
 * Cada afirmação sai como item de lista seguido da **marca de origem** em comentário HTML: some
 * na leitura renderizada e permanece no arquivo versionado. O revisor lê o documento; quem
 * audita lê o rastro — e os dois leem o mesmo arquivo.
 *
 * A seção vazia é **declarada**, não omitida: um Landscape sem a seção de cenário pareceria um
 * documento que não previu o assunto, quando o fato é que a pesquisa não trouxe fonte. Dizer
 * isso é o mínimo para o leitor não confundir ausência com esquecimento.
 */
export function renderizarDocumento(
  documento: DocumentoDoPacote,
  projeto: IdentidadeDoProjeto,
  afirmacoes: readonly AfirmacaoDoPacote[],
  secoesEsperadas: readonly string[],
  preambulo: string
): string {
  const linhas: string[] = [`# ${documento} — ${projeto.nome}`, '', preambulo, '']
  const agrupadas = new Map(porSecao(afirmacoes))

  for (const secao of secoesEsperadas) {
    linhas.push(`## ${secao}`, '')
    const daSecao = agrupadas.get(secao) ?? []

    if (daSecao.length === 0) {
      linhas.push('_Sem conteúdo registrado nesta revisão._', '')
      continue
    }

    for (const afirmacao of daSecao) {
      linhas.push(`- ${afirmacao.texto}`, `  ${marcaDeOrigem(afirmacao.origem)}`)
    }
    linhas.push('')
  }

  return linhas.join('\n')
}

/** As seções de cada documento, na ordem em que aparecem. Dado, não lógica. */
export const SECOES_DO_DOCUMENTO: Readonly<Record<DocumentoDoPacote, readonly string[]>> = {
  PRD: ['Escopo', 'Não objetivos', 'Questões pendentes'],
  LANDSCAPE: ['Cenário', 'Gatilhos de revisão'],
  CONVENTION: ['Vocabulário e regras informadas']
}

/**
 * O preâmbulo de cada documento. Diz **como o arquivo foi produzido** — sem isso, um leitor
 * futuro não sabe se pode editá-lo à mão nem de onde vieram as marcas de origem.
 */
export const PREAMBULO_DO_DOCUMENTO: Readonly<Record<DocumentoDoPacote, string>> = {
  PRD: '> Composto das decisões do planejamento. Cada item cita a decisão que o originou.',
  LANDSCAPE:
    '> Composto de fontes externas extraídas. Cada item cita a URL e o hash do conteúdo no momento da coleta.',
  CONVENTION:
    '> Só contém regras informadas no planejamento deste projeto. Nenhuma política de outro projeto é importada.'
}

/**
 * Os gatilhos de revisão do Landscape (critério 6).
 *
 * São **derivados das fontes**, não escritos à mão: cada fonte coletada é um gatilho, porque o
 * que faz o Landscape envelhecer é a fonte mudar. `conteudoMudou` (M6-F06) é o que responde a
 * pergunta depois — aqui se registra qual pergunta fazer e sobre o quê.
 */
export function gatilhosDeRevisao(
  fontes: readonly FonteDoLandscape[]
): readonly AfirmacaoDoPacote[] {
  return fontes.map((fonte, i) => ({
    id: `landscape-gatilho-${i}`,
    secao: 'Gatilhos de revisão',
    texto: `Revisar se o conteúdo de [${fonte.titulo}](${fonte.url}) mudar desde a coleta em ${fonte.coletadoEm}.`,
    origem: origemDaFonte(fonte)
  }))
}
