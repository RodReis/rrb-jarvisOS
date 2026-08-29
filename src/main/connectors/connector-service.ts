/**
 * O **ponto único de chamada** de conectores (SPEC-Conectores-01, § Fluxo).
 *
 * Toda chamada a serviço externo que não seja provider de IA funila por aqui. É o análogo do
 * `AiCallService` da M5-F02, e existe pela mesma razão estrutural: é a **sede** da governança
 * que a F02 vai instalar — health, retry, rate limit, ledger de créditos e circuit breaker. Um
 * segundo caminho até um adapter seria um caminho sem gate, e o orçamento de conector deixaria
 * de ser garantia para virar convenção.
 *
 * **Runtime separado do ponto único de IA** (decisão do PI de 2026-08-29). Os dois compartilham
 * o Vault, a auditoria encadeada e o ledger de uso; não compartilham o caminho de chamada, e
 * `callProvider` não aparece neste arquivo.
 *
 * O que este serviço faz, nesta ordem (a ordem **é** o critério 1):
 *   1. **resolve** o adapter no registro — em memória, sem I/O;
 *   2. **valida** o envelope contra a capacidade declarada (`validarConnectorRequest`);
 *   3. **valida** o `input` da operação pelo adapter, que é quem conhece a forma;
 *   4. **resolve a credencial** no Vault — só agora, e só quando a operação exige uma;
 *   5. **classifica** pela política (`api.external-call`, tier médio) e **audita** a requisição;
 *   6. **executa**, normaliza e audita a conclusão.
 *
 * Os passos 1–3 não tocam rede, disco nem cofre: é isso que faz "capacidade desconhecida falha
 * antes de qualquer I/O" ser um fato sobre o código e não uma promessa. O passo 4 vem **depois**
 * da validação de propósito — buscar credencial para um pedido que será recusado é tocar o cofre
 * à toa, e desfaz a garantia do critério 1.
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
import type { ConnectorAdapter, ConnectorExecution } from './adapter'

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

export class ConnectorService {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly secrets: ConnectorSecretSource,
    private readonly policy: PolicyService,
    private readonly audit: AuditRepository
  ) {}

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
  async call(request: ConnectorRequest, ctx: ConnectorCallContext): Promise<ConnectorOutcome> {
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

    // (4) **Só agora** o cofre. Depois de tudo que pode recusar sem ele.
    const credencial = this.resolverCredencial(request, ctx)
    if (credencial.erro !== undefined) return credencial.erro

    // (5) Classificação e auditoria da requisição. `api.external-call` (tier médio) é a ação
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

    // (6) Executa. O `try` traduz exceção inesperada num lugar só, para todo adapter: sem ele,
    // cada adapter que esquecesse de capturar derrubaria o handler IPC em vez de devolver um
    // desfecho que a tela sabe mostrar.
    const inicio = Date.now()
    const desfecho = await this.executar(adapter, {
      request,
      capability,
      ...(credencial.secret === undefined ? {} : { secret: credencial.secret })
    })

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

  private async executar(
    adapter: ConnectorAdapter,
    execution: ConnectorExecution
  ): Promise<ConnectorOutcome> {
    try {
      return await adapter.executar(execution)
    } catch (erro) {
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
    }
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
