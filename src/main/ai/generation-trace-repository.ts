/**
 * Persistência da trilha da geração (SPEC-Fases-03 § Persistência).
 *
 * Camada fina — guarda e devolve —, com duas responsabilidades que **não** são delegáveis:
 *
 * 1. **Redigir antes de gravar.** O argumento e o resultado de uma ferramenta podem carregar
 *    segredo (um `Bash` com token na linha de comando é o caso concreto do MVP-009). O banco
 *    guarda para sempre; um segredo que entra aqui não sai mais. Por isso a redação acontece
 *    **neste ponto** e não no chamador: quem gravar trace de outra fatia herda a proteção sem
 *    saber que precisava dela — a mesma postura de `argsSeguros` no terminal do MVP-004.
 * 2. **Recusar trace órfão.** `ledgerEntryId` vazio não vira linha (critério 2). O banco não tem
 *    FK, então quem garante a ligação é este arquivo.
 *
 * ## Por que lote
 *
 * Uma geração longa emite milhares de eventos. Um `INSERT` por evento faria o SQLite fazer um
 * commit por delta de texto e serializar o stream — o console atrasaria a geração que ele apenas
 * observa. O lote (a cada `EVENTOS_POR_LOTE` ou `INTERVALO_DE_LOTE_MS`) escreve numa transação
 * só. O preço é que os últimos eventos ficam em memória por até um quarto de segundo; `flush` no
 * fechamento é o que garante que eles não se percam nem no cancelamento (critério 8).
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { GenerationEvent, GenerationTrace, StatusDoTrace } from '@shared/domain/geracao'
import { redact } from '@shared/contracts/logging-redaction'
import { redigirSegredos } from '@shared/domain/segredos'
import { log } from '../logging/logger'

/** Quantos eventos acumulam antes de uma escrita. */
export const EVENTOS_POR_LOTE = 50

/** Quanto tempo um evento espera por companhia antes de ser escrito sozinho. */
export const INTERVALO_DE_LOTE_MS = 250

/** O escopo de quem gera — o mesmo de toda entidade persistida. */
export interface EscopoDaGeracao {
  readonly userId: string
  readonly workspace: WorkspaceId
}

interface TraceRow {
  readonly id: string
  readonly ledger_entry_id: string
  readonly project_id: string
  readonly etapa: string
  readonly fase: string
  readonly provider: string
  readonly model: string
  readonly iniciado_em: string
  readonly terminado_em: string | null
  readonly status: string
}

interface EventoRow {
  readonly tipo: string
  readonly payload: string
}

/**
 * Redige um texto que vai para o banco. Nunca lança: entrada estranha vira string.
 *
 * **Os dois redatores, e não um.** Eles pegam coisas diferentes, e usar só um deixa passar o que
 * o outro cobre — foi o que o teste pegou, com `Bearer sk-ant-…` chegando ao disco intacto:
 *
 * - `redact` (ADR-004, o mesmo do terminal do MVP-004) age sobre **nome de campo** e sobre
 *   credencial embutida em URL. Sozinho, não vê um token solto no meio de uma linha de comando,
 *   porque ali não há campo nenhum a reconhecer.
 * - `redigirSegredos` age sobre **formato**: `sk-…`, `ghp_…`, `AIza…`, bloco de chave privada,
 *   atribuição explícita de senha. É o que alcança o argumento do `Bash`.
 */
function textoSeguro(texto: string): string {
  const redigido = redact(texto)
  return redigirSegredos(typeof redigido === 'string' ? redigido : String(redigido))
}

/**
 * O evento como ele pode ser gravado.
 *
 * Só os campos de ferramenta passam pelo redator: `delta` é o texto que o modelo escreveu (o
 * próprio documento — redigi-lo mutilaria o produto), e `uso`/`erro` são números e frases nossas.
 * O que precisa de redação é o que veio de **fora**: o comando que o modelo pediu e o que a
 * ferramenta respondeu.
 */
function eventoSeguro(evento: GenerationEvent): GenerationEvent {
  if (evento.tipo === 'ferramenta-inicio') {
    return { ...evento, resumoDoArgumento: textoSeguro(evento.resumoDoArgumento) }
  }

  if (evento.tipo === 'ferramenta-fim') {
    return { ...evento, resumoDoResultado: textoSeguro(evento.resumoDoResultado) }
  }

  return evento
}

export class GenerationTraceRepository {
  constructor(private readonly db: Database) {}

  /**
   * Abre o trace. **Recusa sem `ledgerEntryId`** (critério 2).
   *
   * Lança em vez de devolver `undefined`: um trace órfão não é um caso a tratar mais adiante, é
   * um defeito de programação no call site — e devolvê-lo em silêncio deixaria o console gravando
   * uma contabilidade paralela ao ledger sem ninguém perceber.
   */
  abrir(escopo: EscopoDaGeracao, trace: Omit<GenerationTrace, 'status' | 'terminadoEm'>): void {
    if (trace.ledgerEntryId === '') {
      throw new Error('Um trace de geração precisa do identificador do ledger que o originou.')
    }

    this.db
      .prepare(
        `INSERT INTO generation_trace
           (id, user_id, workspace_id, project_id, ledger_entry_id,
            etapa, fase, provider, model, iniciado_em, terminado_em, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'em-andamento')`
      )
      .run(
        trace.id,
        escopo.userId,
        escopo.workspace,
        trace.projectId,
        trace.ledgerEntryId,
        trace.etapa,
        trace.fase,
        trace.provider,
        trace.modelo,
        trace.iniciadoEm
      )
  }

  /**
   * Grava um lote de eventos numa transação só.
   *
   * `seqInicial` vem de fora porque quem numera é o coletor — ele conhece a ordem do stream, e
   * derivar a sequência de um `SELECT MAX(seq)` a cada lote faria uma leitura por escrita e
   * abriria corrida entre dois lotes do mesmo trace.
   */
  gravarEventos(traceId: string, eventos: readonly GenerationEvent[], seqInicial: number): void {
    if (eventos.length === 0) return

    const inserir = this.db.prepare(
      `INSERT INTO generation_trace_event (trace_id, seq, tipo, payload)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (trace_id, seq) DO NOTHING`
    )

    this.db.transaction(() => {
      eventos.forEach((evento, indice) => {
        const seguro = eventoSeguro(evento)
        inserir.run(traceId, seqInicial + indice, seguro.tipo, JSON.stringify(seguro))
      })
    })()
  }

  /** Fecha o trace com o desfecho. */
  fechar(traceId: string, status: StatusDoTrace, terminadoEm: string): void {
    this.db
      .prepare(`UPDATE generation_trace SET status = ?, terminado_em = ? WHERE id = ?`)
      .run(status, terminadoEm, traceId)
  }

  /** As gerações de uma etapa, da mais recente para a mais antiga (o histórico do painel). */
  listar(
    escopo: EscopoDaGeracao,
    projectId: string,
    etapa: string,
    limite = 20
  ): readonly GenerationTrace[] {
    const linhas = this.db
      .prepare(
        `SELECT id, ledger_entry_id, project_id, etapa, fase, provider, model,
                iniciado_em, terminado_em, status
           FROM generation_trace
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND etapa = ?
          ORDER BY iniciado_em DESC
          LIMIT ?`
      )
      .all(escopo.userId, escopo.workspace, projectId, etapa, limite) as TraceRow[]

    return linhas.map(paraTrace)
  }

  /** Um trace pelo id, com escopo — ninguém lê a trilha de outro usuário. */
  buscar(escopo: EscopoDaGeracao, traceId: string): GenerationTrace | undefined {
    const linha = this.db
      .prepare(
        `SELECT id, ledger_entry_id, project_id, etapa, fase, provider, model,
                iniciado_em, terminado_em, status
           FROM generation_trace
          WHERE id = ? AND user_id = ? AND workspace_id = ?`
      )
      .get(traceId, escopo.userId, escopo.workspace) as TraceRow | undefined

    return linha === undefined ? undefined : paraTrace(linha)
  }

  /**
   * Os eventos de um trace, na ordem em que o CLI os emitiu (critério 6).
   *
   * Linha que não parseia é **descartada com aviso**, não propagada: um payload corrompido no
   * banco não pode derrubar a abertura do histórico. É a mesma postura de falha aberta do parser.
   */
  eventos(escopo: EscopoDaGeracao, traceId: string): readonly GenerationEvent[] {
    if (this.buscar(escopo, traceId) === undefined) return []

    const linhas = this.db
      .prepare(
        `SELECT tipo, payload FROM generation_trace_event WHERE trace_id = ? ORDER BY seq ASC`
      )
      .all(traceId) as EventoRow[]

    const eventos: GenerationEvent[] = []

    for (const linha of linhas) {
      try {
        eventos.push(JSON.parse(linha.payload) as GenerationEvent)
      } catch {
        log.db.warn('Evento de geração ignorado por payload ilegível', { traceId, tipo: linha.tipo })
      }
    }

    return eventos
  }

  /**
   * Compacta os traces antigos: os eventos saem, o trace fica (SPEC-Fases-03 § Persistência).
   *
   * O que sobra é o `uso` e uma contagem por ferramenta — o suficiente para responder "quanto
   * custou e o que ela usou" sem guardar o texto inteiro de uma geração de meses atrás. O trace
   * **nunca** é apagado enquanto o projeto existir: ele é a prova de que o documento foi gerado, e
   * é a ele que o ledger se liga.
   *
   * Devolve quantos traces foram compactados — o coletor audita esse número.
   */
  compactar(antesDe: string): number {
    // `e.seq >= 0` exclui a própria linha-resumo (que mora em `seq = -1`). Sem isso, o resumo
    // que a compactação insere reativaria o critério na execução seguinte e o mesmo trace seria
    // contado para sempre — foi o que o teste do "compactar duas vezes" pegou.
    const traces = this.db
      .prepare(
        `SELECT DISTINCT t.id
           FROM generation_trace t
           JOIN generation_trace_event e ON e.trace_id = t.id
          WHERE t.iniciado_em < ? AND t.terminado_em IS NOT NULL
            AND e.tipo != 'uso' AND e.seq >= 0`
      )
      .all(antesDe) as { readonly id: string }[]

    if (traces.length === 0) return 0

    const contar = this.db.prepare(
      `SELECT payload FROM generation_trace_event
        WHERE trace_id = ? AND tipo = 'ferramenta-inicio'`
    )
    const apagar = this.db.prepare(
      `DELETE FROM generation_trace_event WHERE trace_id = ? AND tipo != 'uso' AND seq >= 0`
    )
    const resumir = this.db.prepare(
      `INSERT INTO generation_trace_event (trace_id, seq, tipo, payload)
       VALUES (?, ?, 'erro', ?)
       ON CONFLICT (trace_id, seq) DO UPDATE SET payload = excluded.payload`
    )

    this.db.transaction(() => {
      for (const { id } of traces) {
        const chamadas = contar.all(id) as { readonly payload: string }[]
        const porFerramenta = new Map<string, number>()

        for (const { payload } of chamadas) {
          try {
            const evento = JSON.parse(payload) as GenerationEvent
            if (evento.tipo !== 'ferramenta-inicio') continue
            porFerramenta.set(evento.nome, (porFerramenta.get(evento.nome) ?? 0) + 1)
          } catch {
            // Payload ilegível não impede a compactação dos outros.
          }
        }

        apagar.run(id)

        // A contagem entra como `erro` — o único tipo com campo livre de texto. Um tipo novo só
        // para isto obrigaria a tela a tratar um caso que ela nunca mostra ao vivo; a frase diz o
        // que aconteceu, que é o que o PI precisa ler ao abrir um trace antigo.
        if (porFerramenta.size > 0) {
          const resumo = [...porFerramenta.entries()]
            .map(([nome, vezes]) => `${nome} ×${vezes}`)
            .join(', ')
          resumir.run(id, -1, JSON.stringify({ tipo: 'erro', mensagem: `Detalhe compactado. Ferramentas: ${resumo}.` }))
        } else {
          resumir.run(
            id,
            -1,
            JSON.stringify({ tipo: 'erro', mensagem: 'Detalhe compactado pela retenção.' })
          )
        }
      }
    })()

    log.db.info('Traces de geração compactados pela retenção', { traces: traces.length })

    return traces.length
  }
}

function paraTrace(linha: TraceRow): GenerationTrace {
  return {
    id: linha.id,
    projectId: linha.project_id,
    ledgerEntryId: linha.ledger_entry_id,
    etapa: linha.etapa,
    fase: linha.fase,
    provider: linha.provider,
    modelo: linha.model,
    iniciadoEm: linha.iniciado_em,
    ...(linha.terminado_em === null ? {} : { terminadoEm: linha.terminado_em }),
    status: statusDoTrace(linha.status)
  }
}

/**
 * O status gravado, validado.
 *
 * `em-andamento` (o valor que `abrir` grava) e qualquer coisa inesperada viram `falhou`: um trace
 * que nunca fechou é uma geração que morreu com o app, e chamá-la de concluída afirmaria um
 * desfecho que não houve.
 */
function statusDoTrace(valor: string): StatusDoTrace {
  return valor === 'concluido' || valor === 'falhou' || valor === 'cancelado' ? valor : 'falhou'
}
