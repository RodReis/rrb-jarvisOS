/**
 * PRD, Landscape e Convention gerados por IA (SPEC-Jornada-03).
 *
 * A pergunta que este arquivo responde: **o que os três documentos estruturais podem afirmar, e
 * o que sustenta cada afirmação?** É a mesma pergunta da M8-F04, com a inversão que a
 * SPEC-Jornada-03 fez: lá os documentos eram **compostos** a partir de decisões e evidências, e
 * a não-invenção era consequência da construção; aqui eles são **gerados por modelo**, e a
 * garantia precisa ser verificada sobre a saída antes de qualquer gravação.
 *
 * Quatro decisões governam o arquivo:
 *
 *  - **Quatro origens, e cada documento admite um subconjunto diferente.** `brief` e `decisao`
 *    apontam para o que o PI escreveu ou escolheu; `evidencia` aponta para conteúdo extraído;
 *    `proposto` é inferência do modelo. O Landscape é o caso duro: afirmação sobre terceiro sem
 *    `evidencia` **não passa** (critério 2), porque é ali que um modelo alucina concorrente.
 *  - **Origem `brief` é âncora, não texto** (decisão cravada pelo Cowork). A afirmação do PRD
 *    referencia o **id** da afirmação do brief aceito, e o validador confere que aquele id
 *    existe — é o que faz "todo requisito tem origem" ser checável por máquina em vez de lido.
 *  - **Síntese sobre evidência é permitida; fonte fabricada não.** O limite da M8-F04 ("síntese
 *    seria conclusão sem evidência") cai: a afirmação sintetiza, mas cita as URLs, e elas têm de
 *    estar no conjunto extraído. Uma URL que o modelo inventou não está lá, e a recusa é
 *    estrutural.
 *  - **Contradição vira pergunta, não correção.** Duas afirmações incompatíveis são um fato
 *    sobre a entrada, e resolvê-las em silêncio escolheria por quem decide (critério 6).
 *
 * Mora em `src/shared/domain` porque a tela mostra origem por afirmação, separa os `proposto`
 * por documento e exibe o bloqueio do Landscape — e a regra precisa ser verificável sem carregar
 * o Electron, como em `brief.ts` e `pacote-estrutural.ts`.
 */

import type { WorkspaceId } from './entities'
import type { Pergunta } from './wizard'
import type { BloqueioExterno, DocumentoDoPacote } from './pacote-estrutural'
import { DOCUMENTOS_DO_PACOTE } from './pacote-estrutural'
import { TERMOS_QUE_EXIGEM_ORIGEM_HUMANA, normalizar } from './brief'

/**
 * De onde uma afirmação dos três documentos veio.
 *
 * **Quatro origens, e a assimetria entre elas é o contrato.** `brief` e `decisao` referenciam
 * algo que o PI produziu; `evidencia` referencia conteúdo baixado e hasheado; `proposto` é a
 * única que a IA cria sozinha — e é a única que o gate lista separada, por documento, para o PI
 * cortar antes de aceitar.
 *
 * Não existe origem "modelo" para conteúdo material. É a mesma ausência deliberada de
 * `pacote-estrutural.ts` e de `brief.ts`: o que a IA infere se chama `proposto` e carrega essa
 * marca até o aceite.
 */
export const ORIGENS_DO_PRD = ['brief', 'decisao', 'evidencia', 'proposto'] as const

export type OrigemDoPrd = (typeof ORIGENS_DO_PRD)[number]

export function isOrigemDoPrd(value: unknown): value is OrigemDoPrd {
  return typeof value === 'string' && (ORIGENS_DO_PRD as readonly string[]).includes(value)
}

/**
 * Uma afirmação de um dos três documentos.
 *
 * `origem` não é opcional, e `referencia`/`fontes` são o que a torna verificável:
 *
 *  - `brief` ⇒ `referencia` é o **id da afirmação** do brief aceito (âncora, não texto).
 *  - `decisao` ⇒ `referencia` é o id da `Decision`.
 *  - `evidencia` ⇒ `fontes` são as URLs extraídas que sustentam a síntese.
 *  - `proposto` ⇒ nenhuma das duas; se houvesse, não seria inferência.
 */
export interface AfirmacaoDoPrd {
  readonly id: string
  readonly documento: DocumentoDoPacote
  readonly secao: string
  readonly texto: string
  readonly origem: OrigemDoPrd
  /** Id da afirmação do brief (origem `brief`) ou da decisão (origem `decisao`). */
  readonly referencia?: string
  /** URLs que sustentam a afirmação. Obrigatórias e não vazias na origem `evidencia`. */
  readonly fontes?: readonly string[]
}

/**
 * Uma contradição detectada entre documentos ou contra o brief (critério 6).
 *
 * **É uma pergunta do contrato da M8-F03** (emenda E1): opções excludentes com impacto,
 * recomendada primeiro com justificativa, texto livre e delegação declarados pelo modelo. Assim
 * a máquina do `wizard.ts` e o pop-up do refinamento a conduzem sem uma segunda superfície —
 * mostrar duas frases incompatíveis com uma recomendação em prosa devolvia ao PI o trabalho de
 * decidir sem opção acionável, que é exatamente o que o contrato existe para evitar.
 */
export interface ContradicaoDoPrd extends Pergunta {
  /** As afirmações em conflito. Duas ou mais ids de `AfirmacaoDoPrd` ou do brief. */
  readonly afirmacoes: readonly string[]
}

/** A `etapa` que a pergunta e a decisão sobre uma contradição carregam. */
export const ETAPA_DA_CONTRADICAO = 'prd'

/**
 * Lê uma contradição como foi gravada.
 *
 * Revisões anteriores à emenda E1 guardavam só `pergunta` e `recomendacao`. Elas viram pergunta
 * de **texto livre**, sem opções e sem delegação: continuam respondíveis pelo mesmo pop-up e
 * nunca quebram a tela — `opcoesOrdenadas` sobre `opcoes` ausente derrubaria o componente.
 */
export function contradicaoGravada(bruta: Record<string, unknown>): ContradicaoDoPrd {
  if (Array.isArray(bruta['opcoes'])) return bruta as unknown as ContradicaoDoPrd

  return {
    id: typeof bruta['id'] === 'string' ? bruta['id'] : '',
    etapa: ETAPA_DA_CONTRADICAO,
    afirmacoes: Array.isArray(bruta['afirmacoes']) ? (bruta['afirmacoes'] as string[]) : [],
    titulo: 'Contradição',
    enunciado: typeof bruta['pergunta'] === 'string' ? bruta['pergunta'] : '',
    opcoes: [],
    recomendada: '',
    justificativa: typeof bruta['recomendacao'] === 'string' ? bruta['recomendacao'] : '',
    aceitaTextoLivre: true,
    delegavel: false
  }
}

/**
 * O conteúdo dos três documentos, antes de virar prosa. A prosa é renderizada disto.
 *
 * `bloqueioDoLandscape` presente significa que a pesquisa não saiu — e, por decisão do PI de
 * 2026-09-03, **isso não bloqueia o PRD nem a Convention**: só o Landscape fica pendente, e o
 * gate exibe o bloqueio com a retomada.
 */
export interface ConteudoDoPrd {
  readonly projectId: string
  readonly afirmacoes: readonly AfirmacaoDoPrd[]
  readonly contradicoes: readonly ContradicaoDoPrd[]
  readonly bloqueioDoLandscape?: BloqueioExterno
}

/** O pacote gravado, com a procedência: qual brief e qual pacote de contexto o originaram. */
export interface PrdRegistrado extends ConteudoDoPrd {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /** O hash da revisão **aceita** do brief que originou estes documentos. */
  readonly briefHash: string
  readonly hash: string
  readonly commitHash: string | null
  readonly contextPackId: string | null
  readonly created_at: string
}

/**
 * Por que o validador recusou. Enum fechado: a tela decide o que mostrar a partir dele, e um
 * motivo novo quebra a compilação em vez de cair num default silencioso.
 */
export const RECUSAS_DO_PRD = [
  'origem-ausente',
  'origem-desconhecida',
  'documento-desconhecido',
  'texto-vazio',
  'referencia-ausente',
  /** Origem `brief` citando um id que não existe na revisão aceita (critério 1). */
  'ancora-inexistente',
  /** Afirmação sobre terceiro no Landscape sem evidência extraída (critério 2). */
  'landscape-sem-evidencia',
  /** Origem `evidencia` citando URL que não está no conjunto extraído — fonte fabricada. */
  'fonte-nao-extraida',
  /** Requisito legal/regulatório inferido pelo modelo (invariante 9). */
  'requisito-sem-origem-humana',
  /** Regra de outro projeto na Convention — inclusive as labels `proplan:*` deste repositório. */
  'regra-de-outro-projeto'
] as const

export type RecusaDoPrd = (typeof RECUSAS_DO_PRD)[number]

export interface ProblemaNoPrd {
  readonly recusa: RecusaDoPrd
  /** Qual afirmação causou. Vazio quando o problema é do documento, não de uma linha. */
  readonly afirmacaoId?: string
  readonly mensagem: string
}

export interface ValidacaoDoPrd {
  readonly valido: boolean
  readonly problemas: readonly ProblemaNoPrd[]
}

/**
 * O vocabulário de processo **deste** repositório, que a Convention gerada não pode conter
 * (critério 5, herdado da M8-F04).
 *
 * A Convention do projeto gerado descreve as entidades, os estados e o vocabulário **dele**. As
 * labels `proplan:*`, os papéis do trio e o ciclo de vida das issues são política do rrb-jarvisOS
 * — copiá-los para o projeto do PI seria impor um processo que ninguém escolheu.
 *
 * Casados sem acento e em minúsculas, mesma normalização de `TERMOS_QUE_EXIGEM_ORIGEM_HUMANA`:
 * um modelo escreve "ProPlan", "proplan" e "pro plan" com a mesma facilidade.
 */
export const TERMOS_DE_OUTRO_PROJETO = [
  'proplan:',
  'claude cowork',
  'claude code',
  'aprovada-pi',
  'rrb-jarvisos',
  'jarvis os',
  'noa'
] as const

/**
 * Onde cada documento é escrito. Reusa `ARQUIVO_DO_DOCUMENTO` do pacote estrutural — os três
 * documentos são os mesmos; o que mudou é como nascem, não onde moram.
 */
export { ARQUIVO_DO_DOCUMENTO } from './pacote-estrutural'

/** As seções de cada documento, na ordem de leitura (SPEC-Planejamento-04, mantidas). */
export const SECOES_DO_PRD: Readonly<Record<DocumentoDoPacote, readonly string[]>> = {
  PRD: [
    'Problema',
    'Usuários',
    'Jornadas',
    'Escopo',
    'Não objetivos',
    'Critérios de sucesso',
    'Restrições',
    'Questões pendentes'
  ],
  LANDSCAPE: ['Cenário', 'Alternativas', 'Diferenciação', 'Incertezas', 'Gatilhos de revisão'],
  CONVENTION: ['Entidades', 'Estados', 'Invariantes', 'Vocabulário']
}

/**
 * As origens que cada documento admite.
 *
 * **O Landscape não admite `brief` nem `decisao`**, e a exclusão é o critério 2 em forma de
 * dado: o que o documento afirma é sobre **terceiros**, e o PI não é fonte sobre o mercado.
 * Ele admite `proposto` porque a spec permite hipótese — marcada como tal, nunca como conclusão.
 *
 * PRD e Convention não admitem `evidencia`: eles descrevem o projeto do PI, e uma página da web
 * não decide o escopo dele.
 */
export const ORIGENS_POR_DOCUMENTO: Readonly<Record<DocumentoDoPacote, readonly OrigemDoPrd[]>> = {
  PRD: ['brief', 'decisao', 'proposto'],
  LANDSCAPE: ['evidencia', 'proposto'],
  CONVENTION: ['brief', 'decisao', 'proposto']
}

/** O que o validador precisa saber sobre o mundo, para conferir as âncoras. */
export interface ContextoDaValidacao {
  /** Os ids das afirmações do brief aceito — as âncoras válidas da origem `brief`. */
  readonly afirmacoesDoBrief: readonly string[]
  /** As URLs (canônicas) com evidência extraída — as fontes válidas da origem `evidencia`. */
  readonly urlsComEvidencia: readonly string[]
}

/**
 * Valida a saída do modelo **antes de gravar** (critérios 1, 2 e 5).
 *
 * Devolve todos os problemas, não o primeiro, pela mesma razão de `validarBrief`: quem gerou
 * corrige a saída inteira, e parar no primeiro faria o conserto virar uma rodada de modelo por
 * problema.
 *
 * **Fail closed em toda decisão.** Origem desconhecida é recusa, não default para `proposto`;
 * documento desconhecido é recusa, não seção extra; URL citada que não está no conjunto extraído
 * é recusa, não aviso. Cada um desses lados permissivos seria exatamente a porta que os
 * critérios existem para fechar.
 */
export function validarPrd(conteudo: ConteudoDoPrd, contexto: ContextoDaValidacao): ValidacaoDoPrd {
  const problemas: ProblemaNoPrd[] = []
  const ancoras = new Set(contexto.afirmacoesDoBrief)
  const extraidas = new Set(contexto.urlsComEvidencia)

  for (const a of conteudo.afirmacoes) {
    if (!isDocumentoDoPrd(a.documento)) {
      problemas.push({
        recusa: 'documento-desconhecido',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" declara o documento "${a.documento}", que não existe no pacote.`
      })
      continue
    }

    if (a.texto.trim().length === 0) {
      problemas.push({
        recusa: 'texto-vazio',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" está vazia.`
      })
    }

    // A ausência é checada antes do valor, mesma ordem de `validarBrief`: origem ausente e
    // origem inválida são problemas diferentes, e fundi-los esconderia qual dos dois ocorreu.
    if (a.origem === undefined || a.origem === null) {
      problemas.push({
        recusa: 'origem-ausente',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" não declara origem. Toda afirmação carrega origem (critério 1).`
      })
      continue
    }

    if (!isOrigemDoPrd(a.origem)) {
      problemas.push({
        recusa: 'origem-desconhecida',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" declara a origem "${a.origem}", que não existe.`
      })
      continue
    }

    // A origem tem de fazer sentido para o documento: uma afirmação de Landscape com origem
    // `brief` diria que o PI é fonte sobre o mercado, que é o que o critério 2 nega.
    if (!ORIGENS_POR_DOCUMENTO[a.documento].includes(a.origem)) {
      problemas.push({
        recusa: a.documento === 'LANDSCAPE' ? 'landscape-sem-evidencia' : 'origem-desconhecida',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" usa a origem "${a.origem}" no documento ${a.documento}, que não a admite.`
      })
      continue
    }

    problemas.push(...problemasDaOrigem(a, ancoras, extraidas))

    // A invariante 9, em runtime — a mesma de `validarBrief`, sobre outro texto: requisito
    // legal, regulatório ou de consentimento só existe se o PI o disse ou o escolheu.
    if (a.origem === 'proposto') {
      const texto = normalizar(a.texto)
      const termo = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.find((t) => texto.includes(t))

      if (termo !== undefined) {
        problemas.push({
          recusa: 'requisito-sem-origem-humana',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" trata de "${termo}" com origem "proposto". Requisito legal, regulatório, de consentimento ou de classificação de domínio só entra vindo do brief ou de uma decisão do PI (invariante 9).`
        })
      }
    }

    // A Convention descreve o projeto do PI, não o processo deste repositório (critério 5).
    if (a.documento === 'CONVENTION') {
      const texto = normalizar(a.texto)
      const termo = TERMOS_DE_OUTRO_PROJETO.find((t) => texto.includes(t))

      if (termo !== undefined) {
        problemas.push({
          recusa: 'regra-de-outro-projeto',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" traz "${termo}", que é vocabulário de outro projeto. A Convention descreve as entidades, os estados e o vocabulário deste projeto.`
        })
      }
    }
  }

  return { valido: problemas.length === 0, problemas }
}

/**
 * O que cada origem exige, além de existir.
 *
 * Separado do laço principal porque são quatro regras distintas sobre o mesmo campo, e
 * mantê-las juntas no corpo de `validarPrd` empilharia quatro níveis de condicional sobre um
 * `switch` que aqui cabe em uma leitura.
 */
function problemasDaOrigem(
  a: AfirmacaoDoPrd,
  ancoras: ReadonlySet<string>,
  extraidas: ReadonlySet<string>
): readonly ProblemaNoPrd[] {
  switch (a.origem) {
    // Âncora, não texto: o id tem de existir na revisão aceita do brief. Sem a conferência,
    // "origem brief" seria uma etiqueta que o modelo cola em qualquer frase (critério 1).
    case 'brief': {
      if (a.referencia === undefined || a.referencia.trim() === '') {
        return [
          {
            recusa: 'referencia-ausente',
            afirmacaoId: a.id,
            mensagem: `A afirmação "${a.id}" diz vir do brief, mas não referencia qual afirmação.`
          }
        ]
      }

      if (!ancoras.has(a.referencia)) {
        return [
          {
            recusa: 'ancora-inexistente',
            afirmacaoId: a.id,
            mensagem: `A afirmação "${a.id}" ancora em "${a.referencia}", que não existe na revisão aceita do brief.`
          }
        ]
      }

      return []
    }

    case 'decisao':
      return a.referencia === undefined || a.referencia.trim() === ''
        ? [
            {
              recusa: 'referencia-ausente',
              afirmacaoId: a.id,
              mensagem: `A afirmação "${a.id}" diz vir de uma decisão, mas não referencia qual.`
            }
          ]
        : []

    // Síntese sobre evidência é permitida; fonte fabricada não. A URL citada tem de estar no
    // conjunto extraído — é o que separa "o modelo sintetizou o que leu" de "o modelo inventou
    // um concorrente e uma URL plausível".
    case 'evidencia': {
      const fontes = a.fontes ?? []

      if (fontes.length === 0) {
        return [
          {
            recusa: 'landscape-sem-evidencia',
            afirmacaoId: a.id,
            mensagem: `A afirmação "${a.id}" é sobre terceiro e não cita nenhuma fonte extraída (critério 2).`
          }
        ]
      }

      const ausentes = fontes.filter((f) => !extraidas.has(f))

      return ausentes.length === 0
        ? []
        : [
            {
              recusa: 'fonte-nao-extraida',
              afirmacaoId: a.id,
              mensagem: `A afirmação "${a.id}" cita ${ausentes.join(', ')}, que não está no conjunto extraído. Fonte não extraída não sustenta afirmação.`
            }
          ]
    }

    // `proposto` não exige nada — é inferência, e exigir referência dela seria pedir que a IA
    // atribuísse a outro o que ela mesma inventou.
    default:
      return []
  }
}

export function isDocumentoDoPrd(valor: unknown): valor is DocumentoDoPacote {
  return typeof valor === 'string' && (DOCUMENTOS_DO_PACOTE as readonly string[]).includes(valor)
}

/**
 * Os `proposto` de um documento — o que o PI corta item a item no gate.
 *
 * **Por documento**, e não numa lista só: a spec pede "a lista de `proposto` por documento", e
 * uma inferência sobre o mercado se julga com outra cabeça que uma inferência sobre o escopo.
 */
export function propostosDoDocumento(
  conteudo: ConteudoDoPrd,
  documento: DocumentoDoPacote
): readonly AfirmacaoDoPrd[] {
  return conteudo.afirmacoes.filter((a) => a.documento === documento && a.origem === 'proposto')
}

/** As afirmações de um documento, na ordem em que o modelo as produziu. */
export function afirmacoesDoDocumento(
  conteudo: ConteudoDoPrd,
  documento: DocumentoDoPacote
): readonly AfirmacaoDoPrd[] {
  return conteudo.afirmacoes.filter((a) => a.documento === documento)
}

/**
 * Remove um `proposto`, preservando tudo o mais.
 *
 * Só corta o que é `proposto`, mesma guarda de `cortarProposto` do brief: um id de outra origem
 * passa e o conteúdo volta igual. Sem ela, um id errado apagaria em silêncio uma afirmação
 * ancorada no brief.
 */
export function cortarPropostoDoPrd(conteudo: ConteudoDoPrd, afirmacaoId: string): ConteudoDoPrd {
  return {
    ...conteudo,
    afirmacoes: conteudo.afirmacoes.filter(
      (a) => !(a.id === afirmacaoId && a.origem === 'proposto')
    )
  }
}

/**
 * O aceite está liberado? (critério 6.)
 *
 * **Contradição não resolvida bloqueia; Landscape bloqueado não.** As duas regras vêm da mesma
 * spec e dizem coisas opostas de propósito: uma contradição é um conflito **interno** que só o
 * PI desfaz, e aceitar por cima escolheria por ele. A pesquisa que não saiu é uma falta
 * **externa**, e a decisão do PI de 2026-09-03 é explícita — o PRD depende do brief, não do
 * mercado, e o Landscape fica pendente e visível.
 */
export function podeAceitarPrd(conteudo: ConteudoDoPrd): boolean {
  return conteudo.contradicoes.length === 0
}

/**
 * Por que a geração não produziu revisão. Fechado: a tela decide o que mostrar a partir dele, e
 * um motivo novo quebra a compilação em vez de cair num default silencioso.
 *
 * Mora no domínio, e não no serviço, porque atravessa a ponte IPC — mesma razão de
 * `GeracaoOutcome` em `brief.ts`: o contrato precisa do tipo e não pode importar do main.
 */
export const RESULTADOS_DO_PRD = [
  'gerado',
  'bloqueado-sem-rota',
  'saida-invalida',
  'projeto-inexistente',
  /** O brief ainda não passou pelo gate: sem revisão aceita não há âncora para a origem `brief`. */
  'brief-nao-aceito',
  'sem-contexto',
  'falha-de-escrita'
] as const

export type ResultadoDoPrd = (typeof RESULTADOS_DO_PRD)[number]

/** O desfecho da geração. Recusa volta como *outcome*, nunca como promise rejeitada. */
export interface PrdOutcome {
  readonly resultado: ResultadoDoPrd
  readonly prd?: PrdRegistrado
  readonly mensagem: string
  /** O que o PI faz para destravar, quando bloqueou. */
  readonly acao?: string
  /** Os problemas do validador, quando a saída foi recusada. */
  readonly problemas?: readonly string[]
}

/** O Landscape saiu, ou ficou pendente por bloqueio de pesquisa? */
export function landscapePendente(conteudo: ConteudoDoPrd): boolean {
  return conteudo.bloqueioDoLandscape !== undefined
}

/**
 * A marca de origem que acompanha cada afirmação no arquivo gerado.
 *
 * Comentário HTML, mesma escolha de `marcaDeOrigem` da M8-F04 e pelo mesmo motivo: some na
 * leitura renderizada e permanece no arquivo versionado — o revisor lê o documento, e quem
 * audita lê o rastro. Um rodapé de notas empurraria a origem para longe da frase que a justifica.
 */
export function marcaDeOrigemDoPrd(afirmacao: AfirmacaoDoPrd): string {
  switch (afirmacao.origem) {
    case 'brief':
      return `<!-- origem: brief · ${afirmacao.referencia ?? ''} -->`
    case 'decisao':
      return `<!-- origem: decisao · ${afirmacao.referencia ?? ''} -->`
    case 'evidencia':
      return `<!-- origem: evidencia · ${(afirmacao.fontes ?? []).join(' · ')} -->`
    default:
      return '<!-- origem: proposto · inferência da IA, revisada pelo dono do projeto -->'
  }
}

/**
 * O preâmbulo de cada documento. Diz **como o arquivo foi produzido** — sem isso, um leitor
 * futuro não sabe se pode editá-lo à mão nem de onde vieram as marcas de origem.
 *
 * Diferente do preâmbulo da M8-F04 porque o modo de produção mudou: lá era composição, aqui é
 * geração verificada. Dizer "composto" num arquivo gerado seria descrever errado o que ele é.
 */
export const PREAMBULO_DO_PRD: Readonly<Record<DocumentoDoPacote, string>> = {
  PRD: '> Gerado a partir do brief aceito. Cada item cita a afirmação do brief, a decisão ou a inferência que o originou.',
  LANDSCAPE:
    '> Gerado a partir de fontes externas extraídas. Cada item cita as URLs que o sustentam; hipóteses são marcadas como proposta.',
  CONVENTION:
    '> Descreve as entidades, os estados e o vocabulário deste projeto. Nenhuma política de outro projeto é importada.'
}

/**
 * Renderiza um documento a partir das afirmações.
 *
 * O `conteudo` do arquivo é **derivado** das afirmações, nunca digitado em paralelo: é o que
 * permite hashear exatamente o que foi escrito no disco e o que garante que a marca de origem
 * de cada linha corresponde à afirmação que ela acompanha.
 *
 * **Não reusa `renderizarDocumento` da M8-F04** porque a forma da origem é outra: lá são duas
 * variantes de união, aqui são quatro origens com referência ou fontes. Adaptar a função antiga
 * exigiria converter as afirmações para um tipo que perde `fontes` — e o Landscape existe para
 * carregá-las.
 *
 * Bloqueio do Landscape entra **dentro do documento**, e não só na tela: quem abrir
 * `LANDSCAPE.md` no repositório do projeto precisa ver que a pesquisa não saiu, com a retomada.
 */
export function renderizarDocumentoDoPrd(
  documento: DocumentoDoPacote,
  nomeDoProjeto: string,
  afirmacoes: readonly AfirmacaoDoPrd[],
  bloqueio?: BloqueioExterno
): string {
  const linhas: string[] = [
    `# ${documento} — ${nomeDoProjeto}`,
    '',
    PREAMBULO_DO_PRD[documento],
    ''
  ]

  if (bloqueio !== undefined) {
    linhas.push(
      '> **Pesquisa bloqueada.** Este documento está incompleto.',
      `> Causa: ${bloqueio.causa}. ${bloqueio.evidencia}`,
      `> Por que não seguir: ${bloqueio.porQueNaoSeguir}`,
      `> Retomada: ${bloqueio.retomada}`,
      ''
    )
  }

  for (const secao of SECOES_DO_PRD[documento]) {
    linhas.push(`## ${secao}`, '')
    const daSecao = afirmacoes.filter((a) => a.secao === secao)

    if (daSecao.length === 0) {
      linhas.push('_Sem conteúdo registrado nesta revisão._', '')
      continue
    }

    for (const a of daSecao) {
      linhas.push(`- ${a.texto}`, `  ${marcaDeOrigemDoPrd(a)}`)
    }
    linhas.push('')
  }

  return linhas.join('\n')
}
