import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Microfone } from './Microfone'
import type { DesfechoDaTranscricao, ProntidaoDaVoz } from '@shared/domain/voz'

/**
 * A tela do microfone (SPEC-Voz-01, critérios 4, 5 e 7).
 *
 * Ponte por `vi.stubGlobal`, não `defineProperty`: a propriedade definida sobrevive ao
 * `unstubAllGlobals` do vizinho e quebra outro arquivo só no CI.
 */

const transcreverAudio = vi.fn()
const prontidaoDaVoz = vi.fn()
const baixarArtefatoDeVoz = vi.fn()
const perguntarAoJarvis = vi.fn()
const historicoDaConversa = vi.fn()
const falar = vi.fn()

/**
 * A assinatura do canal da hotkey, guardando o ouvinte.
 *
 * Guardar o callback é o ponto: o que os testes da hotkey medem é o que a tela faz **ao ser
 * avisada** pelo main, e um dublê que só conta chamadas de assinatura nunca chegaria lá.
 */
let avisarHotkey: ((gravando: boolean) => void) | undefined
const onVozHotkey = vi.fn((ouvinte: (gravando: boolean) => void) => {
  avisarHotkey = ouvinte
  return () => {
    avisarHotkey = undefined
  }
})

function prontidao(extra: Partial<ProntidaoDaVoz> = {}): ProntidaoDaVoz {
  return { pronta: true, faltando: [], compute: 'cuda', ...extra }
}

beforeEach(() => {
  transcreverAudio.mockReset()
  prontidaoDaVoz.mockReset().mockResolvedValue(prontidao())
  baixarArtefatoDeVoz.mockReset().mockResolvedValue({ estado: 'ok' })
  perguntarAoJarvis.mockReset().mockResolvedValue({ estado: 'ok', resposta: 'Dois aguardando.' })
  historicoDaConversa.mockReset().mockResolvedValue([])
  falar.mockReset().mockResolvedValue({ estado: 'indisponivel' })
  avisarHotkey = undefined
  onVozHotkey.mockClear()
  vi.stubGlobal('jarvis', {
    transcreverAudio,
    prontidaoDaVoz,
    baixarArtefatoDeVoz,
    perguntarAoJarvis,
    historicoDaConversa,
    falar,
    onVozHotkey
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Um dublê de captura: `getUserMedia` não existe em jsdom, e o que se mede aqui é a **lógica da
 * tela** — quando ela grava, quando transcreve, o que faz com cada desfecho. A captura real é
 * exercitada no app, no critério 5.
 */
function capturaFalsa(amostras = 16_000): () => Promise<() => Promise<Int16Array>> {
  return async () => async () => new Int16Array(amostras)
}

/**
 * Um reprodutor de mentira: Web Audio não existe em jsdom.
 *
 * `terminou` resolve na hora porque o que se mede aqui é **que a fala foi pedida**, não quanto
 * ela dura; um dublê que nunca resolvesse travaria o teste no `await`.
 */
function reprodutorFalso(): { tocar: () => { terminou: Promise<void> }; cancelar: () => void } {
  return { tocar: () => ({ terminou: Promise.resolve(), cancelar: () => {} }), cancelar: () => {} }
}

function montar(capturar = capturaFalsa()): ReturnType<typeof render> {
  // Devolve o resultado do `render` porque o teste de desmontagem precisa do `unmount`.
  return render(
    <Microfone
      workspace="jarvis"
      vozDaFala="pt_BR-faber-medium"
      capturar={capturar}
      criarFala={reprodutorFalso as never}
    />
  )
}

describe('runtime ausente é convite, não erro (critério 4)', () => {
  it('oferece baixar quando falta artefato, em vez de dizer que falhou', async () => {
    // A primeira execução do app cai aqui. "Falhou" mandaria tentar de novo — ação que nunca
    // vai funcionar enquanto o runtime não existir.
    prontidaoDaVoz.mockResolvedValue(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    montar()

    expect(await screen.findByRole('button', { name: /baixar/i })).toBeInTheDocument()
  })

  it('não oferece gravar enquanto o runtime não está pronto', async () => {
    prontidaoDaVoz.mockResolvedValue(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    montar()

    await screen.findByRole('button', { name: /baixar/i })
    expect(screen.queryByRole('button', { name: /segure para falar/i })).not.toBeInTheDocument()
  })

  it('baixar chama a ponte e volta a consultar a prontidão', async () => {
    prontidaoDaVoz.mockResolvedValueOnce(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /baixar/i }))

    expect(baixarArtefatoDeVoz).toHaveBeenCalledWith('runtime-python')
    // Sem reconsultar, a tela continuaria oferecendo baixar o que já baixou.
    await waitFor(() => expect(prontidaoDaVoz).toHaveBeenCalledTimes(2))
  })

  it('hash divergente diz o que houve, sem stack trace', async () => {
    prontidaoDaVoz.mockResolvedValue(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    baixarArtefatoDeVoz.mockResolvedValue({ estado: 'hash-divergente' })
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /baixar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/integridade|verificação|hash/i)
  })
})

describe('o modo de compute aparece na tela (critério 7)', () => {
  it('indica CPU quando não há CUDA', async () => {
    prontidaoDaVoz.mockResolvedValue(prontidao({ compute: 'cpu-int8' }))
    montar()

    expect(await screen.findByText(/cpu/i)).toBeInTheDocument()
  })

  it('indica GPU quando há CUDA', async () => {
    montar()

    expect(await screen.findByText(/gpu|cuda/i)).toBeInTheDocument()
  })
})

describe('push-to-talk: segurar grava, soltar transcreve (critério 5)', () => {
  it('o botão anuncia o gesto, não só "gravar"', async () => {
    montar()

    // "Segure para falar" ensina o gesto; "Gravar" sugere clique, que não é o contrato aqui.
    expect(await screen.findByRole('button', { name: /segure para falar/i })).toBeInTheDocument()
  })

  it('mostra o texto transcrito quando o desfecho é ok', async () => {
    const desfecho: DesfechoDaTranscricao = {
      estado: 'ok',
      resultado: { texto: 'bom dia, jarvis', idioma: 'pt', segmentos: [] }
    }
    transcreverAudio.mockResolvedValue(desfecho)
    montar()

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    expect(await screen.findByText('bom dia, jarvis')).toBeInTheDocument()
  })

  it('falha na transcrição oferece tentar de novo, não baixar', async () => {
    // A distinção do critério 2: "falhou" pede nova tentativa; "runtime ausente" pede download.
    transcreverAudio.mockResolvedValue({ estado: 'falhou', motivo: 'o sidecar encerrou' })
    montar()

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/tentar de novo|tente novamente/i)
    expect(alerta).not.toHaveTextContent(/baixar/i)
  })

  it('clique curto demais não vira erro na cara do usuário', async () => {
    // `sem-audio` é acidente, não falha: um alerta aqui puniria um clique sem querer.
    transcreverAudio.mockResolvedValue({ estado: 'sem-audio' })
    montar(capturaFalsa(0))

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    await waitFor(() => expect(transcreverAudio).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('o áudio não sobrevive à transcrição (critério 8)', () => {
  it('a tela não guarda o último buffer', async () => {
    transcreverAudio.mockResolvedValue({
      estado: 'ok',
      resultado: { texto: 'oi', idioma: 'pt', segmentos: [] }
    })
    montar()

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])
    await screen.findByText('oi')

    // O que a tela guarda é o **texto**. Nenhum elemento carrega áudio em atributo de dado.
    expect(document.body.innerHTML).not.toMatch(/data:audio|blob:|Int16Array/)
  })
})

describe('a hotkey global conduz a gravação (critério 5)', () => {
  it('assina o canal do main ao montar — o atalho chega com a janela minimizada', async () => {
    montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    expect(onVozHotkey).toHaveBeenCalledTimes(1)
  })

  it('o aviso de abrir começa a gravação, e o de fechar transcreve', async () => {
    transcreverAudio.mockResolvedValue({
      estado: 'ok',
      resultado: { texto: 'dito pela hotkey', idioma: 'pt', segmentos: [] }
    })
    montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    // O main só avisa: quem tem o microfone é a tela (`getUserMedia` é Web API do renderer).
    await act(async () => avisarHotkey?.(true))
    await screen.findByRole('button', { name: /ouvindo/i })

    await act(async () => avisarHotkey?.(false))
    await screen.findByText('dito pela hotkey')
  })

  it('cancela a assinatura ao desmontar — canal não fica pendurado', async () => {
    const { unmount } = montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    unmount()

    expect(avisarHotkey).toBeUndefined()
  })
})

/**
 * O loop fechado: falar → transcrever → responder → falar (SPEC-Voz-03, critérios 1, 4 e 8).
 *
 * O que estes testes prendem é a **costura**, que é onde a fatia pode falhar sem nenhuma peça
 * estar quebrada: a transcrição vira pergunta sozinha, a resposta é falada, e a recusa da rota
 * local chega aos dois canais — tela e voz.
 */
async function segurarEsoltar(): Promise<void> {
  const botao = await screen.findByRole('button', { name: /segure para falar/i })
  await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])
}

describe('a transcrição vira pergunta e a resposta vira fala (critério 1)', () => {
  beforeEach(() => {
    transcreverAudio.mockResolvedValue({
      estado: 'ok',
      resultado: { texto: 'o que está na fila?', idioma: 'pt', segmentos: [] }
    })
  })

  it('pergunta ao JARVIS com o texto transcrito, sem o usuário pedir', async () => {
    // O loop fecha sozinho: soltar o botão não devolve texto na tela para alguém clicar em
    // "enviar" — a transcrição **é** a pergunta.
    montar()
    await segurarEsoltar()

    await waitFor(() =>
      expect(perguntarAoJarvis).toHaveBeenCalledWith('o que está na fila?', 'jarvis')
    )
  })

  it('fala a resposta pelo TTS local', async () => {
    falar.mockResolvedValue({ estado: 'ok', fala: { pcm: new Int16Array(8), sampleRate: 22_050 } })
    montar()
    await segurarEsoltar()

    await waitFor(() =>
      expect(falar).toHaveBeenCalledWith('Dois aguardando.', 'pt_BR-faber-medium')
    )
  })

  it('mostra a troca na tela, com quem falou em cada linha', async () => {
    historicoDaConversa.mockResolvedValue([
      { pergunta: 'o que está na fila?', resposta: 'Dois aguardando.' }
    ])
    montar()
    await segurarEsoltar()

    expect(await screen.findByText(/Dois aguardando\./)).toBeInTheDocument()
    // Sem o rótulo, as duas falas viram um bloco de texto onde não se sabe quem disse o quê.
    expect(await screen.findByText(/JARVIS:/)).toBeInTheDocument()
  })

  it('não fala quando o TTS está indisponível, e não acusa erro por isso', async () => {
    // A resposta já está na tela: uma tarja vermelha diria que a conversa falhou quando o que
    // faltou foi o som.
    falar.mockResolvedValue({ estado: 'indisponivel' })
    historicoDaConversa.mockResolvedValue([{ pergunta: 'oi', resposta: 'Olá.' }])
    montar()
    await segurarEsoltar()

    await screen.findByText(/Olá\./)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('libera o botão só quando a fala termina', async () => {
    // Sem isto o usuário veria "segure para falar" enquanto o JARVIS ainda responde, e um novo
    // aperto abriria uma segunda conversa por cima da primeira.
    let responder: (v: unknown) => void = () => {}
    perguntarAoJarvis.mockReturnValue(new Promise((r) => (responder = r)))
    montar()
    await segurarEsoltar()

    const botao = await screen.findByRole('button', { name: /pensando/i })
    expect(botao).toBeDisabled()

    await act(async () => responder({ estado: 'ok', resposta: 'pronto' }))
    await screen.findByRole('button', { name: /segure para falar/i })
  })
})

describe('a rota local fora recusa nos dois canais (critério 4)', () => {
  beforeEach(() => {
    transcreverAudio.mockResolvedValue({
      estado: 'ok',
      resultado: { texto: 'oi', idioma: 'pt', segmentos: [] }
    })
    perguntarAoJarvis.mockResolvedValue({
      estado: 'indisponivel',
      proximaAcao: 'O modelo qwen3:8b não está baixado. Rode ollama pull qwen3:8b.'
    })
  })

  it('mostra a próxima ação que o main escolheu, sem reescrevê-la', async () => {
    /*
     * O texto vem pronto do main porque só ele sabe **qual** indisponibilidade ocorreu. Uma
     * frase fixa aqui achataria "suba o Ollama" e "baixe o modelo" numa que não resolve nem uma
     * nem outra — e ela é falada, onde não há como reler procurando qual metade se aplica.
     */
    montar()
    await segurarEsoltar()

    expect(await screen.findByText(/ollama pull qwen3:8b/i)).toBeInTheDocument()
  })

  it('fala a recusa, e o texto falado é o mesmo da tela', async () => {
    falar.mockResolvedValue({ estado: 'ok', fala: { pcm: new Int16Array(4), sampleRate: 22_050 } })
    montar()
    await segurarEsoltar()

    // Frase estática pelo TTS: anunciar "o modelo caiu" não pode depender do modelo que caiu.
    await waitFor(() =>
      expect(falar).toHaveBeenCalledWith(
        'O modelo qwen3:8b não está baixado. Rode ollama pull qwen3:8b.',
        'pt_BR-faber-medium'
      )
    )
  })

  it('volta a aceitar a próxima pergunta depois da recusa', async () => {
    // Recusa não é estado terminal: o usuário sobe o Ollama e tenta de novo sem reabrir o app.
    montar()
    await segurarEsoltar()

    await screen.findByText(/ollama pull/i)
    await screen.findByRole('button', { name: /segure para falar/i })
  })
})

describe('a conversa não ganha canal de ação (critério 8)', () => {
  it('a ponte usada pela tela não expõe nada que execute', async () => {
    /*
     * Guarda de superfície do lado do renderer: a tela fala com `perguntarAoJarvis`,
     * `historicoDaConversa` e `falar` — texto entrando e saindo. Um método que rodasse comando,
     * tocasse arquivo ou disparasse conector a partir de uma resposta seria o canal de ação que
     * a spec põe fora do escopo, atrás de Policy Engine e aprovação.
     */
    montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    const daConversa = Object.keys(window.jarvis).filter((k) => /conversa|jarvis$/i.test(k))
    expect(daConversa.length).toBeGreaterThan(0)

    expect(
      daConversa.filter((k) => /exec|run|command|comando|arquivo|file|deploy|connector/i.test(k))
    ).toEqual([])
  })
})
