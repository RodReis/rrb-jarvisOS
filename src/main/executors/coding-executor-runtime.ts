/**
 * O runtime dos executores de código (SPEC-Multi-Executor-01).
 *
 * A pergunta que este serviço responde: **dado um pedido já decidido pelo kernel e um
 * adapter que sabe falar com um CLI, o que aconteceu, o que mudou e quanto custou?**
 *
 * Irmão de `AIProviderRuntime` e `ConnectorRuntime` (ARCHITECTURE § Pipeline V2), e a
 * **única** porta de entrada para executar código por CLI. Não é organização: é onde a
 * recusa do critério 4 mora, e um segundo caminho até um adapter seria um caminho sem essa
 * recusa — o modo de cobrança deixaria de ser garantia para virar convenção.
 *
 * O que ele faz, nesta ordem:
 *   1. **recusa** request incompatível, antes de tocar o adapter (critério 4);
 *   2. **abre** a tentativa — só o kernel abre (regra 1);
 *   3. **consome** os eventos do adapter alimentando a máquina de estados, que decide o que
 *      é transição e o que é diagnóstico (critério 2, regras 1 e 4);
 *   4. **redige** tudo que sai para evidência (regra 5);
 *   5. **encerra** por timeout ou cancelamento idempotente, matando a árvore do processo
 *      (critério 3);
 *   6. devolve `ExecutorResult` — **nunca lança** por falha do executor (critério 6).
 *
 * **O que este runtime não faz:** não escolhe entre executores (F04), não abre PR nem
 * mergeia, não resolve credencial (recebe referência opaca, critério 5), não decide escopo
 * e não autoriza escrita — `path_changed` é observação, e quem verifica o que foi tocado é
 * o kernel, depois (regra 3). O `ConstrutorService` da V1 segue paralelo: a migração do
 * call site é de outra fatia.
 */

import { redigirSegredos } from '@shared/domain/segredos'
import { redact } from '@shared/contracts/logging-redaction'
import { log } from '../logging/logger'
import type {
  CodingExecutorAdapter,
  ExecutorEvent,
  ExecutorRequest,
  ExecutorResult
} from './executor'
import { aplicarEvento, estadoInicial, isTerminal, type EstadoDaTentativa } from './attempt-state'
import { validarRequest, type Recusa } from './validar-request'

/**
 * Quem encerra a árvore de processos de uma tentativa (critério 3).
 *
 * Injetado, e não `process.kill` direto, por duas razões. A primeira é honestidade de
 * fronteira: o runtime não conhece container, PID nem worktree — quem sabe matar o processo
 * do Codex num container é a camada que o subiu. A segunda é o teste: o critério 3 pede que
 * cancelar duas vezes produza **um** efeito, e contar efeitos exige poder observá-los.
 *
 * Ausente = o runtime só aborta o `signal` e para de consumir. É o caso do executor que roda
 * em processo, sem árvore a matar.
 */
export type MatadorDeProcesso = (request: ExecutorRequest) => void

/** O que o runtime guarda de uma tentativa em voo. */
interface TentativaEmVoo {
  readonly controle: AbortController
  readonly request: ExecutorRequest
  /**
   * `true` depois do primeiro cancelamento.
   *
   * É o que faz o cancelamento ser **idempotente** (critério 3): o segundo clique no botão
   * "Cancelar" encontra a flag levantada e não mata nada de novo. Sem ela, `matarProcesso`
   * rodaria uma vez por clique — e no container isso é um `docker exec kill` por clique.
   */
  cancelada: boolean
}

export class CodingExecutorRuntime {
  /**
   * As tentativas em voo, para que `cancelar` alcance a certa.
   *
   * Mora no runtime e não no handler de IPC porque é aqui que o `AbortController` existe —
   * o handler só conhece o `attemptId`. Um mapa no transporte precisaria que o runtime lhe
   * entregasse o controle, o que é a mesma coisa por um caminho mais longo e com uma
   * referência a mais viva.
   */
  private readonly emVoo = new Map<string, TentativaEmVoo>()

  constructor(
    private readonly matarProcesso?: MatadorDeProcesso,
    /** Injetável só para o teste não depender do relógio real. */
    private readonly agora: () => number = () => Date.now()
  ) {}

  /**
   * O executor está instalado e responde? (health por executor, spec § Dentro.)
   *
   * Nunca lança: executor ausente é a resposta `false`, que é informação, não erro — a tela
   * de executores precisa poder dizer "não instalado" sem tratar exceção.
   */
  async saudeDoExecutor(adapter: CodingExecutorAdapter): Promise<boolean> {
    try {
      return await adapter.disponivel()
    } catch {
      return false
    }
  }

  /**
   * Cancela uma tentativa em andamento. **Idempotente** (critério 3).
   *
   * No-op quando a tentativa já terminou ou já foi cancelada: cancelar o que acabou é
   * corrida normal entre o clique do usuário e o fim do stream, não erro. Devolve `true`
   * só no cancelamento que **teve efeito**, e é isso que o teste do critério 3 conta.
   */
  cancelar(attemptId: string): boolean {
    const voo = this.emVoo.get(attemptId)
    if (voo === undefined || voo.cancelada) return false

    voo.cancelada = true
    voo.controle.abort()
    // A árvore do processo sai aqui, uma vez só. Abortar o `signal` e esperar o executor
    // terminar sozinho deixaria um filho órfão consumindo a assinatura — e um executor que
    // ignora o pedido educado é exatamente o que este caminho existe para resolver.
    this.matarProcesso?.(voo.request)
    return true
  }

  /**
   * Executa a tentativa e devolve o resultado.
   *
   * **Não lança** por falha do executor: o desfecho ruim é `ExecutorResult` com status
   * `falhou`, `cancelado` ou `recusado` (critério 6). Uma exceção aqui obrigaria cada
   * chamador a lembrar de traduzi-la em estado — e o que não é lembrado vira run travado.
   */
  async executar(
    request: ExecutorRequest,
    adapter: CodingExecutorAdapter
  ): Promise<ExecutorResult> {
    // (1) A recusa vem **antes** de qualquer contato com o adapter (critério 4). Depois do
    // spawn a informação é a mesma e o custo já foi pago.
    const recusa = validarRequest(request, adapter)
    if (recusa !== undefined) return this.recusar(request, recusa)

    // (2) Só o kernel abre a tentativa (regra 1). O estado nasce aqui, não de um evento.
    let estado = estadoInicial(request.attemptId)

    const controle = new AbortController()
    const voo: TentativaEmVoo = { controle, request, cancelada: false }
    this.emVoo.set(request.attemptId, voo)

    // O `signal` do chamador (o kernel cancelando de fora) entra pelo mesmo caminho do
    // botão: um só lugar mata a árvore, e ele é idempotente.
    const abortarDeFora = (): void => {
      this.cancelar(request.attemptId)
    }
    request.signal?.addEventListener('abort', abortarDeFora, { once: true })

    // O relógio arma antes do primeiro evento. O que ele protege não é a execução longa —
    // construir código é lento por natureza — e sim o executor **pendurado**, que sem isto
    // seguraria a tentativa, e o run, para sempre.
    const relogio = setTimeout(() => {
      this.cancelar(request.attemptId)
    }, request.limiteDeTempoMs)

    const inicio = this.agora()
    const evidencias: string[] = []
    let excecao: string | undefined

    try {
      for await (const evento of adapter.executar({ ...request, signal: controle.signal })) {
        // (3) A máquina decide: transição ou diagnóstico. O runtime não interpreta evento —
        // duplicado, fora de ordem, atrasado e desconhecido são problema dela, num lugar só.
        estado = aplicarEvento(estado, evento)

        // (4) A evidência sai redigida (regra 5). `redigirSegredos` age sobre **texto** —
        // um token no meio de um argumento de ferramenta —, e é complementar ao `redact` do
        // log, que age sobre nome de campo. Os dois, porque nenhum dos dois alcança o caso
        // do outro.
        const linha = evidenciaDoEvento(evento)
        if (linha !== undefined) evidencias.push(redigirSegredos(linha))

        // Terminal encerra o consumo. Seguir lendo depois do `done` alimentaria a máquina
        // com eventos que ela já rejeita — trabalho para chegar ao mesmo lugar, com o
        // processo vivo mais tempo do que precisa.
        if (isTerminal(estado.fase)) break
      }
    } catch (erro) {
      // Falha do processo (ENOENT, crash, stream partido). A mensagem do adapter é dado
      // dele, então passa pela redaction antes de virar evidência.
      excecao = redigirSegredos(erro instanceof Error ? erro.message : 'Falha no executor.')
    } finally {
      clearTimeout(relogio)
      request.signal?.removeEventListener('abort', abortarDeFora)
      this.emVoo.delete(request.attemptId)
    }

    const duracaoMs = this.agora() - inicio
    const resultado = this.montarResultado(estado, {
      evidencias,
      duracaoMs,
      cancelada: voo.cancelada,
      ...(excecao === undefined ? {} : { excecao })
    })

    this.registrar(request, resultado, duracaoMs)
    return resultado
  }

  /** O desfecho da recusa: status próprio, uso vazio, adapter intocado (critério 4). */
  private recusar(request: ExecutorRequest, recusa: Recusa): ExecutorResult {
    const resultado: ExecutorResult = {
      status: 'recusado',
      attemptId: request.attemptId,
      resumo: recusa.mensagem,
      pathsAlterados: [],
      validacoes: [],
      evidencias: [recusa.mensagem],
      // A assinatura da recusa é o **motivo**, não a mensagem: é o que agrupa "recusado pelo
      // mesmo problema" na auditoria, e a mensagem carrega nomes que variam por executor.
      assinaturaDeFalha: `recusa:${recusa.motivo}`,
      diagnosticos: []
    }

    this.registrar(request, resultado, 0)
    return resultado
  }

  /**
   * Traduz o estado final em `ExecutorResult`.
   *
   * `cancelada` vence o que a máquina viu, e a razão é o critério 3: um executor que ignora
   * o sinal pode nunca emitir `canceled`, e reportar `falhou` diria que o executor quebrou
   * quando fomos nós que o matamos. A exceção só vira `falhou` quando ninguém cancelou.
   */
  private montarResultado(
    estado: EstadoDaTentativa,
    contexto: {
      readonly evidencias: readonly string[]
      readonly duracaoMs: number
      readonly cancelada: boolean
      readonly excecao?: string
    }
  ): ExecutorResult {
    const status = contexto.cancelada
      ? 'cancelado'
      : estado.fase === 'concluida'
        ? 'concluido'
        : 'falhou'

    // O erro da exceção do processo entra na evidência, não se perde: sem ele, uma falha de
    // spawn chegaria ao relatório como "falhou" sem nada a investigar.
    const evidencias =
      contexto.excecao === undefined
        ? contexto.evidencias
        : [...contexto.evidencias, contexto.excecao]

    const assinatura =
      estado.assinaturaDeFalha ??
      (status === 'falhou' && contexto.excecao !== undefined ? 'processo:excecao' : undefined)

    return {
      status,
      attemptId: estado.attemptId,
      ...(estado.resumo === undefined ? {} : { resumo: estado.resumo }),
      pathsAlterados: estado.pathsAlterados,
      // Validações ficam vazias nesta fatia: quem as roda é o kernel, e o request as declara
      // para o executor saber o que será medido. Preenchê-las aqui exigiria que o runtime
      // executasse comando — que é o `ConstrutorService`, outra camada.
      validacoes: [],
      evidencias,
      ...(estado.uso === undefined ? {} : { uso: { ...estado.uso, duracaoMs: contexto.duracaoMs } }),
      ...(estado.sessao === undefined ? {} : { sessaoRetomavel: estado.sessao }),
      ...(assinatura === undefined ? {} : { assinaturaDeFalha: assinatura }),
      diagnosticos: estado.diagnosticos
    }
  }

  /**
   * O registro auditável (critério 6).
   *
   * Números, identificadores e a **nossa** assinatura de falha — nunca o formato interno do
   * fornecedor. É isso que faz a consulta "quantas tentativas falharam pelo mesmo motivo?"
   * continuar respondendo quando o Codex mudar a numeração dos erros dele.
   *
   * `redact` antes do log porque o contexto é objeto: ele apaga valor de campo sensível por
   * nome, o que `redigirSegredos` (que age sobre texto) não alcança.
   */
  private registrar(
    request: ExecutorRequest,
    resultado: ExecutorResult,
    duracaoMs: number
  ): void {
    const contexto = redact({
      correlationId: request.attemptId,
      runId: request.runId,
      chaveIdempotente: request.chaveIdempotente,
      executor: request.executor,
      modelo: request.modelo,
      modoDeCobranca: request.modoDeCobranca,
      status: resultado.status,
      pathsAlterados: resultado.pathsAlterados.length,
      tokensEntrada: resultado.uso?.tokensEntrada,
      tokensSaida: resultado.uso?.tokensSaida,
      diagnosticos: resultado.diagnosticos.length,
      assinaturaDeFalha: resultado.assinaturaDeFalha,
      duracaoMs
    }) as Record<string, unknown>

    const registrar = resultado.status === 'concluido' ? log.agent.info : log.agent.warn
    registrar(`Tentativa de executor: ${resultado.status}`, contexto)
  }
}

/**
 * A linha de evidência de um evento, ou `undefined` quando o evento não deixa evidência.
 *
 * `progress` e `usage` ficam fora: o primeiro é ruído de acompanhamento e o segundo já vai
 * estruturado no resultado — repeti-lo como texto daria duas contabilidades do mesmo número.
 */
function evidenciaDoEvento(evento: ExecutorEvent): string | undefined {
  switch (evento.tipo) {
    case 'started':
      return 'executor iniciou'
    case 'tool_used':
      return `ferramenta ${evento.nome}${evento.argumentos === undefined ? '' : ` ${evento.argumentos}`}`
    case 'path_changed':
      return `path alterado ${evento.path}`
    case 'done':
      return `executor concluiu${evento.resumo === undefined ? '' : `: ${evento.resumo}`}`
    case 'failed':
      return `executor falhou: ${evento.erro}`
    case 'canceled':
      return 'executor cancelado'
    case 'progress':
    case 'usage':
    case 'desconhecido':
      return undefined
  }
}
