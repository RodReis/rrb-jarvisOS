/**
 * O `SttEngine` de verdade: faster-whisper num sidecar Python (SPEC-Voz-01, critérios 1, 6 e 7).
 *
 * **Este é o único arquivo do app que sabe que faster-whisper existe** — e mesmo aqui o
 * conhecimento é só um nome de modelo e um formato de pedido, porque quem importa a biblioteca é
 * o script Python. É o que o critério 1 pede, e a guarda de lint é quem o mantém verdadeiro.
 *
 * ## O que ele faz, e o que delega
 *
 * Ele não baixa (é o `download-de-artefato`), não extrai nem instala (é a `instalacao`) e não
 * move JSON (é o `Sidecar`). O que sobra é a tradução: um `Int16Array` vira um pedido, uma
 * resposta vira `ResultadoDaTranscricao`, e a configuração do momento entra no meio.
 *
 * ## `disponivel()` pergunta ao disco, e instala se puder
 *
 * A prontidão não é um booleano guardado. Ela olha os 29 artefatos e, se estiverem todos lá,
 * garante que o runtime está instalado antes de responder `true` — porque "baixado" e "pronto"
 * são coisas diferentes, e responder `true` para o primeiro deixaria a transcrição seguinte
 * falhar com um erro de import do Python, que é a mensagem mais inútil possível para quem só
 * queria falar ao microfone.
 */

import { Sidecar } from './sidecar'
import { lerConfiguracao, type ConfiguracaoDaVoz } from './configuracao'
import { instalarRuntime, DIRETORIO_DO_MODELO, type DepsDaInstalacao } from './instalacao'
import { artefatosFaltando } from './instalacao'
import type { Artefato } from './download-de-artefato'
import type { ModoDeCompute } from '@shared/domain/voz'
import type { ResultadoDaTranscricao, SttEngine } from './stt-engine'

export interface DepsDoEngine {
  readonly artefatos: readonly Artefato[]
  readonly instalacao: DepsDaInstalacao
  /** Cria o sidecar já apontado para o Python instalado e o script escrito. */
  readonly criarSidecar: () => Sidecar
  /** O texto da configuração no disco, ou `undefined` se ela ainda não existe. */
  readonly lerConfiguracaoBruta: () => Promise<string | undefined>
  /** O caminho absoluto de um relativo ao `userData` — o Python precisa de absoluto. */
  readonly absoluto: (relativo: string) => string
  /** Onde o modo de compute observado é registrado (critério 7). */
  readonly registrarCompute: (modo: ModoDeCompute) => void
}

export class FasterWhisperEngine implements SttEngine {
  private sidecar: Sidecar | undefined
  private computeObservado: ModoDeCompute | undefined

  constructor(private readonly deps: DepsDoEngine) {}

  /** O modo que o sidecar reportou, ou `undefined` enquanto ele nunca subiu. */
  get compute(): ModoDeCompute | undefined {
    return this.computeObservado
  }

  async disponivel(): Promise<boolean> {
    const faltando = await artefatosFaltando(this.deps.artefatos, this.deps.instalacao.existe)
    if (faltando.length > 0) return false

    const desfecho = await instalarRuntime(this.deps.artefatos, this.deps.instalacao)

    return desfecho.estado === 'ok'
  }

  async transcribe(pcm: Int16Array): Promise<ResultadoDaTranscricao> {
    const configuracao = await this.configuracaoAtual()
    const sidecar = this.garantirSidecar()

    // O PCM vira base64 e segue no pedido. Sem arquivo temporário em lugar nenhum: o áudio vive
    // nesta chamada e some com ela (critério 8).
    const resposta = await sidecar.pedir({
      acao: 'transcrever',
      pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64'),
      modelo: this.deps.absoluto(DIRETORIO_DO_MODELO),
      idioma: configuracao.idioma
    })

    return this.traduzir(resposta)
  }

  async encerrar(): Promise<void> {
    const sidecar = this.sidecar
    this.sidecar = undefined
    await sidecar?.encerrar()
  }

  /**
   * Pergunta ao sidecar como ele vai calcular, e registra (critério 7).
   *
   * A resposta vem do runtime e não de uma sonda daqui: quem decide se CUDA serve é o
   * CTranslate2, com os próprios requisitos de driver e cuDNN, e uma segunda opinião deste lado
   * poderia discordar da que vale.
   */
  async sondarCompute(): Promise<ModoDeCompute> {
    const resposta = await this.garantirSidecar().pedir({ acao: 'ping' })
    const modo: ModoDeCompute = resposta.compute === 'cuda' ? 'cuda' : 'cpu-int8'

    this.computeObservado = modo
    this.deps.registrarCompute(modo)

    return modo
  }

  private async configuracaoAtual(): Promise<ConfiguracaoDaVoz> {
    // Lida a cada chamada, que é o que faz "vale na chamada seguinte, sem restart" ser verdade:
    // não há estado em memória a invalidar quando Settings muda (critério 6).
    return lerConfiguracao(await this.deps.lerConfiguracaoBruta())
  }

  private garantirSidecar(): Sidecar {
    // Reusado entre chamadas: carregar o modelo Whisper custa segundos, e pagar isso por
    // enunciado seria o oposto do que a fatia entrega.
    this.sidecar ??= this.deps.criarSidecar()

    return this.sidecar
  }

  private traduzir(resposta: Record<string, unknown>): ResultadoDaTranscricao {
    const segmentos = Array.isArray(resposta.segmentos) ? resposta.segmentos : []

    // Leitura defensiva: o outro lado é um processo separado, e uma resposta com forma
    // inesperada derrubaria a transcrição com um erro sobre `undefined` em vez de devolver o
    // que deu para entender.
    return {
      texto: typeof resposta.texto === 'string' ? resposta.texto : '',
      idioma: typeof resposta.idioma === 'string' ? resposta.idioma : '',
      segmentos: segmentos.map((bruto) => {
        const s = (bruto ?? {}) as Record<string, unknown>

        return {
          inicioMs: typeof s.inicioMs === 'number' ? s.inicioMs : 0,
          fimMs: typeof s.fimMs === 'number' ? s.fimMs : 0,
          texto: typeof s.texto === 'string' ? s.texto : ''
        }
      })
    }
  }
}
