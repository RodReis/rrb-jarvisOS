/**
 * Governança de conectores (SPEC-Conectores-02) — as decisões puras.
 *
 * A F01 entregou o contrato e o ponto único; esta fatia acrescenta o que acontece **em volta**
 * de uma chamada: se ela cabe no orçamento de créditos, se pode ser repetida, quanto esperar
 * antes de repetir, e quando parar de tentar. Tudo aqui é função pura sobre dado — o serviço
 * no main junta relógio, banco e auditoria em volta.
 *
 * A separação é a mesma de `budget.ts`, e pela mesma razão: afirmar que "429 retenta e 401 não"
 * não precisa de rede, e um teste que precisasse de rede para dizer isso estaria medindo a rede.
 *
 * O que **não** mora aqui: a política de produto (quantos créditos vale uma busca — isso é do
 * adapter, na F05) e o efeito (esperar, chamar, registrar — isso é do serviço).
 */

import type { ConnectorErrorCode, ConnectorId } from './connectors'
import type { WorkspaceId } from './entities'

/**
 * Em que estado uma chamada terminou (spec § Regras).
 *
 * **Estado do desfecho, não status de painel** — decisão do PI (2026-08-29). É assim que as
 * fatias seguintes já o usam: a SPEC-Conectores-03 pede `BLOCKED_EXTERNAL` "cuja ação concreta
 * é a URL de instalação" e a SPEC-Conectores-05 pede `BLOCKED_EXTERNAL` para quota — os dois
 * falam de **uma chamada específica**, não de um indicador na tela.
 *
 * - `READY` — funcionou.
 * - `DEGRADED` — funcionou, mas com sinal de degradação (retentou, ou o serviço avisou que
 *   está perto do limite). Distinguir de `READY` é o que permite ao breaker abrir **antes** da
 *   primeira falha dura.
 * - `BLOCKED_EXTERNAL` — barrado por algo que só o usuário resolve: credencial, permissão,
 *   quota, ou o **nosso** teto de créditos. Retentar não ajuda e o breaker não conta contra o
 *   serviço, porque o serviço não está mal — nós é que não podemos chamar.
 * - `FAILED` — falhou por algo que pode ser transitório e já esgotou as tentativas.
 */
export const CONNECTOR_STATES = ['READY', 'DEGRADED', 'BLOCKED_EXTERNAL', 'FAILED'] as const

export type ConnectorState = (typeof CONNECTOR_STATES)[number]

/**
 * Em que estado um código de erro coloca a chamada.
 *
 * Tabela e não `switch` espalhado: o mapeamento é **dado**, e tê-lo num lugar só é o que
 * garante que `credencial-recusada` signifique a mesma coisa para o breaker, para a auditoria e
 * para a tela. Um `switch` por call site é como as três leituras divergem.
 *
 * A divisão segue a mesma pergunta do `ConnectorErrorCode`: *quem resolve isto?*. Se é o
 * usuário (credencial, permissão, quota, nosso teto), é `BLOCKED_EXTERNAL`; se é o tempo, é
 * `FAILED`.
 */
export const ESTADO_DO_ERRO: Readonly<Record<ConnectorErrorCode, ConnectorState>> = {
  // Pedido malformado: nem chegou a ser uma chamada de verdade. `FAILED` e não
  // `BLOCKED_EXTERNAL` porque nada externo bloqueou — o defeito é nosso.
  'connector-nao-registrado': 'FAILED',
  'capacidade-desconhecida': 'FAILED',
  'contrato-incompativel': 'FAILED',
  'validacao-invalida': 'FAILED',
  // Autorização: só o usuário resolve, e retentar entra em loop (spec § Regras).
  'credencial-ausente': 'BLOCKED_EXTERNAL',
  'credencial-recusada': 'BLOCKED_EXTERNAL',
  'permissao-negada': 'BLOCKED_EXTERNAL',
  // Quota/teto: idem — esperar não devolve crédito.
  'limite-excedido': 'BLOCKED_EXTERNAL',
  // Transitórios: o tempo pode resolver.
  indisponivel: 'FAILED',
  timeout: 'FAILED',
  'resposta-invalida': 'FAILED',
  // Cancelamento é desfecho pedido pelo usuário, não falha do serviço — por isso não conta
  // contra o breaker (ver `contaContraOBreaker`).
  cancelado: 'FAILED'
}

/**
 * Os códigos que **nunca** são retentados automaticamente (critério 2 e spec § Regras:
 * "401/403, quota esgotada e permissão do usuário não entram em loop").
 *
 * Lista explícita de quem **não** pode, e não de quem pode: um código novo acrescentado ao
 * `ConnectorErrorCode` amanhã cai no caso conservador (não retenta) em vez de virar retry por
 * omissão. Errar para o lado de não repetir é o lado barato — a chamada perdida o usuário
 * refaz; a repetida contra um 401 vira bloqueio de conta.
 */
export const CODIGOS_SEM_RETRY: readonly ConnectorErrorCode[] = [
  'credencial-ausente',
  'credencial-recusada',
  'permissao-negada',
  'limite-excedido',
  'connector-nao-registrado',
  'capacidade-desconhecida',
  'contrato-incompativel',
  'validacao-invalida',
  'resposta-invalida',
  'cancelado'
]

/** Quantas tentativas **além** da primeira. Padrão conservador; o serviço pode receber outro. */
export const MAX_TENTATIVAS_PADRAO = 2

/** Espera base do backoff exponencial, em ms. */
export const BACKOFF_BASE_MS = 500

/** Teto da espera, para um `Retry-After` absurdo não pendurar a chamada por minutos. */
export const BACKOFF_MAXIMO_MS = 30_000

/**
 * O que se sabe sobre a falha na hora de decidir se repete.
 *
 * `retryAfterMs` é a **orientação do serviço** (cabeçalho `Retry-After` ou equivalente), que a
 * spec manda respeitar: o serviço sabe quando estará livre melhor que a nossa curva. Ausente,
 * cai no backoff exponencial.
 */
export interface TentativaDeChamada {
  readonly code: ConnectorErrorCode
  /** Quantas tentativas já foram feitas, incluindo a primeira. Começa em 1. */
  readonly tentativa: number
  readonly maxTentativas: number
  /** Se a operação é seguro repetir — leitura, ou mutação com chave de idempotência. */
  readonly repetivel: boolean
  /** Orientação do serviço, em ms. */
  readonly retryAfterMs?: number
}

/** A decisão sobre repetir: com a espera junto, para o chamador não recalculá-la. */
export type DecisaoDeRetry =
  | { readonly repetir: false; readonly motivo: 'nao-repetivel' | 'codigo-terminal' | 'esgotou' }
  | { readonly repetir: true; readonly esperarMs: number }

/**
 * Decide se a chamada é repetida, e quanto esperar (critérios 2 e 3).
 *
 * A ordem das três recusas é a política inteira, e não é intercambiável:
 *
 * 1. **Não repetível vence tudo.** Uma mutação sem chave de idempotência não pode ser repetida
 *    *nem quando* o erro é um 429 clássico — repetir um `POST /issues` que talvez tenha sido
 *    aplicado cria a segunda issue. É o critério 3, e ele é mais forte que o 2 de propósito.
 * 2. **Código terminal.** 401/403/quota não entram em loop: o resultado seria idêntico e a
 *    repetição só aproxima o bloqueio da conta.
 * 3. **Orçamento de tentativas.** O último a falar, porque só faz sentido perguntar "já tentei
 *    demais?" sobre algo que valeria a pena tentar.
 */
export function decidirRetry(t: TentativaDeChamada): DecisaoDeRetry {
  if (!t.repetivel) return { repetir: false, motivo: 'nao-repetivel' }
  if (CODIGOS_SEM_RETRY.includes(t.code)) return { repetir: false, motivo: 'codigo-terminal' }
  if (t.tentativa >= t.maxTentativas) return { repetir: false, motivo: 'esgotou' }

  return { repetir: true, esperarMs: calcularEspera(t) }
}

/**
 * Quanto esperar antes da próxima tentativa.
 *
 * A orientação do serviço **vence** a nossa curva quando existe (spec § Regras: "backoff
 * respeita orientação do serviço") — um `Retry-After: 30` é o serviço dizendo em quanto tempo
 * vai atender, e ignorá-lo para tentar em 1s é gastar a tentativa à toa e somar carga a quem já
 * pediu trégua.
 *
 * O teto existe porque a orientação vem de fora: um `Retry-After` de uma hora (ou um valor
 * absurdo por bug do serviço) penduraria a chamada. Truncar é honesto — a tentativa falha mais
 * cedo e o usuário decide, em vez de o app parecer travado.
 */
export function calcularEspera(t: Pick<TentativaDeChamada, 'tentativa' | 'retryAfterMs'>): number {
  if (t.retryAfterMs !== undefined && t.retryAfterMs > 0) {
    return Math.min(t.retryAfterMs, BACKOFF_MAXIMO_MS)
  }

  // Exponencial simples: 500ms, 1s, 2s… Sem jitter, e a ausência é deliberada — jitter serve
  // para dessincronizar **muitos clientes**, e aqui há um app desktop com WIP baixo. Jitter
  // tornaria o teste do backoff não-determinístico em troca de nada.
  return Math.min(BACKOFF_BASE_MS * 2 ** (t.tentativa - 1), BACKOFF_MAXIMO_MS)
}

/**
 * Uma falha conta contra o circuit breaker?
 *
 * Só o que indica que **o serviço** está mal. Credencial recusada, permissão negada e o nosso
 * próprio teto de créditos dizem respeito a nós, não a ele — contá-los abriria o breaker e
 * barraria chamadas que funcionariam, transformando um problema de configuração num apagão.
 *
 * Cancelamento também não conta: o usuário desistir não é o serviço falhar.
 */
export function contaContraOBreaker(code: ConnectorErrorCode): boolean {
  return ESTADO_DO_ERRO[code] === 'FAILED' && code !== 'cancelado' && !ehErroDePedido(code)
}

/** Erros de pedido malformado: defeito nosso, e o serviço nem foi consultado. */
function ehErroDePedido(code: ConnectorErrorCode): boolean {
  return (
    code === 'connector-nao-registrado' ||
    code === 'capacidade-desconhecida' ||
    code === 'contrato-incompativel' ||
    code === 'validacao-invalida'
  )
}

/** Falhas consecutivas que abrem o circuito. */
export const FALHAS_PARA_ABRIR = 3

/** Quanto o circuito fica aberto antes de deixar passar uma chamada de prova. */
export const CIRCUITO_ABERTO_MS = 30_000

/**
 * O estado do circuito de um conector, como o serviço o guarda.
 *
 * Em memória e não no banco, de propósito: é observação sobre **esta sessão** do app. Persistir
 * faria o app abrir de manhã acreditando que o GitHub está fora do ar porque estava ontem à
 * noite — e a primeira chamada do dia seria barrada por um dado velho.
 */
export interface EstadoDoCircuito {
  readonly falhasConsecutivas: number
  /** Instante (epoch ms) até quando o circuito fica aberto. `0` = fechado. */
  readonly abertoAte: number
}

export const CIRCUITO_FECHADO: EstadoDoCircuito = { falhasConsecutivas: 0, abertoAte: 0 }

/**
 * O circuito está aberto **agora**?
 *
 * Aberto significa: não chame, devolva o desfecho barrado direto. É o "impede tempestade de
 * chamadas" da spec — e a mesma linha diz que o breaker **não converte falha em sucesso**, por
 * isso o retorno é usado para produzir um erro, nunca um resultado vazio que a tela leria como
 * "não há nada".
 */
export function circuitoAberto(estado: EstadoDoCircuito, agoraMs: number): boolean {
  return estado.abertoAte > agoraMs
}

/** O estado do circuito depois de uma chamada. Puro: recebe o anterior, devolve o novo. */
export function proximoCircuito(
  estado: EstadoDoCircuito,
  falhou: boolean,
  agoraMs: number
): EstadoDoCircuito {
  // Sucesso fecha o circuito por completo, e não decrementa: a chamada de prova que passa é a
  // evidência de que o serviço voltou. Decrementar manteria o app cauteloso contra um serviço
  // que já está de pé.
  if (!falhou) return CIRCUITO_FECHADO

  const falhas = estado.falhasConsecutivas + 1
  if (falhas >= FALHAS_PARA_ABRIR) {
    return { falhasConsecutivas: falhas, abertoAte: agoraMs + CIRCUITO_ABERTO_MS }
  }

  return { falhasConsecutivas: falhas, abertoAte: 0 }
}

/**
 * O teto de créditos de um conector, num escopo.
 *
 * **Créditos, não USD** — decisão do PI (2026-08-29): a Tavily cobra em créditos e o GitHub não
 * cobra. Converter para dólar dependeria do plano contratado e produziria número falso, além de
 * esconder qual orçamento estourou. Este ledger e a `BudgetPolicy` do MVP-005 coexistem, cada um
 * com seu gate, e estouram separado (critério 8).
 *
 * Escopo `user_id` + `workspace_id` (spec § decisões cravadas), espelhando o `CredentialRef`.
 * `project_id` entra no MVP-008, onde projeto nasce.
 */
export interface ConnectorCreditPolicy {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly connector: ConnectorId
  /** Teto do **dia corrente**, em créditos do próprio conector. */
  readonly dailyLimit: number
  /** Teto do **mês corrente**. Contado separado do diário, como na `BudgetPolicy`. */
  readonly monthlyLimit: number
}

/** Teto diário padrão, em créditos. Conservador, no espírito do USD 1/dia da `BudgetPolicy`. */
export const CREDITOS_DIA_PADRAO = 100

/** Teto mensal padrão, em créditos. */
export const CREDITOS_MES_PADRAO = 1_000

export function tetoDeCreditosPadrao(
  userId: string,
  workspace: WorkspaceId,
  connector: ConnectorId
): ConnectorCreditPolicy {
  return {
    user_id: userId,
    workspace_id: workspace,
    connector,
    dailyLimit: CREDITOS_DIA_PADRAO,
    monthlyLimit: CREDITOS_MES_PADRAO
  }
}

/** Créditos já consumidos no escopo, por período. */
export interface CreditosConsumidos {
  readonly dia: number
  readonly mes: number
}

/** Qual teto a decisão olhou — distingue-os na auditoria sem parsear número. */
export type PeriodoDeCredito = 'dia' | 'mes'

/**
 * O veredito do gate de créditos.
 *
 * **Dois caminhos e não três**, ao contrário do `VereditoDoOrcamento`: não há `alerta`. O
 * orçamento em USD alerta porque o usuário decide se aceita gastar mais; crédito de conector é
 * cota comprada — ou cabe, ou não cabe. Um alerta aqui pediria uma decisão que o usuário não
 * tem como tomar no momento da chamada.
 */
export type VereditoDeCredito =
  | { readonly decisao: 'permitido' }
  | {
      readonly decisao: 'bloqueado'
      readonly periodo: PeriodoDeCredito
      readonly limite: number
      readonly projetado: number
    }

/**
 * Decide se a chamada cabe no teto de créditos (critério 8).
 *
 * Mesma forma de `avaliarOrcamento`, e a semelhança é proposital: dia antes de mês, `>` e não
 * `>=` (gastar exatamente o teto é respeitá-lo, não excedê-lo). Duas regras iguais escritas de
 * formas diferentes é como uma delas ganha um bug que a outra não tem.
 *
 * `custoEstimado` é o que o adapter declara que a operação consome — zero para o GitHub, que
 * não cobra. Custo zero **sempre** passa, inclusive com o teto estourado: barrar uma chamada
 * gratuita porque uma chamada paga estourou a cota seria cobrar por algo que não custa.
 */
export function avaliarCreditos(
  policy: ConnectorCreditPolicy,
  consumido: CreditosConsumidos,
  custoEstimado: number
): VereditoDeCredito {
  if (custoEstimado <= 0) return { decisao: 'permitido' }

  const periodos = [
    {
      periodo: 'dia' as const,
      projetado: consumido.dia + custoEstimado,
      limite: policy.dailyLimit
    },
    {
      periodo: 'mes' as const,
      projetado: consumido.mes + custoEstimado,
      limite: policy.monthlyLimit
    }
  ]

  for (const { periodo, projetado, limite } of periodos) {
    if (projetado > limite) return { decisao: 'bloqueado', periodo, limite, projetado }
  }

  return { decisao: 'permitido' }
}

/** Mensagem em pt-BR do bloqueio por créditos — texto num lugar só, como `mensagemDeBloqueio`. */
export function mensagemDeCreditoEsgotado(
  connector: ConnectorId,
  veredito: Extract<VereditoDeCredito, { decisao: 'bloqueado' }>
): string {
  const janela = veredito.periodo === 'dia' ? 'diário' : 'mensal'
  return (
    `O limite ${janela} de créditos do conector ${connector} foi atingido ` +
    `(${veredito.projetado} de ${veredito.limite}). Ajuste o teto em Configurações ou aguarde a virada do período.`
  )
}
