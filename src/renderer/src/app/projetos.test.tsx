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
      listarPacotes
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

  it('abre o contexto do projeto no próprio item, e o botão declara o estado', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto()])

    render(<ProjetosLocais workspace="jarvis" />)

    const abrir = await screen.findByRole('button', { name: /Abrir contexto de Projeto Alfa/ })
    // `aria-expanded` porque o botão alterna uma região desta mesma tela: sem ele, quem ouve
    // a interface não sabe se o painel abriu ou se a página mudou.
    expect(abrir).toHaveAttribute('aria-expanded', 'false')

    await usuario.click(abrir)

    expect(await screen.findByText('Contexto, skills e orçamento')).toBeInTheDocument()
    expect(listContextPacks).toHaveBeenCalledWith('p-1')
    expect(screen.getByRole('button', { name: 'Fechar contexto' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('mostra o contexto de um projeto por vez', async () => {
    const usuario = userEvent.setup()
    listProjects.mockResolvedValue([projeto(), projeto({ id: 'p-2', nome: 'Projeto Beta' })])

    render(<ProjetosLocais workspace="jarvis" />)

    await usuario.click(
      await screen.findByRole('button', { name: /Abrir contexto de Projeto Alfa/ })
    )
    await usuario.click(
      await screen.findByRole('button', { name: /Abrir contexto de Projeto Beta/ })
    )

    // Dois painéis abertos empurrariam a lista para fora da dobra e o usuário perderia a
    // coluna que veio varrer.
    expect(screen.getAllByText('Contexto, skills e orçamento')).toHaveLength(1)
  })
})
