/**
 * Contratos da `BudgetPolicy` — o gate de custo (SPEC-Providers-03).
 *
 * A F02 mede o custo e reporta; esta fatia decide **antes** de a chamada sair. O que mora
 * aqui é a forma do orçamento e a **função pura de decisão**: dado o acumulado do período, a
 * estimativa desta chamada e os limites, qual dos três caminhos seguir.
 *
 * A decisão é pura de propósito. O gate roda no main, dentro do ponto único, com relógio,
 * banco e auditoria em volta — e nada disso é necessário para afirmar que `0,95 + 0,10` sobre
 * um limite de `1,00` bloqueia. Separando, o teste do critério 2 afirma sobre o número.
 *
 * **Honestidade do modelo (ARCHITECTURE):** com BYOK o bloqueio é por **estimativa**
 * pré-chamada — o custo real só se conhece no fim do stream. O gate reduz o risco de estouro;
 * não o zera. Ver `avaliarOrcamento`.
 */

import type { WorkspaceId } from './entities'

/** A moeda dos limites. Uma só nesta fatia; existe como tipo para não virar `string` solta. */
export const MOEDA_DO_ORCAMENTO = 'USD' as const

export type MoedaDoOrcamento = typeof MOEDA_DO_ORCAMENTO

/** Limite diário padrão, em USD (requisitos § MVP Corte 2/3; ARCHITECTURE § Resiliência). */
export const LIMITE_DIARIO_PADRAO = 1

/** Limite mensal padrão, em USD. Separado do diário de propósito — critério 1. */
export const LIMITE_MENSAL_PADRAO = 1

/** Fração do limite que dispara alerta sem barrar. O "alerta" do ADR-001, questão 1. */
export const LIMIAR_DE_ALERTA_PADRAO = 0.8

/**
 * O orçamento de um escopo (`user_id` + `workspace_id`), como o RF do `BudgetPolicy` o define.
 *
 * Escopo usuário+workspace e não global: NOA e JARVIS têm orçamentos próprios, espelhando o
 * escopo da credencial na F01 — o gasto de um espaço não pode barrar o outro.
 *
 * Squad e agente ficam para o Corte 4 (spec § Fora): acrescentar as colunas agora seria
 * modelar um escopo que nada preenche.
 */
export interface BudgetPolicy {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  /** Teto do **dia corrente**, em USD. Ajustável (critério 1). */
  readonly dailyLimit: number
  /** Teto do **mês corrente**, em USD. Contado separado do diário. */
  readonly monthlyLimit: number
  /** Fração (0–1) do limite a partir da qual a chamada segue **com alerta**. */
  readonly alertThreshold: number
  readonly currency: MoedaDoOrcamento
}

/** O orçamento de quem nunca o editou — o padrão que o critério 1 exige existir. */
export function orcamentoPadrao(userId: string, workspace: WorkspaceId): BudgetPolicy {
  return {
    user_id: userId,
    workspace_id: workspace,
    dailyLimit: LIMITE_DIARIO_PADRAO,
    monthlyLimit: LIMITE_MENSAL_PADRAO,
    alertThreshold: LIMIAR_DE_ALERTA_PADRAO,
    currency: MOEDA_DO_ORCAMENTO
  }
}

/** O gasto real já registrado no escopo, por período (critério 3: dia e mês contam separado). */
export interface GastoAcumulado {
  /** Soma dos `CostEvent` reais do **dia corrente**, em USD. */
  readonly diaUsd: number
  /** Soma dos `CostEvent` reais do **mês corrente**, em USD. */
  readonly mesUsd: number
}

/** Qual dos dois tetos a decisão olhou. Distingue-os na auditoria sem parsear número. */
export type PeriodoDoOrcamento = 'dia' | 'mes'

/**
 * O veredito do gate — os três caminhos do critério 2.
 *
 * União discriminada, e não booleano + campos opcionais: `bloqueado` **sempre** diz qual
 * período estourou e por quanto, e `alerta` **sempre** traz a fração atingida. Campos
 * opcionais fariam cada chamador testar `undefined` em vez de tratar o caso.
 */
export type VereditoDoOrcamento =
  | { readonly decisao: 'permitido' }
  | {
      readonly decisao: 'alerta'
      readonly periodo: PeriodoDoOrcamento
      /** Fração do limite que o projetado atinge (≥ `alertThreshold`, < 1). */
      readonly fracao: number
      readonly limiteUsd: number
      readonly projetadoUsd: number
    }
  | {
      readonly decisao: 'bloqueado'
      readonly periodo: PeriodoDoOrcamento
      readonly limiteUsd: number
      readonly projetadoUsd: number
    }

/**
 * Decide sobre `(gasto real acumulado) + (estimativa desta chamada)` — critério 2.
 *
 * Ordem das perguntas: **bloqueio antes de alerta**, e **dia antes de mês** dentro de cada.
 *
 * - Bloqueio antes de alerta porque um projetado que estoura o teto também cruzou o limiar; se
 *   o alerta respondesse primeiro, a chamada que estoura sairia com um aviso.
 * - Dia antes de mês porque o diário é o teto mais apertado no uso normal (mesmo valor padrão,
 *   janela menor); quando os dois estouram, nomear o diário é a informação acionável — o
 *   usuário espera o dia virar, não o mês.
 *
 * **Estimativa, não medição** (critério 5): `estimativaUsd` é a cota superior da F02 (prompt
 * medido + teto de saída inteiro). O real pode divergir para baixo — e para cima, se a
 * contagem aproximada de tokens subestimar. Por isso o gate é melhor esforço: o custo real
 * só existe depois do stream, quando os tokens já foram gerados e cobrados.
 */
export function avaliarOrcamento(
  policy: BudgetPolicy,
  gasto: GastoAcumulado,
  estimativaUsd: number
): VereditoDoOrcamento {
  const periodos = [
    { periodo: 'dia' as const, projetado: gasto.diaUsd + estimativaUsd, limite: policy.dailyLimit },
    {
      periodo: 'mes' as const,
      projetado: gasto.mesUsd + estimativaUsd,
      limite: policy.monthlyLimit
    }
  ]

  for (const { periodo, projetado, limite } of periodos) {
    // `>` e não `>=`: gastar **exatamente** o limite é o limite sendo respeitado, não excedido.
    if (projetado > limite) {
      return { decisao: 'bloqueado', periodo, limiteUsd: limite, projetadoUsd: projetado }
    }
  }

  for (const { periodo, projetado, limite } of periodos) {
    // Limite zero não tem fração definida (divisão por zero) — e já foi tratado acima: com
    // teto zero, qualquer estimativa positiva bloqueia. Chegar aqui com limite 0 significa
    // estimativa 0 sobre acumulado 0, que é o caso permitido.
    if (limite <= 0) continue

    const fracao = projetado / limite
    if (fracao >= policy.alertThreshold) {
      return { decisao: 'alerta', periodo, fracao, limiteUsd: limite, projetadoUsd: projetado }
    }
  }

  return { decisao: 'permitido' }
}

/**
 * A mensagem que a tela mostra quando o gate barra — pt-BR, com os números da decisão.
 *
 * Mora no domínio e não no renderer porque o main também a usa: é o texto do evento `fim`
 * com `estado: 'falhou'` (o mesmo caminho da credencial ausente na F02). Duas redações do
 * mesmo bloqueio divergiriam, e a divergente seria a que o usuário lê.
 */
export function mensagemDeBloqueio(
  veredito: Extract<VereditoDoOrcamento, { decisao: 'bloqueado' }>
): string {
  const periodo = veredito.periodo === 'dia' ? 'diário' : 'mensal'
  return (
    `Orçamento ${periodo} de US$ ${veredito.limiteUsd.toFixed(2)} seria excedido ` +
    `(projetado US$ ${veredito.projetadoUsd.toFixed(2)}). ` +
    'Ajuste o limite em Configurações ou aguarde o próximo período.'
  )
}

/**
 * O que a tela de Settings mostra: os limites e o quanto já se gastou neles.
 *
 * Mora no shared, e não no serviço do main, porque **atravessa o IPC**. Um tipo do main na
 * assinatura da ponte arrastaria o `better-sqlite3` para o bundle do renderer — a mesma razão
 * pela qual `AuditVerification` duplica a forma do `ChainVerification` em vez de importá-lo.
 */
export interface BudgetSnapshot {
  readonly policy: BudgetPolicy
  readonly gasto: GastoAcumulado
}

/** Os limites que o usuário edita. Sem `currency`: uma moeda só nesta fatia. */
export interface BudgetLimitsInput {
  readonly dailyLimit: number
  readonly monthlyLimit: number
  readonly alertThreshold: number
}

/**
 * Guard do payload que atravessa o IPC (CONVENTION §2: validar na fronteira).
 *
 * Só checa a **forma** — que os três campos existem e são números finitos. A faixa válida
 * (limite ≥ 0, limiar em 0–1) é regra de negócio e vive no serviço: forma errada é chamador
 * quebrado, valor fora da faixa é usuário digitando, e os dois merecem tratamentos diferentes.
 */
export function isBudgetLimitsInput(value: unknown): value is BudgetLimitsInput {
  if (typeof value !== 'object' || value === null) return false

  const candidato = value as Record<string, unknown>
  return (
    typeof candidato.dailyLimit === 'number' &&
    Number.isFinite(candidato.dailyLimit) &&
    typeof candidato.monthlyLimit === 'number' &&
    Number.isFinite(candidato.monthlyLimit) &&
    typeof candidato.alertThreshold === 'number' &&
    Number.isFinite(candidato.alertThreshold)
  )
}
