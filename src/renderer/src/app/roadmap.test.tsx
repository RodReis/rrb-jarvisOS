import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComTrilha } from './trilha-de-teste'
import { RoadmapDoProjeto } from './RoadmapDoProjeto'

/**
 * O roadmap gerado por IA e os dois gates (SPEC-Jornada-05, categoria Tela).
 *
 * O que este nível protege e nenhum outro protege:
 *  - **gerar, escolher e aprovar são três atos** — não existe botão que faça dois deles;
 *  - **só os MVPs elegíveis oferecem escolha** (critério 3), e os demais dizem por quê;
 *  - **a origem de cada MVP é texto, não cor** — é o que o PI lê antes de colocar na fila;
 *  - **as perguntas abertas aparecem antes da SPEC** e dizem que travam o aceite (critério 4);
 *  - **o gate mostra o que cobre antes do aceite**: aprovar sem ver o que se aprova é o clique
 *    automático que o critério 5 existe para não ensinar;
 *  - **não há campo de identidade**: quem aprova vem da sessão no main.
 */

const carregarRoadmapGerado = vi.fn()
const mvpsElegiveis = vi.fn()
const listarAprovacoes = vi.fn()
const revisoesDoGate = vi.fn()
const gerarRoadmapPorIa = vi.fn()
const escolherMvpDoRoadmap = vi.fn()
const responderPerguntaDaSpec = vi.fn()
const aprovarGate = vi.fn()
const aplicarEventoDaJornada = vi.fn()
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
  if (gate === 'MVP_ENTRY') return Promise.resolve([{ artefato: 'mvp-1', hash: 'c'.repeat(64) }])
  return Promise.resolve([{ artefato: 'docs/spec/spec-x.md', hash: 'd'.repeat(64) }])
}

const PERGUNTA = {
  id: 'p-1',
  enunciado: 'E-mail é obrigatório?',
  opcoes: [
    { id: 'a', rotulo: 'Sim, obrigatório', impacto: 'Todo cliente tem contato.' },
    { id: 'b', rotulo: 'Não, opcional', impacto: 'Cadastro mais rápido.' }
  ],
  recomendada: 'a',
  justificativa: 'O PRD fala em contatar o cliente depois.'
}

function roadmapGerado(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rev-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    pacoteEstruturalId: 'pac-1',
    arquiteturaId: 'arq-1',
    mvps: [
      {
        id: 'mvp-1',
        numero: 1,
        titulo: 'Cadastro de cliente',
        tese: 'Cadastrar, listar e editar clientes.',
        resultado: 'Um operador cadastra e encontra o cliente.',
        dependeDe: [],
        origem: 'prd',
        referencia: 'r-1',
        fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'prd', referencia: 'r-1' }]
      },
      {
        id: 'mvp-2',
        numero: 2,
        titulo: 'Relatórios',
        tese: 'Exportar o cadastrado.',
        resultado: 'O relatório do mês é baixado.',
        dependeDe: ['mvp-1'],
        origem: 'proposto',
        fatias: [{ id: 'f-2', numero: 1, titulo: 'Exportar CSV', origem: 'proposto' }]
      }
    ],
    mvpEscolhido: null,
    hash: 'h'.repeat(64),
    commitHash: null,
    contextPackId: null,
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  }
}

function comSpec(resposta?: string): Record<string, unknown> {
  return roadmapGerado({
    mvpEscolhido: 'mvp-1',
    spec: {
      fatiaId: 'f-1',
      titulo: 'Formulário',
      objetivo: 'Cadastrar um cliente.',
      fluxo: ['Abrir o formulário'],
      regras: ['Nome obrigatório'],
      criteriosDeAceite: ['Salvar sem nome mostra erro'],
      testes: ['Unitário da validação'],
      perguntas: [resposta === undefined ? PERGUNTA : { ...PERGUNTA, resposta }]
    }
  })
}

/**
 * Monta o painel **junto do botão que a trilha desenha** (#332, defeito 4).
 *
 * Aqui só a geração migrou: os aceites do roadmap são gates numa lista, cada linha com o próprio
 * estado, e continuam no painel — ver a nota em `onAcaoDaEtapa` de `RoadmapDoProjeto`.
 */
function renderizar(): void {
  render(
    <ComTrilha
      etapa="roadmap"
      painel={({ onAcaoDaEtapa, onOcupado }) => (
        <RoadmapDoProjeto
          workspace="jarvis"
          projectId="p-1"
          nomeDoProjeto="Projeto Alfa"
          etapa="roadmap"
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupado}
        />
      )}
    />
  )
}

beforeEach(() => {
  carregarRoadmapGerado.mockReset().mockResolvedValue(null)
  mvpsElegiveis.mockReset().mockResolvedValue([])
  listarAprovacoes.mockReset().mockResolvedValue([])
  revisoesDoGate.mockReset().mockResolvedValue([])
  gerarRoadmapPorIa.mockReset()
  escolherMvpDoRoadmap.mockReset()
  responderPerguntaDaSpec.mockReset()
  aprovarGate.mockReset()
  aplicarEventoDaJornada.mockReset().mockResolvedValue(null)
  sendLog.mockReset()

  Object.defineProperty(window, 'jarvis', {
    value: {
      carregarRoadmapGerado,
      mvpsElegiveis,
      listarAprovacoes,
      revisoesDoGate,
      gerarRoadmapPorIa,
      escolherMvpDoRoadmap,
      responderPerguntaDaSpec,
      aprovarGate,
      aplicarEventoDaJornada,
      sendLog
    },
    configurable: true,
    writable: true
  })
})

describe('gerar o roadmap', () => {
  it('pede a geração ao main', async () => {
    const usuario = userEvent.setup()
    gerarRoadmapPorIa.mockResolvedValue({ resultado: 'gerado', mensagem: 'Roadmap gerado.' })

    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Gerar o roadmap' }))

    expect(gerarRoadmapPorIa).toHaveBeenCalledWith('p-1', 'jarvis')
  })

  it('sem roadmap, o vazio diz de onde os MVPs nascem', async () => {
    renderizar()

    expect(await screen.findByText('Nenhum roadmap gerado ainda')).toBeInTheDocument()
  })

  it('a recusa por falta de rota chega como aviso, com a ação', async () => {
    const usuario = userEvent.setup()
    gerarRoadmapPorIa.mockResolvedValue({
      resultado: 'bloqueado-sem-rota',
      mensagem: 'A geração não aconteceu.',
      acao: 'Configure a assinatura.'
    })

    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Gerar o roadmap' }))

    expect(await screen.findByText('Nenhuma rota autorizada')).toBeInTheDocument()
    expect(screen.getByText('Configure a assinatura.')).toBeInTheDocument()
  })

  it('os problemas do validador aparecem um por linha', async () => {
    const usuario = userEvent.setup()
    gerarRoadmapPorIa.mockResolvedValue({
      resultado: 'saida-invalida',
      mensagem: 'Nada foi gravado.',
      problemas: ['Ciclo de dependência: A → B.', 'B depende de C, que não existe.']
    })

    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Gerar o roadmap' }))

    expect(await screen.findByText('Ciclo de dependência: A → B.')).toBeInTheDocument()
    expect(screen.getByText('B depende de C, que não existe.')).toBeInTheDocument()
  })

  it('com roadmap, o painel oferece "Gerar de novo" — e só ele', async () => {
    carregarRoadmapGerado.mockResolvedValue(roadmapGerado())

    renderizar()

    // A regra do PI (#332): o avanço mora na trilha, refazer mora no painel. Dois botões com o
    // mesmo nome, um do lado do outro, não dá — e "Regerar roadmap" era o nome divergente.
    expect(await screen.findByRole('button', { name: 'Gerar de novo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regerar roadmap' })).not.toBeInTheDocument()
  })

  it('sem roadmap, gerar é só o botão da trilha — o painel não duplica', async () => {
    renderizar()

    await screen.findByRole('button', { name: 'Gerar o roadmap' })
    expect(screen.queryByRole('button', { name: 'Gerar de novo' })).not.toBeInTheDocument()
  })
})

describe('os MVPs propostos e a escolha (critérios 2 e 3)', () => {
  beforeEach(() => {
    carregarRoadmapGerado.mockResolvedValue(roadmapGerado())
    mvpsElegiveis.mockResolvedValue([roadmapGerado().mvps as never].flat().slice(0, 1))
  })

  it('mostra a tese e o resultado, que são coisas diferentes', async () => {
    renderizar()

    expect(await screen.findByText('Cadastrar, listar e editar clientes.')).toBeInTheDocument()
    expect(
      screen.getByText('Resultado: Um operador cadastra e encontra o cliente.')
    ).toBeInTheDocument()
  })

  it('a origem é texto, e o proposto se distingue do ancorado', async () => {
    renderizar()
    await screen.findAllByText(/Cadastro de cliente/)

    expect(screen.getByText(/PRD · r-1/)).toBeInTheDocument()
    // O MVP inferido e a fatia dele: a origem aparece nos dois níveis, e é isso que o PI lê.
    expect(screen.getAllByText('Proposto pela IA').length).toBeGreaterThanOrEqual(2)
  })

  it('só o MVP elegível oferece o botão de escolha', async () => {
    renderizar()
    await screen.findAllByText(/Cadastro de cliente/)

    expect(
      screen.getByRole('button', { name: 'Colocar "Cadastro de cliente" na fila' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Colocar "Relatórios" na fila' })).toBeNull()
  })

  it('o MVP bloqueado diz por que não pode ser escolhido', async () => {
    renderizar()

    expect(
      await screen.findByText('Depende de um MVP que ainda não foi entregue.')
    ).toBeInTheDocument()
  })

  it('escolher manda o id ao main, não o conteúdo', async () => {
    const usuario = userEvent.setup()
    escolherMvpDoRoadmap.mockResolvedValue({ resultado: 'gerado', mensagem: 'ok' })

    renderizar()
    await usuario.click(
      await screen.findByRole('button', { name: 'Colocar "Cadastro de cliente" na fila' })
    )

    expect(escolherMvpDoRoadmap).toHaveBeenCalledWith('p-1', 'mvp-1', 'jarvis')
  })

  it('depois da escolha, nenhum MVP oferece trocar: desfazer aceite não é um clique', async () => {
    carregarRoadmapGerado.mockResolvedValue(comSpec())

    renderizar()
    await screen.findAllByText(/Cadastro de cliente/)

    expect(screen.queryByRole('button', { name: /na fila$/ })).toBeNull()
    expect(screen.getByText('Na fila')).toBeInTheDocument()
  })
})

describe('a SPEC e as perguntas abertas (critério 4)', () => {
  it('sem MVP escolhido, nenhuma SPEC aparece', async () => {
    carregarRoadmapGerado.mockResolvedValue(roadmapGerado())

    renderizar()
    await screen.findAllByText(/Cadastro de cliente/)

    expect(screen.queryByText(/^SPEC —/)).toBeNull()
  })

  it('a pergunta aberta diz que trava o aceite', async () => {
    carregarRoadmapGerado.mockResolvedValue(comSpec())

    renderizar()

    expect(await screen.findByText('1 decisões em aberto')).toBeInTheDocument()
    expect(screen.getByText(/não pode ser aceita enquanto houver pergunta/)).toBeInTheDocument()
  })

  it('cada opção mostra o impacto, e a recomendada vem marcada', async () => {
    carregarRoadmapGerado.mockResolvedValue(comSpec())

    renderizar()
    await screen.findByText('E-mail é obrigatório?')

    expect(screen.getByText('Todo cliente tem contato.')).toBeInTheDocument()
    expect(screen.getByText('Cadastro mais rápido.')).toBeInTheDocument()
    expect(screen.getByText('Recomendada')).toBeInTheDocument()
    expect(
      screen.getByText('Por que a recomendada: O PRD fala em contatar o cliente depois.')
    ).toBeInTheDocument()
  })

  it('responder manda o id da pergunta e da opção, nunca o enunciado', async () => {
    const usuario = userEvent.setup()
    carregarRoadmapGerado.mockResolvedValue(comSpec())
    responderPerguntaDaSpec.mockResolvedValue({ resultado: 'gerado', mensagem: 'ok' })

    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Escolher "Não, opcional"' }))

    expect(responderPerguntaDaSpec).toHaveBeenCalledWith('p-1', 'p-1', 'b', 'jarvis')
  })

  it('a opção escolhida vira selo, não botão', async () => {
    carregarRoadmapGerado.mockResolvedValue(comSpec('a'))

    renderizar()
    await screen.findByText('E-mail é obrigatório?')

    expect(screen.getByText('Escolhida')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escolher "Sim, obrigatório"' })).toBeNull()
  })

  it('respondida tudo, a tela diz que a SPEC pode ser aceita', async () => {
    carregarRoadmapGerado.mockResolvedValue(comSpec('a'))

    renderizar()

    expect(await screen.findByText('Todas as decisões foram tomadas')).toBeInTheDocument()
  })

  it('mostra as seções da SPEC gerada', async () => {
    carregarRoadmapGerado.mockResolvedValue(comSpec())

    renderizar()
    await screen.findByText('E-mail é obrigatório?')

    expect(screen.getByText('Critérios de aceite')).toBeInTheDocument()
    expect(screen.getByText('Salvar sem nome mostra erro')).toBeInTheDocument()
  })
})

describe('o centro de aprovações', () => {
  beforeEach(() => {
    carregarRoadmapGerado.mockResolvedValue(roadmapGerado())
    revisoesDoGate.mockImplementation(revisoesPorGate)
  })

  it('mostra o que cada gate cobre antes do botão', async () => {
    renderizar()

    expect(await screen.findByText('docs/PRD.md')).toBeInTheDocument()
    expect(screen.getByText('docs/ARCHITECTURE.md')).toBeInTheDocument()
    expect(screen.getByText('docs/spec/spec-x.md')).toBeInTheDocument()
  })

  it('aprovar manda só o gate: a identidade vem da sessão no main', async () => {
    const usuario = userEvent.setup()
    aprovarGate.mockResolvedValue({ reason: 'aprovado', mensagem: 'Aprovado.' })

    renderizar()
    const botoes = await screen.findAllByRole('button', { name: 'Aprovar' })
    await usuario.click(botoes[0]!)

    expect(aprovarGate).toHaveBeenCalledWith('p-1', 'PROJECT_PACKAGE', 'jarvis')
    expect(screen.queryByLabelText(/identidade/i)).toBeNull()
  })

  it('o aceite do MVP_ENTRY move a jornada pelo canal de evento', async () => {
    const usuario = userEvent.setup()
    aprovarGate.mockResolvedValue({ reason: 'aprovado', mensagem: 'Aprovado.' })

    renderizar()
    const botoes = await screen.findAllByRole('button', { name: 'Aprovar' })
    await usuario.click(botoes[1]!)

    await waitFor(() => {
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'mvp-aceito', 'jarvis')
    })
  })

  it('o aceite do SLICE_ENTRY move a jornada para spec-aceita', async () => {
    const usuario = userEvent.setup()
    aprovarGate.mockResolvedValue({ reason: 'aprovado', mensagem: 'Aprovado.' })

    renderizar()
    const botoes = await screen.findAllByRole('button', { name: 'Aprovar' })
    await usuario.click(botoes[2]!)

    await waitFor(() => {
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'spec-aceita', 'jarvis')
    })
  })

  /** Critério 5 na tela: a revisão já aprovada não convida a reaprovar. */
  it('gate já aprovado mostra o selo e desabilita o botão', async () => {
    listarAprovacoes.mockResolvedValue([
      {
        id: 'ap-1',
        gate: 'PROJECT_PACKAGE',
        revisoes: REVISOES,
        identidade: 'pi@exemplo',
        autor: 'pi',
        created_at: '2026-09-03T10:00:00.000Z'
      }
    ])

    renderizar()
    await screen.findByText('docs/PRD.md')

    expect(await screen.findByText('Aprovado')).toBeInTheDocument()
    expect(screen.getByText('Aprovado por pi@exemplo.')).toBeInTheDocument()
  })

  it('gate sem revisões diz que não há o que aprovar', async () => {
    revisoesDoGate.mockResolvedValue([])

    renderizar()

    const semObjeto = await screen.findAllByText('Nada a aprovar ainda neste gate.')
    expect(semObjeto.length).toBeGreaterThan(0)
  })

  it('a recusa da aprovação chega como conteúdo, não como erro técnico', async () => {
    const usuario = userEvent.setup()
    aprovarGate.mockResolvedValue({
      reason: 'sem-identidade',
      mensagem: 'Entre na sua conta para aprovar.'
    })

    renderizar()
    const botoes = await screen.findAllByRole('button', { name: 'Aprovar' })
    await usuario.click(botoes[0]!)

    expect(await screen.findByText('Entre na sua conta para aprovar.')).toBeInTheDocument()
  })
})
