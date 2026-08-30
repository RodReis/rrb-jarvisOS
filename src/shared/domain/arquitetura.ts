/**
 * O pacote de arquitetura: ARCHITECTURE, DECISIONS, TESTING e REVIEW (SPEC-Planejamento-05).
 *
 * A pergunta que este arquivo responde: **o que a arquitetura pode afirmar, dado o que o PI
 * anexou?**
 *
 * A resposta é uma restrição, não uma capacidade. O critério 4 diz que *"a arquitetura não
 * promete fluxo ausente dos protótipos"*, e a forma que isso toma aqui é `jornadasCobertas`
 * entrando na composição como **fonte fechada**: as seções de fluxo saem das jornadas que os
 * protótipos realmente mostram, e não há caminho neste módulo que produza uma linha de fluxo a
 * partir de outra coisa. Um gerador livre transformaria o critério 4 em "esperamos que o modelo
 * só cite telas que existem".
 *
 * **O critério 3 é uma coluna, não uma convenção.** *"Design e arquitetura referenciam a mesma
 * revisão do PRD"* — e por isso `PacoteArquitetura` carrega `pacoteEstruturalId`, apontando para
 * a revisão que ele assume. Sem o ponteiro, a arquitetura estaria implicitamente ligada ao "PRD
 * mais recente", que muda sob os pés dela: regerar o PRD faria a arquitetura passar a descrever
 * um documento que ninguém comparou com ela.
 *
 * **O critério 6 é a lista de anexos junto.** *"Pacote registra hashes de todos os anexos e
 * saídas"* — os hashes das saídas vêm dos `DocumentoGerado`, e os dos anexos precisam ser
 * congelados no ato, porque o anexo pode ser substituído depois. Guardar só os ids faria o
 * pacote apontar para hashes que mudaram.
 *
 * **A mesma origem da M8-F04, sem variante nova.** As afirmações daqui usam `OrigemDaAfirmacao`
 * — `decisao` ou `evidencia` —, e não existe origem "anexo" nem "modelo". Um protótipo não
 * *afirma* nada: ele delimita o que pode ser afirmado, e essa delimitação aparece como o
 * conjunto de jornadas, não como fonte de frase.
 *
 * **O que este arquivo não faz:** não lê arquivo, não abre navegador, não escreve no disco.
 */

import type { WorkspaceId } from './entities'
import type { Anexo } from './anexos-de-design'
import type { AfirmacaoDoPacote, DocumentoGerado } from './pacote-estrutural'
import type { AchadoDoPrototipo } from './validacao-de-prototipo'
import type { Decision, DecisoesPorPergunta, Pergunta } from './wizard'
import { textoDaDecisao } from './pacote-compositor'

/**
 * Os quatro documentos que esta fatia produz. Enum fechado pelo mesmo motivo do
 * `DOCUMENTOS_DO_PACOTE`: cada um tem seções próprias, e um quinto é mudança de contrato.
 */
export const DOCUMENTOS_DA_ARQUITETURA = [
  'ARCHITECTURE',
  'DECISIONS',
  'TESTING',
  'REVIEW'
] as const

export type DocumentoDaArquitetura = (typeof DOCUMENTOS_DA_ARQUITETURA)[number]

export const ARQUIVO_DA_ARQUITETURA: Readonly<Record<DocumentoDaArquitetura, string>> = {
  ARCHITECTURE: 'docs/ARCHITECTURE.md',
  DECISIONS: 'docs/DECISIONS.md',
  TESTING: 'docs/TESTING.md',
  REVIEW: 'docs/REVIEW.md'
}

/** As seções de cada documento, na ordem. Dado, não lógica — como na M8-F04. */
export const SECOES_DA_ARQUITETURA: Readonly<
  Record<DocumentoDaArquitetura, readonly string[]>
> = {
  ARCHITECTURE: ['Fluxos cobertos', 'Módulos e fronteiras', 'Dados', 'Resiliência'],
  DECISIONS: ['Decisões estruturais', 'Questões em aberto'],
  TESTING: ['Estratégia', 'Evidência'],
  REVIEW: ['Como revisar', 'Pontos de atenção']
}

export const PREAMBULO_DA_ARQUITETURA: Readonly<Record<DocumentoDaArquitetura, string>> = {
  ARCHITECTURE:
    '> Os fluxos descritos aqui saem dos protótipos anexados. Fluxo sem protótipo não é prometido.',
  DECISIONS: '> Cada decisão cita a resposta do planejamento que a originou.',
  TESTING: '> Estratégia derivada do escopo decidido e das jornadas efetivamente prototipadas.',
  REVIEW: '> Instruções de revisão deste projeto, a partir do que foi decidido e anexado.'
}

/**
 * O pacote de arquitetura gerado.
 *
 * `anexos` congela os hashes do gate no instante da geração (critério 6), e
 * `pacoteEstruturalId` amarra a revisão do PRD assumida (critério 3).
 */
export interface PacoteArquitetura {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  /** A revisão do PRD que esta arquitetura assume (critério 3). */
  readonly pacoteEstruturalId: string
  readonly documentos: readonly DocumentoGerado[]
  /** Os anexos como estavam quando a arquitetura saiu — com hash (critério 6). */
  readonly anexos: readonly Anexo[]
  readonly hash: string
  readonly commitHash: string | null
  readonly created_at: string
}

/**
 * Por que a arquitetura não pôde sair. Enum fechado: a tela decide o que mostrar a partir dele.
 */
export const ARQUITETURA_REASONS = [
  'gerada',
  'projeto-inexistente',
  /** O gate de anexos não abriu: falta `DESIGN-SYSTEM.md` ou protótipo (critério 1). */
  'anexos-pendentes',
  /** Não há PRD a que se referir — a arquitetura não tem revisão para assumir (critério 3). */
  'prd-ausente',
  /** Os protótipos têm problema que impede prometer o fluxo (critério 2). */
  'prototipos-invalidos',
  'falha-de-escrita'
] as const

export type ArquiteturaReason = (typeof ARQUITETURA_REASONS)[number]

export interface ArquiteturaOutcome {
  readonly reason: ArquiteturaReason
  readonly pacote?: PacoteArquitetura
  /** Em `anexos-pendentes`: o que falta anexar. */
  readonly pendencias?: readonly string[]
  /** Em `prototipos-invalidos`: os achados que impedem, com pergunta e recomendação. */
  readonly achados?: readonly AchadoDoPrototipo[]
  readonly mensagem: string
}

/**
 * As perguntas do wizard que a arquitetura usa.
 *
 * `design-de-origem` é a desta fatia (a M8-F03 a declarou não-delegável e a M8-F04 a deixou de
 * fora do PRD de propósito): ela diz se o design nasce dos anexos do PI ou de outra origem, e é
 * a decisão que a seção de fronteiras registra.
 */
export const PERGUNTAS_DA_ARQUITETURA: readonly string[] = ['superficie', 'design-de-origem']

/**
 * As jornadas viram as afirmações de "Fluxos cobertos".
 *
 * **Origem `decisao`, apontando para a decisão de superfície** — e não uma origem nova. A
 * jornada não é uma afirmação independente: ela é o recorte concreto da superfície que o PI
 * decidiu, delimitado pelo que ele prototipou. Inventar uma terceira variante de origem para
 * ela abriria a porta que os critérios 1 e 5 da M8-F04 mantêm fechada.
 */
export function afirmacoesDosFluxos(
  jornadas: readonly string[],
  decisaoDeSuperficie: Decision | undefined
): readonly AfirmacaoDoPacote[] {
  if (decisaoDeSuperficie === undefined) return []
  return jornadas.map((jornada, i) => ({
    id: `fluxo-${i}`,
    secao: 'Fluxos cobertos',
    texto: jornada,
    origem: {
      tipo: 'decisao',
      decisaoId: decisaoDeSuperficie.id,
      perguntaId: decisaoDeSuperficie.perguntaId
    }
  }))
}

/**
 * As decisões do planejamento viram as afirmações de "Decisões estruturais".
 *
 * Só as perguntas que a arquitetura usa: incluir todas repetiria no `DECISIONS.md` o que o PRD
 * já registrou, e o leitor deixaria de saber qual documento responde o quê.
 */
export function afirmacoesDasDecisoes(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta,
  perguntas: readonly string[] = PERGUNTAS_DA_ARQUITETURA
): readonly AfirmacaoDoPacote[] {
  const afirmacoes: AfirmacaoDoPacote[] = []

  for (const perguntaId of perguntas) {
    const decisao = decisoes[perguntaId]
    const pergunta = catalogo.find((p) => p.id === perguntaId)
    if (decisao === undefined || pergunta === undefined) continue

    afirmacoes.push({
      id: `decisao-${perguntaId}`,
      secao: 'Decisões estruturais',
      texto: `${pergunta.titulo}: ${textoDaDecisao(pergunta, decisao)}`,
      origem: { tipo: 'decisao', decisaoId: decisao.id, perguntaId }
    })
  }

  return afirmacoes
}

/**
 * Os achados que **não** impedem viram "Questões em aberto" do `DECISIONS.md`.
 *
 * É o critério 2 tomando forma de documento: o problema mostrado ao PI não desaparece quando ele
 * decide gerar assim mesmo — ele vira uma questão registrada, com a pergunta que a originou.
 * Sem isso, "o PI viu e seguiu" e "ninguém percebeu" ficariam indistinguíveis depois do fato.
 */
export function afirmacoesDasQuestoes(
  achados: readonly AchadoDoPrototipo[],
  decisaoDeSuperficie: Decision | undefined
): readonly AfirmacaoDoPacote[] {
  if (decisaoDeSuperficie === undefined) return []
  return achados
    .filter((a) => a.severidade === 'pergunta')
    .map((achado) => ({
      id: `questao-${achado.id}`,
      secao: 'Questões em aberto',
      texto: `${achado.pergunta} — recomendação: ${achado.recomendacao}`,
      origem: {
        tipo: 'decisao' as const,
        decisaoId: decisaoDeSuperficie.id,
        perguntaId: decisaoDeSuperficie.perguntaId
      }
    }))
}

/**
 * A estratégia de teste sai das jornadas cobertas, uma linha por jornada.
 *
 * Pelo mesmo motivo dos fluxos: testar o que não foi prototipado seria prometer cobertura sobre
 * tela que ninguém desenhou.
 */
export function afirmacoesDeTeste(
  jornadas: readonly string[],
  decisaoDeSuperficie: Decision | undefined
): readonly AfirmacaoDoPacote[] {
  if (decisaoDeSuperficie === undefined) return []
  return jornadas.map((jornada, i) => ({
    id: `teste-${i}`,
    secao: 'Estratégia',
    texto: `Cobrir a jornada "${jornada}" com teste de ponta a ponta.`,
    origem: {
      tipo: 'decisao',
      decisaoId: decisaoDeSuperficie.id,
      perguntaId: decisaoDeSuperficie.perguntaId
    }
  }))
}

/**
 * A evidência do TESTING: os anexos que sustentam a revisão, por hash (critério 6).
 *
 * Origem `decisao` da superfície pela mesma razão dos fluxos — o anexo não afirma, ele comprova;
 * o que se afirma é que a revisão foi construída sobre aquele conteúdo, e o hash é a prova.
 */
export function afirmacoesDaEvidencia(
  anexos: readonly Anexo[],
  decisaoDeSuperficie: Decision | undefined
): readonly AfirmacaoDoPacote[] {
  if (decisaoDeSuperficie === undefined) return []
  return anexos.map((anexo) => ({
    id: `evidencia-${anexo.caminho}`,
    secao: 'Evidência',
    texto: `${anexo.caminho} — sha256:${anexo.hash.slice(0, 16)} (${anexo.bytes} bytes, anexado em ${anexo.anexadoEm}).`,
    origem: {
      tipo: 'decisao',
      decisaoId: decisaoDeSuperficie.id,
      perguntaId: decisaoDeSuperficie.perguntaId
    }
  }))
}

/**
 * As instruções de revisão, derivadas do que existe.
 *
 * "Como revisar" lista os documentos da revisão; "Pontos de atenção" lista o que os protótipos
 * deixaram em aberto. Nenhuma das duas inventa prática de revisão genérica — um `REVIEW.md` com
 * conselhos de boas práticas seria conteúdo sem origem, e é o que o critério 5 da M8-F04
 * proibiu ao dizer que a Convention não importa regra de outro projeto.
 */
export function afirmacoesDaRevisao(
  documentosDoPrd: readonly DocumentoGerado[],
  achados: readonly AchadoDoPrototipo[],
  decisaoDeSuperficie: Decision | undefined
): readonly AfirmacaoDoPacote[] {
  if (decisaoDeSuperficie === undefined) return []
  const origem = {
    tipo: 'decisao' as const,
    decisaoId: decisaoDeSuperficie.id,
    perguntaId: decisaoDeSuperficie.perguntaId
  }

  const comoRevisar = documentosDoPrd.map((doc) => ({
    id: `revisar-${doc.documento}`,
    secao: 'Como revisar',
    texto: `Conferir ${doc.caminho} contra esta arquitetura — sha256:${doc.hash.slice(0, 16)}.`,
    origem
  }))

  const atencao = achados.map((achado) => ({
    id: `atencao-${achado.id}`,
    secao: 'Pontos de atenção',
    texto: `${achado.prototipo}: ${achado.pergunta}`,
    origem
  }))

  return [...comoRevisar, ...atencao]
}
