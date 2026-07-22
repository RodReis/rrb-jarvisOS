import { contextBridge, ipcRenderer } from 'electron'
import {
  BRIDGE_KEY,
  IPC_CHANNELS,
  IPC_SEND_CHANNELS,
  type AppInfo,
  type JarvisBridge
} from '@shared/contracts/ipc'
import type { LogInput } from '@shared/contracts/logging'

/**
 * Preload — a ponte tipada e o único ponto de contato do renderer com o main.
 *
 * Expõe métodos nomeados, nunca `ipcRenderer` cru nem um `invoke(canal, ...)` genérico:
 * um canal arbitrário deixaria o renderer alcançar qualquer handler do main, o que
 * anularia a fronteira de segurança (docs/ARCHITECTURE.md).
 */
const bridge: JarvisBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  // `send`, não `invoke`: o renderer não espera confirmação de gravação (ADR-005 — quem
  // escreve é o main). Aguardar o disco para logar prenderia a UI ao IO.
  sendLog: (record: LogInput): void => ipcRenderer.send(IPC_SEND_CHANNELS.log, record)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
} else {
  // contextIsolation desligado quebra a fronteira renderer↔Node. Falhar alto é
  // preferível a expor a ponte num contexto sem isolamento.
  throw new Error('contextIsolation está desabilitado — a ponte não será exposta.')
}
