/**
 * O **ponto único de chamada** de IA (SPEC-Providers-02, critério 3).
 *
 * Toda chamada a provider funila por aqui. Não é organização de código: é a **sede do gate de
 * orçamento** que a F03 vai instalar (ADR-001, questão 1 — "bloqueio no ponto único de chamada
 * do adapter"). Um segundo caminho até um adapter seria um caminho que não passa pelo gate, e o
 * orçamento deixaria de ser garantia para virar convenção.
 *
 * O que este ponto faz, nesta ordem:
 *   1. **classifica** pela política (`api.external-call`, tier médio) — report, não barra;
 *   2. **estima** o custo pela tabela semeada;
 *   3. **gateia pelo orçamento** (SPEC-Providers-03): abaixo do limiar segue; cruzando o
 *      limiar segue com alerta; excedendo o limite, a chamada **não sai**;
 *   4. **audita** a requisição, dispara o adapter e repassa os chunks;
 *   5. ao fim, calcula o **custo real** pelo `usage`, **registra o `CostEvent`** (insumo do
 *      gate da próxima chamada) e audita a conclusão.
 *
 * O passo 3 é o que a F02 preparou e a F03 instalou: a estimativa é calculada antes de a
 * chamada sair justamente para que exista número a gatear quando ainda dá para não gastar.
 *
 * **Melhor esforço, declarado** (ARCHITECTURE § Resiliência): com BYOK o gate decide sobre
 * **estimativa**, porque o custo real só existe depois do stream. Estouro descoberto no meio
 * não mata a chamada corrente (decisão do PI, critério 4) — os tokens já foram gerados e
 * cobrados, e matá-la entregaria resposta quebrada pelo mesmo preço. O real é registrado, e a
 * **próxima** chamada é a que o gate barra.
 */

import { randomUUID } from 'node:crypto'
import {
  CREDENCIAL_DO_PROVIDER,
  MAX_TOKENS_PADRAO,
  MODELO_PADRAO,
  TIMEOUT_PADRAO_MS,
  calcularCustoUsd,
  estimarCustoUsd,
  type AiProvider,
  type AiRequest,
  type AiStreamEvent,
  type CostEvent
} from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { PolicyService } from '../policy/policy-service'
import type { CredentialService } from '../credentials/credential-service'
import { mensagemDeBloqueio } from '@shared/domain/budget'
import type { BudgetService } from '../budget/budget-service'
import { AdapterError } from './anthropic-adapter'
import type { AiAdapter } from './adapter'

/** Quem chama: usuário e espaço, para escopo de credencial, auditoria e (na F03) orçamento. */
export interface AiCallContext {
  readonly userId: string
  readonly workspace: WorkspaceId
}

export class AiCallService {
  constructor(
    /**
     * Os adapters por provider. Mapa, e não um adapter só: a F04 acrescenta entradas aqui e o
     * ponto de chamada não muda — que é o critério 1 valendo na prática.
     */
    private readonly adapters: Readonly<Record<AiProvider, AiAdapter>>,
    private readonly credentials: CredentialService,
    private readonly policy: PolicyService,
    private readonly audit: AuditRepository,
    /**
     * O gate de orçamento (SPEC-Providers-03). Entra no construtor, e não como consulta
     * opcional dentro do laço, porque é **obrigatório**: um `AiCallService` sem gate é o
     * caminho sem orçamento que o ponto único existe para não permitir.
     */
    private readonly budget: BudgetService
  ) {}

  /**
   * Chamadas em voo, para que `cancel` alcance a certa.
   *
   * Mora no serviço e não no handler porque é aqui que o `AbortController` existe — o handler
   * só conhece o `id`. Um mapa no transporte precisaria que o serviço lhe entregasse o
   * controle, o que é a mesma coisa por um caminho mais longo.
   */
  private readonly emVoo = new Map<string, AbortController>()

  /**
   * Aborta uma chamada em andamento. No-op quando ela já terminou — cancelar o que acabou é
   * corrida normal entre o clique do usuário e o fim do stream, não erro.
   */
  cancel(id: string): void {
    this.emVoo.get(id)?.abort()
    this.emVoo.delete(id)
  }

  /**
   * Executa a chamada, emitindo os eventos do stream conforme chegam.
   *
   * `AsyncIterable` de `AiStreamEvent` — o mesmo tipo que atravessa o IPC. O handler não
   * traduz nada: pega o evento e manda pelo canal, o que evita uma segunda forma do mesmo
   * dado divergindo da primeira.
   *
   * **Não lança** por falha do provider: o desfecho ruim é o evento `fim` com `estado:
   * 'falhou'` (critério 7). Uma exceção aqui obrigaria cada chamador a lembrar de traduzi-la
   * em estado de tela — e o que não é lembrado vira app quebrado no meio do stream.
   */
  async *call(request: AiRequest, ctx: AiCallContext): AsyncIterable<AiStreamEvent> {
    const id = randomUUID()
    const model = request.model ?? MODELO_PADRAO[request.provider]
    const maxTokens = request.maxTokens ?? MAX_TOKENS_PADRAO
    const estimadoUsd = estimarCustoUsd(request.provider, model, request.prompt, maxTokens)

    // (3) O **gate de orçamento** (SPEC-Providers-03, critério 2). Antes da auditoria de
    // requisição e antes de qualquer contato com o provider: barrar depois de o `AuditEvent`
    // dizer "requisitei" registraria uma requisição que nunca houve.
    const veredito = this.budget.check(
      { userId: ctx.userId, workspace: ctx.workspace },
      estimadoUsd
    )

    if (veredito.decisao === 'bloqueado') {
      // Desfecho previsto, não exceção — o mesmo caminho da credencial ausente. A tela precisa
      // **mostrar** que o orçamento barrou, com os números, e um throw aqui só chegaria à tela
      // se cada chamador lembrasse de traduzi-lo.
      //
      // `naoSaiu` mantém o `CostEvent` fora do registro: a chamada não saiu, então não custou.
      // Registrar zero aqui poluiria a soma do período com chamadas que o próprio gate
      // impediu — e o teste que pegou isto contava as linhas de `cost_event`, não o texto.
      yield this.finalizar(id, ctx, request.provider, model, {
        estado: 'falhou',
        erro: mensagemDeBloqueio(veredito),
        latenciaTotalMs: 0,
        estimadoUsd,
        naoSaiu: true
      })
      return
    }

    // (1) Classificação — `api.external-call` é tier **médio** na taxonomia semeada
    // (SPEC-Execucao-02). Report: a decisão é auditada pelo PolicyService e nada é barrado.
    this.policy.classify('api.external-call', {
      workspace: ctx.workspace,
      // O prompt **não** entra no detalhe. `sensitivity: internal` classifica a chamada, não o
      // conteúdo — e o conteúdo é justamente o que não pode ir para a auditoria.
      sensitivity: 'internal',
      detail: { provider: request.provider, model }
    })

    // (2)+(3) Auditoria **antes** — a requisição, sem prompt e sem credencial (critério 5).
    // Antes e não depois: a ordem é o que a auditoria conta (decidi, então fiz), e um evento
    // só no fim perderia toda chamada que morreu no meio.
    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspace,
      type: 'ai-call',
      payload: { fase: 'requisicao', id, provider: request.provider, model, estimadoUsd }
    })

    // Log de **entrada**, casado com a saída pelo `correlationId` (CONVENTION §3: fluxos de AI
    // logam os dois lados). Sem prompt: o texto do usuário é conteúdo sensível.
    log.ai.info('Chamada a provider de IA iniciada', {
      correlationId: id,
      direction: 'in',
      provider: request.provider,
      model,
      estimadoUsd
    })

    // Nem todo provider consome credencial (F04): o Ollama fala com o `localhost` e o
    // `claude-code` usa a sessão do próprio CLI. `undefined` no mapa é a declaração disso, e
    // não uma entrada esquecida — por isso a busca no Vault só acontece quando há chave a
    // buscar, e "sem credencial" deixa de ser sinônimo de "não configurado".
    const chave = CREDENCIAL_DO_PROVIDER[request.provider]
    const credencial =
      chave === undefined ? undefined : this.credentials.resolve(ctx.userId, ctx.workspace, chave)

    if (chave !== undefined && credencial === undefined) {
      // Credencial ausente é desfecho previsto, não exceção: o app roda sem provider
      // configurado (mesma degradação graciosa do login sem `.env`), e a tela precisa dizer o
      // que fazer a respeito.
      yield this.finalizar(id, ctx, request.provider, model, {
        estado: 'falhou',
        erro: 'Nenhuma credencial configurada para este provider. Adicione a chave em Configurações.',
        latenciaTotalMs: 0,
        estimadoUsd,
        naoSaiu: true
      })
      return
    }

    const adapter = this.adapters[request.provider]
    const inicio = Date.now()
    let latenciaPrimeiroChunkMs: number | undefined
    const controle = new AbortController()
    this.emVoo.set(id, controle)
    // O timeout arma **antes** do primeiro chunk e desarma no fim. O que ele protege não é a
    // resposta longa (streaming é lento por natureza) e sim o stream pendurado, que sem isto
    // seguraria a chamada — e o evento de conclusão — para sempre.
    const relogio = setTimeout(() => controle.abort(), TIMEOUT_PADRAO_MS)

    try {
      for await (const chunk of adapter.generateStream({
        model,
        prompt: request.prompt,
        ...(request.system === undefined ? {} : { system: request.system }),
        maxTokens,
        ...(credencial === undefined ? {} : { apiKey: credencial.value }),
        timeoutMs: TIMEOUT_PADRAO_MS,
        signal: controle.signal
      })) {
        if (chunk.tipo === 'texto') {
          latenciaPrimeiroChunkMs ??= Date.now() - inicio
          yield { tipo: 'chunk', id, texto: chunk.texto }
          continue
        }

        // (4) Custo **real** pelo `usage` que o provider reportou — medição, não estimativa.
        yield this.finalizar(id, ctx, request.provider, model, {
          estado: 'concluido',
          usage: chunk.usage,
          realUsd: calcularCustoUsd(request.provider, model, chunk.usage),
          latenciaTotalMs: Date.now() - inicio,
          ...(latenciaPrimeiroChunkMs === undefined ? {} : { latenciaPrimeiroChunkMs }),
          estimadoUsd
        })
        return
      }

      // O laço terminou sem `fim`: stream interrompido no meio (critério 7). É falha, não
      // sucesso vazio — tratar como conclusão registraria custo zero para uma chamada que o
      // provider pode ter cobrado.
      yield this.finalizar(id, ctx, request.provider, model, {
        estado: 'falhou',
        erro: 'O stream foi interrompido antes do fim.',
        latenciaTotalMs: Date.now() - inicio,
        ...(latenciaPrimeiroChunkMs === undefined ? {} : { latenciaPrimeiroChunkMs }),
        estimadoUsd
      })
    } catch (erro) {
      yield this.finalizar(id, ctx, request.provider, model, {
        estado: 'falhou',
        // A mensagem do `AdapterError` já é segura (o adapter a traduziu). Qualquer outra
        // exceção vira frase genérica: repassar `erro.message` cru é como o corpo de uma
        // resposta 401 — que pode ecoar o header enviado — chegaria à tela.
        erro:
          erro instanceof AdapterError ? erro.message : 'Falha inesperada ao chamar o provider.',
        latenciaTotalMs: Date.now() - inicio,
        ...(latenciaPrimeiroChunkMs === undefined ? {} : { latenciaPrimeiroChunkMs }),
        estimadoUsd
      })
    } finally {
      clearTimeout(relogio)
      this.emVoo.delete(id)
    }
  }

  /**
   * Fecha a chamada: monta o `CostEvent`, audita a conclusão e loga a saída.
   *
   * Um lugar só para os três desfechos (concluído, falhou, sem credencial) porque cada um
   * deles **tem** de auditar — e três call sites escrevendo o mesmo bloco é onde um deles
   * esquece. O `AuditEvent` na falha é exigência explícita do critério 7.
   */
  private finalizar(
    id: string,
    ctx: AiCallContext,
    provider: AiProvider,
    model: string,
    desfecho: {
      readonly estado: 'concluido' | 'falhou'
      readonly erro?: string
      readonly usage?: CostEvent['usage']
      readonly realUsd?: number
      readonly latenciaPrimeiroChunkMs?: number
      readonly latenciaTotalMs: number
      readonly estimadoUsd: number
      /**
       * `true` quando a chamada **não saiu** — barrada pelo gate ou sem credencial. Nesses
       * casos não há custo a registrar: gravar zero afirmaria que a chamada aconteceu e não
       * custou nada, quando ela simplesmente não aconteceu. Auditar, sim; somar, não.
       */
      readonly naoSaiu?: boolean
    }
  ): AiStreamEvent {
    const custo: CostEvent = {
      provider,
      model,
      workspace: ctx.workspace,
      estimadoUsd: desfecho.estimadoUsd,
      ...(desfecho.realUsd === undefined ? {} : { realUsd: desfecho.realUsd }),
      ...(desfecho.usage === undefined ? {} : { usage: desfecho.usage }),
      ...(desfecho.latenciaPrimeiroChunkMs === undefined
        ? {}
        : { latenciaPrimeiroChunkMs: desfecho.latenciaPrimeiroChunkMs }),
      latenciaTotalMs: desfecho.latenciaTotalMs
    }

    // (5) Registra o `CostEvent` — o insumo do gate da **próxima** chamada (critério 4).
    //
    // `realUsd` ausente grava NULL, não zero: a chamada que falhou antes do `usage` não tem
    // custo medido, e zero afirmaria que não custou.
    //
    // É aqui, e não no `check`, que o estouro no meio do stream se resolve: a chamada corrente
    // **terminou** (não a matamos), o real entra na soma, e a próxima é a barrada.
    if (desfecho.naoSaiu !== true) {
      this.budget.record(
        {
          callId: id,
          provider,
          model,
          estimadoUsd: desfecho.estimadoUsd,
          ...(desfecho.realUsd === undefined ? {} : { realUsd: desfecho.realUsd })
        },
        { userId: ctx.userId, workspace: ctx.workspace }
      )
    }

    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspace,
      type: 'ai-call',
      // Números e identificadores — nunca o prompt, nunca a resposta, nunca a chave. O que a
      // auditoria responde é "quanto custou, quanto demorou, deu certo?", e responder isso não
      // exige o conteúdo (ADR-004: "o log de auditoria não é lugar de credencial").
      payload: {
        fase: 'conclusao',
        id,
        provider,
        model,
        estado: desfecho.estado,
        estimadoUsd: desfecho.estimadoUsd,
        ...(desfecho.realUsd === undefined ? {} : { realUsd: desfecho.realUsd }),
        ...(desfecho.usage === undefined
          ? {}
          : {
              tokensEntrada: desfecho.usage.tokensEntrada,
              tokensSaida: desfecho.usage.tokensSaida
            }),
        latenciaTotalMs: desfecho.latenciaTotalMs
      }
    })

    const registrar = desfecho.estado === 'falhou' ? log.ai.warn : log.ai.info
    registrar(
      desfecho.estado === 'falhou'
        ? 'Chamada a provider de IA falhou'
        : 'Chamada a provider de IA concluída',
      {
        correlationId: id,
        direction: 'out',
        provider,
        model,
        estado: desfecho.estado,
        ...(desfecho.realUsd === undefined ? {} : { realUsd: desfecho.realUsd }),
        latenciaTotalMs: desfecho.latenciaTotalMs
      }
    )

    return {
      tipo: 'fim',
      id,
      estado: desfecho.estado,
      ...(desfecho.estado === 'concluido' ? { custo } : {}),
      ...(desfecho.erro === undefined ? {} : { erro: desfecho.erro })
    }
  }
}
