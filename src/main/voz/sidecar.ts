/**
 * O processo filho que roda o engine de STT (SPEC-Voz-01, critério 2).
 *
 * ## Por que stdio, e não uma porta local
 *
 * O protocolo é JSON por linha no stdin/stdout (decisão do Cowork na spec). Porta de rede local
 * teria superfície maior, apareceria no firewall e permitiria que **outro** processo da máquina
 * falasse com o sidecar. Pelo stdio, quem conversa com ele é quem o criou, e mais ninguém.
 *
 * ## Sob demanda, e um processo só
 *
 * Sobe na primeira chamada e é reusado: carregar o modelo Whisper custa segundos, e fazer isso
 * por enunciado seria o oposto do que a fatia entrega. Morre com o app, ou quando alguém chama
 * `encerrar`.
 *
 * ## O que este arquivo **não** sabe
 *
 * Nada sobre Whisper, Python ou transcrição. Ele move JSON por linha — o comando e os argumentos
 * chegam prontos. É o que permite testá-lo inteiro sem baixar runtime nenhum, e é o que faz o
 * critério 1 valer também aqui.
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

/** O `spawn` injetado, pelo mesmo motivo do adapter do Claude Code: teste sem processo real. */
export type SpawnDoSidecar = (
  comando: string,
  args: readonly string[]
) => ChildProcessWithoutNullStreams

export interface OpcoesDoSidecar {
  readonly spawn: SpawnDoSidecar
  readonly comando: string
  readonly args: readonly string[]
  /** Quanto esperar por uma resposta antes de desistir. Trava sem morrer é o caso que ele pega. */
  readonly timeoutMs: number
}

/** Uma resposta do sidecar, no que este arquivo precisa dela. */
export interface RespostaDoSidecar {
  readonly id?: number
  readonly ok?: boolean
  readonly erro?: string
  readonly texto?: string
  readonly [chave: string]: unknown
}

interface Pendente {
  readonly resolver: (r: RespostaDoSidecar) => void
  readonly rejeitar: (e: Error) => void
  readonly relogio: ReturnType<typeof setTimeout>
}

export class Sidecar {
  private processo: ChildProcessWithoutNullStreams | undefined
  private readonly pendentes = new Map<number, Pendente>()
  private proximoId = 1
  private resto = ''

  constructor(private readonly opcoes: OpcoesDoSidecar) {}

  /**
   * Envia um pedido e espera a resposta **dele**.
   *
   * A correlação é por `id` e não por ordem de chegada: o sidecar pode responder fora de ordem,
   * e sem o id uma transcrição receberia o resultado de outra — silenciosamente, que é o pior
   * modo de errar aqui.
   */
  async pedir(payload: Record<string, unknown>): Promise<RespostaDoSidecar> {
    const proc = this.garantirProcesso()
    const id = this.proximoId++

    return new Promise<RespostaDoSidecar>((resolver, rejeitar) => {
      const relogio = setTimeout(() => {
        this.pendentes.delete(id)
        rejeitar(new Error('O sidecar de voz não respondeu dentro do tempo limite.'))
      }, this.opcoes.timeoutMs)

      this.pendentes.set(id, { resolver, rejeitar, relogio })
      proc.stdin.write(JSON.stringify({ ...payload, id }) + '\n')
    })
  }

  /** Encerra o processo, se houver. Idempotente: chamar duas vezes não estoura. */
  async encerrar(): Promise<void> {
    const proc = this.processo
    this.processo = undefined
    if (proc === undefined) return

    this.falharPendentes(new Error('O sidecar de voz foi encerrado.'))
    proc.kill()
  }

  private garantirProcesso(): ChildProcessWithoutNullStreams {
    if (this.processo !== undefined) return this.processo

    const proc = this.opcoes.spawn(this.opcoes.comando, this.opcoes.args)
    this.processo = proc
    this.resto = ''

    proc.stdout.on('data', (pedaco: Buffer) => this.receber(pedaco.toString('utf8')))

    /*
     * Morte do processo **falha as chamadas em curso** em vez de deixá-las penduradas.
     *
     * Promessa que nunca resolve deixaria a UI em "transcrevendo" para sempre — pior que erro,
     * porque não há próxima ação possível. Zerar `processo` aqui é o que faz a tentativa
     * seguinte subir um novo, que é o restart que o critério 2 pede.
     */
    const aoMorrer = (): void => {
      this.processo = undefined
      this.falharPendentes(new Error('O sidecar de voz encerrou no meio da chamada.'))
    }
    proc.on('exit', aoMorrer)
    proc.on('error', aoMorrer)

    return proc
  }

  /** Acumula bytes e trata cada linha completa. Linha parcial fica para o próximo pedaço. */
  private receber(texto: string): void {
    const partes = (this.resto + texto).split('\n')
    this.resto = partes.pop() ?? ''

    for (const linha of partes) {
      if (linha.trim() === '') continue

      let resposta: RespostaDoSidecar
      try {
        resposta = JSON.parse(linha) as RespostaDoSidecar
      } catch {
        // O runtime escreve aviso no stdout (o fallback para CPU é um). Tratar isso como
        // resposta mataria a chamada em curso por causa de um log.
        continue
      }

      const pendente = typeof resposta.id === 'number' ? this.pendentes.get(resposta.id) : undefined
      if (pendente === undefined) continue

      this.pendentes.delete(resposta.id as number)
      clearTimeout(pendente.relogio)

      if (resposta.ok === false) {
        pendente.rejeitar(new Error(resposta.erro ?? 'O sidecar de voz recusou o pedido.'))
        continue
      }

      pendente.resolver(resposta)
    }
  }

  private falharPendentes(erro: Error): void {
    for (const [id, p] of this.pendentes) {
      clearTimeout(p.relogio)
      this.pendentes.delete(id)
      p.rejeitar(erro)
    }
  }
}
