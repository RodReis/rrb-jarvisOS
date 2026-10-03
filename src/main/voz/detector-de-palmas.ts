/** Detector local de duas palmas a partir de PCM mono de 16 kHz.
 *
 * Processa janelas de 10 ms e guarda apenas energia e tempo. Nenhuma amostra é persistida.
 * Uma palma precisa ser breve e destacar-se do ruído ambiente; dois candidatos devem ocorrer
 * com intervalo humano plausível. O bloqueio após disparo evita abrir dois turnos pela mesma ação.
 */
export class DetectorDeDuasPalmas {
  private readonly amostrasPorQuadro = 160
  private readonly quadro = new Int16Array(this.amostrasPorQuadro)
  private preenchido = 0
  private quadros = 0
  private ruido = 200
  private picoInicio: number | null = null
  private primeiroPico: number | null = null
  private bloqueadoAte = 0

  alimentar(pcm: Int16Array): boolean {
    let detectou = false
    for (const amostra of pcm) {
      this.quadro[this.preenchido++] = amostra
      if (this.preenchido !== this.amostrasPorQuadro) continue

      this.preenchido = 0
      this.quadros += 1
      if (this.processarQuadro()) detectou = true
    }
    return detectou
  }

  limpar(): void {
    this.preenchido = 0
    this.quadros = 0
    this.ruido = 200
    this.picoInicio = null
    this.primeiroPico = null
    this.bloqueadoAte = 0
    this.quadro.fill(0)
  }

  private processarQuadro(): boolean {
    const agora = this.quadros * 10
    let soma = 0
    for (const amostra of this.quadro) soma += amostra * amostra
    const rms = Math.sqrt(soma / this.amostrasPorQuadro)
    const limiar = Math.max(1_200, this.ruido * 6)
    const alto = rms >= limiar

    if (agora < this.bloqueadoAte) return false

    if (alto) {
      if (this.picoInicio === null) this.picoInicio = agora
      // Energia alta sustentada é fala, música ou ruído; não uma palma curta.
      if (agora - this.picoInicio > 120) this.primeiroPico = null
      return false
    }

    // Atualizar o piso apenas fora dos impulsos evita que uma palma eleve o próprio limiar.
    this.ruido = Math.max(100, this.ruido * 0.98 + rms * 0.02)
    if (this.picoInicio === null) {
      if (this.primeiroPico !== null && agora - this.primeiroPico > 700) {
        this.primeiroPico = null
      }
      return false
    }

    const duracao = agora - this.picoInicio
    const inicio = this.picoInicio
    this.picoInicio = null
    if (duracao > 120) {
      this.primeiroPico = null
      return false
    }

    if (this.primeiroPico !== null) {
      const intervalo = inicio - this.primeiroPico
      if (intervalo >= 180 && intervalo <= 700) {
        this.primeiroPico = null
        this.bloqueadoAte = agora + 2_000
        return true
      }
    }

    this.primeiroPico = inicio
    return false
  }
}
