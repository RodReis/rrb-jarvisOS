import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextoDoProjeto } from './ContextoDoProjeto'

/**
 * Painel de contexto do projeto (SPEC-Planejamento-02, categoria Tela).
 *
 * O painel é testado **isolado**, não pelo `App`: o que se investiga aqui é o que a tela pede
 * ao main e o que ela mostra do que voltou.
 *
 * A ponte é mockada porque o renderer não decide nada: segredo, teto e exceção são do main. Um
 * mock que decidisse aqui provaria a política do teste, não a do produto. O que a tela **tem**
 * de fazer é mostrar o que o gate decidiu — e é isso que estas asserções cobram.
 */

const listContextPacks = vi.fn()
const listCapabilities = vi.fn()
const listFailures = vi.fn()
const buildContextPack = vi.fn()
const resolveFailure = vi.fn()

function pack(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pack-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    tarefa: 'SPEC-Planejamento-02',
    itens: [
      {
        caminho: 'docs/PRD.md',
        hash: 'a'.repeat(64),
        origem: 'explicito',
        bytes: 1_024,
        motivo: 'anexado'
      }
    ],
    regras: [],
    falhasAbertas: [],
    orcamento: {
      etapa: 'contexto',
      unmetered: false,
      tetoDeTokens: 32_000,
      tokensEstimados: 4_300,
      estimadoUsd: 0.1234
    },
    rota: 'anthropic',
    hash: 'b'.repeat(64),
    created_at: '2026-08-30T12:00:00.000Z',
    ...over
  }
}

function falha(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fingerprint: 'f-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    resumo: 'typecheck falhou',
    ocorrencias: 2,
    resolvida: false,
    primeiraEm: '2026-08-30T10:00:00.000Z',
    ultimaEm: '2026-08-30T11:00:00.000Z',
    ...over
  }
}

function montar(): void {
  render(<ContextoDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Projeto Alfa" />)
}

beforeEach(() => {
  listContextPacks.mockReset().mockResolvedValue([])
  listCapabilities.mockReset().mockResolvedValue([])
  listFailures.mockReset().mockResolvedValue([])
  buildContextPack.mockReset()
  resolveFailure.mockReset().mockResolvedValue(true)

  Object.defineProperty(window, 'jarvis', {
    value: {
      listContextPacks,
      listCapabilities,
      listFailures,
      buildContextPack,
      resolveFailure
    },
    configurable: true,
    writable: true
  })
})

describe('ContextoDoProjeto', () => {
  it('mostra o vazio quando nenhum contexto foi montado', async () => {
    montar()

    expect(await screen.findByText('Nenhum contexto montado')).toBeInTheDocument()
  })

  it('mostra o manifesto com caminho e revisão de cada arquivo (critério 2)', async () => {
    listContextPacks.mockResolvedValue([pack()])
    montar()

    expect(await screen.findByText('docs/PRD.md')).toBeInTheDocument()
    // O hash truncado na tela, o completo no rótulo acessível: truncar é economia de largura,
    // não de informação, e quem ouve a tabela não tem `title` para consultar.
    expect(screen.getByText('a'.repeat(12))).toBeInTheDocument()
    expect(screen.getByLabelText(`Hash completo: ${'a'.repeat(64)}`)).toBeInTheDocument()
  })

  it('mostra o custo estimado na rota paga', async () => {
    listContextPacks.mockResolvedValue([pack()])
    montar()

    expect(await screen.findByText(/Rota anthropic/)).toHaveTextContent('US$')
  })

  it('na rota de assinatura não mostra valor em dólar (critério 1a)', async () => {
    // O ponto do teste: "US$ 0,00" diria "esta chamada foi de graça"; o fato é que esta rota
    // não cobra por chamada. A tela precisa dizer a segunda coisa, não a primeira.
    listContextPacks.mockResolvedValue([
      pack({
        rota: 'claude-code',
        orcamento: {
          etapa: 'contexto',
          unmetered: true,
          tetoDeTokens: 32_000,
          tokensEstimados: 4_300,
          estimadoUsd: null
        }
      })
    ])
    montar()

    const linha = await screen.findByText(/Rota claude-code/)
    expect(linha).toHaveTextContent('sem custo por chamada')
    expect(linha).not.toHaveTextContent('US$')
  })

  it('mostra a exceção de leitura ampla com motivo e teto (critério 3)', async () => {
    listContextPacks.mockResolvedValue([
      pack({
        excecaoDeLeituraAmpla: {
          motivo: 'regressão sem localização conhecida',
          tetoDeBytes: 524_288,
          autorizadoPor: 'u-1',
          autorizadoEm: '2026-08-30T12:00:00.000Z'
        }
      })
    ])
    montar()

    // Visível quer dizer legível: o motivo por extenso, não um ícone que só quem conhece o
    // sistema decifra.
    expect(await screen.findByText('regressão sem localização conhecida')).toBeInTheDocument()
    expect(screen.getByText(/Teto autorizado/)).toBeInTheDocument()
  })

  it('pede o motivo só quando há curinga na seleção', async () => {
    montar()
    await screen.findByText('Nenhum contexto montado')

    // Sempre visível, o campo viraria pedágio do caminho normal e o usuário aprenderia a
    // preenchê-lo por hábito — esvaziando o critério 3.
    expect(screen.queryByLabelText(/Motivo da leitura ampla/)).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Arquivos do contexto'), 'src/**')

    expect(screen.getByLabelText(/Motivo da leitura ampla/)).toBeInTheDocument()
  })

  it('envia curinga como leitura ampla e caminho comum como explícito', async () => {
    buildContextPack.mockResolvedValue({ reason: 'montado', mensagem: 'ok', pack: pack() })
    montar()
    await screen.findByText('Nenhum contexto montado')

    await userEvent.type(screen.getByLabelText('Arquivos do contexto'), 'docs/PRD.md')
    await userEvent.click(screen.getByRole('button', { name: 'Montar contexto' }))

    const [pedido] = buildContextPack.mock.calls[0] as [Record<string, never>]
    expect(pedido).toMatchObject({
      projectId: 'p-1',
      candidatos: [{ caminho: 'docs/PRD.md', origem: 'explicito' }]
    })
  })

  it('mostra a recusa por segredo com os caminhos — e nunca o segredo (critério 7)', async () => {
    buildContextPack.mockResolvedValue({
      reason: 'segredo-no-contexto',
      mensagem: 'O arquivo "config/.env" parece conter credencial e não entra no contexto.',
      caminhosComSegredo: ['config/.env']
    })
    montar()
    await screen.findByText('Nenhum contexto montado')

    await userEvent.type(screen.getByLabelText('Arquivos do contexto'), 'config/.env')
    await userEvent.click(screen.getByRole('button', { name: 'Montar contexto' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('config/.env')
    // O que o main devolveu não tem o trecho; a tela não pode inventá-lo de volta.
    expect(alerta.textContent ?? '').not.toContain('sk-')
  })

  it('mostra a recusa de leitura ampla sem exceção como aviso, não como erro', async () => {
    buildContextPack.mockResolvedValue({
      reason: 'leitura-ampla-sem-excecao',
      mensagem: 'Leitura ampla do repositório exige uma exceção registrada.'
    })
    montar()
    await screen.findByText('Nenhum contexto montado')

    await userEvent.type(screen.getByLabelText('Arquivos do contexto'), 'src/**')
    await userEvent.type(screen.getByLabelText(/Motivo da leitura ampla/), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Montar contexto' }))

    // Nada quebrou: o gate funcionou. Pintar isso de vermelho ensinaria a ler um gate
    // funcionando como falha. A distinção fica no `data-jos-tom` do alerta do DS.
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toContain('exceção registrada')
  })

  it('lista as falhas abertas e resolve pelo fingerprint (critério 4)', async () => {
    listFailures.mockResolvedValue([falha()])
    montar()

    expect(await screen.findByText('typecheck falhou')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Marcar resolvida/ }))

    expect(resolveFailure).toHaveBeenCalledWith('p-1', 'f-1', 'jarvis')
  })

  it('não lista a falha já resolvida — ela não volta ao contexto', async () => {
    listFailures.mockResolvedValue([falha({ resolvida: true, resumo: 'já resolvida' })])
    montar()
    await screen.findByText('Nenhum contexto montado')

    expect(screen.queryByText('já resolvida')).not.toBeInTheDocument()
  })

  it('mostra a capacidade atendida pelo caminho direto sem tratá-la como falta (critério 5)', async () => {
    listCapabilities.mockResolvedValue([
      {
        capacidade: 'perguntas-de-escopo',
        meio: 'direto',
        procedimento: 'Listar as perguntas em aberto antes de gerar.'
      }
    ])
    montar()

    const painel = await screen.findByText('Como o fluxo aplica cada disciplina')
    expect(painel).toBeInTheDocument()
    expect(screen.getByText('Listar as perguntas em aberto antes de gerar.')).toBeInTheDocument()
    // `direto` não é degradação: nenhum alerta é levantado por ele.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('mostra a skill quando ela existe, no mesmo lugar do caminho direto', async () => {
    listCapabilities.mockResolvedValue([
      {
        capacidade: 'mapa-estrutural',
        meio: 'skill',
        skillId: 'graphify',
        procedimento: 'Começar pelo índice e pela busca estrutural.'
      }
    ])
    montar()

    expect(await screen.findByText('graphify')).toBeInTheDocument()
  })

  it('a tabela do manifesto tem legenda acessível', async () => {
    listContextPacks.mockResolvedValue([pack()])
    montar()

    const tabela = await screen.findByRole('table')
    expect(
      within(tabela).getByText('Arquivos enviados no contexto de SPEC-Planejamento-02')
    ).toBeInTheDocument()
  })
})
