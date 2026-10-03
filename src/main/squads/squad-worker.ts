/**
 * O executor de um worker somente-leitura (SPEC-Squads-03, critérios 1 e 4).
 *
 * Roda **uma** tarefa pelo ponto único de IA, **sem ferramentas** (a fase de planejamento é a que o
 * adapter isola sem ferramenta, settings nem MCP) e devolve um **estado terminal auditado** — nunca
 * lança, e nenhum caminho termina sem estado: recusa antes de rodar, resultado concluído,
 * incompleto, inválido, estouro de prazo, cancelamento ou falha da chamada.
 *
 * O que o worker devolve é **dado não confiável** até o schema e a regra de evidência o validarem
 * (regra 4): quem decide `concluida` é `avaliarResultado`, e a evidência de arquivo só vale se está
 * no `ContextPack` da tarefa. A `assinatura` do resultado é calculada aqui, pelo kernel.
 *
 * **Uma tentativa por chamada.** A repetição é do orquestrador, dentro do limite da M9-F04 (regra
 * 1: falha não autoriza repetição indefinida nem aumento de orçamento); este arquivo só recusa a
 * tentativa que passa do limite.
 */

import { createHash } from 'node:crypto'
import { TIMEOUT_PADRAO_MS, type AiRequest, type CostEvent } from '@shared/domain/ai'
import type { ContextPack } from '@shared/domain/context-pack'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import {
  avaliarResultado,
  textoDaAssinatura,
  type EstadoDaTarefa,
  type ResultadoDaTarefa,
  type SchemaDeResultado
} from '@shared/domain/squad-execucao'
import { PAPEIS_QUE_ESCREVEM, type TarefaDoPlano } from '@shared/domain/squad-plano'
import { ehSchemaDeResultado, esquemaDoResultado } from '@shared/domain/squad-resultado-esquema'
import type { AiCallContext } from '../ai/call-provider'
import type { FonteDaTarefa } from '../context/context-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { ChamadorDeIa } from './squad-gerador'
import { extrairJsonFinal } from './squad-planejador'
import { recusaDaTentativa, recusaDoContexto, recusaDosLimites } from './squad-recusas'
import { montarPromptDoWorker } from './squad-worker-prompt'

/** Mais que isto de saída é um modelo fora de controle, não um resultado: corta e marca inválida. */
const MAX_BYTES_DA_SAIDA = 256 * 1024
const MS_POR_MINUTO = 60_000
/** Margem para o relógio do executor disparar antes do relógio do ponto único. */
const MARGEM_DO_PRAZO_MS = 2_000
/** O que do erro do provider vai para a auditoria: o bastante para diagnosticar, nada de corpo cru. */
const MAX_MOTIVO_AUDITADO = 160

export interface PedidoDoWorker {
  readonly runId: string
  readonly tarefa: Pick<
    TarefaDoPlano,
    'id' | 'papel' | 'capacidade' | 'camada' | 'schemaDeResultado' | 'limites' | 'regraDeConclusao'
  >
  /** O que a tarefa precisa responder, em texto do kernel (nunca texto de agente). */
  readonly objetivo: string
  /** O pack e os textos que o montador do contexto entregou: o pack autoriza a chamada. */
  readonly contexto: { readonly pack: ContextPack; readonly fontes: readonly FonteDaTarefa[] }
  /** O modelo da camada da tarefa, resolvido pelo snapshot do Squad. */
  readonly modelo: ModeloEscolhido
  /** Obrigatório com o modelo local: a janela de contexto que o Ollama recebe. */
  readonly numCtx?: number
  /** A partir de 1. */
  readonly tentativa: number
  /** Cancela a tarefa de fora (o PI, o kernel). */
  readonly signal?: AbortSignal
}

export interface ResultadoDoWorker {
  readonly estado: Exclude<EstadoDaTarefa, 'pendente' | 'em-execucao'>
  readonly motivo?: string
  readonly resultado?: ResultadoDaTarefa
  /** Só com resultado lido (`concluida` ou `incompleta`). */
  readonly assinatura?: string
  /** A evidência que o resultado citou e o kernel não reconheceu. */
  readonly descartadas: readonly string[]
  readonly packId: string
  readonly tentativa: number
  readonly duracaoMs: number
  /** O custo medido pelo ponto único, quando a chamada chegou ao fim. */
  readonly custo?: CostEvent
}

export interface DependenciasDoWorker {
  readonly ia: ChamadorDeIa
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  readonly agora?: () => number
}

type Desfecho = Pick<ResultadoDoWorker, 'estado' | 'motivo' | 'resultado' | 'descartadas'>

const sha256 = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex')

export class ExecutorDeWorker {
  private readonly agora: () => number

  constructor(private readonly deps: DependenciasDoWorker) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  async executar(pedido: PedidoDoWorker): Promise<ResultadoDoWorker> {
    const inicio = this.agora()
    const base = { packId: pedido.contexto.pack.id, tentativa: pedido.tentativa }

    const recusa = this.recusar(pedido)
    if (recusa !== undefined) {
      const r: ResultadoDoWorker = {
        ...base,
        estado: 'recusada',
        motivo: recusa,
        descartadas: [],
        duracaoMs: this.agora() - inicio
      }
      this.auditar(pedido, 'fim', r)
      return r
    }

    // Cancelada antes de rodar: nem chama a IA, e só o estado final é auditado — a tarefa nunca começou.
    if (pedido.signal?.aborted === true) {
      const r: ResultadoDoWorker = {
        ...base,
        estado: 'cancelada',
        motivo: 'cancelada-antes-de-iniciar',
        descartadas: [],
        duracaoMs: this.agora() - inicio
      }
      this.auditar(pedido, 'fim', r)
      return r
    }

    this.auditar(pedido, 'inicio')
    let custo: CostEvent | undefined
    let desfecho: Desfecho
    try {
      const rodado = await this.rodar(pedido)
      desfecho = rodado.desfecho
      custo = rodado.custo
    } catch (erro) {
      // O worker nunca lança: o que escapou até aqui é falha, e falha tem estado.
      desfecho = {
        estado: 'falhou',
        motivo: `erro inesperado: ${erro instanceof Error ? erro.name : 'desconhecido'}`,
        descartadas: []
      }
    }

    const assinatura =
      desfecho.resultado === undefined ? undefined : sha256(textoDaAssinatura(desfecho.resultado))
    const r: ResultadoDoWorker = {
      ...base,
      ...desfecho,
      ...(assinatura === undefined ? {} : { assinatura }),
      ...(custo === undefined ? {} : { custo }),
      duracaoMs: this.agora() - inicio
    }
    this.auditar(pedido, 'fim', r)
    return r
  }

  /** O que impede a tarefa de nem começar. `undefined` quando ela pode rodar. */
  private recusar(pedido: PedidoDoWorker): string | undefined {
    const { tarefa, contexto, modelo } = pedido
    if (PAPEIS_QUE_ESCREVEM.includes(tarefa.papel)) return 'papel-de-escrita'
    if (!ehSchemaDeResultado(tarefa.schemaDeResultado)) return 'schema-desconhecido'
    const comum =
      recusaDaTentativa(pedido.tentativa) ??
      recusaDosLimites(tarefa.limites) ??
      recusaDoContexto(contexto.fontes.length, contexto.pack.itens.length)
    if (comum !== undefined) return comum
    if (modelo.provider === 'ollama' && (pedido.numCtx === undefined || pedido.numCtx <= 0)) {
      return 'modelo-local-sem-janela'
    }

    const { system, prompt } = montarPromptDoWorker({
      tarefa,
      objetivo: pedido.objetivo,
      fontes: contexto.fontes
    })
    const tokensDeEntrada = Math.ceil(Buffer.byteLength(system + prompt, 'utf8') / 4)
    return tokensDeEntrada > tarefa.limites.maxTokensEntrada
      ? 'contexto-acima-do-limite'
      : undefined
  }

  private async rodar(pedido: PedidoDoWorker): Promise<{ desfecho: Desfecho; custo?: CostEvent }> {
    const { tarefa, contexto, modelo } = pedido
    const schema = tarefa.schemaDeResultado as SchemaDeResultado
    const { system, prompt } = montarPromptDoWorker({
      tarefa,
      objetivo: pedido.objetivo,
      fontes: contexto.fontes
    })
    const esquema = JSON.stringify(esquemaDoResultado(schema))

    // O prazo efetivo é o menor entre o do plano e o teto do ponto único. O relógio do executor
    // dispara primeiro, para o estado ser `timeout` e não uma falha anônima.
    const prazoMs = Math.min(tarefa.limites.maxMinutos * MS_POR_MINUTO, TIMEOUT_PADRAO_MS)
    const controle = new AbortController()
    let causa: 'timeout' | 'cancelada' | undefined
    const estourar = setTimeout(() => {
      causa ??= 'timeout'
      controle.abort()
    }, prazoMs)
    const cancelar = (): void => {
      causa ??= 'cancelada'
      controle.abort()
    }
    if (pedido.signal?.aborted === true) cancelar()
    else pedido.signal?.addEventListener('abort', cancelar)

    const ctx: AiCallContext = {
      userId: this.deps.userId(),
      workspace: this.deps.workspaceId(),
      signal: controle.signal,
      timeoutMs: prazoMs + MARGEM_DO_PRAZO_MS
    }
    const request: AiRequest = {
      provider: modelo.provider,
      model: modelo.modelo,
      system,
      prompt,
      maxTokens: tarefa.limites.maxTokensSaida,
      contextPackId: contexto.pack.id,
      runId: pedido.runId,
      tentativa: pedido.tentativa,
      // Sem ferramentas, sem settings do ambiente, esquema imposto: é a fase que o adapter isola
      // assim. É política de isolamento, não de roteamento — o modelo vem do snapshot, acima.
      fase: 'planejamento',
      ...(modelo.provider === 'ollama'
        ? { opcoesLocais: { numCtx: pedido.numCtx as number, formato: esquema } }
        : { jsonSchema: esquema })
    }

    try {
      let texto = ''
      let custo: CostEvent | undefined
      for await (const evento of this.deps.ia.call(request, ctx)) {
        if (evento.tipo === 'chunk') {
          texto += evento.texto
          if (Buffer.byteLength(texto, 'utf8') > MAX_BYTES_DA_SAIDA) {
            controle.abort()
            return {
              desfecho: { estado: 'invalida', motivo: 'saida-grande-demais', descartadas: [] }
            }
          }
          continue
        }
        custo = evento.custo
        // Prazo ou cancelamento que disparou antes do fim vale mais que o resultado que chegou junto:
        // cancelada não vira concluída por uma corrida entre o sinal e o último evento.
        if (causa !== undefined) return { desfecho: this.falha(causa), ...(custo ? { custo } : {}) }
        if (evento.estado === 'falhou') {
          return { desfecho: this.falha(causa, evento.erro), ...(custo ? { custo } : {}) }
        }
        return {
          desfecho: this.avaliar(texto, schema, contexto.fontes),
          ...(custo ? { custo } : {})
        }
      }
      return { desfecho: this.falha(causa, 'o stream terminou sem desfecho') }
    } finally {
      clearTimeout(estourar)
      pedido.signal?.removeEventListener('abort', cancelar)
    }
  }

  /** A falha da chamada, classificada pelo que a causou: prazo e cancelamento têm estado próprio. */
  private falha(causa: 'timeout' | 'cancelada' | undefined, erro?: string): Desfecho {
    if (causa === 'timeout') return { estado: 'timeout', motivo: 'prazo-do-plano', descartadas: [] }
    if (causa === 'cancelada') return { estado: 'cancelada', motivo: 'cancelada', descartadas: [] }
    return {
      estado: 'falhou',
      motivo: (erro ?? 'a chamada falhou').slice(0, MAX_MOTIVO_AUDITADO),
      descartadas: []
    }
  }

  private avaliar(
    texto: string,
    schema: SchemaDeResultado,
    fontes: readonly FonteDaTarefa[]
  ): Desfecho {
    const bruto = extrairJsonFinal(texto, (v) => 'conclusao' in v && 'schema' in v)
    if (bruto === undefined) {
      return { estado: 'invalida', motivo: 'saida-sem-json', descartadas: [] }
    }
    const avaliado = avaliarResultado(bruto, {
      schemaEsperado: schema,
      fontesDoPack: new Set(fontes.map((f) => f.caminho))
    })
    if (avaliado.estado === 'invalida') {
      return { estado: 'invalida', motivo: avaliado.motivo, descartadas: [] }
    }
    return {
      estado: avaliado.estado,
      resultado: avaliado.resultado,
      descartadas: avaliado.descartadas,
      ...(avaliado.estado === 'incompleta' ? { motivo: avaliado.motivo } : {})
    }
  }

  /**
   * O estado e os ids, nunca o texto do agente: a auditoria responde "o que aconteceu com esta
   * tarefa?" sem repetir o que o modelo escreveu (ADR-004).
   */
  private auditar(pedido: PedidoDoWorker, marco: 'inicio' | 'fim', r?: ResultadoDoWorker): void {
    const { tarefa, contexto, modelo } = pedido
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-tarefa',
      payload: {
        marco,
        runId: pedido.runId,
        tarefaId: tarefa.id,
        papel: tarefa.papel,
        capacidade: tarefa.capacidade,
        camada: tarefa.camada,
        tentativa: pedido.tentativa,
        packId: contexto.pack.id,
        packHash: contexto.pack.hash,
        provider: modelo.provider,
        modelo: modelo.modelo,
        schemaDeResultado: tarefa.schemaDeResultado,
        estado: r?.estado ?? 'em-execucao',
        ...(r === undefined
          ? {}
          : {
              ...(r.motivo === undefined ? {} : { motivo: r.motivo }),
              ...(r.assinatura === undefined ? {} : { assinatura: r.assinatura }),
              descartadas: r.descartadas.length,
              duracaoMs: r.duracaoMs
            })
      }
    })
  }
}
