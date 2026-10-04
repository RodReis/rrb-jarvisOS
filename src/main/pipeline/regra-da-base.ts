/**
 * A regra vigente de uma branch-base, lida da origem (SPEC-Scheduler-04).
 *
 * Duas fontes, e o que vale é a **união**: a proteção clássica da branch (`branch.ensure-protection`
 * a cria) e os *repository rulesets* do GitHub. Um repositório que exige um check só por ruleset
 * parecia, para a pipeline, uma base sem exigência nenhuma — e "PR verde" passava a significar
 * "verde nos checks que eu conheço", não "verde no que a origem exige".
 *
 * Existe como módulo porque **dois** lugares precisam ler a mesma regra do mesmo jeito: o
 * `EntregaService`, que tira o snapshot, e o `MergeService`, que compara a origem com ele sob o
 * lease. Se cada um lesse à sua maneira, a regra pareceria mudar a cada comparação.
 */

import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'
import type { ConnectorOutcome } from '@shared/domain/connectors'
import type { RegraObservada } from '@shared/domain/ruleset'

export type ChamarGithub = (
  operation: string,
  input: Record<string, unknown>
) => Promise<ConnectorOutcome>

interface ProtecaoLida {
  readonly contexts?: readonly string[]
  readonly strict?: boolean
  readonly protegida?: boolean
  readonly mergeQueueExigida?: boolean
}

interface RulesetsLidos {
  readonly contextsExigidos?: readonly string[]
  readonly mergeQueue?: boolean
  readonly tipos?: readonly string[]
}

/**
 * Lê a regra da origem. **Ilegível é `undefined`, nunca regra vazia**: falha em qualquer das duas
 * fontes não pode virar "a origem não exige nada". Quem precisa de um valor mesmo assim (o
 * snapshot do `EntregaService`) decide o que fazer; quem compara (o `MergeService`) trata como
 * observação incompleta e não mergeia.
 */
export async function lerRegraDaBase(
  chamar: ChamarGithub,
  alvo: { readonly owner: string; readonly repo: string; readonly branchBase: string }
): Promise<RegraObservada | undefined> {
  const entrada = { owner: alvo.owner, repo: alvo.repo, branch: alvo.branchBase }

  const [protecao, rulesets] = await Promise.all([
    chamar(GITHUB_OPERATIONS.getRequiredChecks, entrada),
    chamar(GITHUB_OPERATIONS.getRulesForBranch, entrada)
  ])
  if (!protecao.ok || !rulesets.ok) return undefined

  const p = (protecao.data ?? {}) as ProtecaoLida
  const r = (rulesets.data ?? {}) as RulesetsLidos

  return {
    // Ordenado e sem repetição: a ordem em que o GitHub devolve não é contrato (ver `rulesetMudou`).
    contexts: [...new Set([...(p.contexts ?? []), ...(r.contextsExigidos ?? [])])].sort(),
    strict: p.strict ?? false,
    // Um ruleset ativo é regra: a base não está "sem proteção" só porque ela mora lá.
    protegida: (p.protegida ?? false) || (r.tipos ?? []).length > 0,
    mergeQueueExigida: (p.mergeQueueExigida ?? false) || (r.mergeQueue ?? false)
  }
}
