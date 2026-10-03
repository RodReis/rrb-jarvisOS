/**
 * Buffer circular de áudio em memória para pré-roll da escuta (SPEC-Escuta-01, critério 3).
 *
 * ## Por que pré-roll de 1500 ms
 *
 * Quando o usuário diz "Ei, amigo, qual a próxima tarefa?", a wake word termina e a fala
 * da pergunta começa imediatamente. Sem pré-roll, a latência de abrir a captura pós-disparo
 * decapitaria a primeira palavra da pergunta. O buffer circular mantém os últimos 1500 ms
 * continuamente em memória, sem nunca crescer além da capacidade fixada (24.000 amostras a 16 kHz).
 *
 * ## O áudio não persiste nem vaza
 *
 * Enquanto nenhuma wake word dispara, as amostras antigas são sobrescritas e descartadas.
 * Nada vai para disco e nada vai para a rede (critérios 3 e 4).
 */

export class BufferCircularAudio {
  private readonly buffer: Int16Array
  private ponteiro = 0
  private preenchido = 0

  constructor(readonly capacidadeAmostras: number) {
    if (!Number.isSafeInteger(capacidadeAmostras) || capacidadeAmostras <= 0) {
      throw new Error('A capacidade do buffer circular deve ser um inteiro maior que zero.')
    }
    this.buffer = new Int16Array(capacidadeAmostras)
  }

  /**
   * Adiciona amostras PCM ao buffer.
   * Amostras mais antigas que a capacidade são descartadas sem alocação extra.
   */
  adicionar(amostras: Int16Array): void {
    if (amostras.length === 0) return

    for (let i = 0; i < amostras.length; i += 1) {
      this.buffer[this.ponteiro] = amostras[i]!
      this.ponteiro = (this.ponteiro + 1) % this.capacidadeAmostras
      if (this.preenchido < this.capacidadeAmostras) {
        this.preenchido += 1
      }
    }
  }

  /**
   * Devolve uma cópia ordenada (do mais antigo ao mais recente) do áudio retido.
   * Não altera o estado do buffer.
   */
  obter(): Int16Array {
    if (this.preenchido === 0) {
      return new Int16Array(0)
    }

    const resultado = new Int16Array(this.preenchido)
    if (this.preenchido < this.capacidadeAmostras) {
      // Buffer ainda não deu a volta: dados vão de 0 a preenchido - 1
      resultado.set(this.buffer.subarray(0, this.preenchido))
    } else {
      // Buffer cheio: os mais antigos começam em `ponteiro` até o fim,
      // seguidos de 0 até `ponteiro - 1`.
      const parteMaisAntiga = this.buffer.subarray(this.ponteiro)
      const parteMaisNova = this.buffer.subarray(0, this.ponteiro)
      resultado.set(parteMaisAntiga, 0)
      resultado.set(parteMaisNova, parteMaisAntiga.length)
    }

    return resultado
  }

  /** Esvazia o buffer. */
  limpar(): void {
    this.ponteiro = 0
    this.preenchido = 0
    this.buffer.fill(0)
  }

  /** Quantas amostras estão retidas atualmente. */
  tamanho(): number {
    return this.preenchido
  }
}
