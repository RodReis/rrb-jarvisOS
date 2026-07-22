import { app, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  IPC_SEND_CHANNELS,
  type AppInfo,
  type AuditVerification,
  type WorkspaceSwitchResult
} from '@shared/contracts/ipc'
import { parseLogInput } from '@shared/contracts/logging-input'
import { isWorkspaceId, type AuditEvent, type AuditEventType } from '@shared/domain/entities'
import { log, writeLog } from '../logging/logger'
import type { PreferencesService } from '../preferences/preferences-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { WorkspaceService } from '../workspace/workspace-service'

/** Monta o payload público do app. Sem segredo, sem caminho de disco, sem env cru. */
export function buildAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    environment: app.isPackaged ? 'production' : 'development'
  }
}

/**
 * O que os handlers precisam para responder. Entra por parâmetro, não por import de
 * singleton: é o que permite exercitar os canais em teste sem abrir banco nem subir janela.
 */
export interface IpcDependencies {
  readonly audit: AuditRepository
  readonly workspaces: WorkspaceService
  readonly preferences: PreferencesService
  readonly userId: string
  /** Minimizar para o tray. Injetado porque a janela nasce depois dos handlers. */
  readonly minimizeToTray: () => void
}

/**
 * Registra os handlers dos canais declarados em `IPC_CHANNELS` e `IPC_SEND_CHANNELS`.
 * Cada canal do contrato tem exatamente um handler aqui — não há rota genérica.
 *
 * A regra "todo método loga" (CONVENTION §3) vale aqui: cada canal emite `info` no fluxo
 * normal e `error` na falha, com `direction` marcando a entrada e a saída da chamada.
 */
export function registerIpcHandlers(deps: IpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, () => {
    log.ipc.info('Metadados do app solicitados', { canal: IPC_CHANNELS.appInfo, direction: 'in' })

    try {
      const info = buildAppInfo()
      log.ipc.info('Metadados do app devolvidos', {
        canal: IPC_CHANNELS.appInfo,
        direction: 'out',
        ambiente: info.environment
      })
      return info
    } catch (error) {
      log.ipc.error('Falha ao montar metadados do app', { canal: IPC_CHANNELS.appInfo, error })
      throw error
    }
  })

  // Auditoria: leitura apenas. O renderer não abre o SQLite (SPEC-04, critério 6), e
  // gravar evento é ato do main disparado por um fluxo real — nunca a pedido da UI.
  ipcMain.handle(IPC_CHANNELS.auditList, (_event, type?: unknown): readonly AuditEvent[] => {
    const eventos = deps.audit.list(deps.userId)
    // Filtro de tipo aplicado aqui, e não numa query montada com string vinda do
    // renderer: o canal aceita um valor externo e ele não vira SQL em hipótese alguma.
    const filtrados =
      typeof type === 'string'
        ? eventos.filter((e) => e.type === (type as AuditEventType))
        : eventos

    log.ipc.info('Eventos de auditoria consultados', {
      canal: IPC_CHANNELS.auditList,
      direction: 'out',
      quantidade: filtrados.length
    })

    return filtrados
  })

  ipcMain.handle(IPC_CHANNELS.auditVerify, (): AuditVerification => {
    const resultado = deps.audit.verify(deps.userId) as AuditVerification

    if (!resultado.ok) {
      log.ipc.warn('Verificação da cadeia de auditoria acusou quebra', {
        canal: IPC_CHANNELS.auditVerify,
        seq: resultado.brokenAt
      })
    }

    return resultado
  })

  ipcMain.handle(IPC_CHANNELS.workspaceGet, () => deps.workspaces.atual())

  ipcMain.handle(
    IPC_CHANNELS.workspaceSwitch,
    (_event, destino: unknown): WorkspaceSwitchResult => {
      // `Desenvolvimento` e qualquer string inventada param aqui: o enum é fechado
      // (CONVENTION §2) e o renderer é fronteira de confiança.
      if (!isWorkspaceId(destino)) {
        log.ipc.warn('Troca de espaço recusada: destino fora do enum', {
          canal: IPC_CHANNELS.workspaceSwitch
        })
        throw new Error('Espaço de trabalho inválido.')
      }

      try {
        return deps.workspaces.trocar(destino)
      } catch (error) {
        log.ipc.error('Falha ao alternar espaço de trabalho', {
          canal: IPC_CHANNELS.workspaceSwitch,
          destino,
          error
        })
        throw error
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.preferencesGet, () => deps.preferences.atual())

  ipcMain.handle(IPC_CHANNELS.preferencesSave, (_event, payload: unknown) => {
    // O serviço descarta campo fora do enum; aqui basta garantir que é objeto.
    const pedido = typeof payload === 'object' && payload !== null ? payload : {}

    try {
      const resultado = deps.preferences.salvar(pedido)
      log.ipc.info('Preferências atualizadas', {
        canal: IPC_CHANNELS.preferencesSave,
        direction: 'out',
        idioma: resultado.locale,
        tema: resultado.theme
      })
      return resultado
    } catch (error) {
      log.ipc.error('Falha ao gravar preferências', {
        canal: IPC_CHANNELS.preferencesSave,
        error
      })
      throw error
    }
  })

  // Só de ida: o renderer manda o registro, o main grava. Sem resposta de propósito —
  // esperar confirmação de log tornaria a UI refém do disco.
  ipcMain.on(IPC_SEND_CHANNELS.log, (_event, payload: unknown) => {
    const input = parseLogInput(payload)

    if (!input) {
      log.ipc.warn('Registro de log do renderer descartado por não casar com o contrato', {
        canal: IPC_SEND_CHANNELS.log
      })
      return
    }

    writeLog({ ...input, source: 'renderer' })
  })

  ipcMain.on(IPC_SEND_CHANNELS.windowMinimizeToTray, () => {
    log.ipc.info('Janela minimizada para o tray', {
      canal: IPC_SEND_CHANNELS.windowMinimizeToTray
    })
    deps.minimizeToTray()
  })
}
