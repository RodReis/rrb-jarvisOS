/**
 * As recusas que valem para toda tarefa do Squad, worker ou escritor (SPEC-Squads-03, regra 1).
 *
 * Mora num lugar só para a regra não divergir entre os dois executores: o limite de tentativas é o
 * da M9-F04 e vale por tarefa, e um limite que não é um número positivo e finito é recusa — nunca
 * "sem limite", que é o que um `Infinity` ou um `NaN` viraria na conta do prazo.
 */

import { proximaTentativaPermitida } from '@shared/domain/attempt'
import type { TarefaDoPlano } from '@shared/domain/squad-plano'

export type MotivoDeRecusaComum =
  'tentativa-invalida' | 'tentativas-esgotadas' | 'limite-invalido' | 'sem-contexto'

/** A tentativa é de 1 a 3: a terceira é a última, e não há quarta (M9-F04). */
export function recusaDaTentativa(tentativa: number): MotivoDeRecusaComum | undefined {
  if (!Number.isInteger(tentativa) || tentativa < 1) return 'tentativa-invalida'
  return proximaTentativaPermitida(tentativa - 1) ? undefined : 'tentativas-esgotadas'
}

/**
 * Prazo, entrada e saída precisam ser números positivos e finitos; os turnos, que viram o
 * `--max-turns` do CLI, inteiros positivos.
 */
export function recusaDosLimites(
  limites: TarefaDoPlano['limites']
): MotivoDeRecusaComum | undefined {
  const { maxTurnos, maxMinutos, maxTokensEntrada, maxTokensSaida } = limites
  const validos =
    Number.isInteger(maxTurnos) &&
    maxTurnos > 0 &&
    [maxMinutos, maxTokensEntrada, maxTokensSaida].every((n) => Number.isFinite(n) && n > 0)
  return validos ? undefined : 'limite-invalido'
}

/** Tarefa sem fonte nenhuma não tem o que analisar nem o que editar. */
export function recusaDoContexto(
  fontes: number,
  itensDoPack: number
): MotivoDeRecusaComum | undefined {
  return fontes === 0 || itensDoPack === 0 ? 'sem-contexto' : undefined
}
