/**
 * O roadmap, o documento do MVP e a SPEC da primeira fatia, gerados por IA (SPEC-Jornada-05).
 *
 * A pergunta que este arquivo responde: **o que um roadmap gerado por modelo pode afirmar sobre
 * um projeto que ainda não começou, e o que sustenta cada MVP e cada fatia?**
 *
 * É a terceira vez que o MVP-025 faz esta inversão — a F03 com o PRD, a F04 com a arquitetura, e
 * agora o roadmap. Na M8-F06 os MVPs eram **compostos** da decisão de escopo e das jornadas
 * prototipadas: a não-invenção era consequência da construção, e o preço era um roadmap que só
 * sabia duas formas (um MVP por jornada, ou uma fundação e as jornadas depois). Aqui um modelo
 * propõe, e a garantia precisa ser verificada sobre a saída antes de qualquer gravação.
 *
 * Quatro decisões governam o arquivo:
 *
 *  - **A IA regenera contra o validador de DAG; não o substitui** (decisão cravada da spec). O
 *    grafo é verificável por máquina, e `validarDag` continua sendo a autoridade sobre ele.
 *    Confiar no texto seria abrir mão de uma garantia que já existe — e um ciclo aceito porque
 *    "o modelo disse que está certo" é um roadmap em que nada pode começar.
 *  - **Toda origem é obrigatória, e são três** (critério 2): `prd`, `arquitetura` e `proposto`.
 *    As duas primeiras são âncoras por id de afirmação da revisão aceita — a mesma disciplina
 *    que a F03 aplicou ao brief e a F04 ao PRD. `proposto` é o que a IA inferiu, e é o que o
 *    gate lista separado para o PI ver antes de escolher.
 *  - **A SPEC gerada nasce `rascunho` com perguntas abertas obrigatórias** (critério 4, decisão
 *    cravada). Uma SPEC sem pergunta sugeriria que não há nada a decidir — que é exatamente o
 *    que a geração não sabe. A regra deste repositório (o Cowork apresenta as perguntas antes de
 *    `aprovada-pi`) vale para o projeto gerado.
 *  - **O MVP aceito é congelado, não recasado** (critério 6, decisão do PI de 2026-09-03).
 *    Regenerar o roadmap depois de um `MVP_ENTRY` não toca o MVP promovido nem suas fatias: eles
 *    saem do escopo da regeneração em vez de dependerem de o modelo repetir o mesmo título. Um
 *    id derivado do texto faria o MVP aceito virar outro na primeira renomeação.
 *
 * **O que este arquivo não faz:** não escreve arquivo, não calcula hash de disco, não consulta
 * banco, não chama modelo. Só descreve a forma do que foi gerado e as regras puras sobre ele.
 *
 * Mora em `src/shared/domain` porque a tela mostra origem por MVP, separa os `proposto`, lista
 * as perguntas da SPEC e desenha os dois gates — e a regra precisa ser verificável sem carregar
 * o Electron, como em `prd.ts` e `arquitetura-gerada.ts`.
 */

import type { WorkspaceId } from './entities'
import type { Mvp, ProblemaEncontrado, Roadmap, Slice } from './roadmap'
import { validarDag } from './roadmap'
import { TERMOS_QUE_EXIGEM_ORIGEM_HUMANA, normalizar } from './brief'
import { TERMOS_DE_OUTRO_PROJETO } from './prd'
import { slugificar } from './projects'

/**
 * De onde um MVP ou uma fatia veio.
 *
 * **Três origens, e a assimetria entre elas é o contrato.** `prd` referencia o requisito aceito;
 * `arquitetura` referencia a afirmação dos documentos técnicos; `proposto` é a única que a IA
 * cria sozinha — e é a única que o gate lista separada, para o PI ver antes de escolher qual MVP
 * entra na fila.
 *
 * Não existe origem "modelo" para conteúdo material. É a mesma ausência deliberada de `prd.ts` e
 * de `arquitetura-gerada.ts`: o que a IA infere se chama `proposto` e carrega essa marca até o
 * aceite.
 *
 * Não existe `prototipo` aqui, e a ausência é deliberada: um MVP é um recorte de entrega, não
 * uma tela. O que o protótipo desenhou já entrou na arquitetura, e é por ela que o roadmap o
 * cita — ancorar de novo no anexo duplicaria a âncora sem acrescentar garantia.
 */
export const ORIGENS_DO_ROADMAP = ['prd', 'arquitetura', 'proposto'] as const

export type OrigemDoRoadmap = (typeof ORIGENS_DO_ROADMAP)[number]

export function isOrigemDoRoadmap(value: unknown): value is OrigemDoRoadmap {
  return typeof value === 'string' && (ORIGENS_DO_ROADMAP as readonly string[]).includes(value)
}

/**
 * Um MVP proposto pelo modelo, antes de virar `Mvp` gravado.
 *
 * `referencia` é o que torna `prd` e `arquitetura` verificáveis: o id da afirmação da revisão
 * aceita, conferido pelo validador. `proposto` não a carrega — se carregasse, não seria
 * inferência.
 *
 * `fatias` são o **checklist** do MVP (§ Regras: *"só a próxima fatia recebe SPEC detalhada; as
 * demais existem como checklist"*). Elas nascem aqui e viram `Slice`, mas só uma delas ganha
 * texto executável.
 */
export interface MvpGerado {
  readonly id: string
  readonly numero: number
  readonly titulo: string
  /** O que este MVP entrega. */
  readonly tese: string
  /** O resultado observável quando ele fecha — o que a spec chama de "resultado". */
  readonly resultado: string
  /** Ids de outros MVPs desta mesma geração. */
  readonly dependeDe: readonly string[]
  readonly origem: OrigemDoRoadmap
  /** Id da afirmação do PRD ou da arquitetura. Ausente quando a origem é `proposto`. */
  readonly referencia?: string
  readonly fatias: readonly FatiaGerada[]
}

/** Uma fatia prevista de um MVP — item do checklist, com origem própria. */
export interface FatiaGerada {
  readonly id: string
  readonly numero: number
  readonly titulo: string
  readonly origem: OrigemDoRoadmap
  readonly referencia?: string
}

/**
 * Uma pergunta aberta da SPEC gerada (critério 4).
 *
 * **Não é a pergunta do refinamento**, e a distinção é deliberada (decisão do PI de 2026-09-03):
 * aquela preenche um bloco do brief e tem outro ciclo de vida; esta pertence à revisão da SPEC e
 * bloqueia o `SLICE_ENTRY` até ser respondida. Misturar as duas faria uma pergunta do brief
 * travar o aceite da SPEC.
 *
 * O formato segue o contrato da M8-F03 no que importa para decidir: enunciado, opções
 * excludentes com impacto, e a recomendada justificada. `resposta` é preenchida pelo PI; até lá,
 * `undefined` — e é o que o gate confere.
 */
export interface PerguntaDaSpec {
  readonly id: string
  readonly enunciado: string
  /** Duas ou três opções mutuamente excludentes, cada uma com o impacto declarado. */
  readonly opcoes: readonly OpcaoDaSpec[]
  /** Id da opção recomendada, entre as oferecidas. */
  readonly recomendada: string
  readonly justificativa: string
  /** O id da opção que o PI escolheu, ou o texto livre. `undefined` enquanto não respondeu. */
  readonly resposta?: string
}

export interface OpcaoDaSpec {
  readonly id: string
  readonly rotulo: string
  /** O trade-off. Opção sem impacto é opção sem escolha — mesma regra da M8-F03. */
  readonly impacto: string
}

/** Quantas opções uma pergunta da SPEC admite. O mesmo contrato da `PerguntaGerada`. */
export const MINIMO_DE_OPCOES_DA_SPEC = 2
export const MAXIMO_DE_OPCOES_DA_SPEC = 3

/**
 * A SPEC executável da primeira fatia, como o modelo a produz.
 *
 * As seções são as de `docs/spec/` deste repositório, que é o formato que o MVP-009 lê (§ 5 da
 * spec). Elas são campos, e não prosa livre, pela mesma razão que as afirmações do PRD são: com
 * prosa, *"a SPEC tem critérios de aceite executáveis"* viraria promessa que alguém teria de ler
 * e julgar.
 */
export interface SpecGerada {
  /** A fatia que esta SPEC detalha. */
  readonly fatiaId: string
  readonly titulo: string
  readonly objetivo: string
  /** O fluxo que a fatia entrega, passo a passo. */
  readonly fluxo: readonly string[]
  readonly regras: readonly string[]
  /** Critérios **executáveis**: cada um vira um teste. Lista vazia reprova (critério 4). */
  readonly criteriosDeAceite: readonly string[]
  readonly testes: readonly string[]
  /** As perguntas abertas. **Lista vazia reprova** — ver o cabeçalho do arquivo. */
  readonly perguntas: readonly PerguntaDaSpec[]
}

/** O conteúdo inteiro de uma geração, antes de virar arquivo. */
export interface ConteudoDoRoadmap {
  readonly projectId: string
  readonly mvps: readonly MvpGerado[]
  /** A SPEC da primeira fatia do MVP escolhido. `undefined` antes do `MVP_ENTRY`. */
  readonly spec?: SpecGerada
}

/** A revisão gravada, com a procedência: qual PRD e qual arquitetura a originaram. */
export interface RoadmapRegistrado extends ConteudoDoRoadmap {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /** A revisão do pacote estrutural (PRD) que este roadmap assume. */
  readonly pacoteEstruturalId: string
  /** A revisão da arquitetura que este roadmap assume. */
  readonly arquiteturaId: string
  /** O id do MVP escolhido no `MVP_ENTRY`, ou `null` enquanto o PI não escolheu. */
  readonly mvpEscolhido: string | null
  readonly hash: string
  readonly commitHash: string | null
  readonly contextPackId: string | null
  readonly created_at: string
}

/**
 * O desfecho de uma geração ou de um gate desta fatia.
 *
 * Mora no domínio, e não no serviço, porque a **tela** o consome: o contrato do IPC precisa ser
 * verificável sem carregar o Electron, e um tipo do main atravessando a ponte quebraria a
 * fronteira que `shared/` existe para manter.
 *
 * `bloqueado-sem-rota` é o critério que a F02 inaugurou e as três fatias seguintes mantiveram: o
 * bloqueio acontece **antes** de qualquer chamada, e é um desfecho lido, não um erro.
 */
export const RESULTADOS_DO_ROADMAP = [
  'gerado',
  'projeto-inexistente',
  /** Falta o PRD aceito ou a arquitetura — não há de onde derivar os MVPs. */
  'pacote-ausente',
  'bloqueado-sem-rota',
  'sem-contexto',
  /** A saída não passou no validador, nem depois da correção. Nada foi gravado. */
  'saida-invalida',
  /** O `MVP_ENTRY` ainda não aconteceu: não há MVP escolhido para especificar a fatia. */
  'mvp-nao-escolhido',
  /** O MVP pedido não está entre os elegíveis (critério 3). */
  'mvp-inelegivel',
  'falha-de-escrita'
] as const

export type ResultadoDoRoadmap = (typeof RESULTADOS_DO_ROADMAP)[number]

export interface RoadmapGeradoOutcome {
  readonly resultado: ResultadoDoRoadmap
  readonly roadmap?: RoadmapRegistrado
  /** Em `saida-invalida`: os problemas que o validador nomeou. */
  readonly problemas?: readonly string[]
  /** Em `bloqueado-sem-rota`: o que o PI pode fazer a respeito. */
  readonly acao?: string
  readonly mensagem: string
}

/**
 * Por que a saída do modelo foi recusada. Enum fechado: a tela e o pedido de correção decidem a
 * partir dele, e um problema novo é mudança de contrato.
 */
export const RECUSAS_DO_ROADMAP = [
  'sem-mvp',
  'mvp-sem-titulo',
  'mvp-sem-tese',
  'mvp-sem-resultado',
  'mvp-sem-fatia',
  'fatia-sem-titulo',
  'origem-sem-referencia',
  'referencia-inexistente',
  'proposto-com-referencia',
  'ids-repetidos',
  'dag-invalido',
  'spec-sem-objetivo',
  'spec-sem-criterio',
  'spec-sem-pergunta',
  'pergunta-fora-do-contrato',
  'pergunta-sem-recomendada',
  'requisito-inventado',
  'processo-de-outro-projeto'
] as const

export type RecusaDoRoadmap = (typeof RECUSAS_DO_ROADMAP)[number]

export interface ProblemaNoRoadmap {
  readonly recusa: RecusaDoRoadmap
  readonly mensagem: string
}

export interface ValidacaoDoRoadmap {
  readonly valido: boolean
  readonly problemas: readonly ProblemaNoRoadmap[]
}

/** O que o validador precisa saber para conferir as âncoras e o grafo. */
export interface ContextoDaValidacao {
  /** Ids das afirmações do PRD aceito — o que a origem `prd` pode citar. */
  readonly afirmacoesDoPrd: readonly string[]
  /** Ids das afirmações da arquitetura — o que a origem `arquitetura` pode citar. */
  readonly afirmacoesDaArquitetura: readonly string[]
}

/**
 * Todo texto que o PI **lê** no roadmap e na SPEC. É a superfície onde um requisito inventado ou
 * o processo deste repositório apareceriam — e por isso a varredura cobre tudo, não só a tese.
 */
function textoVisivel(conteudo: ConteudoDoRoadmap): string {
  const doRoadmap = conteudo.mvps.flatMap((m) => [
    m.titulo,
    m.tese,
    m.resultado,
    ...m.fatias.map((f) => f.titulo)
  ])

  const spec = conteudo.spec
  const daSpec =
    spec === undefined
      ? []
      : [
          spec.titulo,
          spec.objetivo,
          ...spec.fluxo,
          ...spec.regras,
          ...spec.criteriosDeAceite,
          ...spec.testes,
          ...spec.perguntas.flatMap((p) => [
            p.enunciado,
            p.justificativa,
            ...p.opcoes.flatMap((o) => [o.rotulo, o.impacto])
          ])
        ]

  return [...doRoadmap, ...daSpec].join(' | ')
}

/**
 * Converte os MVPs gerados na forma que `validarDag` conhece.
 *
 * O grafo é o mesmo objeto de sempre — é por isso que o validador da M8-F06 continua sendo a
 * autoridade sobre ele, e não uma segunda checagem escrita aqui. A conversão existe só porque
 * `MvpGerado` carrega o checklist e a âncora, que o DAG não precisa conhecer.
 */
export function comoMvps(gerados: readonly MvpGerado[]): readonly Mvp[] {
  return gerados.map((m) => ({
    id: m.id,
    numero: m.numero,
    titulo: m.titulo,
    tese: m.tese,
    estado: 'proposto' as const,
    dependeDe: m.dependeDe,
    // A origem do `Mvp` gravado é a do domínio antigo (`decisao`/`evidencia`) e não a daqui: o
    // DAG não a lê, e converter as três origens para as duas perderia justo a distinção que o
    // critério 2 protege. `RoadmapRegistrado` guarda a origem verdadeira.
    origem: { tipo: 'decisao' as const, decisaoId: m.id, perguntaId: 'roadmap-gerado' }
  }))
}

/** Os problemas de DAG traduzidos para o vocabulário do validador desta fatia. */
function problemasDoDag(problemas: readonly ProblemaEncontrado[]): readonly ProblemaNoRoadmap[] {
  return problemas.map((p) => ({ recusa: 'dag-invalido' as const, mensagem: p.mensagem }))
}

/**
 * Valida a saída do modelo — o roadmap e, quando presente, a SPEC.
 *
 * Devolve **todos** os problemas, não o primeiro: quem gerou corrige a saída inteira numa
 * rodada, em vez de uma chamada de modelo por defeito. Mesma economia do validador do PRD e do
 * da arquitetura.
 *
 * **A validação de DAG é delegada a `validarDag`** (decisão cravada da spec): um segundo
 * detector de ciclo escrito aqui divergiria do primeiro no dia em que um dos dois mudasse, e o
 * grafo continuaria com dois donos.
 */
export function validarRoadmapGerado(
  conteudo: ConteudoDoRoadmap,
  contexto: ContextoDaValidacao
): ValidacaoDoRoadmap {
  const problemas: ProblemaNoRoadmap[] = []

  if (conteudo.mvps.length === 0) {
    problemas.push({
      recusa: 'sem-mvp',
      mensagem: 'O roadmap não tem nenhum MVP; não há o que entrar na fila.'
    })
  }

  const idsDeMvp = conteudo.mvps.map((m) => m.id)
  const idsDeFatia = conteudo.mvps.flatMap((m) => m.fatias.map((f) => f.id))
  const todos = [...idsDeMvp, ...idsDeFatia]

  // Ids repetidos não são detalhe de forma: `dependeDe` aponta por id, e dois MVPs com o mesmo
  // id fariam a dependência apontar para os dois — o grafo deixaria de ser o que o texto diz.
  if (new Set(todos).size !== todos.length) {
    problemas.push({
      recusa: 'ids-repetidos',
      mensagem: 'Dois MVPs ou duas fatias têm o mesmo id, e as dependências deixam de ser únicas.'
    })
  }

  for (const mvp of conteudo.mvps) {
    if (mvp.titulo.trim().length === 0) {
      problemas.push({ recusa: 'mvp-sem-titulo', mensagem: `O MVP "${mvp.id}" não tem título.` })
    }

    if (mvp.tese.trim().length === 0) {
      problemas.push({
        recusa: 'mvp-sem-tese',
        mensagem: `O MVP "${mvp.titulo || mvp.id}" não declara o que entrega.`
      })
    }

    if (mvp.resultado.trim().length === 0) {
      problemas.push({
        recusa: 'mvp-sem-resultado',
        mensagem: `O MVP "${mvp.titulo || mvp.id}" não declara o resultado observável quando fecha.`
      })
    }

    // Um MVP sem fatia é um container vazio: o checklist é o que a spec pede (§ 1), e é dele que
    // sai a fatia que ganha SPEC. Sem ele, o `SLICE_ENTRY` não teria objeto.
    if (mvp.fatias.length === 0) {
      problemas.push({
        recusa: 'mvp-sem-fatia',
        mensagem: `O MVP "${mvp.titulo || mvp.id}" não prevê nenhuma fatia.`
      })
    }

    problemas.push(...problemasDaOrigem(mvp.origem, mvp.referencia, mvp.titulo || mvp.id, contexto))

    for (const fatia of mvp.fatias) {
      if (fatia.titulo.trim().length === 0) {
        problemas.push({
          recusa: 'fatia-sem-titulo',
          mensagem: `Uma fatia do MVP "${mvp.titulo || mvp.id}" não tem título.`
        })
      }

      problemas.push(
        ...problemasDaOrigem(
          fatia.origem,
          fatia.referencia,
          `${mvp.titulo || mvp.id} · ${fatia.titulo || fatia.id}`,
          contexto
        )
      )
    }
  }

  // O DAG, pelo validador da M8-F06. Só faz sentido quando os ids são únicos: com repetição, o
  // grafo que ele veria não é o que o modelo escreveu.
  if (new Set(idsDeMvp).size === idsDeMvp.length) {
    problemas.push(...problemasDoDag(validarDag(comoMvps(conteudo.mvps))))
  }

  if (conteudo.spec !== undefined) {
    problemas.push(...problemasDaSpec(conteudo.spec))
  }

  // As duas varreduras de invariante, sobre o texto inteiro. É a mesma postura de runtime que a
  // `PerguntaGerada` inaugurou: aqui o que chega ao PI é texto que nenhum humano leu.
  const texto = normalizar(textoVisivel(conteudo))

  const termo = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.find((t) => texto.includes(t))
  if (termo !== undefined) {
    problemas.push({
      recusa: 'requisito-inventado',
      mensagem: `O roadmap menciona "${termo}". A pipeline não inventa requisito legal, regulatório, de consentimento, aceite duplo ou classificação por domínio (invariante 9 do CONVENTION §4).`
    })
  }

  const processo = TERMOS_DE_OUTRO_PROJETO.find((t) => texto.includes(t))
  if (processo !== undefined) {
    problemas.push({
      recusa: 'processo-de-outro-projeto',
      mensagem: `O roadmap menciona "${processo}", que é processo deste repositório e não do projeto gerado.`
    })
  }

  return { valido: problemas.length === 0, problemas }
}

/**
 * As regras de âncora, aplicadas a um MVP ou a uma fatia.
 *
 * **`prd` e `arquitetura` exigem referência existente; `proposto` exige a ausência dela.** A
 * segunda metade não é simetria decorativa: uma inferência que cita um requisito estaria se
 * apresentando como derivada dele, e o gate a listaria como `proposto` mesmo assim — o PI leria
 * "a IA inferiu" sobre algo que aparenta ter fonte.
 */
function problemasDaOrigem(
  origem: OrigemDoRoadmap,
  referencia: string | undefined,
  onde: string,
  contexto: ContextoDaValidacao
): readonly ProblemaNoRoadmap[] {
  if (origem === 'proposto') {
    return referencia === undefined
      ? []
      : [
          {
            recusa: 'proposto-com-referencia',
            mensagem: `"${onde}" é "proposto" mas cita "${referencia}": inferência não tem fonte a citar.`
          }
        ]
  }

  if (referencia === undefined || referencia.trim().length === 0) {
    return [
      {
        recusa: 'origem-sem-referencia',
        mensagem: `"${onde}" tem origem "${origem}" sem citar de qual afirmação veio.`
      }
    ]
  }

  const conhecidas = origem === 'prd' ? contexto.afirmacoesDoPrd : contexto.afirmacoesDaArquitetura

  return conhecidas.includes(referencia)
    ? []
    : [
        {
          recusa: 'referencia-inexistente',
          mensagem: `"${onde}" cita "${referencia}", que não existe na revisão aceita de ${origem === 'prd' ? 'PRD' : 'arquitetura'}.`
        }
      ]
}

/**
 * As regras da SPEC gerada (critério 4).
 *
 * **Critério de aceite vazio e pergunta vazia reprovam pelo mesmo motivo, invertido.** Sem
 * critério executável a SPEC não é executável — é uma intenção; sem pergunta aberta ela afirma
 * que não há nada a decidir, que é o que a geração não tem como saber.
 */
function problemasDaSpec(spec: SpecGerada): readonly ProblemaNoRoadmap[] {
  const problemas: ProblemaNoRoadmap[] = []

  if (spec.objetivo.trim().length === 0) {
    problemas.push({ recusa: 'spec-sem-objetivo', mensagem: 'A SPEC gerada não tem objetivo.' })
  }

  if (spec.criteriosDeAceite.length === 0) {
    problemas.push({
      recusa: 'spec-sem-criterio',
      mensagem: 'A SPEC gerada não tem critério de aceite executável, e sem ele nada é verificável.'
    })
  }

  if (spec.perguntas.length === 0) {
    problemas.push({
      recusa: 'spec-sem-pergunta',
      mensagem:
        'A SPEC gerada não tem pergunta aberta. Uma SPEC sem pergunta afirma que não há nada a decidir, e isso a geração não sabe.'
    })
  }

  for (const pergunta of spec.perguntas) {
    if (
      pergunta.opcoes.length < MINIMO_DE_OPCOES_DA_SPEC ||
      pergunta.opcoes.length > MAXIMO_DE_OPCOES_DA_SPEC
    ) {
      problemas.push({
        recusa: 'pergunta-fora-do-contrato',
        mensagem: `A pergunta "${pergunta.id}" tem ${pergunta.opcoes.length} opções; o contrato pede entre ${MINIMO_DE_OPCOES_DA_SPEC} e ${MAXIMO_DE_OPCOES_DA_SPEC}.`
      })
    }

    if (pergunta.opcoes.some((o) => o.impacto.trim().length === 0)) {
      problemas.push({
        recusa: 'pergunta-fora-do-contrato',
        mensagem: `Uma opção da pergunta "${pergunta.id}" não declara impacto, e sem ele não há trade-off a comparar.`
      })
    }

    if (!pergunta.opcoes.some((o) => o.id === pergunta.recomendada)) {
      problemas.push({
        recusa: 'pergunta-sem-recomendada',
        mensagem: `A recomendada "${pergunta.recomendada}" não está entre as opções da pergunta "${pergunta.id}".`
      })
    }
  }

  return problemas
}

/**
 * Os MVPs elegíveis ao `MVP_ENTRY` (critério 3): os que **não têm dependência pendente**.
 *
 * A escolha entre eles é do PI (pergunta 1 da spec, resolvida em 2026-09-03) — substituindo o
 * automático da M8-F06, que pegava o primeiro da ordem topológica porque a spec não definia quem
 * escolhia. Oferecer um MVP cuja dependência não fechou não é oferecer escolha: é oferecer um
 * trabalho que não pode começar.
 *
 * Um MVP já concluído não é dependência pendente; um `proposto` é.
 */
export function mvpsElegiveis(
  mvps: readonly MvpGerado[],
  concluidos: readonly string[] = []
): readonly MvpGerado[] {
  const fechados = new Set(concluidos)
  return mvps.filter((m) => m.dependeDe.every((d) => fechados.has(d)))
}

/** As perguntas da SPEC ainda sem resposta — o que o `SLICE_ENTRY` confere (critério 4). */
export function perguntasSemResposta(spec: SpecGerada): readonly PerguntaDaSpec[] {
  return spec.perguntas.filter((p) => p.resposta === undefined || p.resposta.trim().length === 0)
}

/** A SPEC pode ser aceita? Só quando toda pergunta aberta foi respondida (critério 4). */
export function specPodeSerAceita(spec: SpecGerada | undefined): boolean {
  return spec !== undefined && perguntasSemResposta(spec).length === 0
}

/** Os MVPs que a IA inferiu — o que o gate lista separado (critério 2). */
export function propostosDoRoadmap(conteudo: ConteudoDoRoadmap): readonly MvpGerado[] {
  return conteudo.mvps.filter((m) => m.origem === 'proposto')
}

/**
 * Registra a resposta do PI a uma pergunta da SPEC.
 *
 * **Devolve conteúdo novo, não edita.** Mesma disciplina do corte de `proposto` no PRD e na
 * arquitetura: a revisão que o PI leu continua no banco, e o hash continua descrevendo o que ele
 * leu. Uma pergunta desconhecida devolve o conteúdo intacto — o serviço reconhece pela
 * igualdade e não grava revisão por um clique que não mudou nada.
 */
export function responderPerguntaDaSpec(
  conteudo: ConteudoDoRoadmap,
  perguntaId: string,
  resposta: string
): ConteudoDoRoadmap {
  const spec = conteudo.spec
  if (spec === undefined) return conteudo
  if (!spec.perguntas.some((p) => p.id === perguntaId)) return conteudo

  return {
    ...conteudo,
    spec: {
      ...spec,
      perguntas: spec.perguntas.map((p) => (p.id === perguntaId ? { ...p, resposta } : p))
    }
  }
}

/**
 * Teto de cada metade do nome do arquivo da SPEC.
 *
 * O `slugificar` de `projects.ts` não trunca — lá o teto é validado no nome do projeto, que o PI
 * digita. Aqui o título vem do modelo, e uma tese de 300 caracteres no lugar do título produziria
 * um caminho que o sistema de arquivos recusa por motivo alheio ao conteúdo.
 */
export const TAMANHO_MAXIMO_DO_NOME_DA_SPEC = 40

function nomeCurto(texto: string): string {
  return slugificar(texto).slice(0, TAMANHO_MAXIMO_DO_NOME_DA_SPEC).replace(/-+$/, '')
}

/**
 * Converte o conteúdo gerado no `Roadmap` que o `RoadmapRepository` e o `STATUS.md` conhecem.
 *
 * `detalhada` é `true` **só** na primeira fatia do MVP escolhido: é a fatia que ganhou SPEC
 * executável (§ Regras). Antes do `MVP_ENTRY` nenhuma é detalhada, porque nenhuma SPEC saiu.
 */
export function comoRoadmap(conteudo: ConteudoDoRoadmap, diretorioDasSpecs: string): Roadmap {
  const detalhada = conteudo.spec?.fatiaId

  const slices: Slice[] = conteudo.mvps.flatMap((mvp) =>
    mvp.fatias.map((fatia) => ({
      id: fatia.id,
      mvpId: mvp.id,
      numero: fatia.numero,
      titulo: fatia.titulo,
      specSlug: `${diretorioDasSpecs}/spec-${nomeCurto(mvp.titulo)}-${String(fatia.numero).padStart(2, '0')}-${nomeCurto(fatia.titulo)}.md`,
      detalhada: fatia.id === detalhada,
      origem: { tipo: 'decisao' as const, decisaoId: fatia.id, perguntaId: 'roadmap-gerado' }
    }))
  )

  return { mvps: comoMvps(conteudo.mvps), slices }
}
