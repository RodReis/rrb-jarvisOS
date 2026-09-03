/**
 * O brief do projeto e a origem de cada afirmação (SPEC-Jornada-02).
 *
 * A pergunta que este arquivo responde: **o que o app pode afirmar sobre um projeto, e de onde
 * cada afirmação veio?** É a mesma pergunta que a M8-F04 respondeu para o pacote estrutural, com
 * uma diferença que muda tudo: lá o texto era **composto** a partir de decisões, então nada podia
 * ser inventado por construção. Aqui o texto é **gerado por modelo**, e a garantia precisa ser
 * verificada em vez de derivada.
 *
 * Três decisões governam o arquivo:
 *
 *  - **Afirmação sem origem não existe.** `Afirmacao` exige `origem`, e o validador recusa a
 *    saída inteira quando falta — antes de gravar. Um campo opcional deixaria "toda afirmação
 *    tem origem" (critério 4) dependendo de quem escreve o call site.
 *  - **`proposto` é a única origem que a IA pode criar sozinha**, e é justamente a que o PI corta
 *    item a item no gate (decisão do PI, 2026-09-03). `prompt` e `decisao` referenciam algo que
 *    o PI escreveu ou escolheu; `proposto` é inferência, e inferência precisa de dono.
 *  - **A invariante 9 vira validador de runtime.** No catálogo estático da M8-F03 ela era um
 *    teste: varria o arquivo e falhava no CI. Com pergunta e texto gerados, o mesmo teste não
 *    protege nada — o que chega ao PI não passou por revisão nenhuma. Aqui a varredura roda
 *    sobre a saída do modelo, a cada geração.
 *
 * Mora em `src/shared/domain` porque a tela mostra a origem por afirmação e separa os `proposto`
 * no gate, e a regra precisa ser verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'

/**
 * Os dez blocos do `ProjectBriefSchema` (design §9.2, enumerados na spec).
 *
 * Ordenados: o índice é a ordem de leitura do documento, e um segundo mapa de ordem divergiria
 * desta lista. Fechado porque o refinamento termina quando **todos** têm resposta ou pendência
 * declarada — e "todos" só é verificável sobre um conjunto conhecido.
 */
export const BLOCOS_DO_BRIEF = [
  'identidade',
  'problema-usuarios-resultado',
  'escopo-e-metricas',
  'jornadas',
  'dominio-e-dados',
  'integracoes',
  'stack-e-restricoes',
  'nao-funcionais-e-testes',
  'politica-git-provider-orcamento',
  'riscos-e-decisoes-abertas'
] as const

export type BlocoDoBrief = (typeof BLOCOS_DO_BRIEF)[number]

export function isBlocoDoBrief(value: unknown): value is BlocoDoBrief {
  return typeof value === 'string' && (BLOCOS_DO_BRIEF as readonly string[]).includes(value)
}

/**
 * Os blocos que o **app já sabe** e por isso não viram pergunta (decisão do PI, 2026-09-03).
 *
 * `identidade` sai da criação do projeto (nome, diretório, repositório); a política de Git,
 * provider e orçamento sai dos defaults do produto. O brief os **exibe para confirmação** — não
 * perguntar o que já se sabe, e não removê-los, porque o MVP-009 lê o brief inteiro.
 */
export const BLOCOS_PRE_PREENCHIDOS: readonly BlocoDoBrief[] = [
  'identidade',
  'politica-git-provider-orcamento'
]

export function isPrePreenchido(bloco: BlocoDoBrief): boolean {
  return BLOCOS_PRE_PREENCHIDOS.includes(bloco)
}

/**
 * De onde a afirmação veio.
 *
 * **Três origens, e a assimetria entre elas é o critério 4.** `prompt` e `decisao` apontam para
 * algo que o PI produziu — o texto que ele escreveu, a opção que ele escolheu. `proposto` é a
 * única que a IA cria sozinha, e por isso é a única que aparece em lista separada no gate, para
 * ser cortada item a item.
 *
 * **Não existe origem "modelo" para requisito.** É a mesma ausência deliberada da M8-F04: lá,
 * `AfirmacaoDoPacote` só admitia `decisao` e `evidencia`. Aqui `proposto` existe porque o brief
 * é rascunho a ser aceito, não documento final — mas ele carrega a marca de inferência, e o
 * validador impede que ela cubra requisito legal ou de consentimento.
 */
export const ORIGENS_DA_AFIRMACAO = ['prompt', 'decisao', 'proposto'] as const

export type OrigemDaAfirmacao = (typeof ORIGENS_DA_AFIRMACAO)[number]

export function isOrigemDaAfirmacao(value: unknown): value is OrigemDaAfirmacao {
  return typeof value === 'string' && (ORIGENS_DA_AFIRMACAO as readonly string[]).includes(value)
}

/**
 * Uma afirmação do brief. **`origem` não é opcional** — é o que torna o critério 4 estrutural em
 * vez de disciplina de quem escreve o call site.
 *
 * `referencia` amarra a afirmação ao que a sustenta: o id da `Decision` quando a origem é
 * `decisao`. Para `prompt` é dispensável (a fonte é o próprio `PROMPT.md` da revisão) e para
 * `proposto` não existe — se existisse, não seria inferência.
 */
export interface Afirmacao {
  readonly id: string
  readonly bloco: BlocoDoBrief
  readonly texto: string
  readonly origem: OrigemDaAfirmacao
  /** O id da `Decision` que a sustenta. Obrigatório quando `origem` é `decisao`. */
  readonly referencia?: string
}

/** Uma pendência declarada: o PI respondeu "não sei" e o brief registra o buraco. */
export interface Pendencia {
  readonly bloco: BlocoDoBrief
  readonly pergunta: string
  /**
   * Pendência **material** bloqueia o aceite; não material entra no brief como aberta
   * (design §9.1). A distinção é do produto, não do modelo: material é o que impede executar.
   */
  readonly material: boolean
}

/** O brief inteiro, antes de virar prosa. A prosa é renderizada disto, nunca o contrário. */
export interface Brief {
  readonly projectId: string
  readonly afirmacoes: readonly Afirmacao[]
  readonly pendencias: readonly Pendencia[]
}

/**
 * O prompt do PI, como o banco o guarda.
 *
 * Mora aqui, e não no repositório do main, porque atravessa a ponte IPC: o contrato de
 * `contracts/ipc.ts` precisa do tipo e não pode importar do processo principal — mesma razão
 * pela qual `EstadoDaJornada` desceu para o domínio na M25-F01.
 */
export interface PromptDoProjeto {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly texto: string
  readonly hash: string
  readonly commitHash: string | null
  readonly created_at: string
}

/** O brief gravado, com a procedência: qual prompt e qual pacote de contexto o originaram. */
export interface BriefRegistrado extends Brief {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly promptId: string
  readonly hash: string
  readonly commitHash: string | null
  readonly contextPackId: string | null
  readonly created_at: string
}

/** Por que a geração não produziu brief. Fechado: a tela decide o que mostrar a partir dele. */
export const RESULTADOS_DA_GERACAO = [
  'gerado',
  'bloqueado-sem-rota',
  'saida-invalida',
  'projeto-inexistente',
  'sem-prompt'
] as const

export type ResultadoDaGeracao = (typeof RESULTADOS_DA_GERACAO)[number]

export interface GeracaoOutcome {
  readonly resultado: ResultadoDaGeracao
  readonly brief?: BriefRegistrado
  readonly mensagem: string
  /** O que o PI faz para destravar, quando bloqueou. */
  readonly acao?: string
  /** Os problemas do validador, quando a saída foi recusada. */
  readonly problemas?: readonly string[]
}

/**
 * Os requisitos que a pipeline **não inventa** (invariante 9 do `CONVENTION.md` §4).
 *
 * A lista é a mesma de `wizard-catalogo.spec.ts`, e a duplicação é deliberada: lá ela varre um
 * catálogo estático em tempo de teste; aqui roda em runtime sobre saída de modelo. Um teste que
 * varre arquivo revisado não protege texto que ninguém revisou.
 *
 * Casados sem acento e em minúsculas para não depender de grafia — um modelo escreve "LGPD",
 * "lgpd" e "Lei Geral de Proteção de Dados" com a mesma facilidade.
 */
export const TERMOS_QUE_EXIGEM_ORIGEM_HUMANA = [
  'lgpd',
  'gdpr',
  'consentimento',
  'aceite duplo',
  'duplo aceite',
  'termos de uso',
  'politica de privacidade',
  'dados pessoais',
  'dados sensiveis',
  'compliance',
  'juridic'
] as const

/** Minúsculas e sem diacrítico. É como todo texto entra na comparação. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** Por que o validador recusou. Enum fechado: a tela decide o que mostrar a partir dele. */
export const RECUSAS_DO_BRIEF = [
  'origem-ausente',
  'origem-desconhecida',
  'referencia-ausente',
  'bloco-desconhecido',
  'texto-vazio',
  'requisito-sem-origem-humana'
] as const

export type RecusaDoBrief = (typeof RECUSAS_DO_BRIEF)[number]

export interface ProblemaNoBrief {
  readonly recusa: RecusaDoBrief
  /** Qual afirmação causou. Vazio quando o problema é do documento, não de uma linha. */
  readonly afirmacaoId?: string
  readonly mensagem: string
}

export interface ValidacaoDoBrief {
  readonly valido: boolean
  readonly problemas: readonly ProblemaNoBrief[]
}

/**
 * Valida a saída do modelo **antes de gravar** (critérios 3 e 4).
 *
 * Devolve todos os problemas, não o primeiro: quem gerou precisa corrigir a saída inteira, e
 * parar no primeiro faria o conserto virar um jogo de tentativa e erro com uma rodada de modelo
 * por problema.
 *
 * **Fail closed.** Origem desconhecida é recusa, não um default para `proposto`: um valor que o
 * validador não reconhece pode ser exatamente o que alguém inventou para escapar da regra, e
 * cair no lado permissivo seria a porta que a invariante 9 existe para fechar.
 */
export function validarBrief(brief: Brief): ValidacaoDoBrief {
  const problemas: ProblemaNoBrief[] = []

  for (const a of brief.afirmacoes) {
    if (!isBlocoDoBrief(a.bloco)) {
      problemas.push({
        recusa: 'bloco-desconhecido',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" declara o bloco "${a.bloco}", que não existe no schema.`
      })
    }

    if (a.texto.trim().length === 0) {
      problemas.push({
        recusa: 'texto-vazio',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" está vazia.`
      })
    }

    // A ausência é checada antes do valor: `origem` ausente e `origem` inválida são problemas
    // diferentes, e reportá-los como um só esconderia qual dos dois aconteceu.
    if (a.origem === undefined || a.origem === null) {
      problemas.push({
        recusa: 'origem-ausente',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" não declara origem. Toda afirmação carrega origem (critério 4).`
      })
      continue
    }

    if (!isOrigemDaAfirmacao(a.origem)) {
      problemas.push({
        recusa: 'origem-desconhecida',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" declara a origem "${a.origem}", que não existe.`
      })
      continue
    }

    // `decisao` sem referência é afirmação órfã: ela diz vir de uma escolha do PI sem dizer de
    // qual, e a trilha que o CONVENTION §4 exige deixaria de ser rastreável.
    if (a.origem === 'decisao' && (a.referencia === undefined || a.referencia.trim() === '')) {
      problemas.push({
        recusa: 'referencia-ausente',
        afirmacaoId: a.id,
        mensagem: `A afirmação "${a.id}" diz vir de uma decisão, mas não referencia qual.`
      })
    }

    // A invariante 9, em runtime: requisito legal/regulatório só existe se o PI o disse ou o
    // escolheu. `proposto` é inferência do modelo, e inferir consentimento é exatamente o que a
    // regra proíbe.
    if (a.origem === 'proposto') {
      const texto = normalizar(a.texto)
      const termo = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.find((t) => texto.includes(t))

      if (termo !== undefined) {
        problemas.push({
          recusa: 'requisito-sem-origem-humana',
          afirmacaoId: a.id,
          mensagem: `A afirmação "${a.id}" trata de "${termo}" com origem "proposto". Requisito legal, regulatório, de consentimento ou de classificação de domínio só entra vindo do prompt ou de uma decisão do PI (invariante 9).`
        })
      }
    }
  }

  return { valido: problemas.length === 0, problemas }
}

/**
 * As afirmações que o PI corta item a item no gate (decisão do PI, 2026-09-03).
 *
 * Lista separada porque cortar bloco inteiro faria um `proposto` ruim obrigar a regenerar todos
 * — e o que sobra depois do corte é o que ele viu e aceitou.
 */
export function propostos(brief: Brief): readonly Afirmacao[] {
  return brief.afirmacoes.filter((a) => a.origem === 'proposto')
}

/**
 * Remove um `proposto`, preservando tudo o mais (critério 5).
 *
 * Só corta o que é `proposto`: um id de outra origem passa e o brief volta igual. Sem essa
 * guarda, um id errado apagaria em silêncio uma afirmação que veio do PI — que é justamente o
 * que o critério 5 protege.
 */
export function cortarProposto(brief: Brief, afirmacaoId: string): Brief {
  return {
    ...brief,
    afirmacoes: brief.afirmacoes.filter((a) => !(a.id === afirmacaoId && a.origem === 'proposto'))
  }
}

/**
 * O aceite está liberado? Pendência **material** bloqueia; não material entra como aberta.
 *
 * Não confere validade aqui: um brief inválido não chega a ser gravado, então perguntar de novo
 * no gate seria checar o que já não pode existir.
 */
export function podeAceitar(brief: Brief): boolean {
  return !brief.pendencias.some((p) => p.material)
}

/** Os blocos que ainda não têm afirmação nem pendência — o que falta ao refinamento. */
export function blocosEmAberto(brief: Brief): readonly BlocoDoBrief[] {
  const cobertos = new Set<string>([
    ...brief.afirmacoes.map((a) => a.bloco),
    ...brief.pendencias.map((p) => p.bloco)
  ])

  return BLOCOS_DO_BRIEF.filter((b) => !cobertos.has(b))
}

/**
 * O refinamento terminou? Todos os blocos com resposta ou pendência declarada.
 *
 * Sem teto numérico de perguntas, como a spec decide: o fim é definido por cobertura, não por
 * contagem — um teto faria o refinamento parar no meio de um bloco por acidente aritmético.
 */
export function refinamentoCompleto(brief: Brief): boolean {
  return blocosEmAberto(brief).length === 0
}
