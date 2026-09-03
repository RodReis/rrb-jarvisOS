import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjetosLocais } from './ProjetosLocais'

/**
 * Tela de projetos locais (SPEC-Planejamento-01, categoria Tela).
 *
 * O painel é testado **isolado**, não pelo `App`: o que se investiga aqui é o que a tela pede
 * ao main e o que ela mostra do que voltou — não a navegação, que já tem suíte própria.
 *
 * A ponte é mockada porque o renderer não decide nada: colisão, allowlist e Git são do main.
 * Um mock que decidisse aqui provaria a política do teste, não a do produto.
 */

const listProjects = vi.fn()
const createProject = vi.fn()
const importProject = vi.fn()
const pickProjectDirectory = vi.fn()
const renameProject = vi.fn()
const removeProject = vi.fn()
const addAllowedCommand = vi.fn()
// A tela passou a hospedar o painel de contexto (SPEC-Planejamento-02). Os mocks entram aqui
// porque o painel só monta quando o usuário o abre — e é justamente esse caminho que o teste
// abaixo exercita.
const listContextPacks = vi.fn()
const listCapabilities = vi.fn()
const listFailures = vi.fn()
// O painel do pacote (M8-F04) é filho do painel de contexto: abrir o contexto monta os dois, e
// sem este método o teste do contexto quebraria por falta de mock, não pelo que investiga.
const listarPacotes = vi.fn()
// Mesma razão, um nível abaixo: o painel de anexos (M8-F05) também é filho do de contexto, e
// monta junto. Sem os dois métodos, o teste do contexto quebraria por falta de mock.
const listarAnexos = vi.fn()
const listarArquiteturas = vi.fn()
// E o painel de roadmap (M8-F06), pelo mesmo motivo — a terceira vez que este mock cresce por
// um painel novo dentro do de contexto.
const carregarRoadmap = vi.fn()
const listarAprovacoes = vi.fn()
const revisoesDoGate = vi.fn()
// A jornada (SPEC-Jornada-01): o CTA de cada card vem do main, e a tela do projeto aberto lê o
// estado dele. Sem os dois, a lista monta com o rótulo genérico — que é o fallback testado
// abaixo, não um acidente.
const jornadaDeVarios = vi.fn()
const estadoDaJornada = vi.fn()

function projeto(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    nome: 'Projeto Alfa',
    slug: 'projeto-alfa',
    diretorio: 'C:/userData/projeto-alfa',
    origem: 'criado',
    gitPreexistente: false,
    created_at: '2026-08-29T12:00:00.000Z',
    ...over
  }
}

beforeEach(() => {
  listProjects.mockReset()
  createProject.mockReset()
  importProject.mockReset()
  pickProjectDirectory.mockReset()
  renameProject.mockReset()
  removeProject.mockReset()
  addAllowedCommand.mockReset()
  listContextPacks.mockReset().mockResolvedValue([])
  listCapabilities.mockReset().mockResolvedValue([])
  listFailures.mockReset().mockResolvedValue([])
  listarPacotes.mockReset().mockResolvedValue([])
  listarAnexos.mockReset().mockResolvedValue([])
  listarArquiteturas.mockReset().mockResolvedValue([])
  carregarRoadmap.mockReset().mockResolvedValue({ mvps: [], slices: [] })
  listarAprovacoes.mockReset().mockResolvedValue([])
  revisoesDoGate.mockReset().mockResolvedValue([])
  jornadaDeVarios.mockReset().mockResolvedValue([])
  estadoDaJornada.mockReset().mockResolvedValue(null)
  listProjects.mockResolvedValue([])

  Object.defineProperty(window, 'jarvis', {
    value: {
      listProjects,
      createProject,
      importProject,
      pickProjectDirectory,
      renameProject,
      removeProject,
      addAllowedCommand,
      listContextPacks,
      listCapabilities,
      listFailures,
      listarPacotes,
      listarAnexos,
      listarArquiteturas,
      carregarRoadmap,
      listarAprovacoes,
      revisoesDoGate,
      jornadaDeVarios,
      estadoDaJornada,
      // A ponte real sempre tem `sendLog`; aqui ele existe porque o caminho de falha **loga**,
      // e sem o método o próprio logger estouraria — mascarando a resiliência que se testa.
      sendLog: vi.fn()
    },
    configurable: true,
    writable: true
  })
})

describe('ProjetosLocais', () => {
  it('mostra o vazio quando ainda não há projeto', async () => {
    render(<ProjetosLocais workspace="jarvis" />)

    expect(await screen.findByText('Nenhum projeto ainda')).toBeInTheDocument()
  })

  it('lista projeto com o caminho e a origem', async () => {
    listProjects.mockResolvedValue([projeto({ origem: 'importado' })])

    render(<ProjetosLocais workspace="jarvis" />)

    expect(await screen.findByText('Projeto Alfa')).toBeInTheDocument()
    // O caminho aparece **inteiro**: é o que o usuário confere para saber onde o app escreveu.
    expect(screen.getByText('C:/userData/projeto-alfa')).toBeInTheDocument()
    expect(screen.getByText('Importado')).toBeInTheDocument()
  })

  it('cria o projeto pelo nome digitado e recarrega a lista', async () => {
    const usuario = userEvent.setup()
    createProject.mockResolvedValue({
      reason: 'criado',
      project: projeto(),
      mensagem: 'Projeto "Projeto Alfa" criado com Git local inicializado.'
    })
    listProjects.mockResolvedValueOnce([]).mockResolvedValue([projeto()])

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')

    await usuario.type(screen.getByRole('textbox'), 'Projeto Alfa')
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))

    // A tela não escolhe diretório: manda nome + espaço, e o main aplica o default.
    expect(createProject).toHaveBeenCalledWith('Projeto Alfa', 'jarvis')
    expect(await screen.findByText('Projeto Alfa')).toBeInTheDocument()
  })

  it('mostra a colisão sem apagar o nome digitado', async () => {
    const usuario = userEvent.setup()
    createProject.mockResolvedValue({
      reason: 'colisao',
      mensagem: 'Já existe um projeto chamado "Projeto Alfa" nesse lugar.',
      diretorioEmConflito: 'C:/userData/projeto-alfa'
    })

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')

    const campo = screen.getByRole('textbox')
    await usuario.type(campo, 'Projeto Alfa')
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))

    expect(
      await screen.findByText('Já existe um projeto chamado "Projeto Alfa" nesse lugar.')
    ).toBeInTheDocument()
    // O nome continua no campo: numa recusa é justamente o que o usuário vai ajustar.
    expect(campo).toHaveValue('Projeto Alfa')
  })

  it('importa a pasta escolhida no seletor do main', async () => {
    const usuario = userEvent.setup()
    pickProjectDirectory.mockResolvedValue('C:/repos/rrb-jarvisOS')
    importProject.mockResolvedValue({
      reason: 'importado',
      project: projeto({ origem: 'importado' }),
      mensagem: 'Projeto importado sem alterar o conteúdo existente.'
    })

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')

    await usuario.click(screen.getByRole('button', { name: 'Importar pasta' }))

    await waitFor(() =>
      expect(importProject).toHaveBeenCalledWith('C:/repos/rrb-jarvisOS', 'jarvis')
    )
  })

  it('não importa nem alerta quando o usuário cancela o seletor', async () => {
    const usuario = userEvent.setup()
    pickProjectDirectory.mockResolvedValue('')

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')

    await usuario.click(screen.getByRole('button', { name: 'Importar pasta' }))

    // Desistir não é erro a relatar: nada é chamado e nada aparece na tela.
    await waitFor(() => expect(pickProjectDirectory).toHaveBeenCalled())
    expect(importProject).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renomeia pelo campo inline do próprio item', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto()])
    renameProject.mockResolvedValue({
      reason: 'criado',
      project: projeto({ nome: 'Projeto Beta' }),
      mensagem: 'Projeto renomeado para "Projeto Beta".'
    })

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Projeto Alfa')

    await usuario.click(screen.getByRole('button', { name: 'Renomear Projeto Alfa' }))
    const campo = screen.getByRole('textbox', { name: 'Renomear Projeto Alfa' })
    await usuario.clear(campo)
    await usuario.type(campo, 'Projeto Beta')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(renameProject).toHaveBeenCalledWith('p-1', 'Projeto Beta', 'jarvis'))
  })

  it('pede confirmação antes de remover e diz que os arquivos ficam', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto()])
    removeProject.mockResolvedValue(true)

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Projeto Alfa')

    await usuario.click(screen.getByRole('button', { name: 'Remover Projeto Alfa da lista' }))

    // O aviso descreve o efeito real. Sem ele, o usuário suporia perda de arquivos e desistiria
    // de uma ação que é reversível por reimportação.
    expect(
      screen.getByText('Sai da lista; a pasta e o histórico Git continuam no disco.')
    ).toBeInTheDocument()
    // Um clique só não remove: o primeiro abre a confirmação.
    expect(removeProject).not.toHaveBeenCalled()

    await usuario.click(screen.getByRole('button', { name: 'Remover Projeto Alfa da lista' }))
    await waitFor(() => expect(removeProject).toHaveBeenCalledWith('p-1', 'jarvis'))
  })

  it('oferece a correção dentro do alerta quando o git não está permitido', async () => {
    const usuario = userEvent.setup()
    createProject
      .mockResolvedValueOnce({
        reason: 'git-indisponivel',
        mensagem: 'O comando `git` não está permitido neste espaço.'
      })
      .mockResolvedValueOnce({
        reason: 'criado',
        project: projeto(),
        mensagem: 'Projeto criado com Git local inicializado.'
      })
    addAllowedCommand.mockResolvedValue(['git'])
    listProjects.mockResolvedValueOnce([]).mockResolvedValue([projeto()])

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')

    await usuario.type(screen.getByRole('textbox', { name: /nome do projeto/i }), 'Projeto Alfa')
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))

    // A correção mora **dentro** do alerta que a pede: um erro cuja instrução é "vá em outra
    // tela" transfere ao usuário o trabalho de achar o caminho.
    const alerta = await screen.findByRole('alert')
    const permitir = within(alerta).getByRole('button', { name: /permitir/i })

    await usuario.click(permitir)

    // Permite pelo canal auditado **e** retoma a criação: permitir sem retomar deixaria o
    // usuário com um alerta resolvido e nenhum projeto.
    await waitFor(() => expect(addAllowedCommand).toHaveBeenCalledWith('git', 'jarvis'))
    expect(createProject).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Projeto Alfa')).toBeInTheDocument()
  })

  it('não oferece o botão de permitir em erro que não é do git', async () => {
    const usuario = userEvent.setup()
    createProject.mockResolvedValue({
      reason: 'colisao',
      mensagem: 'Já existe um projeto com esse nome.'
    })

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')

    await usuario.type(screen.getByRole('textbox', { name: /nome do projeto/i }), 'Projeto Alfa')
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))

    // A correção é específica do desfecho. Oferecer "permitir git" numa colisão sugeriria que a
    // permissão resolve algo que ela não resolve.
    const alerta = await screen.findByRole('alert')
    expect(within(alerta).queryByRole('button', { name: /permitir/i })).not.toBeInTheDocument()
  })

  it('nunca submete comando — nem no caminho que permite o git', async () => {
    const usuario = userEvent.setup()
    const runCommand = vi.fn()
    Object.defineProperty(window, 'jarvis', {
      value: {
        listProjects,
        createProject,
        importProject,
        pickProjectDirectory,
        renameProject,
        removeProject,
        addAllowedCommand,
        runCommand
      },
      configurable: true,
      writable: true
    })

    createProject.mockResolvedValue({
      reason: 'git-indisponivel',
      mensagem: 'O comando `git` não está permitido neste espaço.'
    })
    addAllowedCommand.mockResolvedValue(['git'])

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Nenhum projeto ainda')
    await usuario.type(screen.getByRole('textbox', { name: /nome do projeto/i }), 'Projeto Alfa')
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))
    await usuario.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: /permitir/i })
    )

    // A garantia estrutural da fatia, afirmada pelo que a tela **chama**, não pelo texto dos
    // rótulos. A versão anterior varria os botões procurando a palavra "git" — e passava por
    // acidente, porque só rodava no estado sem erro. Agora existe um botão legítimo com "git"
    // no rótulo, e o que continua proibido é outra coisa: a tela pede *projeto* e *permissão*,
    // nunca um comando. Um `runCommand` aqui seria o segundo caminho de escrita de repositório
    // que a decisão 2 do PI proíbe.
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('mostra um CTA por projeto, com o rótulo da etapa (critério 3)', async () => {
    listProjects.mockResolvedValue([projeto()])
    jornadaDeVarios.mockResolvedValue([
      {
        projectId: 'p-1',
        etapa: 'prompt',
        cta: 'Escrever o prompt',
        trilha: [],
        motivoDaRegressao: null,
        recalculada: false
      }
    ])

    render(<ProjetosLocais workspace="jarvis" />)

    // O rótulo vem da etapa, não de um "Abrir" genérico: o card diz o próximo passo sem que o
    // PI precise entrar para descobrir qual é.
    //
    // `waitFor` e não uma leitura única: o card monta com o rótulo de fallback e recebe o CTA
    // quando a jornada chega. Afirmar no primeiro render testaria o instante errado — e passaria
    // ou falharia conforme a máquina estivesse mais ou menos carregada.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Abrir Projeto Alfa/ })).toHaveTextContent(
        'Escrever o prompt'
      )
    )
    expect(jornadaDeVarios).toHaveBeenCalledWith(['p-1'], 'jarvis')
  })

  it('pede as jornadas numa chamada só, não uma por card', async () => {
    listProjects.mockResolvedValue([projeto(), projeto({ id: 'p-2', nome: 'Projeto Beta' })])

    render(<ProjetosLocais workspace="jarvis" />)

    await screen.findByText('Projeto Beta')

    // Uma viagem pela ponte por tela, não por item: a leitura recalcula a etapa, e o custo se
    // multiplicaria junto com a lista.
    await waitFor(() => expect(jornadaDeVarios).toHaveBeenCalledTimes(1))
    expect(jornadaDeVarios).toHaveBeenCalledWith(['p-1', 'p-2'], 'jarvis')
  })

  it('a lista sobrevive a uma ponte sem o canal da jornada', async () => {
    // A exceção é **síncrona**: uma ponte sem o método lança antes de existir promise, e um
    // `.catch()` sozinho não a pegaria. Sem a guarda, o card perderia a tela inteira por causa
    // do rótulo de um botão.
    jornadaDeVarios.mockImplementation(() => {
      throw new TypeError('window.jarvis.jornadaDeVarios is not a function')
    })
    listProjects.mockResolvedValue([projeto()])

    render(<ProjetosLocais workspace="jarvis" />)

    expect(await screen.findByText('Projeto Alfa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir Projeto Alfa/ })).toBeInTheDocument()
  })

  it('abrir o projeto troca o índice pela jornada, e voltar desfaz', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto()])
    estadoDaJornada.mockResolvedValue({
      projectId: 'p-1',
      etapa: 'prompt',
      cta: 'Escrever o prompt',
      trilha: [
        {
          etapa: 'prompt',
          posicao: 'atual',
          cta: 'Escrever o prompt',
          oQueFalta: null,
          acionavel: true
        },
        {
          etapa: 'refinamento',
          posicao: 'futura',
          cta: 'Responder o refinamento',
          oQueFalta: 'Conclua "Escrever o prompt" para chegar aqui.',
          acionavel: false
        }
      ],
      motivoDaRegressao: null,
      recalculada: false
    })

    render(<ProjetosLocais workspace="jarvis" />)

    await usuario.click(await screen.findByRole('button', { name: /Abrir Projeto Alfa/ }))

    // O índice sai de cena: mantê-lo montado custaria a consulta das jornadas a cada mudança
    // na tela do projeto, para desenhar algo que ninguém está vendo.
    expect(await screen.findByText('Prompt inicial')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Criar projeto' })).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Voltar aos projetos' }))

    expect(await screen.findByRole('button', { name: 'Criar projeto' })).toBeInTheDocument()
  })

  it('etapa futura não oferece ação e diz o que falta (critério 4)', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto()])
    estadoDaJornada.mockResolvedValue({
      projectId: 'p-1',
      etapa: 'prompt',
      cta: 'Escrever o prompt',
      trilha: [
        {
          etapa: 'prompt',
          posicao: 'atual',
          cta: 'Escrever o prompt',
          oQueFalta: null,
          acionavel: true
        },
        {
          etapa: 'refinamento',
          posicao: 'futura',
          cta: 'Responder o refinamento',
          oQueFalta: 'Conclua "Escrever o prompt" para chegar aqui.',
          acionavel: false
        }
      ],
      motivoDaRegressao: null,
      recalculada: false
    })

    render(<ProjetosLocais workspace="jarvis" />)
    await usuario.click(await screen.findByRole('button', { name: /Abrir Projeto Alfa/ }))

    await screen.findByText('Prompt inicial')

    // Ausência, não desabilitação: um alvo morto em cada linha futura seria ruído. E o que
    // falta é **dito**, porque a etapa futura ainda precisa se explicar.
    expect(
      screen.queryByRole('button', { name: 'Responder o refinamento' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Conclua "Escrever o prompt" para chegar aqui.')).toBeInTheDocument()
  })

  it('a trilha mostra o motivo quando a jornada regrediu (critério 7)', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto()])
    estadoDaJornada.mockResolvedValue({
      projectId: 'p-1',
      etapa: 'prd',
      cta: 'Gerar o PRD',
      trilha: [
        { etapa: 'prd', posicao: 'atual', cta: 'Gerar o PRD', oQueFalta: null, acionavel: true }
      ],
      motivoDaRegressao: 'O PRD mudou semanticamente',
      recalculada: false
    })

    render(<ProjetosLocais workspace="jarvis" />)
    await usuario.click(await screen.findByRole('button', { name: /Abrir Projeto Alfa/ }))

    // O motivo aparece acima da trilha: o PI precisa saber por que a jornada andou para trás
    // antes de procurar onde ela parou.
    expect(await screen.findByText('O PRD mudou semanticamente')).toBeInTheDocument()
  })
})
