/**
 * Contratos de projeto e sessão de planejamento (SPEC-Planejamento-01).
 *
 * A pergunta que este arquivo responde: **o que é um projeto do JARVIS OS antes de existir
 * uma linha de código dele?** Um diretório no disco, um repositório Git local, e um estado de
 * planejamento em progresso — nesta ordem de dependência, e nenhum dos três sozinho.
 *
 * Duas entidades, e a divisão entre elas é a decisão central da fatia:
 *
 *  - **`Project`** é o que existe no disco. Identidade estável (slug, diretório, origem) que
 *    sobrevive a reinício e a qualquer perda de estado de trabalho.
 *  - **`PlanningSession`** é o que está em progresso. Respostas do wizard, autosalvas a cada
 *    mudança e retomáveis. Vive no SQLite **porque não deve virar commit**: cada tecla do
 *    usuário não é um marco documental, e commitar rascunho encheria o histórico de ruído que
 *    enterraria os marcos reais (spec § Regras).
 *
 * **Git é a fonte das revisões documentais; o SQLite é o estado de trabalho.** Os dois não
 * competem: um guarda o que foi decidido (imutável, hasheável, revisável), o outro guarda o
 * que está sendo decidido (mutável, sobrescrito, descartável). Confundi-los daria um histórico
 * ilegível ou um rascunho que se perde no reinício.
 *
 * Mora em `src/shared/domain` porque a UI lista projetos e mostra o progresso do planejamento,
 * e o contrato precisa ser verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'
import type { Etapa } from './jornada'

/**
 * Como o projeto passou a existir. Enum fechado, e não um booleano `importado`: os dois
 * caminhos têm garantias diferentes que a auditoria precisa distinguir sem inferir — `criado`
 * promete estrutura documental nova, `importado` promete **não ter tocado em nada** que já
 * estava lá.
 */
export const PROJECT_ORIGINS = ['criado', 'importado'] as const

export type ProjectOrigin = (typeof PROJECT_ORIGINS)[number]

/**
 * Por que uma tentativa de criar/importar terminou assim. Enum fechado pela mesma razão que
 * `CommandReason` é: a UI decide o que mostrar a partir dele, e um motivo novo é mudança de
 * contrato — nunca uma string que vaza de um `catch` para a tela.
 *
 * As recusas acontecem **antes de qualquer escrita**. É o que sustenta o critério 3 (*colisão
 * não cria diretório parcial nem modifica o alvo*): não há estado a limpar porque não houve
 * estado.
 */
export const PROJECT_REASONS = [
  'criado',
  'importado',
  'nome-invalido',
  'colisao',
  'diretorio-fora-da-allowlist',
  'diretorio-inexistente',
  'git-indisponivel',
  'falha-no-git',
  'falha-de-escrita'
] as const

export type ProjectReason = (typeof PROJECT_REASONS)[number]

/**
 * Um marco documental — o **único** gatilho de commit automático (spec § Fluxo 6).
 *
 * Fechado e nomeado, não texto livre, porque a mensagem de commit é determinística por marco
 * (spec § decisões cravadas): o mesmo marco produz sempre a mesma mensagem, e é isso que torna
 * o histórico legível e o critério 4 verificável.
 *
 * `estrutura-inicial` é o único que esta fatia dispara; os demais existem porque as fatias
 * seguintes do MVP-008 os produzem, e declará-los agora evita que cada uma acrescente um caso
 * solto ao mapa de mensagens — mesma razão pela qual a taxonomia de risco nasceu completa no
 * MVP-002.
 */
export const MARCOS_DOCUMENTAIS = [
  'estrutura-inicial',
  // SPEC-Jornada-02, critério 1: o prompt do PI vira `PROMPT.md` e o commit é o que dá ao
  // brief algo para citar como `ContextPack` — sem revisão no disco, a geração não teria o que
  // ler (SPEC-Planejamento-02, critério 1: nenhuma chamada sem contexto montado).
  'prompt-registrado',
  'contexto-aprovado',
  'prd-aprovado',
  'design-anexado',
  'arquitetura-aprovada',
  'roadmap-aprovado'
] as const

export type MarcoDocumental = (typeof MARCOS_DOCUMENTAIS)[number]

/**
 * A mensagem de commit de cada marco. **Dado, não lógica** — mesma postura do seed da
 * taxonomia de risco: mudar a mensagem de um marco é editar uma linha aqui, nunca o serviço.
 *
 * pt-BR e no formato convencional do repositório (CLAUDE.md § Idioma). Determinística de
 * propósito: dois projetos que atingem o mesmo marco produzem a mesma linha de histórico, e o
 * critério 4 pede exatamente isso.
 */
export const MENSAGEM_DO_MARCO: Readonly<Record<MarcoDocumental, string>> = {
  'estrutura-inicial': 'docs: estrutura documental inicial do projeto',
  'prompt-registrado': 'docs: prompt do projeto',
  'contexto-aprovado': 'docs: contexto e escopo aprovados',
  'prd-aprovado': 'docs: PRD aprovado',
  'design-anexado': 'docs: anexos de design do PI',
  'arquitetura-aprovada': 'docs: arquitetura aprovada',
  'roadmap-aprovado': 'docs: roadmap e índice de fatias'
}

/**
 * Um projeto local. Escopado por `user_id` **e** `workspace_id` (CONVENTION §2): projetos são
 * do JARVIS OS, e o NOA não os lista.
 */
export interface Project {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /** Nome livre digitado pelo usuário, preservado como ele escreveu. */
  readonly nome: string
  /** Identificador em kebab-case derivado do nome. Único por usuário + espaço. */
  readonly slug: string
  /** Diretório canônico do projeto. Dentro da allowlist, sempre. */
  readonly diretorio: string
  readonly origem: ProjectOrigin
  /**
   * `true` quando o repositório Git já existia (importação de repo). O app **nunca**
   * reinicializa repositório existente (spec § Regras), e este campo registra a diferença.
   */
  readonly gitPreexistente: boolean
  readonly created_at: string
}

/**
 * O resultado de tentar criar ou importar. Devolvido **sempre** — inclusive nas recusas, que
 * não são erro a estourar: colisão é desfecho legítimo que a UI mostra e a auditoria guarda.
 */
export interface ProjectOutcome {
  readonly reason: ProjectReason
  /** Presente só quando `reason` é `criado` ou `importado`. */
  readonly project?: Project
  /** Descrição em pt-BR do que aconteceu, para a tela. */
  readonly mensagem: string
  /** O diretório que colidiu, quando `reason` é `colisao` — a UI oferece retomar ou importar. */
  readonly diretorioEmConflito?: string
}

/**
 * O estado de trabalho do planejamento. **Uma sessão por projeto**: retomar é reabrir a mesma,
 * nunca criar outra — duas sessões abertas para o mesmo projeto significariam duas verdades
 * sobre onde o usuário parou.
 *
 * `respostas` é um mapa aberto porque as perguntas vêm das fatias seguintes (M8-F03 em diante),
 * e fechá-lo aqui obrigaria esta fatia a conhecer um wizard que ainda não existe.
 */
export interface PlanningSession {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  /** Onde o wizard parou. Texto livre da fatia que o define; opaco para esta. */
  readonly etapa: string
  /**
   * Onde a **jornada de planejamento** parou (SPEC-Jornada-01). Campo distinto de `etapa`, que
   * guarda a etapa do wizard: são dois conceitos: `etapa` diz qual grupo de perguntas o
   * catálogo preenche, `etapaDaJornada` diz em que ponto da trilha o projeto está.
   *
   * **É cache, não fonte de verdade.** Quando discorda do que as aprovações e os marcos
   * sustentam, o serviço recalcula e audita o desvio (critério 2).
   */
  readonly etapaDaJornada: Etapa
  /** Por que a jornada regrediu da última vez, ou `null` se nunca regrediu (critério 7). */
  readonly motivoDaRegressao: string | null
  readonly respostas: Readonly<Record<string, unknown>>
  /** Último marco documental já commitado, ou `null` enquanto nenhum foi atingido. */
  readonly ultimoMarco: MarcoDocumental | null
  readonly updated_at: string
  readonly created_at: string
}

/**
 * Resultado de um commit de marco. **`commitado: false` não é erro fatal**: o critério 5 exige
 * que falha de commit preserve os dados no SQLite e ofereça retomada, então o serviço devolve o
 * desfecho em vez de estourar — quem chamou continua com a sessão intacta.
 */
export interface MarcoOutcome {
  readonly marco: MarcoDocumental
  readonly commitado: boolean
  readonly mensagem: string
  /** Hash do commit, quando houve. É por ele que a revisão é rastreável (spec § Evidência). */
  readonly commitHash?: string
}

/** Teto do slug. É ele que entra no path, e path longo demais falha por motivo alheio ao nome. */
export const TAMANHO_MAXIMO_DO_SLUG = 64

/**
 * Slug em kebab-case a partir do nome digitado. Puro, sem I/O — é regra, e regra mora onde
 * pode ser testada sem Electron.
 *
 * Remove acento antes de filtrar (NFD + corte dos diacríticos): sem isso, "Análise Rápida"
 * viraria `an-lise-r-pida`, porque `á` não casa a classe permitida e cada acento viraria um
 * hífen. O usuário brasileiro nomeia projeto com acento por padrão — isso não é caso de borda,
 * é o caminho comum.
 */
export function slugificar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * O nome é utilizável? **A validação é sobre o slug, não sobre o nome**: é o slug que vira
 * diretório, e um nome que parece válido mas slugifica para vazio (só acento, só símbolo)
 * criaria um diretório sem nome.
 */
export function isNomeDeProjetoValido(nome: string): boolean {
  const slug = slugificar(nome)
  return slug.length > 0 && slug.length <= TAMANHO_MAXIMO_DO_SLUG
}

export function isMarcoDocumental(value: unknown): value is MarcoDocumental {
  return typeof value === 'string' && (MARCOS_DOCUMENTAIS as readonly string[]).includes(value)
}
