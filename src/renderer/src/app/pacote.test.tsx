import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PacoteDoProjeto } from './PacoteDoProjeto'

/**
 * O painel do pacote estrutural (SPEC-Planejamento-04, categoria Tela).
 *
 * O painel é testado **isolado**, não pelo `App`: o que se investiga é o que a tela pede ao main
 * e o que ela mostra do que voltou.
 *
 * A ponte é mockada porque o renderer não decide nada — compor, pesquisar e bloquear são do
 * main. Um mock que decidisse aqui provaria a política do teste, não a do produto. O que a tela
 * **tem** de fazer é mostrar o bloqueio inteiro e nunca oferecer um jeito de escrever documento,
 * e é isso que estas asserções cobram.
 */

const gerarPacote = vi.fn()
const listarPacotes = vi.fn()

function pacote(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pac-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    documentos: [
      {
        documento: 'PRD',
        caminho: 'docs/PRD.md',
        conteudo: '# PRD',
        hash: 'a'.repeat(64),
        afirmacoes: [{ id: 'x', secao: 'Escopo', texto: 'y', origem: { tipo: 'decisao' } }]
      }
    ],
    hash: 'b'.repeat(64),
    commitHash: 'c0ffee1234',
    created_at: '2026-08-30T12:00:00.000Z',
    ...over
  }
}

function montar(): void {
  render(<PacoteDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Projeto Alfa" />)
}

beforeEach(() => {
  gerarPacote.mockReset()
  listarPacotes.mockReset().mockResolvedValue([])

  Object.defineProperty(window, 'jarvis', {
    // `sendLog` faz parte da ponte real e o caminho de falha o usa: sem ele no dublê, o teste
    // que exercita a falha de leitura quebraria por falta do mock, não pelo que investiga.
    value: { gerarPacote, listarPacotes, sendLog: vi.fn() },
    configurable: true,
    writable: true
  })
})

describe('a tela não escreve documento (critérios 1 e 5)', () => {
  it('não oferece campo de conteúdo — só o termo de pesquisa', async () => {
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')

    // Um único campo de texto, e ele é a consulta. Um editor aqui seria o caminho por onde
    // afirmação sem origem entraria.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByLabelText('Pesquisa de mercado')).toBeInTheDocument()
  })

  it('manda só projeto, consulta e workspace ao main', async () => {
    gerarPacote.mockResolvedValue({ reason: 'gerado', mensagem: 'Pacote gerado.' })
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')

    await userEvent.type(screen.getByLabelText('Pesquisa de mercado'), 'concorrentes')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }))

    expect(gerarPacote).toHaveBeenCalledWith('p-1', 'concorrentes', 'jarvis')
  })
})

describe('o bloqueio mostra os cinco campos da CONVENTION §4 (critério 3)', () => {
  const bloqueado = {
    reason: 'pesquisa-bloqueada',
    mensagem: 'Não foi possível concluir a busca de mercado.',
    bloqueio: {
      causa: 'credencial-ausente',
      evidencia: 'HTTP 401 da Tavily',
      tentativas: 1,
      porQueNaoSeguir: 'Seguir exigiria escrever o cenário sem fonte extraída.',
      retomada: 'Configure a chave da Tavily no Settings.'
    }
  }

  it('mostra causa, evidência, tentativas, porquê e retomada', async () => {
    gerarPacote.mockResolvedValue(bloqueado)
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')

    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }))

    expect(await screen.findByText('credencial-ausente')).toBeInTheDocument()
    expect(screen.getByText('HTTP 401 da Tavily')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(
      screen.getByText('Seguir exigiria escrever o cenário sem fonte extraída.')
    ).toBeInTheDocument()
    expect(screen.getByText('Configure a chave da Tavily no Settings.')).toBeInTheDocument()
  })

  it('o bloqueio permanece na tela — não é toast que some', async () => {
    gerarPacote.mockResolvedValue(bloqueado)
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')

    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }))
    await screen.findByText('credencial-ausente')

    // A ação de retomada continua legível depois de a interação terminar.
    expect(screen.getByText('Configure a chave da Tavily no Settings.')).toBeInTheDocument()
  })

  it('bloqueio não recarrega a lista — nada foi gerado', async () => {
    gerarPacote.mockResolvedValue(bloqueado)
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')
    listarPacotes.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }))
    await screen.findByText('credencial-ausente')

    expect(listarPacotes).not.toHaveBeenCalled()
  })
})

describe('decisões incompletas nomeiam o que falta (critério 1)', () => {
  it('lista as pendências em vez de mandar completar o wizard', async () => {
    gerarPacote.mockResolvedValue({
      reason: 'decisoes-incompletas',
      mensagem: 'Faltam decisões do planejamento: publico, superficie.',
      pendencias: ['publico', 'superficie']
    })
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')

    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }))

    expect(await screen.findByText('Faltam: publico, superficie.')).toBeInTheDocument()
  })
})

describe('a revisão gerada', () => {
  it('lista os três caminhos com hash e contagem de afirmações', async () => {
    listarPacotes.mockResolvedValue([pacote()])
    montar()

    expect(await screen.findByText('docs/PRD.md')).toBeInTheDocument()
    expect(screen.getByText('1 afirmações')).toBeInTheDocument()
    expect(screen.getByText('a'.repeat(12))).toBeInTheDocument()
  })

  it('o hash completo está no rótulo acessível', async () => {
    listarPacotes.mockResolvedValue([pacote()])
    montar()

    expect(await screen.findByLabelText(`Hash completo: ${'a'.repeat(64)}`)).toBeInTheDocument()
  })

  it('mostra o commit da revisão', async () => {
    listarPacotes.mockResolvedValue([pacote()])
    montar()

    expect(await screen.findByText('c0ffee12')).toBeInTheDocument()
  })

  it('avisa quando o pacote existe mas o commit falhou', async () => {
    listarPacotes.mockResolvedValue([pacote({ commitHash: null })])
    montar()

    expect(await screen.findByText('Sem commit')).toBeInTheDocument()
  })

  it('gerar com sucesso recarrega a lista', async () => {
    gerarPacote.mockResolvedValue({ reason: 'gerado', mensagem: 'Pacote gerado.' })
    montar()
    await screen.findByText('Nenhuma revisão gerada ainda.')
    listarPacotes.mockClear().mockResolvedValue([pacote()])

    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }))

    expect(await screen.findByText('docs/PRD.md')).toBeInTheDocument()
  })
})

describe('estados de borda', () => {
  it('mostra o vazio quando nenhuma revisão foi gerada', async () => {
    montar()

    expect(await screen.findByText('Nenhuma revisão gerada ainda.')).toBeInTheDocument()
  })

  it('falha ao listar não deixa a tela em branco', async () => {
    listarPacotes.mockRejectedValue(new Error('sem banco'))
    montar()

    expect(await screen.findByText('Nenhuma revisão gerada ainda.')).toBeInTheDocument()
  })
})
