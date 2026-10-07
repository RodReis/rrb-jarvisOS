/** Ponte fechada do modo de chegada: só o main inicia reprodução; mídia só vem do diálogo local. */
import { randomUUID } from 'node:crypto'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS, IPC_SEND_CHANNELS } from '@shared/contracts/ipc'
import type { ConfiguracaoDasBoasVindas } from '@shared/domain/boas-vindas'
import { validarConfiguracaoDasBoasVindas } from './estado-das-boas-vindas-em-disco'

interface EstadoConfiguravel {
  readonly configuracao: () => ConfiguracaoDasBoasVindas
  readonly salvarConfiguracao: (config: ConfiguracaoDasBoasVindas) => void
}

type PedidoSemId =
  | { readonly acao: 'fala'; readonly texto: string }
  | { readonly acao: 'midia'; readonly dados: Uint8Array; readonly tipo: string }

export function registrarIpcDasBoasVindas(
  estado: EstadoConfiguravel,
  janela: () => BrowserWindow | undefined
): {
  readonly reproduzir: (pedido: PedidoSemId) => Promise<void>
} {
  let pronto = false
  const pendentes = new Map<
    string,
    { resolver: (ok: boolean) => void; relogio: ReturnType<typeof setTimeout> }
  >()

  ipcMain.handle(IPC_CHANNELS.boasVindasLer, () => estado.configuracao())
  ipcMain.handle(IPC_CHANNELS.boasVindasSalvar, (_evento, entrada: unknown) => {
    if (typeof entrada !== 'object' || entrada === null) throw new Error('Configuração inválida')
    const novo = {
      ...(entrada as Record<string, unknown>),
      // Só o diálogo do main pode conceder acesso a arquivo ou pasta.
      midia: estado.configuracao().midia
    }
    if (!validarConfiguracaoDasBoasVindas(novo)) throw new Error('Configuração inválida')
    estado.salvarConfiguracao({
      ativa: novo.ativa,
      janelaInicio: novo.janelaInicio,
      janelaFim: novo.janelaFim,
      tetoDaPersonaMs: novo.tetoDaPersonaMs,
      frases: {
        manha: novo.frases.manha,
        tarde: novo.frases.tarde,
        noite: novo.frases.noite
      },
      midiaAtiva: novo.midiaAtiva,
      midia: novo.midia
    })
    return estado.configuracao()
  })
  ipcMain.handle(IPC_CHANNELS.boasVindasSelecionarMidia, async (_evento, tipo: unknown) => {
    if (tipo === null) {
      estado.salvarConfiguracao({ ...estado.configuracao(), midiaAtiva: false, midia: null })
      return estado.configuracao()
    }
    if (tipo !== 'arquivo' && tipo !== 'pasta') throw new Error('Tipo de mídia inválido')
    const escolha = await dialog.showOpenDialog({
      title: tipo === 'arquivo' ? 'Escolher áudio das boas-vindas' : 'Escolher pasta de áudio',
      properties: tipo === 'arquivo' ? ['openFile'] : ['openDirectory'],
      ...(tipo === 'arquivo'
        ? { filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }] }
        : {})
    })
    if (!escolha.canceled && escolha.filePaths[0]) {
      estado.salvarConfiguracao({
        ...estado.configuracao(),
        midiaAtiva: true,
        midia: { tipo, caminho: escolha.filePaths[0] }
      })
    }
    return estado.configuracao()
  })

  ipcMain.on(IPC_SEND_CHANNELS.boasVindasPronto, (evento) => {
    if (janela()?.webContents === evento.sender) {
      pronto = true
      evento.sender.once('did-start-loading', () => {
        pronto = false
      })
    }
  })
  ipcMain.on(
    IPC_SEND_CHANNELS.boasVindasReproducaoConcluida,
    (evento, id: unknown, ok: unknown) => {
      if (
        janela()?.webContents !== evento.sender ||
        typeof id !== 'string' ||
        typeof ok !== 'boolean'
      )
        return
      const pendente = pendentes.get(id)
      if (!pendente) return
      clearTimeout(pendente.relogio)
      pendentes.delete(id)
      pendente.resolver(ok)
    }
  )

  return {
    async reproduzir(pedido) {
      const ativa = janela()
      if (!pronto || !ativa || ativa.isDestroyed()) throw new Error('Tela de voz indisponível')
      const id = randomUUID()
      const resultado = new Promise<boolean>((resolver) => {
        const relogio = setTimeout(() => {
          // O renderer interrompe o áudio antes de liberar a próxima atividade.
          try {
            ativa.webContents.send(IPC_EVENT_CHANNELS.boasVindasCancelarReproducao, id)
          } catch {
            pendentes.delete(id)
            resolver(false)
            return
          }
          const esperaCancelamento = setTimeout(() => {
            pendentes.delete(id)
            resolver(false)
          }, 2_000)
          pendentes.set(id, { resolver, relogio: esperaCancelamento })
        }, 120_000)
        pendentes.set(id, { resolver, relogio })
      })
      try {
        ativa.webContents.send(IPC_EVENT_CHANNELS.boasVindasReproduzir, { ...pedido, id })
      } catch {
        const pendente = pendentes.get(id)
        if (pendente) {
          clearTimeout(pendente.relogio)
          pendentes.delete(id)
          pendente.resolver(false)
        }
      }
      if (!(await resultado)) throw new Error('Reprodução das boas-vindas não concluída')
    }
  }
}
