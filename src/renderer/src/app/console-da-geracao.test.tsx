/**
 * O console da geração na tela (SPEC-Fases-03, critérios 1, 4, 6 e 7).
 *
 * A ponte é dublada — é a fronteira que este componente atravessa, e o que se prova aqui é a
 * **tela**: que a ordem do stream vira a ordem na tela, que o painel abre sozinho e continua
 * fechável, e que o histórico reabre a trilha gravada.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventoDaGeracao, GenerationEvent, GenerationTrace } from '@shared/domain/geracao'
import { ConsoleDaGeracao, agruparEmBlocos } from './ConsoleDaGeracao'

let emitir: ((payload: EventoDaGeracao) => void) | undefined
const cancelarAssinatura = vi.fn()
const historico = vi.fn<() => Promise<readonly GenerationTrace[]>>()
const eventosGravados = vi.fn<() => Promise<readonly GenerationEvent[]>>()

const TRACE: GenerationTrace = {
  id: 't1',
  projectId: 'p1',
  ledgerEntryId: 'call-1',
  etapa: 'refinamento',
  fase: 'planejamento',
  provider: 'claude-code',
  modelo: 'claude-fable-5-1',
  iniciadoEm: '2026-09-04T13:00:00.000Z',
  terminadoEm: '2026-09-04T13:00:20.000Z',
  status: 'concluido'
}

beforeEach(() => {
  emitir = undefined
  cancelarAssinatura.mockClear()
  historico.mockReset().mockResolvedValue([])
  eventosGravados.mockReset().mockResolvedValue([])

  vi.stubGlobal('jarvis', {
    onGenerationEvent: (ouvinte: (payload: EventoDaGeracao) => void) => {
      emitir = ouvinte
      return cancelarAssinatura
    },
    generationHistory: historico,
    generationEvents: eventosGravados
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderizar(): void {
  render(<ConsoleDaGeracao projectId="p1" workspace="jarvis" etapa="refinamento" />)
}

/** Emite um evento como o main o entregaria, e espera o React reagir. */
async function chega(evento: GenerationEvent, traceId = 't1'): Promise<void> {
  await waitFor(() => expect(emitir).toBeDefined())
  emitir?.({ traceId, evento })
}

describe('quando não há nada a mostrar', () => {
  it('não renderiza — uma etapa nunca gerada não tem trilha', async () => {
    renderizar()

    await waitFor(() => expect(historico).toHaveBeenCalled())
    expect(screen.queryByText('Console da geração')).not.toBeInTheDocument()
  })

  it('aparece quando a etapa tem geração anterior, mesmo sem nada correndo', async () => {
    // Esconder o histórico faria a evidência existir só durante os segundos da geração.
    historico.mockResolvedValue([TRACE])
    renderizar()

    expect(await screen.findByText('Console da geração')).toBeInTheDocument()
  })
})

describe('ao vivo (critérios 1 e 6)', () => {
  it('abre sozinho quando a geração começa', async () => {
    renderizar()
    await chega({ tipo: 'texto', delta: 'Paris' })

    const bloco = await screen.findByText('Console da geração')
    expect(bloco.closest('details')).toHaveAttribute('open')
  })

  it('continua fechável durante a geração', async () => {
    // A abertura automática dispara na **transição**, uma vez. Reabri-lo a cada evento tornaria
    // o painel impossível de fechar durante uma geração longa.
    renderizar()
    await chega({ tipo: 'texto', delta: 'primeiro' })

    const rotulo = await screen.findByText('Console da geração')
    await userEvent.click(rotulo)
    expect(rotulo.closest('details')).not.toHaveAttribute('open')

    await chega({ tipo: 'texto', delta: ' segundo' })
    await waitFor(() => expect(screen.getByText(/primeiro segundo/)).toBeInTheDocument())
    expect(rotulo.closest('details')).not.toHaveAttribute('open')
  })

  it('mostra o texto do modelo em fluxo, junto num parágrafo', async () => {
    // O modelo emite pedaços arbitrários; um `<p>` por evento quebraria a frase em confete.
    renderizar()
    await chega({ tipo: 'texto', delta: 'Paris é' })
    await chega({ tipo: 'texto', delta: ' a capital.' })

    expect(await screen.findByText('Paris é a capital.')).toBeInTheDocument()
  })

  it('mostra a ferramenta com nome, resumo e status', async () => {
    renderizar()
    await chega({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Read',
      resumoDoArgumento: '/tmp/a.ts'
    })

    expect(await screen.findByText('Read')).toBeInTheDocument()
    expect(screen.getByText('/tmp/a.ts')).toBeInTheDocument()

    await chega({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'conteúdo do arquivo',
      tamanhoOriginal: 19
    })

    expect(await screen.findByText('ok')).toBeInTheDocument()
  })

  it('a ferramenta que falhou é marcada como erro, não só colorida', async () => {
    renderizar()
    await chega({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Bash',
      resumoDoArgumento: 'npm test'
    })
    await chega({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'erro',
      resumoDoResultado: 'exit 1',
      tamanhoOriginal: 6
    })

    // Estado em texto: cor sozinha nunca comunica estado.
    expect(await screen.findByText('erro')).toBeInTheDocument()
  })

  it('o resultado fica colapsado e abre no clique', async () => {
    renderizar()
    await chega({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Read',
      resumoDoArgumento: '/tmp/a.ts'
    })
    await chega({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'linha do resultado',
      tamanhoOriginal: 18
    })

    // Antes do `ferramenta-fim` a linha não tem resultado e portanto não é colapsável — é só
    // uma linha. Quando o resultado chega, ela vira `Disclosure`, e o React **substitui** os
    // nós: reusar a referência de antes olharia para um elemento que saiu da árvore.
    //
    // O bloco é buscado pelo texto do resultado, e não pelo nome da ferramenta: o nome existe
    // desde o `ferramenta-inicio`, então esperar por ele devolve o `<details>` do painel
    // externo — que está aberto — em vez do da linha, que é o que este teste afirma.
    const bloco = await waitFor(() => {
      const alvo = screen.getByText('linha do resultado').closest('details')
      expect(alvo).not.toBeNull()
      return alvo as HTMLElement
    })

    expect(bloco).not.toHaveAttribute('open')

    await userEvent.click(screen.getByText('Read'))
    expect(bloco).toHaveAttribute('open')
    expect(within(bloco).getByText('linha do resultado')).toBeVisible()
  })

  it('avisa que o resultado é um resumo quando ele foi truncado (critério 4)', async () => {
    renderizar()
    await chega({
      tipo: 'ferramenta-inicio',
      chamadaId: 'c1',
      nome: 'Read',
      resumoDoArgumento: '/tmp/grande.log'
    })
    await chega({
      tipo: 'ferramenta-fim',
      chamadaId: 'c1',
      status: 'ok',
      resumoDoResultado: 'x'.repeat(2048),
      tamanhoOriginal: 5 * 1024 * 1024
    })

    await userEvent.click(await screen.findByText('Read'))

    expect(screen.getByText(/Resumo de 5[.,]0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/não é guardado/)).toBeInTheDocument()
  })

  it('mostra tokens e duração ao fechar', async () => {
    renderizar()
    await chega({ tipo: 'uso', tokensEntrada: 1200, tokensSaida: 340, duracaoMs: 2600 })

    expect(await screen.findByText(/1\.200 tokens de entrada/)).toBeInTheDocument()
    expect(screen.getByText(/340 de saída/)).toBeInTheDocument()
    expect(screen.getByText('2.6s')).toBeInTheDocument()
  })

  it('mostra o erro de parser sem derrubar o resto (critério 5)', async () => {
    renderizar()
    await chega({ tipo: 'texto', delta: 'antes' })
    await chega({ tipo: 'erro', mensagem: 'Uma linha do CLI não pôde ser interpretada.' })
    await chega({ tipo: 'texto', delta: ' depois' })

    expect(await screen.findByText(/não pôde ser interpretada/)).toBeInTheDocument()
    expect(screen.getByText('antes')).toBeInTheDocument()
    expect(screen.getByText('depois')).toBeInTheDocument()
  })

  it('geração nova limpa a trilha da anterior', async () => {
    renderizar()
    await chega({ tipo: 'texto', delta: 'da primeira' }, 't1')
    expect(await screen.findByText('da primeira')).toBeInTheDocument()

    await chega({ tipo: 'texto', delta: 'da segunda' }, 't2')

    expect(await screen.findByText('da segunda')).toBeInTheDocument()
    expect(screen.queryByText('da primeira')).not.toBeInTheDocument()
  })

  it('cancela a assinatura ao desmontar', async () => {
    const { unmount } = render(
      <ConsoleDaGeracao projectId="p1" workspace="jarvis" etapa="refinamento" />
    )
    await waitFor(() => expect(emitir).toBeDefined())

    unmount()

    expect(cancelarAssinatura).toHaveBeenCalled()
  })
})

describe('adapter sem ferramentas (critério 7)', () => {
  it('mostra só texto e uso, sem linha de ferramenta', async () => {
    renderizar()
    await chega({ tipo: 'texto', delta: 'resposta direta' })
    await chega({ tipo: 'uso', tokensEntrada: 10, tokensSaida: 20, duracaoMs: 300 })

    expect(await screen.findByText('resposta direta')).toBeInTheDocument()
    expect(screen.getByText(/10 tokens de entrada/)).toBeInTheDocument()
    expect(screen.queryByText('ok')).not.toBeInTheDocument()
  })
})

describe('histórico (critério 6)', () => {
  it('reabre a trilha gravada de uma geração anterior', async () => {
    historico.mockResolvedValue([TRACE])
    eventosGravados.mockResolvedValue([
      { tipo: 'texto', delta: 'texto de antes' },
      { tipo: 'ferramenta-inicio', chamadaId: 'c9', nome: 'Grep', resumoDoArgumento: 'padrão' }
    ])

    renderizar()
    await userEvent.click(await screen.findByText('Console da geração'))

    // O seletor lista a geração com data, modelo e desfecho — o suficiente para escolher.
    const gatilho = screen.getByRole('combobox', { name: /Geração/ })
    await userEvent.click(gatilho)
    await userEvent.click(await screen.findByText(/claude-fable-5-1 · concluída/))

    expect(await screen.findByText('texto de antes')).toBeInTheDocument()
    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(eventosGravados).toHaveBeenCalledWith('t1', 'jarvis')
  })

  it('a regeneração não apaga a anterior na lista', async () => {
    historico.mockResolvedValue([TRACE, { ...TRACE, id: 't0', ledgerEntryId: 'call-0' }])
    renderizar()

    await userEvent.click(await screen.findByText('Console da geração'))
    await userEvent.click(screen.getByRole('combobox', { name: /Geração/ }))

    expect(await screen.findAllByText(/claude-fable-5-1/)).toHaveLength(2)
  })
})

describe('agruparEmBlocos', () => {
  it('preserva a ordem entre texto e ferramenta (critério 1)', () => {
    const blocos = agruparEmBlocos([
      { tipo: 'texto', delta: 'vou ler' },
      { tipo: 'ferramenta-inicio', chamadaId: 'c1', nome: 'Read', resumoDoArgumento: '/a' },
      { tipo: 'texto', delta: 'li' }
    ])

    expect(blocos.map((b) => b.tipo)).toEqual(['texto', 'ferramenta', 'texto'])
  })

  it('junta texto consecutivo e separa o que vem depois de uma ferramenta', () => {
    const blocos = agruparEmBlocos([
      { tipo: 'texto', delta: 'a' },
      { tipo: 'texto', delta: 'b' },
      { tipo: 'ferramenta-inicio', chamadaId: 'c1', nome: 'Read', resumoDoArgumento: '/a' },
      { tipo: 'texto', delta: 'c' }
    ])

    expect(blocos[0]).toEqual({ tipo: 'texto', texto: 'ab' })
    expect(blocos[2]).toEqual({ tipo: 'texto', texto: 'c' })
  })

  it('o fim completa a linha que o início abriu, em vez de criar outra', () => {
    const blocos = agruparEmBlocos([
      { tipo: 'ferramenta-inicio', chamadaId: 'c1', nome: 'Read', resumoDoArgumento: '/a' },
      {
        tipo: 'ferramenta-fim',
        chamadaId: 'c1',
        status: 'ok',
        resumoDoResultado: 'saída',
        tamanhoOriginal: 5
      }
    ])

    expect(blocos).toHaveLength(1)
    expect(blocos[0]).toMatchObject({ tipo: 'ferramenta', nome: 'Read', status: 'ok' })
  })

  it('descarta o fim órfão — o teto de eventos pode ter cortado o início', () => {
    const blocos = agruparEmBlocos([
      {
        tipo: 'ferramenta-fim',
        chamadaId: 'sumiu',
        status: 'ok',
        resumoDoResultado: 'saída',
        tamanhoOriginal: 5
      }
    ])

    expect(blocos).toEqual([])
  })

  it('casa cada fim com o seu início quando há várias ferramentas em voo', () => {
    const blocos = agruparEmBlocos([
      { tipo: 'ferramenta-inicio', chamadaId: 'c1', nome: 'Read', resumoDoArgumento: '/a' },
      { tipo: 'ferramenta-inicio', chamadaId: 'c2', nome: 'Grep', resumoDoArgumento: 'x' },
      {
        tipo: 'ferramenta-fim',
        chamadaId: 'c2',
        status: 'erro',
        resumoDoResultado: 'nada',
        tamanhoOriginal: 4
      }
    ])

    expect(blocos[0]).toMatchObject({ nome: 'Read' })
    expect(blocos[0]).not.toHaveProperty('status')
    expect(blocos[1]).toMatchObject({ nome: 'Grep', status: 'erro' })
  })
})
