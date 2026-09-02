/**
 * O snapshot do conjunto obrigatório observado na origem (critério 11 da SPEC-Entrega-05).
 *
 * A pergunta que ele responde: **qual regra valia quando este run começou, e ela ainda vale?**
 *
 * Existe porque o gate de merge não pode comparar com uma regra que já não vale. Entre o início do
 * run e o merge, alguém pode acrescentar um check obrigatório na proteção da branch-base; mergear
 * contra o snapshot velho entraria na base sem a verificação que a origem passou a exigir. E o
 * inverso também importa: uma proteção que sumiu no meio do caminho muda o que "verde" significa.
 *
 * O snapshot é **append-only por run** — cada observação é uma linha nova. Sobrescrever apagaria a
 * prova de que a regra mudou, que é justamente a evidência da reconciliação que o critério pede.
 */

/** Uma observação do conjunto obrigatório, com quando e onde foi observada. */
export interface SnapshotDeRuleset {
  readonly runId: string
  readonly branch: string
  /** Os *contexts* que a proteção exige. Vazio quando não há proteção ou ela não exige check. */
  readonly contexts: readonly string[]
  /** A origem exige que o branch esteja atualizado com a base antes do merge? */
  readonly strict: boolean
  readonly protegida: boolean
  /** A origem exige merge queue? A pipeline não a contorna (critério 12). */
  readonly mergeQueueExigida: boolean
  /** A referência do recurso na origem, para a auditoria apontar o que foi observado. */
  readonly ref: string
  /** ISO-8601. A data é parte do snapshot: "observado quando" é metade do que ele afirma. */
  readonly observadoEm: string
}

/** O que a origem devolve agora — os campos de regra, sem os de identificação do snapshot. */
export interface RegraObservada {
  readonly contexts: readonly string[]
  readonly strict: boolean
  readonly protegida: boolean
  readonly mergeQueueExigida: boolean
}

/**
 * A regra da origem mudou desde o snapshot?
 *
 * Compara **conjunto ordenado**, não a lista como veio: a ordem em que o GitHub devolve `contexts`
 * não é contrato, e tratá-la como mudança forçaria reconciliação a cada consulta — o que
 * transformaria o sinal em ruído, e ruído é onde um alarme legítimo passa despercebido.
 *
 * Comparar só o tamanho não bastaria: `['a', 'a']` e `['a', 'b']` têm o mesmo comprimento, e o
 * segundo exige um check que o primeiro não exigia. Por isso a comparação é elemento a elemento
 * depois de ordenar.
 */
export function rulesetMudou(anterior: SnapshotDeRuleset, atual: RegraObservada): boolean {
  if (anterior.protegida !== atual.protegida) return true
  if (anterior.strict !== atual.strict) return true
  if (anterior.mergeQueueExigida !== atual.mergeQueueExigida) return true

  const antes = [...anterior.contexts].sort()
  const agora = [...atual.contexts].sort()

  return antes.length !== agora.length || antes.some((contexto, i) => contexto !== agora[i])
}
