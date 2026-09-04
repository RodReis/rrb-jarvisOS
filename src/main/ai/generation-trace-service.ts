/**
 * O coletor de uma geração: recebe os eventos enquanto elas acontecem, escreve em lote e avisa a
 * tela (SPEC-Fases-03 § Persistência e § Superfície).
 *
 * Um coletor por geração — ele guarda a sequência e o lote em memória, e dois streams no mesmo
 * objeto embaralhariam a ordem que o critério 1 exige preservar.
 *
 * ## O que ele garante
 *
 * - **Nenhum evento se perde no cancelamento** (critério 8): o `fechar` faz `flush` do que ainda
 *   está em memória **antes** de gravar o status. A ordem importa — gravar `cancelado` primeiro e
 *   perder o lote deixaria um trace que afirma ter terminado sem os eventos que o levaram ali.
 * - **O relógio não sobrevive ao fim.** Um `setTimeout` pendurado depois do fechamento gravaria
 *   num trace fechado e seguraria o processo. O `fechar` sempre o limpa.
 * - **A tela é avisada ao vivo, o banco em lote.** São ritmos diferentes de propósito: o painel
 *   precisa do evento agora; o SQLite não precisa de um commit por delta de texto.
 */

import type { EventoDaGeracao, GenerationEvent, StatusDoTrace } from '@shared/domain/geracao'
import { faseDaEtapa, type Fase } from '@shared/domain/fase'
import type { Etapa } from '@shared/domain/jornada'
import { RETENCAO_DIAS } from '@shared/domain/retencao'
import { log } from '../logging/logger'
import type { RegraDeRetencao } from '../pipeline/retencao-service'
import {
  EVENTOS_POR_LOTE,
  INTERVALO_DE_LOTE_MS,
  eventoSeguro,
  type EscopoDaGeracao,
  type GenerationTraceRepository
} from './generation-trace-repository'

export interface AberturaDoTrace {
  readonly traceId: string
  readonly escopo: EscopoDaGeracao
  readonly projectId: string
  /** O `call_id` do ponto único. Sem ele o trace é recusado (critério 2). */
  readonly ledgerEntryId: string
  readonly etapa: Etapa
  readonly provider: string
  readonly modelo: string
}

/**
 * Um coletor vivo. `registrar` durante, `fechar` no fim — sempre os dois, e o `fechar` no
 * `finally` de quem o criou.
 */
export interface ColetorDaGeracao {
  registrar(evento: GenerationEvent): void
  fechar(status: StatusDoTrace): void
}

export class GenerationTraceService {
  constructor(
    private readonly repo: GenerationTraceRepository,
    /**
     * Para onde os eventos vão ao vivo (o canal IPC). Opcional: um coletor sem tela ainda grava
     * — é o que faz a trilha existir para gerações que ninguém está olhando.
     */
    private readonly publicar?: (evento: EventoDaGeracao) => void,
    private readonly agora: () => Date = () => new Date()
  ) {}

  /** Abre o trace e devolve o coletor da geração. */
  abrir(abertura: AberturaDoTrace): ColetorDaGeracao {
    const fase: Fase = faseDaEtapa(abertura.etapa)

    this.repo.abrir(abertura.escopo, {
      id: abertura.traceId,
      projectId: abertura.projectId,
      ledgerEntryId: abertura.ledgerEntryId,
      etapa: abertura.etapa,
      fase,
      provider: abertura.provider,
      modelo: abertura.modelo,
      iniciadoEm: this.agora().toISOString()
    })

    return new Coletor(abertura.traceId, this.repo, this.publicar, this.agora)
  }

  /** O histórico da etapa (a lista que o painel mostra). */
  historico(
    escopo: EscopoDaGeracao,
    projectId: string,
    etapa: Etapa
  ): ReturnType<GenerationTraceRepository['listar']> {
    return this.repo.listar(escopo, projectId, etapa)
  }

  /** Os eventos de uma geração anterior — o que reabre o painel do histórico (critério 6). */
  eventos(escopo: EscopoDaGeracao, traceId: string): readonly GenerationEvent[] {
    return this.repo.eventos(escopo, traceId)
  }

  /**
   * A regra de retenção desta fatia (SPEC-Fases-03 § Persistência).
   *
   * Compacta os traces com mais de `RETENCAO_DIAS`: os eventos saem, o `uso` e a contagem por
   * ferramenta ficam. **O trace nunca é apagado** enquanto o projeto existir — ele é a prova de
   * que o documento foi gerado, e é a ele que o ledger se liga.
   *
   * `RETENCAO_DIAS` vem do domínio da M9-F06 em vez de uma constante local: a janela é a mesma
   * decisão de produto, e duas constantes divergiriam na primeira vez que alguém mudasse uma.
   *
   * Não filtra por usuário: a compactação é sobre **idade**, e um trace velho de outro usuário é
   * igualmente velho. O `userId` entra na assinatura por causa do contrato da regra.
   */
  regraDeRetencao(): RegraDeRetencao {
    return {
      nome: 'traces-da-geracao',
      aplicar: (_userId, agoraMs) =>
        this.repo.compactar(new Date(agoraMs - RETENCAO_DIAS * 24 * 60 * 60 * 1000).toISOString())
    }
  }
}

class Coletor implements ColetorDaGeracao {
  private pendentes: GenerationEvent[] = []
  private proximaSeq = 0
  private relogio: NodeJS.Timeout | undefined
  private fechado = false

  constructor(
    private readonly traceId: string,
    private readonly repo: GenerationTraceRepository,
    private readonly publicar: ((evento: EventoDaGeracao) => void) | undefined,
    private readonly agora: () => Date
  ) {}

  registrar(evento: GenerationEvent): void {
    // Evento depois do fechamento é corrida normal entre o `kill` do processo e o último `data`
    // do stdout. Ignorar é o certo: gravá-lo acrescentaria evento a um trace que já disse como
    // terminou.
    if (this.fechado) return

    /*
     * **A redação acontece na entrada, e é isso que a torna uma garantia.**
     *
     * Ela morava só na gravação, e o E2E mediu a consequência: o mesmo `Bash` com um token na
     * linha de comando ia redigido para o banco e **em claro para a tela**, porque `publicar`
     * recebia o evento cru. O segredo atravessava o IPC e era exibido durante a geração ao vivo
     * — a superfície que o PI está justamente olhando.
     *
     * O critério 3 fala em "argumento e resultado **persistidos**", então pela letra não era
     * violação; pelo ADR-005 ("sem vazar segredo/PII") era. Redigir na entrada resolve os dois
     * de uma vez e por construção: não existe caminho a partir daqui que veja o texto cru, então
     * a próxima saída que alguém acrescentar nasce protegida sem precisar lembrar disso.
     */
    const seguro = eventoSeguro(evento)

    this.pendentes.push(seguro)

    try {
      this.publicar?.({ traceId: this.traceId, evento: seguro })
    } catch (erro) {
      // A tela não pode derrubar a gravação, pelo mesmo motivo que a gravação não derruba a
      // geração: cada camada só quebra a si mesma.
      log.ai.warn('Falha ao publicar evento da geração', { traceId: this.traceId, erro })
    }

    if (this.pendentes.length >= EVENTOS_POR_LOTE) {
      this.flush()
      return
    }

    // Um evento sozinho não espera para sempre por companhia: `unref` para que o relógio não
    // segure o processo de saindo, que é o que trava o teardown do E2E.
    if (this.relogio === undefined) {
      this.relogio = setTimeout(() => this.flush(), INTERVALO_DE_LOTE_MS)
      this.relogio.unref?.()
    }
  }

  fechar(status: StatusDoTrace): void {
    if (this.fechado) return
    this.fechado = true

    // `flush` **antes** do status: o trace precisa terminar com os eventos que o levaram ali,
    // inclusive no cancelamento (critério 8).
    this.flush()
    this.repo.fechar(this.traceId, status, this.agora().toISOString())
  }

  private flush(): void {
    if (this.relogio !== undefined) {
      clearTimeout(this.relogio)
      this.relogio = undefined
    }

    if (this.pendentes.length === 0) return

    const lote = this.pendentes
    // Troca a referência **antes** de gravar: um `push` durante a escrita (o stdout não para de
    // chegar) entraria no lote seguinte em vez de ser descartado pelo `length = 0` de depois.
    this.pendentes = []
    const seqInicial = this.proximaSeq
    this.proximaSeq += lote.length

    try {
      this.repo.gravarEventos(this.traceId, lote, seqInicial)
    } catch (erro) {
      // Banco travado, disco cheio. O console perde o lote; a geração continua. É a mesma ordem
      // de prioridade do parser: o documento é o produto, o console é evidência.
      log.ai.warn('Falha ao gravar lote de eventos da geração', {
        traceId: this.traceId,
        eventos: lote.length,
        erro
      })
    }
  }
}
