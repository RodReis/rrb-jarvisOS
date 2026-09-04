/**
 * Qual rota gera, e quando a geração **não** acontece (SPEC-Jornada-02, critério 6).
 *
 * A pergunta que este arquivo responde: **o que acontece quando a assinatura não está
 * disponível?** A resposta certa é *nada acontece* — bloqueia, com ação concreta, sem chamada e
 * sem custo. A resposta errada, e a que o código tende a produzir sozinho, é cair na rota paga
 * "só desta vez".
 *
 * Isso é a decisão 4 do MVP-008 levada à consequência. O gate de orçamento em dólar só existe
 * para a rota paga; se a paga puder ser fallback silencioso, o gate deixa de ser gate — ele
 * passaria a ser atravessado justamente nos momentos em que ninguém decidiu atravessá-lo.
 *
 * Por isso a escolha é **função pura, com opt-in explícito por projeto**: um serviço que
 * decidisse a rota no meio da orquestração acabaria com um `catch` que tenta a outra, e o
 * fallback nasceria de um tratamento de erro em vez de uma decisão. Aqui, a rota paga sem
 * `optInDeRotaPaga` não é um caminho que falha — é um caminho que não existe.
 */

import type { AiProvider } from './ai'

/** O que a geração vai fazer. Fechado: a tela e o serviço decidem a partir dele. */
export const DECISOES_DE_ROTA = ['assinatura', 'paga', 'bloqueado'] as const

export type DecisaoDeRota = (typeof DECISOES_DE_ROTA)[number]

/** Por que bloqueou. Cada motivo tem uma ação concreta diferente — por isso não é um booleano. */
export const MOTIVOS_DE_BLOQUEIO = [
  'assinatura-indisponivel-sem-opt-in',
  'assinatura-esgotada-sem-opt-in',
  'sem-rota-alguma'
] as const

export type MotivoDeBloqueio = (typeof MOTIVOS_DE_BLOQUEIO)[number]

export interface EstadoDasRotas {
  /** A rota de assinatura está configurada e utilizável agora. */
  readonly assinaturaDisponivel: boolean
  /** A quota da assinatura acabou (SPEC-Entrega-04, critério 12). */
  readonly assinaturaEsgotada: boolean
  /** Há credencial para a rota paga — ter credencial **não** autoriza usá-la. */
  readonly rotaPagaConfigurada: boolean
  /**
   * O PI habilitou explicitamente a rota paga **para este projeto**.
   *
   * Por projeto, e não global: habilitar em um projeto não deve gastar dinheiro em outro. É a
   * mesma granularidade do orçamento por workspace, um nível abaixo.
   */
  readonly optInDeRotaPaga: boolean
}

export interface ResultadoDaRota {
  readonly decisao: DecisaoDeRota
  readonly motivo?: MotivoDeBloqueio
  /** O que o PI faz para destravar. Presente sempre que a decisão é `bloqueado`. */
  readonly acao?: string
}

/**
 * A ação concreta de cada bloqueio. **Dado, não lógica** — mesma postura do `MENSAGEM_DO_MARCO`.
 *
 * Um bloqueio sem ação concreta é um beco sem saída: diz que não dá, e não diz o que fazer. O
 * `BLOCKED_EXTERNAL` do MVP-006 e do MVP-009 estabeleceu essa régua, e ela vale aqui.
 */
export const ACAO_DO_BLOQUEIO: Readonly<Record<MotivoDeBloqueio, string>> = {
  'assinatura-indisponivel-sem-opt-in':
    'Conecte a assinatura do Claude (Claude Code CLI) em Providers, ou habilite a rota paga para este projeto.',
  'assinatura-esgotada-sem-opt-in':
    'A quota da assinatura acabou. Aguarde a renovação ou habilite a rota paga para este projeto.',
  'sem-rota-alguma':
    'Nenhuma rota de geração está configurada. Conecte a assinatura do Claude ou uma credencial de provider em Providers.'
}

/**
 * Escolhe a rota — ou bloqueia.
 *
 * **A assinatura vem primeiro sempre**, e não só quando é mais barata: a rota paga é exceção
 * autorizada, não alternativa equivalente. Inverter a ordem faria o opt-in virar uma preferência
 * em vez de uma permissão.
 *
 * **Sem opt-in, a rota paga não é considerada** — nem quando é a única configurada. É o critério
 * 6 literal: sem assinatura e sem opt-in, bloqueia sem chamada e sem custo. Um `else` que caísse
 * na paga aqui seria exatamente o fallback silencioso que a decisão 4 do MVP-008 proíbe.
 */
export function escolherRota(estado: EstadoDasRotas): ResultadoDaRota {
  const assinaturaUtilizavel = estado.assinaturaDisponivel && !estado.assinaturaEsgotada

  if (assinaturaUtilizavel) {
    return { decisao: 'assinatura' }
  }

  // A partir daqui a assinatura não serve. A rota paga só entra com autorização explícita —
  // ter credencial configurada não é autorização.
  if (estado.optInDeRotaPaga && estado.rotaPagaConfigurada) {
    return { decisao: 'paga' }
  }

  const motivo: MotivoDeBloqueio = !estado.assinaturaDisponivel
    ? estado.rotaPagaConfigurada
      ? 'assinatura-indisponivel-sem-opt-in'
      : 'sem-rota-alguma'
    : 'assinatura-esgotada-sem-opt-in'

  return { decisao: 'bloqueado', motivo, acao: ACAO_DO_BLOQUEIO[motivo] }
}

/**
 * A geração pode acontecer? Açúcar sobre `escolherRota`, para call sites que só querem a guarda.
 *
 * Existe para que a checagem seja **uma expressão**, e não um `if` reescrito em cada chamada —
 * um deles esqueceria o caso `bloqueado` e a chamada sairia mesmo assim.
 */
export function podeGerar(estado: EstadoDasRotas): boolean {
  return escolherRota(estado).decisao !== 'bloqueado'
}

/**
 * O provider concreto de cada rota. `claude-code` é a rota de assinatura do produto.
 *
 * Mora aqui, junto de `DecisaoDeRota`, porque **rota e provider são o mesmo fato dito duas
 * vezes**: quem decide a rota precisa do provider logo em seguida, e a tradução nasceu copiada
 * em cada serviço de geração. Uma sexta cópia entraria com o card da SPEC-Fases-01, e aí o card
 * poderia anunciar um provider diferente do que a geração usaria — exatamente o que o critério 4
 * daquela spec proíbe ("rota e modelo do card são os mesmos que o selo mostra").
 *
 * Sem entrada para `bloqueado` de propósito: rota bloqueada não gera, então não tem provider. Um
 * `Record<DecisaoDeRota, …>` obrigaria a inventar um valor para o caso em que nada acontece.
 */
export const PROVIDER_DA_ROTA: Readonly<Record<'assinatura' | 'paga', AiProvider>> = {
  assinatura: 'claude-code',
  paga: 'anthropic'
}
