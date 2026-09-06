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
import { MODULOS_DO_APP } from './modulos'
import { rotasDoSubModulo } from './registro-de-modulos'

/**
 * Sub-módulos do JARVIS — o **rail dual** do protótipo (JARVISOS §2, critério 3 da SPEC-04a).
 *
 * `command` é o Professional Ops; `agents` é o Agents OS. Não são workspaces: o CLAUDE.md é
 * explícito em que `Agentic OS` é **área interna** do JARVIS OS, nunca um quarto espaço. Por
 * isso vivem aqui como dimensão da navegação do JARVIS, e não em `WorkspaceId` — pôr `agents`
 * ao lado de `noa`/`jarvis` seria criar por acidente o espaço que a arquitetura proíbe.
 *
 * O NOA não tem sub-módulo. O rail dele é atalho de view (NOA §2), e é por isso que
 * `subModuloDoWorkspace` devolve `null` — ausência declarada, não valor default que a UI
 * precisaria adivinhar se é real.
 */
export const SUB_MODULOS_JARVIS = ['command', 'agents'] as const

export type SubModuloJarvis = (typeof SUB_MODULOS_JARVIS)[number]

export const SUB_MODULO_INICIAL: SubModuloJarvis = 'command'

/**
 * Itens de navegação por espaço.
 *
 * As rotas do JARVIS **derivam do registro de módulos** (SPEC-Shell-01, regra 1): não existe
 * lista literal, e por isso uma fatia que entrega tela não precisa editar este arquivo. O NOA
 * mantém a lista própria — o rail dele é atalho de view, não sub-módulo (NOA §2), e ele não
 * entra no escopo desta fatia.
 *
 * `settings` aparece nos **dois** espaços de propósito (SPEC-05): é capacidade
 * compartilhada, e a preferência é do usuário, não do espaço. Ainda assim ela é uma rota
 * *de cada* espaço, não uma exceção fora do mapa — do contrário a regra de isolamento
 * teria um caso especial, e caso especial é onde vazamento se esconde.
 */
export const ROTAS_POR_WORKSPACE: Readonly<Record<WorkspaceId, readonly string[]>> = {
  noa: ['notas', 'agenda', 'settings'],
  jarvis: SUB_MODULOS_JARVIS.flatMap((sub) => rotasDoSubModulo(MODULOS_DO_APP, sub))
}

/**
 * Rota inicial de cada espaço.
 *
 * Não é mais uma constante `'inicio'`: a rota `inicio` **saiu** (regra 6), e a inicial passou a
 * ser o primeiro item visível. Uma constante fixa apontaria para tela que pode não existir, que
 * é exatamente o problema que esta fatia resolve.
 */
export function rotaInicialDoWorkspace(workspace: WorkspaceId): string {
  const primeira = ROTAS_POR_WORKSPACE[workspace][0]
  if (primeira === undefined) throw new Error(`Espaço sem rotas: ${workspace}`)
  return primeira
}

/** Onde o usuário está em cada espaço. */
export type RotasPorWorkspace = Readonly<Record<WorkspaceId, string>>

export const NAVEGACAO_INICIAL: RotasPorWorkspace = {
  noa: rotaInicialDoWorkspace('noa'),
  jarvis: rotaInicialDoWorkspace('jarvis')
}

/**
 * Traduz uma rota gravada antes desta fatia (SPEC-Shell-01, critério 6).
 *
 * `operacoes` → `operator` (a fila de aprovação é governança, não "Operações") e `projetos` →
 * `projects` (identificador em inglês, regra 10). Devolve `undefined` para rota que **sumiu** —
 * `inicio` e `agentes` — em vez de um substituto plausível: quem chama decide, e um palpite aqui
 * mandaria a pessoa para uma tela que ela não escolheu, escondendo o desaparecimento.
 */
export function migrarRota(rota: string): string | undefined {
  const RENOMEADAS: Readonly<Record<string, string>> = {
    operacoes: 'operator',
    projetos: 'projects'
  }

  const nova = RENOMEADAS[rota] ?? rota
  return ROTAS_POR_WORKSPACE.noa.includes(nova) || ROTAS_POR_WORKSPACE.jarvis.includes(nova)
    ? nova
    : undefined
}

/**
 * Migra o estado de navegação inteiro, lido do disco.
 *
 * Rota que sumiu cai na inicial **do espaço**, nunca em placeholder (regra 7).
 */
export function migrarNavegacao(atual: RotasPorWorkspace): RotasPorWorkspace {
  const migrado = { ...atual }

  for (const workspace of Object.keys(atual) as WorkspaceId[]) {
    migrado[workspace] = migrarRota(atual[workspace]) ?? rotaInicialDoWorkspace(workspace)
  }

  return migrado
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
  return rotaPertenceAoWorkspace(workspace, rota) ? rota : rotaInicialDoWorkspace(workspace)
}

/**
 * Rotas por sub-módulo do JARVIS — **derivadas do registro**, não escritas aqui.
 *
 * Era uma lista literal; virar projeção é o ponto da SPEC-Shell-01. Rota de módulo oculto não
 * entra, então nenhuma rota navegável cai no cabeçalho de placeholder (critério 2).
 */
export const ROTAS_POR_SUB_MODULO: Readonly<Record<SubModuloJarvis, readonly string[]>> = {
  command: rotasDoSubModulo(MODULOS_DO_APP, 'command'),
  agents: rotasDoSubModulo(MODULOS_DO_APP, 'agents')
}

/**
 * O sub-módulo a que uma rota do JARVIS pertence.
 *
 * Existe porque o rail e a sidebar têm de concordar: entrar em `agentes` precisa acender o
 * Agents OS no rail, senão o usuário vê a navegação de um sub-módulo com o outro marcado como
 * ativo. Devolve `null` para rota que não é do JARVIS — quem chama decide o que fazer, em vez
 * de receber um `'command'` que pareceria resposta legítima.
 */
export function subModuloDaRota(rota: string): SubModuloJarvis | null {
  const achado = SUB_MODULOS_JARVIS.find((sub) => ROTAS_POR_SUB_MODULO[sub].includes(rota))
  return achado ?? null
}

/** A rota inicial de um sub-módulo — a primeira da lista dele. */
export function rotaInicialDoSubModulo(sub: SubModuloJarvis): string {
  const primeira = ROTAS_POR_SUB_MODULO[sub][0]
  if (primeira === undefined) throw new Error(`Sub-módulo sem rotas: ${sub}`)
  return primeira
}
