/**
 * Referência em memória do PCM enviado ao alto-falante. Descarta blocos de entrada fortemente
 * correlacionados com a própria fala; voz simultânea do usuário continua passando. Não é AEC.
 */
let referencia: { pcm: Int16Array; taxa: number; posicaoMs: () => number } | undefined

export function iniciarReferenciaDaFala(
  pcm: Int16Array,
  taxa: number,
  posicaoMs: () => number
): () => void {
  const atual = { pcm, taxa, posicaoMs }
  referencia = atual
  return () => {
    if (referencia === atual) referencia = undefined
  }
}

/** O detector recebe blocos de 80 ms a 16 kHz. Janela cobre atraso acústico de até 320 ms. */
export function suprimirPropriaFala(bloco: Int16Array): Int16Array {
  const atual = referencia
  if (!atual || bloco.length === 0) return bloco
  const fimNoAltoFalante = Math.floor((atual.posicaoMs() / 1_000) * atual.taxa)
  const passo = Math.max(1, Math.floor(atual.taxa * 0.008))
  const duracao = Math.floor((bloco.length / 16_000) * atual.taxa)
  const maiorAtraso = Math.floor(atual.taxa * 0.32)
  let energiaEntrada = 0
  for (const amostra of bloco) energiaEntrada += amostra * amostra
  if (energiaEntrada < bloco.length * 40 * 40) return bloco

  for (let atraso = 0; atraso <= maiorAtraso; atraso += passo) {
    const inicio = fimNoAltoFalante - duracao - atraso
    if (inicio < 0 || inicio + duracao >= atual.pcm.length) continue
    let produto = 0
    let energiaReferencia = 0
    for (let i = 0; i < bloco.length; i += 4) {
      const amostra = atual.pcm[inicio + Math.floor((i / 16_000) * atual.taxa)]
      produto += bloco[i] * amostra
      energiaReferencia += amostra * amostra
    }
    // A amostragem de 1/4 mantém a correlação em escala equivalente à energia total.
    const correlacao = produto / Math.sqrt((energiaEntrada / 4) * energiaReferencia)
    if (correlacao >= 0.82) return new Int16Array(bloco.length)
  }
  return bloco
}
