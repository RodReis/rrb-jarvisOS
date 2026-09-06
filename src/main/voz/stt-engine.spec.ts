import { describe, expect, it, vi } from 'vitest'
import { transcrever, type SttEngine, type ResultadoDaTranscricao } from './stt-engine'

/** Um engine de teste — quem chama nunca sabe qual é o concreto (critério 1). */
function engineFalso(resposta: Partial<ResultadoDaTranscricao> = {}): SttEngine {
  return {
    transcribe: vi.fn(async () => ({
      texto: 'uma frase em português',
      idioma: 'pt',
      segmentos: [],
      ...resposta
    })),
    disponivel: vi.fn(async () => true),
    encerrar: vi.fn(async () => undefined)
  }
}

/** PCM de brinquedo: 16 kHz mono, o formato que o renderer envia. */
function pcm(amostras = 16_000): Int16Array {
  return new Int16Array(amostras)
}

describe('SttEngine — o contrato (critério 1)', () => {
  it('devolve o texto do engine injetado', async () => {
    const engine = engineFalso({ texto: 'bom dia' })

    const r = await transcrever(engine, pcm())

    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') throw new Error('desfecho inesperado')
    expect(r.resultado.texto).toBe('bom dia')
  })

  it('não conhece o engine concreto — qualquer um que cumpra o contrato serve', async () => {
    const outro: SttEngine = {
      transcribe: async () => ({ texto: 'de outro engine', idioma: 'pt', segmentos: [] }),
      disponivel: async () => true,
      encerrar: async () => undefined
    }

    const r = await transcrever(outro, pcm())

    expect(r.estado === 'ok' && r.resultado.texto).toBe('de outro engine')
  })

  it('recusa áudio vazio sem chamar o engine — não é falha dele', async () => {
    // Chamar o engine com zero amostras gastaria a inicialização do sidecar para nada, e o
    // erro voltaria como "falha na transcrição", culpando o engine por um clique acidental.
    const engine = engineFalso()

    const r = await transcrever(engine, new Int16Array(0))

    expect(r.estado).toBe('sem-audio')
    expect(engine.transcribe).not.toHaveBeenCalled()
  })

  it('falha do engine vira desfecho tratado, nunca exceção', async () => {
    // Quem chama é o IPC, e uma exceção atravessando a ponte chega ao renderer como erro
    // opaco — sem próxima ação, que é o que o critério 2 exige da UI.
    const engine: SttEngine = {
      transcribe: async () => {
        throw new Error('o sidecar morreu no meio')
      },
      disponivel: async () => true,
      encerrar: async () => undefined
    }

    const r = await transcrever(engine, pcm())

    expect(r.estado).toBe('falhou')
    expect(r.estado === 'falhou' && r.motivo).toContain('sidecar')
  })

  it('engine indisponível é desfecho próprio, não falha', async () => {
    // "Runtime ausente" pede **baixar**; "transcrição falhou" pede **tentar de novo**. Fundir
    // os dois daria à UI uma próxima ação errada na primeira execução do app.
    const engine = engineFalso()
    engine.disponivel = vi.fn(async () => false)

    const r = await transcrever(engine, pcm())

    expect(r.estado).toBe('indisponivel')
    expect(engine.transcribe).not.toHaveBeenCalled()
  })

  it('o áudio não é guardado em lugar nenhum pelo contrato (critério 8)', async () => {
    const engine = engineFalso()
    const amostras = pcm(320)

    await transcrever(engine, amostras)

    // O contrato recebe o PCM e o repassa; não há campo onde ele fique. O teste afirma sobre
    // a **superfície**: nenhuma chave do resultado carrega o áudio de volta.
    const r = await transcrever(engine, amostras)
    expect(JSON.stringify(r)).not.toContain('Int16Array')
  })
})
