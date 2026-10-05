/**
 * Merge serializado (SPEC-Scheduler-04): o núcleo puro.
 *
 * Dois PRs podem estar verdes ao mesmo tempo e ainda assim não poder entrar juntos: o segundo foi
 * verificado contra uma base que o primeiro acabou de mudar. A serialização tem duas peças — um
 * **lease exclusivo por repositório e branch-base** (quem está na seção crítica) e uma **decisão
 * sob o lease** (o que a origem mostra *agora* ainda é o que a pipeline avaliou?). Esta é a
 * segunda; a primeira vive no `LeaseRepository`.
 *
 * Nada aqui faz I/O. A observação da origem entra como dado, e o veredicto sai como valor — é o que
 * permite testar a corrida de dois PRs sem uma origem de verdade.
 */

import { rulesetMudou, type RegraObservada, type SnapshotDeRuleset } from './ruleset'

/** Prefixo do recurso do lease. Distinto de `wip:slot:`, `worktree:`, `container:` e `porta:`. */
export const PREFIXO_DO_MERGE = 'merge:'

/**
 * O recurso exclusivo de um repositório e branch-base.
 *
 * Dono e repositório entram em minúsculas: o GitHub os trata sem distinguir caixa, e dois runs que
 * escrevessem `RodReis/Jarvis` e `rodreis/jarvis` disputariam o mesmo repositório com dois leases
 * diferentes — exatamente a corrida que o lease existe para impedir. O **branch** mantém a caixa:
 * `main` e `Main` são refs distintas no Git.
 */
export function recursoDoMerge(owner: string, repo: string, branchBase: string): string {
  return `${PREFIXO_DO_MERGE}${owner.toLowerCase()}/${repo.toLowerCase()}:${branchBase}`
}

export function ehRecursoDeMerge(recurso: string): boolean {
  return recurso.startsWith(PREFIXO_DO_MERGE)
}

/**
 * Lê de volta o que `recursoDoMerge` escreveu. O `:` separa repositório e branch com segurança:
 * nem nome de dono, nem de repositório, nem ref do Git o admitem.
 */
export function lerRecursoDeMerge(
  recurso: string
): { readonly owner: string; readonly repo: string; readonly branchBase: string } | undefined {
  if (!ehRecursoDeMerge(recurso)) return undefined

  const corpo = recurso.slice(PREFIXO_DO_MERGE.length)
  const separador = corpo.indexOf(':')
  if (separador <= 0 || separador === corpo.length - 1) return undefined

  const repositorio = corpo.slice(0, separador)
  const barra = repositorio.indexOf('/')
  if (barra <= 0 || barra === repositorio.length - 1) return undefined

  return {
    owner: repositorio.slice(0, barra),
    repo: repositorio.slice(barra + 1),
    branchBase: corpo.slice(separador + 1)
  }
}

/**
 * A chave de idempotência do merge: **determinística**, derivada de repositório, PR e head.
 *
 * Uma chave nova a cada chamada (o que a entrega fazia) apaga a relação entre a intenção anterior
 * e o retry depois de um crash: o diário nunca reconhece que é a mesma operação. Com a chave
 * derivada, o retry do mesmo head repete a intenção; e o head entra porque o merge de **outro**
 * commit do mesmo PR é outra operação, não um retry.
 */
export function chaveDoMerge(
  owner: string,
  repo: string,
  pullRequest: number,
  headSha: string
): string {
  return `pr.squash-merge:${owner.toLowerCase()}/${repo.toLowerCase()}#${pullRequest}@${headSha}`
}

/** O que a pipeline avaliou ao decidir integrar. É contra isto que a origem é comparada. */
export interface AvaliacaoDoMerge {
  /** O head que os checks aprovaram. */
  readonly headSha: string
  /** A base no instante da avaliação. Ausente quando a leitura falhou. */
  readonly baseSha?: string | undefined
  /** A regra observada na avaliação. Ausente: não há como provar que ela não mudou. */
  readonly snapshot?: SnapshotDeRuleset | undefined
}

/** O que a origem mostra agora, lido **sob o lease**. */
export interface ObservacaoDoMerge {
  readonly estado: 'aberto' | 'fechado' | 'mergeado'
  readonly headSha?: string | undefined
  readonly baseSha?: string | undefined
  readonly regra?: RegraObservada | undefined
  /** O commit de merge, quando `estado` é `mergeado`. */
  readonly mergeSha?: string | undefined
  /**
   * Quantos commits da base o PR **não contém**, segundo a origem. Ausente é "não sei" — e "não
   * sei" **não** é "em dia": a decisão vira `observacao-incompleta` e o merge não sai.
   *
   * Existe porque a base lida duas vezes (na avaliação e sob o lease) responde só "a base mudou
   * entre as duas leituras" — e o PR que ficou para trás de um merge **anterior** à avaliação passa
   * por ela sem alarme: os dois lados leem a base nova. O CI dele, porém, rodou sem aquele commit.
   */
  readonly atrasadoPor?: number | undefined
}

export type DecisaoDoMerge =
  | { readonly reason: 'pode-mergear' }
  | { readonly reason: 'ja-mergeado'; readonly mergeSha: string }
  | { readonly reason: 'pr-fechado' }
  | { readonly reason: 'head-mudou'; readonly headSha: string }
  | { readonly reason: 'regra-mudou' }
  | { readonly reason: 'base-avancou'; readonly baseSha: string }
  /** Falta dado para afirmar qualquer coisa. Fail closed: não mergeia, e a volta seguinte relê. */
  | { readonly reason: 'observacao-incompleta'; readonly faltou: string }

/**
 * O merge pode sair, dado o que a origem mostra agora?
 *
 * **A precedência é a regra.** Quando mais de uma coisa mudou, vale a primeira da lista:
 *
 *  1. **já mergeado** — o efeito aconteceu (talvez antes de um crash). O resto é detalhe, e
 *     mergear de novo seria o efeito duplicado que a reconciliação existe para evitar;
 *  2. **PR fechado** — não há o que integrar;
 *  3. **head mudou** — os checks aprovaram outro commit. O commit novo precisa de checks novos
 *     antes de qualquer outra pergunta;
 *  4. **regra mudou** — a regra nova decide o que "verde" significa, e isso vem antes de saber se
 *     a base andou;
 *  5. **base avançou** — a pipeline sabe atualizar a branch e revalidar. Duas fontes: a base que
 *     mudou entre a avaliação e o lease, e o PR que a origem diz estar atrás dela.
 *
 * **Ilegível não é igual.** Head e regra ilegíveis são `observacao-incompleta`: tratar "não sei"
 * como "não mudou" é a afirmação sem prova que a SPEC-Pipeline-01 proíbe. A **base** ilegível é
 * exceção deliberada, herdada da M9-F05 §7: preservar o PR e explicar a limitação, porque a
 * permissão de ler a base pode faltar e as outras garantias continuam valendo.
 */
export function decidirMerge(
  avaliacao: AvaliacaoDoMerge,
  observacao: ObservacaoDoMerge
): DecisaoDoMerge {
  if (observacao.estado === 'mergeado') {
    return observacao.mergeSha === undefined
      ? { reason: 'observacao-incompleta', faltou: 'mergeSha de um PR mergeado' }
      : { reason: 'ja-mergeado', mergeSha: observacao.mergeSha }
  }

  if (observacao.estado === 'fechado') return { reason: 'pr-fechado' }

  if (observacao.headSha === undefined) {
    return { reason: 'observacao-incompleta', faltou: 'head do pull request' }
  }
  if (observacao.headSha !== avaliacao.headSha) {
    return { reason: 'head-mudou', headSha: observacao.headSha }
  }

  if (avaliacao.snapshot === undefined || observacao.regra === undefined) {
    return { reason: 'observacao-incompleta', faltou: 'regra da branch-base' }
  }
  if (rulesetMudou(avaliacao.snapshot, observacao.regra)) return { reason: 'regra-mudou' }

  if (
    avaliacao.baseSha !== undefined &&
    observacao.baseSha !== undefined &&
    avaliacao.baseSha !== observacao.baseSha
  ) {
    return { reason: 'base-avancou', baseSha: observacao.baseSha }
  }

  // Sem saber se o PR contém a base, não há afirmação possível: fail closed, como head e regra.
  if (observacao.atrasadoPor === undefined) {
    return { reason: 'observacao-incompleta', faltou: 'comparação base...head do pull request' }
  }

  // O PR não contém a base atual: o CI dele validou um head que não inclui o commit do vizinho.
  if (observacao.atrasadoPor > 0) {
    return { reason: 'base-avancou', baseSha: observacao.baseSha ?? avaliacao.baseSha ?? '' }
  }

  return { reason: 'pode-mergear' }
}

/** O estado de uma tentativa de merge, persistida **antes** de a chamada sair. */
export const ESTADOS_DA_TENTATIVA = ['iniciada', 'confirmada', 'abandonada'] as const
export type EstadoDaTentativa = (typeof ESTADOS_DA_TENTATIVA)[number]
