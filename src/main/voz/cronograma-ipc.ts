import { dialog, ipcMain } from 'electron'
import type { ConfiguracaoDoCronograma, ResultadoDoCronograma } from '@shared/domain/cronograma'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { CronogramaService } from './cronograma-service'
import { validarCronograma } from './validar-cronograma'

export function registrarIpcDoCronograma(
  servico: CronogramaService,
  caminhosPermitidos: () => Set<string>
): void {
  ipcMain.handle(IPC_CHANNELS.cronogramaLer, (): ConfiguracaoDoCronograma => servico.ler())
  ipcMain.handle(IPC_CHANNELS.cronogramaHistorico, (): readonly ResultadoDoCronograma[] =>
    servico.historico()
  )
  ipcMain.handle(IPC_CHANNELS.cronogramaSelecionarMidia, async (_evento, tipo: unknown) => {
    if (tipo !== 'arquivo' && tipo !== 'pasta') throw new Error('Tipo de mídia inválido')
    const escolha = await dialog.showOpenDialog({
      title: tipo === 'arquivo' ? 'Escolher áudio do cronograma' : 'Escolher pasta de áudio',
      properties: tipo === 'arquivo' ? ['openFile'] : ['openDirectory'],
      ...(tipo === 'arquivo'
        ? { filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }] }
        : {})
    })
    const caminho = escolha.filePaths[0]
    if (escolha.canceled || !caminho) return null
    caminhosPermitidos().add(caminho)
    return { tipo, caminho }
  })
  ipcMain.handle(IPC_CHANNELS.cronogramaSalvar, (_evento, entrada: unknown) => {
    // A seleção física de mídia pertence ao diálogo do main, nunca ao texto vindo da tela.
    if (!validarCronograma(entrada)) throw new Error('Cronograma inválido')
    {
      for (const sequencia of entrada.sequencias)
        for (const atividade of sequencia.atividades) {
          if (
            atividade.tipo === 'tocar-midia-local' &&
            !caminhosPermitidos().has(atividade.midia?.caminho)
          ) {
            throw new Error('Mídia não selecionada no dispositivo')
          }
        }
    }
    return servico.salvar(entrada)
  })
}
