/**
 * Navegação isolada por espaço (SPEC-Fundacao-02, critério 1).
 *
 * A regra que dá trabalho: **cada workspace lembra a última rota onde o usuário estava**;
 * voltar a ele restaura essa rota, e a rota do outro espaço nunca aparece na tela do
 * espaço ativo. Uma variável `rotaAtual` única não resolve — ela vazaria de um espaço para
 * o outro, que é exatamente o que o critério proíbe.
 *
 * Estado puro, sem React: assim a regra é testável direto, sem renderizar componente.
 */

import type { WorkspaceId } from '@shared/domain/entities'

/**
 * Itens de navegação por espaço. Placeholders — os módulos reais vêm em fatias futuras.
 *
 * `settings` aparece nos **dois** espaços de propósito (SPEC-05): é capacidade
 * compartilhada, e a preferência é do usuário, não do espaço. Ainda assim ela é uma rota
 * *de cada* espaço, não uma exceção fora do mapa — do contrário a regra de isolamento
 * teria um caso especial, e caso especial é onde vazamento se esconde.
 */
export const ROTAS_POR_WORKSPACE: Readonly<Record<WorkspaceId, readonly string[]>> = {
  noa: ['inicio', 'notas', 'agenda', 'settings'],
  jarvis: ['inicio', 'operacoes', 'agentes', 'settings']
}

/** Rota inicial de cada espaço, usada na primeira visita. */
export const ROTA_INICIAL = 'inicio'

/** Onde o usuário está em cada espaço. */
export type RotasPorWorkspace = Readonly<Record<WorkspaceId, string>>

export const NAVEGACAO_INICIAL: RotasPorWorkspace = {
  noa: ROTA_INICIAL,
  jarvis: ROTA_INICIAL
}

/** Verifica se a rota pertence ao espaço — evita restaurar uma rota que vazou. */
export function rotaPertenceAoWorkspace(workspace: WorkspaceId, rota: string): boolean {
  return ROTAS_POR_WORKSPACE[workspace].includes(rota)
}

/**
 * Registra a navegação dentro de um espaço, sem tocar na rota dos outros.
 *
 * Rota que não pertence ao espaço é ignorada: aceitar `operacoes` como rota do NOA
 * criaria justamente o vazamento que o critério 1 proíbe.
 */
export function navegar(
  atual: RotasPorWorkspace,
  workspace: WorkspaceId,
  rota: string
): RotasPorWorkspace {
  if (!rotaPertenceAoWorkspace(workspace, rota)) return atual
  if (atual[workspace] === rota) return atual

  return { ...atual, [workspace]: rota }
}

/** A rota a exibir ao entrar num espaço: a última dele, nunca a de outro. */
export function rotaDoWorkspace(atual: RotasPorWorkspace, workspace: WorkspaceId): string {
  const rota = atual[workspace]
  return rotaPertenceAoWorkspace(workspace, rota) ? rota : ROTA_INICIAL
}
