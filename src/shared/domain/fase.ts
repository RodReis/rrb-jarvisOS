/**
 * A fase do projeto (SPEC-Fases-01).
 *
 * A pergunta que este arquivo responde: **em que trecho grande do trabalho este projeto está?**
 * A M25-F01 deu doze etapas, e doze é preciso demais para um card de índice: o PI olha a lista
 * e quer "ainda planejando" ou "já construindo" antes de querer "aceite do PRD".
 *
 * Duas decisões governam o arquivo:
 *
 *  - **Fase é função da etapa, não coluna.** Mesma razão da etapa derivada (critério 2 da
 *    SPEC-Jornada-01): um valor que só o código escreve viraria segunda fonte de verdade sobre
 *    o que a etapa já diz. Nenhuma transição nova, nenhum evento novo, nada a persistir.
 *  - **`FASE_DA_ETAPA` é `Record` completo, e o teste confere a completude.** Uma etapa nova
 *    não pode nascer sem fase: com mapa parcial ela cairia em `undefined` e o card apareceria
 *    sem fase, longe da decisão que faltou tomar. O corte é dado versionado, não lógica — a
 *    mesma postura de `CTA_DA_ETAPA` e `MENSAGEM_DO_MARCO`.
 *
 * Mora em `src/shared/domain` pela razão de sempre: a trilha e o card são desenhados no
 * renderer, e a regra precisa ser verificável sem carregar o Electron.
 */

import type { Etapa } from './jornada'
import { ETAPAS, ordemDaEtapa } from './jornada'

/**
 * As fases, **em ordem**. O índice é a posição: é o que permite dizer que a fase nunca regride
 * ao longo da trilha, sem um segundo mapa de ordem que poderia divergir desta lista.
 */
export const FASES = ['planejamento', 'especificacao', 'construcao'] as const

export type Fase = (typeof FASES)[number]

export function isFase(value: unknown): value is Fase {
  return typeof value === 'string' && (FASES as readonly string[]).includes(value)
}

/** O rótulo pt-BR de cada fase. Dado, não `switch` na tela. */
export const ROTULO_DA_FASE: Readonly<Record<Fase, string>> = {
  planejamento: 'Planejamento',
  especificacao: 'Especificação',
  construcao: 'Construção'
}

/**
 * A fase de cada etapa — **o corte decidido pelo PI em 2026-09-04**.
 *
 * `arquitetura` fica no Planejamento: ela é o último documento do pacote, e o aceite do pacote
 * (`pacote-aceito`) é o que fecha o trecho. Foram descartados "fase por gate" (seis combos, que
 * é a trilha de novo com outro nome) e "arquitetura na Especificação".
 *
 * `Record` completo de propósito: acrescentar etapa quebra o `tsc` aqui, e é o lugar certo para
 * a decisão aparecer.
 */
export const FASE_DA_ETAPA: Readonly<Record<Etapa, Fase>> = {
  prompt: 'planejamento',
  refinamento: 'planejamento',
  'brief-aceito': 'planejamento',
  prd: 'planejamento',
  'prd-aceito': 'planejamento',
  design: 'planejamento',
  arquitetura: 'planejamento',
  'pacote-aceito': 'planejamento',
  roadmap: 'especificacao',
  'mvp-aceito': 'especificacao',
  'spec-aceita': 'especificacao',
  construcao: 'construcao'
}

export function faseDaEtapa(etapa: Etapa): Fase {
  return FASE_DA_ETAPA[etapa]
}

/** As etapas de uma fase, na ordem da trilha. Derivado do mapa: nunca uma segunda lista. */
export function etapasDaFase(fase: Fase): readonly Etapa[] {
  return ETAPAS.filter((etapa) => FASE_DA_ETAPA[etapa] === fase)
}

export interface ProgressoNaFase {
  /** 1-based: é o que a tela mostra ("3 de 8"), não índice de array. */
  readonly posicao: number
  readonly total: number
}

/**
 * Onde a etapa está **dentro da própria fase** (critério 1 do card).
 *
 * Dentro da fase, e não da trilha inteira, porque é o que o bloco mostra: "3 de 8 no
 * Planejamento" responde quanto falta para virar a fase; "3 de 12" responderia outra pergunta,
 * que a trilha aberta já responde melhor.
 */
export function progressoNaFase(etapa: Etapa): ProgressoNaFase {
  const daFase = etapasDaFase(faseDaEtapa(etapa))
  const posicao = daFase.findIndex((e) => ordemDaEtapa(e) === ordemDaEtapa(etapa)) + 1

  return { posicao, total: daFase.length }
}
