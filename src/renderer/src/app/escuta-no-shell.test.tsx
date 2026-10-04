import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { DisparoDaEscuta, EstadoDaEscuta } from '@shared/domain/voz'
import { entrarPelaChoice } from './test-utils'

/**
 * A escuta no shell (SPEC-Escuta-01): o controle está sempre na barra, nos dois espaços, e um
 * disparo leva ao Command Center — que só existe no JARVIS.
 */

const LIGADA: EstadoDaEscuta = {
  ativa: true,
  disponivel: true,
  frase: true,
  palmas: true,
  sensibilidade: 0.5,
  hotkey: 'Control+Alt+M',
  hotkeyRegistrada: true
}

const PERFIL = {
  id: 'u-1',
  name: 'Rodrigo Reis',
  email: 'rodrigo@example.com',
  locale: 'pt-BR' as const,
  theme: 'sistema' as const
}

let disparar: ((d: DisparoDaEscuta) => void) | undefined
const switchWorkspace = vi.fn()
const informarTurnoDaEscuta = vi.fn()
const getUserMedia = vi.fn()

function mockarPonte(espaco: WorkspaceId): void {
  disparar = undefined
  switchWorkspace
    .mockReset()
    .mockImplementation((w: WorkspaceId) => Promise.resolve({ workspace: w, auditSeq: 1 }))
  informarTurnoDaEscuta.mockReset()
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = {}
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() }
      }
      createScriptProcessor() {
        return { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() }
      }
      createAnalyser() {
        return { fftSize: 1024, getFloatTimeDomainData: vi.fn() }
      }
      async close() {}
    }
  )
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([{ kind: 'audioinput', deviceId: 'headset-2', label: 'Headset' }])
    }
  })
  vi.stubGlobal('jarvis', {
    getAppInfo: vi.fn(),
    sendLog: vi.fn(),
    minimizeToTray: vi.fn(),
    switchWorkspace,
    getWorkspace: vi.fn().mockResolvedValue(espaco),
    getPreferences: vi.fn().mockResolvedValue({
      locale: 'pt-BR',
      theme: 'sistema',
      resolvedTheme: 'escuro',
      vozEntradaId: 'headset-2'
    }),
    savePreferences: vi.fn(),
    listAuditEvents: vi.fn(),
    verifyAuditChain: vi.fn(),
    getAuth: vi.fn().mockResolvedValue({ state: 'ativo', profile: PERFIL }),
    login: vi.fn(),
    logout: vi.fn(),
    listPendingApprovals: vi.fn(async () => []),
    prontidaoDaVoz: vi.fn(async () => ({ pronta: true, faltando: [], compute: 'cpu-int8' })),
    transcreverAudio: vi.fn(),
    baixarArtefatoDeVoz: vi.fn(),
    perguntarAoJarvis: vi.fn(),
    historicoDaConversa: vi.fn(async () => []),
    falar: vi.fn(),
    onVozHotkey: vi.fn(() => () => undefined),
    onAuthChanged: vi.fn(() => () => undefined),
    listProjects: vi.fn(async () => []),
    estadoDaEscuta: vi.fn(async () => LIGADA),
    definirEscutaAtiva: vi.fn(),
    enviarPcmDaEscuta: vi.fn(),
    informarTurnoDaEscuta,
    onEscutaMudou: vi.fn(() => () => undefined),
    onEscutaDisparo: vi.fn((ouvinte: (d: DisparoDaEscuta) => void) => {
      disparar = ouvinte
      return () => undefined
    })
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('o controle da escuta na barra', () => {
  it.each<WorkspaceId>(['jarvis', 'noa'])('aparece no espaço %s', async (espaco) => {
    mockarPonte(espaco)
    await entrarPelaChoice(espaco)

    expect(await screen.findByRole('switch', { name: /escuta/i })).toBeInTheDocument()
    const grupo = await screen.findByRole('group', { name: /escuta contínua/i })
    expect(within(grupo).getByRole('status')).toBeInTheDocument()
  })
})

describe('um disparo leva ao Command Center', () => {
  beforeEach(() => mockarPonte('jarvis'))

  it('no JARVIS, mostra o Command Center e reutiliza a captura contínua', async () => {
    await entrarPelaChoice('jarvis')
    await screen.findByTestId('command-center')
    // O disparo pode chegar com o app em qualquer rota; o que o torna útil é levar à tela do turno.
    await userEvent.click(screen.getByRole('button', { name: 'Projects Hub' }))
    await waitFor(() => expect(screen.queryByTestId('command-center')).not.toBeInTheDocument())
    await screen.findByText(/escuta ligada/i)
    const capturasDeTurno = (): number =>
      getUserMedia.mock.calls.filter(
        ([pedido]) =>
          pedido?.audio?.deviceId?.exact === 'headset-2' && pedido?.audio?.echoCancellation === true
      ).length
    const abertasAntes = capturasDeTurno()

    act(() => disparar?.({ gatilho: 'frase', sessaoBloqueada: false }))
    await screen.findByTestId('command-center')

    expect(abertasAntes).toBe(1)
    expect(capturasDeTurno()).toBe(abertasAntes)
  })

  it('vindo do NOA, passa para o JARVIS — o Command Center não existe no NOA', async () => {
    mockarPonte('noa')
    await entrarPelaChoice('noa')
    await screen.findByRole('switch', { name: /escuta/i })
    await screen.findByText(/escuta ligada/i)
    expect(screen.queryByTestId('command-center')).not.toBeInTheDocument()

    act(() => disparar?.({ gatilho: 'palmas', sessaoBloqueada: false }))

    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith('jarvis'))
    await screen.findByTestId('command-center')
  })

  it('se a troca de espaço falha, o main é avisado de que não há turno para conduzir', async () => {
    mockarPonte('noa')
    switchWorkspace.mockRejectedValue(new Error('falhou'))
    await entrarPelaChoice('noa')
    await screen.findByRole('switch', { name: /escuta/i })
    await screen.findByText(/escuta ligada/i)

    act(() => disparar?.({ gatilho: 'frase', sessaoBloqueada: false }))

    // Sem consumidor para o turno, o main ficaria ignorando gatilhos até o teto de 2 minutos.
    await waitFor(() => expect(informarTurnoDaEscuta).toHaveBeenCalledWith(false))
  })
})
