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

/**
 * A assinatura que cada provider representa, ou `undefined` quando ele não é rota de assinatura.
 *
 * Existe para o boot responder *"a assinatura **desta** fase está no ar?"* sem espalhar a
 * pergunta: o modelo da fase dá o provider, e este mapa diz se ele é assinatura e qual. Um `if`
 * por provider no boot faria o próximo provider de assinatura nascer com a checagem esquecida.
 */
export const PROVIDER_DE_ASSINATURA: readonly AiProvider[] = ['claude-code', 'codex']

/** `true` quando o provider atende pela assinatura do PI, não por credencial paga. */
export function ehAssinatura(provider: AiProvider): boolean {
  return PROVIDER_DE_ASSINATURA.includes(provider)
}

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
  /**
   * A rota de assinatura está configurada e utilizável agora.
   *
   * **Qual** assinatura é decidido por quem monta este estado, e não aqui: desde a SPEC-Fases-06
   * existem duas (Claude Code e Codex), e o modelo da fase é que diz qual atende esta geração.
   * A função continua pura e com a mesma forma — ver `assinaturaDoProvider`.
   */
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
  /**
   * **Qual** assinatura esta geração precisa (SPEC-Fases-06 § Dentro).
   *
   * Existe para a mensagem de bloqueio nomear o fornecedor certo: mandar conectar o Claude quando
   * a fase escolheu Sol seria uma ação que não destrava nada. Não muda a **decisão** — a regra é
   * a mesma para as duas assinaturas —, só o texto que o PI lê.
   *
   * Opcional para não quebrar quem monta o estado sem saber a fase (o painel do Settings, que
   * pergunta pelo ambiente e não por um projeto); ausente, a mensagem fica genérica.
   */
  readonly assinaturaDe?: AiProvider
}

export interface ResultadoDaRota {
  readonly decisao: DecisaoDeRota
  readonly motivo?: MotivoDeBloqueio
  /** O que o PI faz para destravar. Presente sempre que a decisão é `bloqueado`. */
  readonly acao?: string
  /**
   * O provider que atende esta rota (SPEC-Fases-06). Ausente em `bloqueado` — rota bloqueada não
   * gera, então não tem provider.
   *
   * Vem no resultado, e não de um mapa consultado depois, porque **rota e provider deixaram de
   * ser o mesmo fato**: `assinatura` pode ser Claude Code ou Codex, e só quem montou o estado
   * sabe qual. Ler `PROVIDER_DA_ROTA['assinatura']` a esta altura devolveria sempre o Claude.
   */
  readonly provider?: AiProvider
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
 * Como o PI conecta **cada** assinatura (SPEC-Fases-06 § Dentro).
 *
 * A ação genérica manda conectar o Claude, e isso era verdade quando havia uma assinatura só.
 * Com duas, mandar conectar o Claude quando a fase escolheu Sol é uma ação que **não destrava
 * nada** — e um bloqueio com ação errada é pior que um bloqueio sem ação, porque manda o PI
 * fazer trabalho inútil.
 *
 * Dado e não `if`: acrescentar uma terceira assinatura passa a ser acrescentar uma linha.
 */
const COMO_CONECTAR: Partial<Record<AiProvider, string>> = {
  'claude-code': 'Conecte a assinatura do Claude (Claude Code CLI) em Providers',
  codex: 'Conecte a assinatura do Codex em Providers'
}

/**
 * A ação do bloqueio, nomeando o fornecedor quando ele é conhecido.
 *
 * **Não muda a decisão** — a regra de bloqueio é a mesma para as duas assinaturas, e é justamente
 * isso que impede uma de cair na outra. O que muda é o texto: "conecte o Codex" quando foi Sol
 * que faltou, "troque o modelo da fase" como alternativa que não gasta.
 */
export function acaoDoBloqueio(motivo: MotivoDeBloqueio, assinaturaDe?: AiProvider): string {
  const conectar = assinaturaDe === undefined ? undefined : COMO_CONECTAR[assinaturaDe]
  if (conectar === undefined) return ACAO_DO_BLOQUEIO[motivo]

  if (motivo === 'assinatura-esgotada-sem-opt-in') {
    return `A quota da assinatura acabou. Aguarde a renovação, troque o modelo da fase, ou habilite a rota paga para este projeto.`
  }

  return `${conectar}, troque o modelo da fase, ou habilite a rota paga para este projeto.`
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
    // **A assinatura que o estado declarou**, não `PROVIDER_DA_ROTA.assinatura`: desde a
    // SPEC-Fases-06 há duas, e quem sabe qual atende esta fase é quem montou o estado a partir do
    // modelo escolhido. Cravar o Claude aqui faria a geração por Sol sair pelo fornecedor errado.
    return { decisao: 'assinatura', provider: estado.assinaturaDe ?? PROVIDER_DA_ROTA.assinatura }
  }

  // A partir daqui a assinatura não serve. A rota paga só entra com autorização explícita —
  // ter credencial configurada não é autorização.
  //
  // **Isto não é fallback entre assinaturas.** A paga é outra moeda, autorizada por opt-in; o que
  // a decisão 4 do MVP-025 proíbe, e a SPEC-Fases-06 estende às duas assinaturas, é uma
  // assinatura cair na outra — e não há caminho aqui que faça isso, porque o estado carrega uma
  // assinatura só.
  if (estado.optInDeRotaPaga && estado.rotaPagaConfigurada) {
    return { decisao: 'paga', provider: PROVIDER_DA_ROTA.paga }
  }

  const motivo: MotivoDeBloqueio = !estado.assinaturaDisponivel
    ? estado.rotaPagaConfigurada
      ? 'assinatura-indisponivel-sem-opt-in'
      : 'sem-rota-alguma'
    : 'assinatura-esgotada-sem-opt-in'

  return { decisao: 'bloqueado', motivo, acao: acaoDoBloqueio(motivo, estado.assinaturaDe) }
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

/**
 * O provider que **esta** decisão de rota usa (SPEC-Fases-06 § Dentro).
 *
 * Existe porque `PROVIDER_DA_ROTA` crava `assinatura → 'claude-code'`, o que era verdade com uma
 * assinatura só. Com duas, o PI escolheria Sol no combo da fase e **a chamada sairia pelo
 * Claude** — sem erro nenhum aparecer, e com o ledger registrando o provider errado.
 *
 * Lê o `provider` que `escolherRota` já resolveu; o fallback cobre um `ResultadoDaRota` montado à
 * mão (dublê de teste), onde a ausência do campo não deve virar exceção.
 */
export function providerDaRota(rota: ResultadoDaRota): AiProvider | undefined {
  if (rota.decisao === 'bloqueado') return undefined
  return rota.provider ?? PROVIDER_DA_ROTA[rota.decisao]
}
