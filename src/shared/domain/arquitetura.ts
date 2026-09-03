/**
 * A forma do pacote de arquitetura: ARCHITECTURE, DECISIONS, TESTING e REVIEW.
 *
 * A pergunta que este arquivo responde: **quais são os quatro documentos, onde eles moram no
 * repositório do projeto e que seções cada um tem?**
 *
 * Nasceu na SPEC-Planejamento-05 respondendo mais que isso: ele também *compunha* o conteúdo, a
 * partir das decisões do wizard e das jornadas que o protótipo mostrava. A SPEC-Jornada-04
 * trocou a composição por **geração verificada** — o conteúdo agora nasce em
 * `arquitetura-gerada.ts`, com origem por afirmação e âncora no protótipo —, e o que sobrou aqui
 * é a forma: os nomes, os caminhos, as seções e o registro do pacote.
 *
 * **O critério 3 é uma coluna, não uma convenção.** *"Design e arquitetura referenciam a mesma
 * revisão do PRD"* — e por isso `PacoteArquitetura` carrega `pacoteEstruturalId`, apontando para
 * a revisão que ele assume. Sem o ponteiro, a arquitetura estaria implicitamente ligada ao "PRD
 * mais recente", que muda sob os pés dela: regerar o PRD faria a arquitetura passar a descrever
 * um documento que ninguém comparou com ela.
 *
 * **Os hashes dos anexos vão junto.** *"O pacote registra hashes de todos os anexos e saídas"* —
 * os das saídas vêm dos `DocumentoGerado`, e os dos anexos precisam ser congelados no ato,
 * porque o anexo pode ser substituído depois. Guardar só os ids faria o pacote apontar para
 * hashes que mudaram.
 *
 * **O que este arquivo não faz:** não lê arquivo, não abre navegador, não escreve no disco e não
 * decide conteúdo.
 */

import type { WorkspaceId } from './entities'
import type { Anexo } from './anexos-de-design'
import type { DocumentoGerado } from './pacote-estrutural'
import type { AchadoDoPrototipo } from './validacao-de-prototipo'

/**
 * Os quatro documentos que esta fatia produz. Enum fechado pelo mesmo motivo do
 * `DOCUMENTOS_DO_PACOTE`: cada um tem seções próprias, e um quinto é mudança de contrato.
 */
export const DOCUMENTOS_DA_ARQUITETURA = ['ARCHITECTURE', 'DECISIONS', 'TESTING', 'REVIEW'] as const

export type DocumentoDaArquitetura = (typeof DOCUMENTOS_DA_ARQUITETURA)[number]

export const ARQUIVO_DA_ARQUITETURA: Readonly<Record<DocumentoDaArquitetura, string>> = {
  ARCHITECTURE: 'docs/ARCHITECTURE.md',
  DECISIONS: 'docs/DECISIONS.md',
  TESTING: 'docs/TESTING.md',
  REVIEW: 'docs/REVIEW.md'
}

/** As seções de cada documento, na ordem. Dado, não lógica — como na M8-F04. */
export const SECOES_DA_ARQUITETURA: Readonly<Record<DocumentoDaArquitetura, readonly string[]>> = {
  ARCHITECTURE: ['Fluxos cobertos', 'Módulos e fronteiras', 'Dados', 'Resiliência'],
  DECISIONS: ['Decisões estruturais', 'Questões em aberto'],
  TESTING: ['Estratégia', 'Evidência'],
  REVIEW: ['Como revisar', 'Pontos de atenção']
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
