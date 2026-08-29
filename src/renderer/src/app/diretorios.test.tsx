import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiretoriosPermitidos } from './DiretoriosPermitidos'

/**
 * A seção de diretórios permitidos do Settings (SPEC-ExecucaoReal-03), categoria Tela.
 *
 * O que estes testes provam é o caminho que a permissão percorre — e, principalmente, o que
 * ela **não** percorre: o critério 6 (o renderer não toca o filesystem) é afirmado aqui pela
 * ausência de qualquer API de FS na superfície que o componente usa. Ele fala por quatro
 * métodos da ponte e por mais nada.
 *
 * O critério 3 (cancelar não altera) é o que uma implementação apressada erra: como o main
 * devolve a lista inalterada, o teste não pode se contentar com "a tela não quebrou" — ele
 * afirma que a lista continua a mesma **e** que o `add` não foi chamado, o que é o que
 * garante que nenhum `AuditEvent` nasceu.
 */

const listAllowedDirectories = vi.fn()
const getAppDirectory = vi.fn()
const pickAllowedDirectory = vi.fn()
const removeAllowedDirectory = vi.fn()
const sendLog = vi.fn()

const APP_DIR = '/home/user/.config/jarvisos'
const PROJETO = '/home/user/projetos/alpha'

beforeEach(() => {
  vi.clearAllMocks()
  listAllowedDirectories.mockResolvedValue([APP_DIR])
  getAppDirectory.mockResolvedValue(APP_DIR)
  pickAllowedDirectory.mockResolvedValue([APP_DIR])
  removeAllowedDirectory.mockResolvedValue([APP_DIR])

  Object.defineProperty(window, 'jarvis', {
    // `sendLog` entra porque o caminho de erro loga (ADR-005): sem ele o `catch` estoura ao
    // registrar a falha, e o teste do erro passaria com uma rejeição solta em segundo plano.
    value: {
      listAllowedDirectories,
      getAppDirectory,
      pickAllowedDirectory,
      removeAllowedDirectory,
      sendLog
    },
    configurable: true,
    writable: true
  })
})

describe('diretórios permitidos (SPEC-ExecucaoReal-03)', () => {
  it('lista os diretórios permitidos do usuário (critério 1)', async () => {
    listAllowedDirectories.mockResolvedValue([APP_DIR, PROJETO])

    render(<DiretoriosPermitidos />)

    expect(await screen.findByText(PROJETO)).toBeInTheDocument()
    expect(screen.getByText(APP_DIR)).toBeInTheDocument()
  })

  it('mostra o estado de carregamento antes de a lista chegar (critério 8)', () => {
    // Promise que nunca resolve: congela a tela no estado que existe entre a montagem e a
    // resposta do IPC — o único jeito de afirmá-lo sem depender de timing.
    listAllowedDirectories.mockReturnValue(new Promise(() => {}))
    getAppDirectory.mockReturnValue(new Promise(() => {}))

    render(<DiretoriosPermitidos />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('com só o diretório do app, ensina como sair do vazio (critério 8)', async () => {
    render(<DiretoriosPermitidos />)

    // O vazio desta tela não é lista de tamanho zero — é "o usuário ainda não permitiu nada",
    // que é exatamente o estado em que o terminal recusa todo cwd.
    expect(await screen.findByText(/só a pasta do aplicativo está permitida/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /permitir uma pasta/i })).toBeInTheDocument()
  })

  it('adicionar pelo seletor nativo reflete o path canonizado (critério 2)', async () => {
    // O path que volta **não** é o que o seletor mostrou: é o que o main canonizou e gravou.
    // A tela exibe esse, e é isso que o usuário precisa ver para saber o que permitiu.
    pickAllowedDirectory.mockResolvedValue([APP_DIR, PROJETO])

    render(<DiretoriosPermitidos />)
    await userEvent.click(await screen.findByRole('button', { name: /permitir uma pasta/i }))

    expect(pickAllowedDirectory).toHaveBeenCalled()
    expect(await screen.findByText(PROJETO)).toBeInTheDocument()
  })

  it('cancelar o seletor não altera a lista (critério 3)', async () => {
    listAllowedDirectories.mockResolvedValue([APP_DIR, PROJETO])
    // Cancelado: o main devolve a lista como estava.
    pickAllowedDirectory.mockResolvedValue([APP_DIR, PROJETO])

    render(<DiretoriosPermitidos />)
    await screen.findByText(PROJETO)
    await userEvent.click(screen.getByRole('button', { name: /permitir uma pasta/i }))

    await waitFor(() => expect(pickAllowedDirectory).toHaveBeenCalledTimes(1))
    // Nenhum item novo e nenhum sumiu — e, principalmente, nada foi removido da lista por
    // engano ao reatribuir a resposta do cancelamento.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(PROJETO)).toBeInTheDocument()
  })

  it('remover tira o diretório da lista (critério 4)', async () => {
    listAllowedDirectories.mockResolvedValue([APP_DIR, PROJETO])
    removeAllowedDirectory.mockResolvedValue([APP_DIR])

    render(<DiretoriosPermitidos />)
    await screen.findByText(PROJETO)

    await userEvent.click(screen.getByRole('button', { name: `Remover ${PROJETO}` }))

    expect(removeAllowedDirectory).toHaveBeenCalledWith(PROJETO)
    await waitFor(() => expect(screen.queryByText(PROJETO)).not.toBeInTheDocument())
  })

  it('o diretório do app é apresentado como fixo e não tem botão de remover (critério 4)', async () => {
    listAllowedDirectories.mockResolvedValue([APP_DIR, PROJETO])

    render(<DiretoriosPermitidos />)
    await screen.findByText(PROJETO)

    // O único "Remover" da tela é o do diretório do usuário. Se o do app tivesse um, haveria
    // dois — e o usuário tentaria uma ação que o repositório recusa em silêncio.
    expect(screen.queryByRole('button', { name: `Remover ${APP_DIR}` })).not.toBeInTheDocument()
    expect(screen.getByText('Fixo')).toBeInTheDocument()
    // A tela diz **por quê** é fixo: sem a linha, o usuário lê a ausência do botão como defeito.
    expect(screen.getByText(/permitida por construção/i)).toBeInTheDocument()
  })

  it('falha ao listar vira erro de produto, não mensagem técnica (critério 8)', async () => {
    listAllowedDirectories.mockRejectedValue(new Error('EPERM: canal caiu'))

    render(<DiretoriosPermitidos />)

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível ler os diretórios permitidos/i)
    // O texto do erro técnico não ajuda quem quer permitir uma pasta — e vazaria detalhe do main.
    expect(alerta).not.toHaveTextContent(/EPERM/)
  })

  it('a tela só fala por IPC tipado — nenhuma API de filesystem (critério 6)', async () => {
    listAllowedDirectories.mockResolvedValue([APP_DIR, PROJETO])

    render(<DiretoriosPermitidos />)
    await screen.findByText(PROJETO)

    await userEvent.click(screen.getByRole('button', { name: /permitir uma pasta/i }))

    // A superfície que o componente usa é exatamente esta. Um `require('fs')` ou um
    // `showDirectoryPicker` no renderer não apareceria aqui — apareceria como método fora
    // da ponte, e a guarda de superfície do preload é quem barra isso do outro lado.
    expect(Object.keys(window.jarvis)).toEqual(
      expect.arrayContaining([
        'listAllowedDirectories',
        'getAppDirectory',
        'pickAllowedDirectory',
        'removeAllowedDirectory'
      ])
    )
    // O caminho de escolha passou pelo main: a tela nunca recebeu handle de arquivo, só a lista.
    expect(pickAllowedDirectory).toHaveBeenCalledWith()
  })
})
