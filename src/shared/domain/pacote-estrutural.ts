/**
 * O pacote estrutural — PRD, Landscape e Convention rastreáveis (SPEC-Planejamento-04).
 *
 * A pergunta que este arquivo responde: **de onde veio cada afirmação destes três documentos?**
 *
 * A resposta não é um comentário de boa-fé; é estrutura. Uma `Afirmacao` **não existe sem
 * `origem`** — o tipo não tem forma de ser construído sem ela, e é isso que torna o critério 1
 * ("todo requisito material possui origem") verificável em vez de prometido. As duas origens
 * possíveis são as duas únicas fontes legítimas de conteúdo material:
 *
 *  - **`decisao`** — o PI respondeu isto no wizard (M8-F03). Carrega o id da `Decision`, e por
 *    ele se chega ao autor: decisão do PI ou delegada ao agente.
 *  - **`evidencia`** — foi extraído de uma fonte externa (M6-F06). Carrega a URL canônica, e
 *    por ela se chega ao `EvidenceItem` com conteúdo, data e hashes.
 *
 * **Não existe origem "modelo".** É a decisão central da fatia, e ela é a forma que o critério 5
 * ("Convention não contém regra inventada") toma aqui: os documentos são **compostos** a partir
 * de decisões e evidências, não redigidos por um modelo e auditados depois. Um gerador de prosa
 * livre transformaria os critérios 1 e 5 em "esperamos que o modelo não tenha inventado" — e o
 * verificador de evidência da M6-F06 é explícito quanto ao seu próprio limite: ele confere que a
 * afirmação **cita** fonte extraída, não que a fonte a sustenta semanticamente. Sobre esse
 * limite não se constrói uma garantia de não-invenção; sobre composição, sim.
 *
 * **O que este arquivo não faz:** não escreve arquivo (isso é I/O, mora no main), não chama
 * Tavily e não decide se a pesquisa é suficiente — só descreve a forma do pacote e as regras
 * puras sobre ela.
 *
 * Mora em `src/shared/domain` porque a tela mostra o pacote e o bloqueio, e o contrato precisa
 * ser verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'

/**
 * Os três documentos do pacote. Enum fechado, e não string livre: cada um tem seções próprias e
 * regras próprias de origem, e um quarto documento é mudança de contrato — nunca um arquivo que
 * aparece porque alguém passou outro nome.
 */
export const DOCUMENTOS_DO_PACOTE = ['PRD', 'LANDSCAPE', 'CONVENTION'] as const

export type DocumentoDoPacote = (typeof DOCUMENTOS_DO_PACOTE)[number]

/** O nome do arquivo de cada documento, na raiz de `docs/` do projeto gerado. */
export const ARQUIVO_DO_DOCUMENTO: Readonly<Record<DocumentoDoPacote, string>> = {
  PRD: 'docs/PRD.md',
  LANDSCAPE: 'docs/LANDSCAPE.md',
  CONVENTION: 'docs/CONVENTION.md'
}

/**
 * De onde uma afirmação veio.
 *
 * União fechada com duas variantes, e **nenhuma delas é "o modelo escreveu"**. Acrescentar uma
 * terceira variante é decisão de produto, não detalhe de implementação: seria abrir a porta que
 * o critério 5 existe para manter fechada.
 */
export type OrigemDaAfirmacao =
  | { readonly tipo: 'decisao'; readonly decisaoId: string; readonly perguntaId: string }
  | { readonly tipo: 'evidencia'; readonly url: string; readonly hashConteudo: string }

/**
 * Uma afirmação material de um dos documentos.
 *
 * `origem` é obrigatória e não tem default. É o critério 1 na forma de tipo: não há como
 * construir uma afirmação sem dizer de onde ela veio, e por isso não há como um documento
 * ganhar conteúdo material sem rastro.
 */
export interface AfirmacaoDoPacote {
  readonly id: string
  readonly secao: string
  readonly texto: string
  readonly origem: OrigemDaAfirmacao
}

/**
 * Por que o pacote não pôde ser concluído.
 *
 * Enum fechado pelo mesmo motivo que `ProjectReason` e `WizardReason` são: a tela decide o que
 * mostrar a partir dele.
 */
export const PACOTE_REASONS = [
  'gerado',
  'projeto-inexistente',
  /** O wizard ainda não terminou: faltam decisões que o PRD precisa (critério 1). */
  'decisoes-incompletas',
  /**
   * A pesquisa necessária não pôde ser feita ou não trouxe evidência para uma conclusão
   * material. **Nunca preenchido por memória do modelo** (critério 3).
   */
  'pesquisa-bloqueada',
  'falha-de-escrita'
] as const

export type PacoteReason = (typeof PACOTE_REASONS)[number]

/**
 * Um bloqueio, com os **cinco campos** que a `CONVENTION.md` §4 § Estados de bloqueio exige:
 * causa verificável, evidência, tentativas, motivo pelo qual continuar seria incorreto e ação
 * mínima de retomada. *"Sem esses campos, o bloqueio é inválido"* — literal.
 *
 * O `ConnectorError` da M6-F01 cobre três deles (causa, evidência, ação), mas não carrega
 * tentativas nem o motivo de continuar ser incorreto — e é justamente esse último campo que
 * distingue um bloqueio de um erro qualquer: ele diz **por que não vale seguir mesmo assim**,
 * que é a pergunta que o critério 3 responde ao proibir preencher por memória do modelo.
 */
export interface BloqueioExterno {
  /** O que barrou, em vocabulário verificável — normalmente o `ConnectorErrorCode`. */
  readonly causa: string
  /** O que sustenta a causa: mensagem do serviço, URLs que falharam, veredito de cota. */
  readonly evidencia: string
  readonly tentativas: number
  /** Por que continuar seria incorreto. Sem isto, o bloqueio é inválido. */
  readonly porQueNaoSeguir: string
  /** A ação mínima que destrava — concreta, executável pelo PI. */
  readonly retomada: string
}

/**
 * Um documento do pacote, com suas afirmações e o texto renderizado.
 *
 * `conteudo` é derivado das `afirmacoes` por composição — nunca digitado em paralelo. Guardá-lo
 * junto é o que permite hashear exatamente o que foi escrito no disco.
 */
export interface DocumentoGerado {
  readonly documento: DocumentoDoPacote
  readonly caminho: string
  readonly conteudo: string
  readonly hash: string
  readonly afirmacoes: readonly AfirmacaoDoPacote[]
}

/**
 * O pacote estrutural gerado — a revisão que o critério 7 pede que vire commit imutável.
 *
 * `hash` é o hash canônico do conjunto: é por ele que a M8-F06 vai reconhecer "mesma revisão"
 * e não pedir aceite duas vezes (invariante 2 do `CONVENTION.md` §4).
 */
export interface PacoteEstrutural {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly documentos: readonly DocumentoGerado[]
  readonly hash: string
  readonly commitHash: string | null
  readonly created_at: string
}

/**
 * O desfecho de gerar o pacote. Recusa volta como *outcome*, nunca como promise rejeitada —
 * mesma postura do `ProjectOutcome` e do `ContextPackOutcome`.
 */
export interface PacoteOutcome {
  readonly reason: PacoteReason
  readonly pacote?: PacoteEstrutural
  /** Preenchido só em `pesquisa-bloqueada`: os cinco campos da CONVENTION §4. */
  readonly bloqueio?: BloqueioExterno
  /** Em `decisoes-incompletas`: quais perguntas do wizard ainda faltam. */
  readonly pendencias?: readonly string[]
  readonly mensagem: string
}

/**
 * As perguntas do wizard que o PRD precisa ter respondidas (critério 1).
 *
 * **Estas três, e não todas as cinco.** `pesquisa` governa a profundidade do Landscape e
 * `design-de-origem` é da M8-F05: exigir as duas aqui bloquearia o PRD por decisões que ele não
 * usa. O corte é o que o próprio catálogo declara — a F04 escreve o PRD e precisa de escopo,
 * público e superfície.
 */
export const PERGUNTAS_DO_PRD: readonly string[] = ['escopo', 'publico', 'superficie']

/**
 * Quais perguntas obrigatórias ainda não têm decisão vigente.
 *
 * Devolve os ids, e não um booleano, porque a tela precisa dizer **o que falta** — "complete o
 * wizard" manda o PI procurar sozinho o que já foi respondido.
 */
export function pendenciasDoPrd(respondidas: readonly string[]): readonly string[] {
  const feitas = new Set(respondidas)
  return PERGUNTAS_DO_PRD.filter((id) => !feitas.has(id))
}

/**
 * A marca de origem que acompanha cada afirmação no arquivo gerado.
 *
 * Comentário HTML porque o destino é Markdown: some na leitura renderizada e permanece no
 * arquivo versionado — o revisor lê o documento, e quem audita lê o rastro. Um rodapé de notas
 * empurraria a origem para longe da frase que ela justifica.
 */
export function marcaDeOrigem(origem: OrigemDaAfirmacao): string {
  return origem.tipo === 'decisao'
    ? `<!-- origem: decisao/${origem.perguntaId} · ${origem.decisaoId} -->`
    : `<!-- origem: evidencia · ${origem.url} · sha256:${origem.hashConteudo.slice(0, 16)} -->`
}

/**
 * As afirmações que dependem de evidência externa — as que o verificador da M6-F06 checa.
 *
 * Só as de origem `evidencia` entram: uma afirmação que veio de decisão do PI não precisa de
 * fonte externa, e exigi-la transformaria "o PI decidiu" em lacuna de pesquisa.
 */
export function afirmacoesComEvidencia(
  afirmacoes: readonly AfirmacaoDoPacote[]
): readonly AfirmacaoDoPacote[] {
  return afirmacoes.filter((a) => a.origem.tipo === 'evidencia')
}

/**
 * Toda afirmação material tem origem? Verificação estrutural do critério 1.
 *
 * Por construção o tipo já garante isso — mas o dado pode vir do banco, onde nada impede uma
 * linha malformada. Esta função é a fronteira: o que foi lido de fora ainda cumpre o contrato?
 */
export function origensCompletas(afirmacoes: readonly AfirmacaoDoPacote[]): boolean {
  return afirmacoes.every((a) => {
    if (a.texto.trim() === '') return false
    return a.origem.tipo === 'decisao'
      ? a.origem.decisaoId.trim() !== ''
      : a.origem.url.trim() !== '' && a.origem.hashConteudo.trim() !== ''
  })
}

/** Type guard de fronteira: o IPC recebe `unknown` e não confia no renderer. */
export function isDocumentoDoPacote(valor: unknown): valor is DocumentoDoPacote {
  return typeof valor === 'string' && (DOCUMENTOS_DO_PACOTE as readonly string[]).includes(valor)
}
