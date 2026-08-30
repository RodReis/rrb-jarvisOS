import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoadmapDoProjeto } from './RoadmapDoProjeto'

/**
 * O roadmap e o centro de aprovações (SPEC-Planejamento-06, categoria Tela).
 *
 * O que este nível protege e nenhum outro protege:
 *  - **gerar e aprovar são dois atos** — não existe botão que faça os dois;
 *  - **o gate mostra o que cobre antes do aceite**: aprovar sem ver o que se aprova é o clique
 *    automático que o critério 5 existe para não ensinar;
 *  - **a revisão já aprovada não convida a reaprovar** (critério 5 na tela);
 *  - **não há campo de identidade**: quem aprova vem da sessão no main.
 */

const carregarRoadmap = vi.fn()
const listarAprovacoes = vi.fn()
const revisoesDoGate = vi.fn()
const gerarRoadmap = vi.fn()
const aprovarGate = vi.fn()
const sendLog = vi.fn()

const REVISOES = [
  { artefato: 'docs/PRD.md', hash: 'a'.repeat(64) },
  { artefato: 'docs/ARCHITECTURE.md', hash: 'b'.repeat(64) }
]

/**
 * O dublê realista: **cada gate cobre artefatos próprios**, como no serviço. Devolver o mesmo
 * conjunto para os três duplicaria cada artefato na tela — e o teste passaria a medir o dublê em
 * vez do produto.
 */
function revisoesPorGate(_projectId: string, gate: string): Promise<unknown> {
  if (gate === 'PROJECT_PACKAGE') return Promise.resolve(REVISOES)
  if (gate === 'MVP_ENTRY') return Promise.resolve([{ artefato: 'm1', hash: 'c'.repeat(64) }])
  return Promise.resolve([{ artefato: 'docs/spec/spec-x.md', hash: 'd'.repeat(64) }])
}

function roadmapCheio(): Record<string, unknown> {
  return {
    mvps: [
      {
        id: 'm1',
        numero: 1,
        titulo: 'Cadastro de cliente',
        tese: 'Entregar a jornada de ponta a ponta.',
        estado: 'proposto',
        dependeDe: [],
        origem: { tipo: 'decisao', decisaoId: 'd', perguntaId: 'escopo' }
      },
      {
        id: 'm2',
        numero: 2,
        titulo: 'Relatórios',
        tese: 'Entregar a jornada de ponta a ponta.',
        estado: 'na-fila',
        dependeDe: ['m1'],
        origem: { tipo: 'decisao', decisaoId: 'd', perguntaId: 'escopo' }
      }
    ],
    slices: [
      {
        id: 's1',
        mvpId: 'm1',
        numero: 1,
        titulo: 'Cadastro de cliente',
        specSlug: 'docs/spec/spec-cadastro-01-cadastro.md',
        detalhada: true,
        origem: { tipo: 'decisao', decisaoId: 'd', perguntaId: 'escopo' }
      }
    ]
  }
}

function renderizar(): void {
  render(<RoadmapDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Projeto Alfa" />)
}

beforeEach(() => {
  carregarRoadmap.mockReset().mockResolvedValue({ mvps: [], slices: [] })
  listarAprovacoes.mockReset().mockResolvedValue([])
  revisoesDoGate.mockReset().mockResolvedValue([])
  gerarRoadmap.mockReset()
  aprovarGate.mockReset()
  sendLog.mockReset()

  Object.defineProperty(window, 'jarvis', {
    value: {
      carregarRoadmap,
      listarAprovacoes,
      revisoesDoGate,
      gerarRoadmap,
      aprovarGate,
      sendLog
    },
    configurable: true,
    writable: true
  })
})

describe('gerar o roadmap', () => {
  it('pede a geração ao main', async () => {
    const usuario = userEvent.setup()
    gerarRoadmap.mockResolvedValue({ reason: 'gerado', mensagem: 'Roadmap gerado e commitado.' })

    renderizar()
    await screen.findByRole('button', { name: 'Gerar roadmap' })

    await usuario.click(screen.getByRole('button', { name: 'Gerar roadmap' }))

    await waitFor(() => expect(gerarRoadmap).toHaveBeenCalledWith('p-1', 'jarvis'))
  })

  /** "Há um ciclo" não é acionável: o PI precisa saber qual. */
  it('mostra os problemas do DAG nomeados', async () => {
    const usuario = userEvent.setup()
    gerarRoadmap.mockResolvedValue({
      reason: 'dag-invalido',
      mensagem: 'O roadmap composto tem dependências inválidas.',
      problemas: [{ mensagem: 'Ciclo de dependência: A → B → A.' }]
    })

    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Gerar roadmap' }))

    expect(await screen.findByText('Ciclo de dependência: A → B → A.')).toBeInTheDocument()
  })

  it('mostra a recusa por falta de base sem tom de erro', async () => {
    const usuario = userEvent.setup()
    gerarRoadmap.mockResolvedValue({
      reason: 'sem-base',
      mensagem: 'Nenhuma jornada prototipada. Anexe protótipos antes de gerar o roadmap.'
    })

    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Gerar roadmap' }))

    expect(await screen.findByText(/Anexe protótipos/)).toBeInTheDocument()
  })

  it('com roadmap existente, o botão passa a dizer regerar', async () => {
    carregarRoadmap.mockResolvedValue(roadmapCheio())

    renderizar()

    expect(await screen.findByRole('button', { name: 'Regerar roadmap' })).toBeInTheDocument()
  })
})

describe('o mapa', () => {
  beforeEach(() => {
    carregarRoadmap.mockResolvedValue(roadmapCheio())
  })

  it('mostra os MVPs com estado em texto, não só cor', async () => {
    renderizar()

    expect(await screen.findByText(/1. Cadastro de cliente/)).toBeInTheDocument()
    expect(screen.getByText('Proposto')).toBeInTheDocument()
    expect(screen.getByText('Na fila')).toBeInTheDocument()
  })

  it('mostra as dependências pelo título, não pelo id', async () => {
    renderizar()

    expect(await screen.findByText(/Depende de: Cadastro de cliente/)).toBeInTheDocument()
  })

  it('mostra a fatia com a SPEC e a marca de detalhada', async () => {
    renderizar()

    expect(await screen.findByText('docs/spec/spec-cadastro-01-cadastro.md')).toBeInTheDocument()
    expect(screen.getByText('SPEC detalhada')).toBeInTheDocument()
  })
})

describe('o centro de aprovações', () => {
  it('mostra os três gates', async () => {
    renderizar()

    expect(await screen.findByText('PROJECT_PACKAGE')).toBeInTheDocument()
    expect(screen.getByText('MVP_ENTRY')).toBeInTheDocument()
    expect(screen.getByText('SLICE_ENTRY')).toBeInTheDocument()
  })

  /**
   * Aprovar sem ver o que se aprova é o clique automático que o critério 5 existe para não
   * ensinar. As revisões ficam à vista, não atrás de um "detalhes".
   */
  it('mostra as revisões com hash antes do botão de aprovar', async () => {
    revisoesDoGate.mockImplementation(revisoesPorGate)

    renderizar()

    expect(await screen.findByText('docs/PRD.md')).toBeInTheDocument()
    const hash = screen.getByLabelText(`Hash completo: ${'a'.repeat(64)}`)
    expect(hash).toHaveTextContent('a'.repeat(12))
  })

  it('desabilita aprovar quando o gate não tem o que aprovar', async () => {
    renderizar()

    await screen.findByText('PROJECT_PACKAGE')
    expect(screen.getAllByRole('button', { name: 'Aprovar' })[0]).toBeDisabled()
    expect(screen.getAllByText('Nada a aprovar ainda neste gate.').length).toBeGreaterThan(0)
  })

  it('aprova o gate pelo canal, sem mandar identidade', async () => {
    const usuario = userEvent.setup()
    revisoesDoGate.mockImplementation(revisoesPorGate)
    aprovarGate.mockResolvedValue({ reason: 'aprovado', mensagem: 'Aprovado.' })

    renderizar()
    await screen.findByText('docs/PRD.md')

    await usuario.click(screen.getAllByRole('button', { name: 'Aprovar' })[0]!)

    // Três argumentos: projeto, gate e espaço. Quem aprova vem da sessão no main.
    await waitFor(() =>
      expect(aprovarGate).toHaveBeenCalledWith('p-1', 'PROJECT_PACKAGE', 'jarvis')
    )
  })

  /** Critério 5 na tela: a revisão já aprovada não convida a reaprovar. */
  it('marca como aprovado e desabilita quando a revisão já tem aceite', async () => {
    revisoesDoGate.mockImplementation(revisoesPorGate)
    listarAprovacoes.mockResolvedValue([
      {
        id: 'ap-1',
        user_id: 'u-1',
        workspace_id: 'jarvis',
        projectId: 'p-1',
        gate: 'PROJECT_PACKAGE',
        revisoes: REVISOES,
        identidade: 'pi@exemplo',
        autor: 'pi',
        created_at: '2026-08-30T10:00:00.000Z'
      }
    ])

    renderizar()

    expect(await screen.findByText('Aprovado')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Aprovar' })[0]).toBeDisabled()
    // E diz quem aprovou — é a pergunta que o critério 4 faz.
    expect(screen.getByText(/pi@exemplo/)).toBeInTheDocument()
  })

  it('mostra a recusa por falta de sessão com o que fazer', async () => {
    const usuario = userEvent.setup()
    revisoesDoGate.mockImplementation(revisoesPorGate)
    aprovarGate.mockResolvedValue({
      reason: 'sem-identidade',
      mensagem: 'Entre na sua conta para aprovar: a aprovação registra quem aceitou.'
    })

    renderizar()
    await screen.findByText('docs/PRD.md')

    await usuario.click(screen.getAllByRole('button', { name: 'Aprovar' })[0]!)

    expect(await screen.findByText(/Entre na sua conta/)).toBeInTheDocument()
  })

  it('não oferece campo de identidade nem de autor', async () => {
    revisoesDoGate.mockImplementation(revisoesPorGate)

    renderizar()
    await screen.findByText('docs/PRD.md')

    // Um campo aqui deixaria o renderer declarar quem aprovou.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
