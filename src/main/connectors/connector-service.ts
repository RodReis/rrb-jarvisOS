/**
 * O **ponto único de chamada** de conectores (SPEC-Conectores-01, § Fluxo).
 *
 * Toda chamada a serviço externo que não seja provider de IA funila por aqui. É o análogo do
 * `AiCallService` da M5-F02, e existe pela mesma razão estrutural: é a **sede** da governança —
 * gate de créditos, timeout, retry, circuit breaker e sanitização (SPEC-Conectores-02). Um
 * segundo caminho até um adapter seria um caminho sem gate, e o teto de créditos deixaria de ser
 * garantia para virar convenção.
 *
 * **Runtime separado do ponto único de IA** (decisão do PI de 2026-08-29). Os dois compartilham
 * o Vault, a auditoria encadeada e o ledger de uso; não compartilham o caminho de chamada, e
 * `callProvider` não aparece neste arquivo.
 *
 * O que este serviço faz, nesta ordem (a ordem **é** o critério 1 da F01):
 *   1. **resolve** o adapter no registro — em memória, sem I/O;
 *   2. **valida** o envelope contra a capacidade declarada (`validarConnectorRequest`);
 *   3. **valida** o `input` da operação pelo adapter, que é quem conhece a forma;
 *   4. **checa o circuito** — aberto, nem tenta (F02, § circuit breaker);
 *   5. **gateia pelos créditos** (F02, critério 8): a chamada que estouraria o teto não sai;
 *   6. **resolve a credencial** no Vault — só agora, e só quando a operação exige uma;
 *   7. **classifica** pela política (`api.external-call`, tier médio) e **audita** a requisição;
 *   8. **executa com timeout e retry**, normaliza, registra o consumo e audita a conclusão.
 *
 * Os passos 1–3 não tocam rede, disco nem cofre: é isso que faz "capacidade desconhecida falha
 * antes de qualquer I/O" ser um fato sobre o código e não uma promessa. O passo 6 vem **depois**
 * da validação e do gate de propósito — buscar credencial para um pedido que será recusado é
 * tocar o cofre à toa.
 *
 * O gate (5) vem **antes** da auditoria de requisição (7), pela mesma razão que o de orçamento
 * na M5-F03: barrar depois de o `AuditEvent` dizer "requisitei" registraria uma requisição que
 * nunca houve.
 */

import {
  ROTULO_DO_CONECTOR,
  validarConnectorRequest,
  type ConnectorCapability,
  type ConnectorError,
  type ConnectorErrorCode,
  type ConnectorOutcome,
  type ConnectorProvenance,
  type ConnectorRecoveryAction,
  type ConnectorRequest
} from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { PolicyService } from '../policy/policy-service'
import type { ConnectorRegistry } from './registry'
import {
  CIRCUITO_FECHADO,
  ESTADO_DO_ERRO,
  MAX_TENTATIVAS_PADRAO,
  circuitoAberto,
  contaContraOBreaker,
  decidirRetry,
  mensagemDeCreditoEsgotado,
  proximoCircuito,
  type ConnectorState,
  type EstadoDoCircuito
} from '@shared/domain/connector-governance'
import type { ConnectorAdapter, ConnectorExecution } from './adapter'
import type { CreditService } from './credit-service'

/** Quem chama: usuário e espaço — o mesmo par de `AiCallContext`, e o escopo do Vault. */
export interface ConnectorCallContext {
  readonly userId: string
  readonly workspace: WorkspaceId
}

/**
 * De onde o material secreto vem.
 *
 * Interface e não o `CredentialService` concreto, e a razão é a fronteira que o PI cravou: as
 * chaves de conector são **separadas** das chaves de IA, e a leitura real (payload estruturado
 * com access/refresh e `expires_at`, rotação atômica) é escopo da M6-F03 — a emenda ao Vault
 * mora lá, não aqui. Depender da interface deixa este serviço pronto para receber aquela
 * implementação sem que a F01 precise antecipá-la, e mantém o critério 1 testável sem cofre.
 */
export interface ConnectorSecretSource {
  /**
   * O segredo daquele escopo, ou `undefined` quando não há credencial guardada.
   *
   * Devolve o valor cru porque roda **dentro do main**, como o `resolve` do `CredentialService`
   * — e como lá, o valor não atravessa o IPC: nada em `ConnectorOutcome` tem campo onde ele
   * caiba.
   */
  resolve(
    userId: string,
    workspace: WorkspaceId,
    key: import('@shared/domain/connectors').ConnectorCredentialKey
  ): string | undefined
}

/** O desfecho, com o estado em que a chamada terminou (SPEC-Conectores-02, § Regras). */
export interface ConnectorCallResult {
  readonly outcome: ConnectorOutcome
  readonly estado: ConnectorState
  /** Quantas tentativas foram feitas, incluindo a primeira. `> 1` é o que torna `DEGRADED`. */
  readonly tentativas: number
}

export class ConnectorService {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly secrets: ConnectorSecretSource,
    private readonly policy: PolicyService,
    private readonly audit: AuditRepository,
    /**
     * O gate de créditos (SPEC-Conectores-02). Entra no construtor, e não como consulta
     * opcional dentro do fluxo, pela mesma razão do `BudgetService` no `AiCallService`: é
     * **obrigatório**. Um `ConnectorService` sem gate é o caminho sem teto que o ponto único
     * existe para não permitir.
     */
    private readonly credits: CreditService,
    /**
     * Espera entre tentativas. Injetável para o teste do backoff não gastar segundos de
     * relógio real — o que ele precisa afirmar é **quanto** se esperou, não que se esperou.
     */
    private readonly esperar: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly agora: () => number = () => Date.now(),
    private readonly maxTentativas: number = MAX_TENTATIVAS_PADRAO
  ) {}

  /**
   * O circuito de cada conector, em memória.
   *
   * Em memória e não no banco, de propósito: é observação sobre **esta sessão**. Persistir faria
   * o app abrir de manhã acreditando que o GitHub está fora do ar porque estava ontem à noite —
   * e a primeira chamada do dia seria barrada por um dado velho.
   */
  private readonly circuitos = new Map<string, EstadoDoCircuito>()

  /**
   * As capacidades que o renderer pode ver (critério 5).
   *
   * Metadado, não adapter: nome da operação, efeito e descrição. É o que a UI usa para saber o
   * que pedir, e o que faz "capacidades permitidas" ser uma lista concreta em vez de o
   * resultado de tentar.
   */
  capabilities(): readonly ConnectorCapability[] {
    return this.registry.capabilities()
  }

  /**
   * Executa uma chamada e devolve o desfecho normalizado.
   *
   * **Não lança** por falha do conector: o desfecho ruim é um `ConnectorError`, pelo mesmo
   * motivo do `estado: 'falhou'` do stream de IA — um erro que só existe como throw no main não
   * chega à tela, e cada chamador teria de lembrar de traduzi-lo.
   */
  async call(
    request: ConnectorRequest,
    ctx: ConnectorCallContext,
    /**
     * Cancelamento vindo de fora — o usuário fechando a tela (critério 1).
     *
     * Separado do timeout de propósito: os dois abortam a mesma chamada, mas **a causa muda o
     * desfecho** (`cancelado` versus `timeout`) e, com ela, se a falha conta contra o circuit
     * breaker. O usuário desistir não é o serviço falhar.
     */
    signal?: AbortSignal
  ): Promise<ConnectorOutcome> {
    // (1) Resolve o adapter — leitura de mapa em memória.
    const adapter = this.registry.resolve(request.connector)
    if (adapter === undefined) {
      return this.recusar(
        request,
        'connector-nao-registrado',
        `O conector ${ROTULO_DO_CONECTOR[request.connector] ?? request.connector} não está disponível neste aplicativo.`,
        'reportar'
      )
    }

    // (2) Valida o envelope contra a capacidade **declarada**. `capability` vem do registro,
    // não do serviço externo: perguntar lá exigiria uma chamada de rede para descobrir se a
    // chamada é permitida, e a recusa deixaria de ser gratuita.
    const capability = this.registry.capability(request.connector, request.operation)
    const invalido = validarConnectorRequest(request, capability)
    if (invalido !== undefined || capability === undefined) {
      // O `capability === undefined` já foi convertido em erro pela validação; o teste extra
      // existe para o compilador estreitar o tipo daqui para baixo.
      return invalido ?? this.recusar(request, 'capacidade-desconhecida', 'Operação desconhecida.')
    }

    // (3) O miolo do payload é do adapter — só ele conhece a forma de cada operação.
    const paraValidar: ConnectorExecution = { request, capability }
    const invalidoNoAdapter = adapter.validar(paraValidar)
    if (invalidoNoAdapter !== undefined) return invalidoNoAdapter

    // (4) O **circuito**. Aberto significa: não chame — o serviço vem falhando e insistir só
    // acrescenta carga a quem já está mal. O breaker **não converte falha em sucesso** (spec §
    // Regras): o retorno é um erro que a tela sabe mostrar, nunca um resultado vazio que ela
    // leria como "não há nada".
    const circuito = this.circuitos.get(request.connector) ?? CIRCUITO_FECHADO
    if (circuitoAberto(circuito, this.agora())) {
      return this.recusar(
        request,
        'indisponivel',
        `O conector ${ROTULO_DO_CONECTOR[request.connector]} está temporariamente indisponível após falhas seguidas. Tente de novo em instantes.`,
        'retentar',
        true
      )
    }

    // (5) O **gate de créditos** (critério 8). Antes da auditoria de requisição e antes de
    // qualquer contato com o serviço: barrar depois de o `AuditEvent` dizer "requisitei"
    // registraria uma requisição que nunca houve — a lição da M5-F03.
    //
    // `custoEstimado` ausente é zero, e zero sempre passa: o GitHub não cobra, e barrar uma
    // chamada gratuita porque uma paga estourou a cota seria cobrar por algo que não custa.
    const custoEstimado = adapter.custoEstimado?.({ request, capability }) ?? 0
    const veredito = this.credits.check(
      { userId: ctx.userId, workspace: ctx.workspace },
      request.connector,
      custoEstimado
    )

    if (veredito.decisao === 'bloqueado') {
      // `BLOCKED_EXTERNAL` e não `FAILED`: quem barrou fomos nós, não o serviço — e é por isso
      // que isto **não** conta contra o circuito (`contaContraOBreaker`). Contar transformaria
      // uma cota esgotada num apagão do conector inteiro.
      return this.recusar(
        request,
        'limite-excedido',
        mensagemDeCreditoEsgotado(request.connector, veredito),
        'reportar'
      )
    }

    // (6) **Só agora** o cofre. Depois de tudo que pode recusar sem ele.
    const credencial = this.resolverCredencial(request, ctx)
    if (credencial.erro !== undefined) return credencial.erro

    // (7) Classificação e auditoria da requisição. `api.external-call` (tier médio) é a ação
    // que a taxonomia semeada já tem para isto — chamada a conector **é** chamada a API
    // externa, e criar uma ação nova diria a mesma coisa com outro nome.
    this.policy.classify('api.external-call', {
      workspace: ctx.workspace,
      // O `input` **não** entra no detalhe: classificar a chamada não é publicar o conteúdo
      // dela — a mesma regra que mantém o prompt fora da auditoria de IA.
      sensitivity: 'internal',
      detail: { connector: request.connector, operation: request.operation }
    })

    // Antes e não depois: a ordem é o que a auditoria conta (decidi, então fiz), e um evento só
    // no fim perderia toda chamada que morreu no meio.
    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspace,
      type: 'connector-call',
      payload: {
        fase: 'requisicao',
        correlationId: request.correlationId,
        connector: request.connector,
        operation: request.operation,
        effect: capability.effect,
        idempotencyKey: request.idempotencyKey ?? null
      }
    })

    log.ai.info('Chamada a conector iniciada', {
      correlationId: request.correlationId,
      direction: 'in',
      connector: request.connector,
      operation: request.operation
    })

    // (8) Executa, com timeout e retry. O laço é o critério 2 e o 3 juntos: só repete o que
    // `decidirRetry` autoriza, e ela recusa antes de tudo a operação não repetível.
    const inicio = Date.now()
    const { desfecho, tentativas } = await this.executarComRetry(adapter, {
      request,
      capability,
      ...(credencial.secret === undefined ? {} : { secret: credencial.secret }),
      ...(signal === undefined ? {} : { signal })
    })

    // O consumo entra no ledger **depois** de a chamada terminar, e só quando ela saiu: é o elo
    // que fecha o critério 8, e a próxima chamada é a que o gate barra. Chamada que não saiu
    // não consumiu — registrar zero aqui poluiria a soma com o que o próprio gate impediu (o
    // defeito que a M5-F03 pegou contando linhas de `cost_event`).
    const consumo = desfecho.ok ? desfecho.usage.creditos : 0
    if (consumo > 0) {
      this.credits.record(
        {
          connector: request.connector,
          operation: request.operation,
          correlationId: request.correlationId,
          creditos: consumo
        },
        { userId: ctx.userId, workspace: ctx.workspace }
      )
    }

    // O circuito só se move por falha **do serviço**: credencial recusada, permissão e a nossa
    // própria cota dizem respeito a nós.
    const contra = !desfecho.ok && contaContraOBreaker(desfecho.code)
    this.circuitos.set(request.connector, proximoCircuito(circuito, contra, this.agora()))

    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspace,
      type: 'connector-call',
      payload: {
        fase: 'conclusao',
        correlationId: request.correlationId,
        connector: request.connector,
        operation: request.operation,
        ok: desfecho.ok,
        // O **estado** entra no rastro (spec § Regras): sem ele, "barrado pela cota" e "o
        // serviço caiu" seriam indistinguíveis na auditoria sem reinterpretar o código de erro
        // — que é exatamente a leitura duplicada que `ESTADO_DO_ERRO` existe para evitar.
        estado: desfecho.ok
          ? tentativas > 1
            ? 'DEGRADED'
            : 'READY'
          : ESTADO_DO_ERRO[desfecho.code],
        tentativas,
        ...(desfecho.ok
          ? { creditos: desfecho.usage.creditos, externalRefId: desfecho.externalRef?.id ?? null }
          : { code: desfecho.code }),
        latenciaMs: Date.now() - inicio
      }
    })

    log.ai.info('Chamada a conector concluída', {
      correlationId: request.correlationId,
      direction: 'out',
      connector: request.connector,
      operation: request.operation,
      ok: desfecho.ok
    })

    return desfecho
  }

  /**
   * Executa com timeout e retry (critérios 1, 2 e 3).
   *
   * O laço repete **apenas** o que `decidirRetry` autoriza, e a primeira coisa que ela checa é
   * a repetibilidade: leitura, ou mutação com chave de idempotência. Uma mutação sem chave não
   * é repetida nem diante de um 429 — repetir um `POST /issues` que talvez tenha sido aplicado
   * cria a segunda issue, e nenhum código de erro justifica isso.
   */
  private async executarComRetry(
    adapter: ConnectorAdapter,
    execution: ConnectorExecution
  ): Promise<{ readonly desfecho: ConnectorOutcome; readonly tentativas: number }> {
    // Repetível = leitura (segura por natureza) ou mutação **com** chave. A `validarConnectorRequest`
    // da F01 já recusou mutação sem chave na entrada; esta linha é o que garante que, se aquela
    // guarda mudar, o retry continue conservador em vez de herdar o buraco.
    const repetivel =
      execution.capability.effect === 'leitura' ||
      (execution.request.idempotencyKey ?? '').trim() !== ''

    let tentativa = 1
    for (;;) {
      const desfecho = await this.executar(adapter, execution)
      if (desfecho.ok) return { desfecho, tentativas: tentativa }

      const decisao = decidirRetry({
        code: desfecho.code,
        tentativa,
        maxTentativas: this.maxTentativas,
        repetivel,
        // A orientação do serviço vence a nossa curva quando existe. Quem a traduz do cabeçalho
        // é o adapter — o serviço só a obedece.
        ...(desfecho.retryAfterMs === undefined ? {} : { retryAfterMs: desfecho.retryAfterMs })
      })

      if (!decisao.repetir) return { desfecho, tentativas: tentativa }

      log.integracao.info('Chamada a conector será repetida', {
        correlationId: execution.request.correlationId,
        connector: execution.request.connector,
        operation: execution.request.operation,
        tentativa,
        esperarMs: decisao.esperarMs,
        code: desfecho.code
      })

      await this.esperar(decisao.esperarMs)
      tentativa += 1
    }
  }

  private async executar(
    adapter: ConnectorAdapter,
    execution: ConnectorExecution
  ): Promise<ConnectorOutcome> {
    // O timeout arma aqui e desarma no fim (critério 1: "timeout e cancelamento liberam
    // recursos"). O `AbortSignal` é o que faz o adapter **soltar** a conexão — sem ele, a
    // promessa perderia a corrida mas o socket continuaria aberto, e o recurso vazaria a cada
    // chamada lenta.
    const controle = new AbortController()
    const externo = execution.signal
    const relogio = setTimeout(() => controle.abort(), execution.request.timeoutMs)

    // Cancelamento do usuário e timeout entram pelo mesmo caminho: o adapter escuta um sinal
    // só. Dois sinais fariam cada adapter lembrar de checar os dois, e o esquecido vazaria.
    const aoCancelar = (): void => controle.abort()
    externo?.addEventListener('abort', aoCancelar, { once: true })

    try {
      const desfecho = await adapter.executar({ ...execution, signal: controle.signal })

      // Abortado **e** o adapter devolveu algo: o desfecho do adapter perde para o motivo do
      // aborto, senão um adapter que ignora o sinal faria o timeout não existir.
      if (controle.signal.aborted) return this.desfechoDeAborto(execution, externo)

      return desfecho
    } catch (erro) {
      if (controle.signal.aborted) return this.desfechoDeAborto(execution, externo)
      // A mensagem do erro **não** é repassada: exceção de SDK carrega URL com query, corpo
      // cru e às vezes header — é caminho clássico de vazamento de credencial. O detalhe fica
      // no log do main, que já passa pela redaction (SPEC-Fundacao-06); a tela recebe texto do
      // app. A sanitização completa da evidência é a F02 (critério 6 de lá).
      log.ai.error('Adapter de conector lançou exceção', {
        correlationId: execution.request.correlationId,
        connector: execution.request.connector,
        operation: execution.request.operation,
        erro: erro instanceof Error ? erro.message : String(erro)
      })

      return this.recusar(
        execution.request,
        'indisponivel',
        'O serviço externo falhou de forma inesperada.',
        'retentar',
        true
      )
    } finally {
      // Desarma sempre — inclusive no caminho de sucesso. Um timer vivo depois da chamada
      // manteria o processo acordado e dispararia um `abort` num controlador que ninguém mais
      // observa; é o "liberar recursos" do critério 1 valendo no caso comum, não só no ruim.
      clearTimeout(relogio)
      externo?.removeEventListener('abort', aoCancelar)
    }
  }

  /**
   * O desfecho de uma chamada abortada — e a distinção entre as duas causas importa.
   *
   * `cancelado` quando quem abortou foi o usuário; `timeout` quando foi o relógio. Sob um
   * código só, "o usuário desistiu" e "o serviço não respondeu" seriam a mesma linha na
   * auditoria — e só a segunda é sinal sobre o serviço. É por isso que `cancelado` não conta
   * contra o circuit breaker e `timeout` conta.
   */
  private desfechoDeAborto(
    execution: ConnectorExecution,
    externo: AbortSignal | undefined
  ): ConnectorError {
    return externo?.aborted === true
      ? this.recusar(execution.request, 'cancelado', 'A chamada foi cancelada.', 'reportar')
      : this.recusar(
          execution.request,
          'timeout',
          'O serviço externo não respondeu a tempo.',
          'retentar',
          true
        )
  }

  /**
   * Obtém o material secreto quando a operação declara uma credencial.
   *
   * Devolve `{ erro }` em vez de lançar, e `credencial-ausente` é desfecho previsto: o app roda
   * sem conector configurado, e a tela precisa dizer o que fazer a respeito — a mesma
   * degradação graciosa do provider de IA sem chave.
   */
  private resolverCredencial(
    request: ConnectorRequest,
    ctx: ConnectorCallContext
  ): { readonly secret?: string; readonly erro?: ConnectorError } {
    if (request.credential === undefined) return {}

    const secret = this.secrets.resolve(ctx.userId, ctx.workspace, request.credential.key)
    if (secret === undefined || secret === '') {
      return {
        erro: this.recusar(
          request,
          'credencial-ausente',
          `Nenhuma credencial configurada para ${ROTULO_DO_CONECTOR[request.connector]}. Conecte a conta em Configurações.`,
          'reautenticar'
        )
      }
    }

    return { secret }
  }

  private recusar(
    request: ConnectorRequest,
    code: ConnectorErrorCode,
    mensagem: string,
    acao: ConnectorRecoveryAction = 'corrigir-entrada',
    retryable = false
  ): ConnectorError {
    const provenance: ConnectorProvenance = {
      connector: request.connector,
      operation: request.operation,
      obtidoEm: new Date().toISOString()
    }

    return { ok: false, code, mensagem, retryable, acao, provenance }
  }
}
