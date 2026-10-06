/** Reproduz somente pedidos originados no main após desbloqueio; nenhum turno de fala chama aqui. */
import type { ReproducaoDasBoasVindas } from '@shared/domain/boas-vindas'
import { criarReprodutor } from './reproducao-de-fala'
import { iniciarReferenciaDaFala } from './referencia-da-fala'

export function instalarReproducaoDasBoasVindas(voz: string, saidaId?: string | null): () => void {
  const reprodutor = criarReprodutor()
  let midiaEmCurso: HTMLAudioElement | undefined
  let urlEmCurso: string | undefined
  let falaEmCurso = false
  let disparos = 0

  const liberarMidia = (): void => {
    midiaEmCurso?.pause()
    midiaEmCurso = undefined
    if (urlEmCurso) URL.revokeObjectURL(urlEmCurso)
    urlEmCurso = undefined
  }

  async function reproduzir(pedido: ReproducaoDasBoasVindas): Promise<void> {
    const disparosAoIniciar = disparos
    const podeReproduzir = async (): Promise<boolean> => {
      const estado = await window.jarvis.estadoDaEscuta()
      return (
        estado.ativa &&
        (estado.fase === 'escutando' || estado.fase === 'ocioso') &&
        disparos === disparosAoIniciar
      )
    }
    if (pedido.acao === 'fala') {
      if (!(await podeReproduzir())) {
        throw new Error('Turno de voz em andamento')
      }
      const resultado = await window.jarvis.falar(pedido.texto, voz)
      if (resultado.estado !== 'ok') throw new Error('Síntese da saudação indisponível')
      if (!(await podeReproduzir())) {
        throw new Error('Turno de voz iniciado durante a síntese')
      }
      window.jarvis.informarFaseDaVoz('falando')
      falaEmCurso = true
      const emCurso = reprodutor.tocar(resultado.fala, saidaId || undefined)
      const limparReferencia = iniciarReferenciaDaFala(
        resultado.fala.pcm,
        resultado.fala.sampleRate,
        emCurso.posicaoMs
      )
      try {
        // A chegada não degrada silenciosamente para o dispositivo padrão do SO.
        if (!(await emCurso.saidaAplicada)) throw new Error('Saída selecionada indisponível')
        await emCurso.terminou
      } finally {
        emCurso.cancelar()
        limparReferencia()
        falaEmCurso = false
        void window.jarvis
          .estadoDaEscuta()
          .then((estado) => {
            if (estado.fase === 'falando') {
              window.jarvis.informarFaseDaVoz(estado.ativa ? 'escutando' : 'ocioso')
            }
          })
          .catch(() => undefined)
      }
      return
    }

    if (!(await podeReproduzir())) throw new Error('Turno de voz em andamento')
    liberarMidia()
    const bytes = new Uint8Array(pedido.dados)
    const url = URL.createObjectURL(new Blob([bytes], { type: pedido.tipo }))
    urlEmCurso = url
    const audio = new Audio(url)
    midiaEmCurso = audio
    audio.onended = liberarMidia
    audio.onerror = liberarMidia
    const comSaida = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    try {
      if (saidaId) {
        if (!comSaida.setSinkId) throw new Error('Saída selecionada indisponível')
        await comSaida.setSinkId(saidaId)
      }
      await audio.play()
    } catch (erro) {
      liberarMidia()
      throw erro
    }
  }

  const remover = window.jarvis.onReproducaoDasBoasVindas((pedido) => {
    void reproduzir(pedido).then(
      () => window.jarvis.confirmarReproducaoDasBoasVindas(pedido.id, true),
      () => window.jarvis.confirmarReproducaoDasBoasVindas(pedido.id, false)
    )
  })
  const removerDisparo = window.jarvis.onEscutaDisparo(() => {
    disparos += 1
    if (falaEmCurso) reprodutor.cancelar()
    liberarMidia()
  })
  window.jarvis.informarBoasVindasProntas()
  return () => {
    remover()
    removerDisparo()
    reprodutor.cancelar()
    liberarMidia()
  }
}
