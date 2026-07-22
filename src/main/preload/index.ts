import { contextBridge, ipcRenderer } from 'electron'
import { BRIDGE_KEY, IPC_CHANNELS, type AppInfo, type JarvisBridge } from '@shared/contracts/ipc'

/**
 * Preload — a ponte tipada e o único ponto de contato do renderer com o main.
 *
 * Expõe métodos nomeados, nunca `ipcRenderer` cru nem um `invoke(canal, ...)` genérico:
 * um canal arbitrário deixaria o renderer alcançar qualquer handler do main, o que
 * anularia a fronteira de segurança (docs/ARCHITECTURE.md).
 */
const bridge: JarvisBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
} else {
  // contextIsolation desligado quebra a fronteira renderer↔Node. Falhar alto é
  // preferível a expor a ponte num contexto sem isolamento.
  throw new Error('contextIsolation está desabilitado — a ponte não será exposta.')
}
