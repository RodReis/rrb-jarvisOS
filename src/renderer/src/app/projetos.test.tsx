import { render, screen, waitFor } from '@testing-library/react'
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
  listProjects.mockResolvedValue([])

  Object.defineProperty(window, 'jarvis', {
    value: {
      listProjects,
      createProject,
      importProject,
      pickProjectDirectory,
      renameProject,
      removeProject
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

  it('não expõe nenhum controle de Git', async () => {
    listProjects.mockResolvedValue([projeto()])

    render(<ProjetosLocais workspace="jarvis" />)
    await screen.findByText('Projeto Alfa')

    // A garantia estrutural da fatia, verificada pela forma da tela: não há botão que peça
    // comando. Se alguém acrescentar um "Commit" aqui, este teste cai — e deve cair, porque
    // seria o segundo caminho de escrita de repositório que a decisão 2 do PI proíbe.
    for (const botao of screen.getAllByRole('button')) {
      expect(botao.textContent?.toLowerCase()).not.toContain('git')
      expect(botao.textContent?.toLowerCase()).not.toContain('commit')
    }
  })
})
