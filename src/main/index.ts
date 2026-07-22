import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { IPC_EVENT_CHANNELS } from '@shared/contracts/ipc'
import { AuthService } from './auth/auth-service'
import { createSupabaseClient, readSupabaseConfig } from './auth/supabase-client'
import { SafeStorageTokenVault } from './auth/token-vault'
import { registerIpcHandlers } from './ipc/handlers'
import { PreferencesService } from './preferences/preferences-service'
import { closeLogger, initLogger, log } from './logging/logger'
import { initRendererLogBridge } from './logging/renderer-bridge'
import { LOCAL_USER_ID, LOCAL_USER_PROFILE } from './storage/local-user'
import { closeStorage, initStorage } from './storage'
import { createTray, destroyTray, revelarJanela } from './tray'
import { WorkspaceService } from './workspace/workspace-service'
import { createMainWindow } from './window'

/**
 * Instância única (SPEC-02, critério 6). Precisa vir **antes** de qualquer inicialização:
 * a segunda instância deve morrer sem tocar no banco nem nos logs, senão duas instâncias
 * disputariam o mesmo arquivo SQLite.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let janela: BrowserWindow | undefined

  // Alguém tentou abrir o app de novo: em vez de uma segunda janela, foca a existente.
  app.on('second-instance', () => {
    if (janela) {
      log.sistema.info('Segunda instância bloqueada; janela existente trazida ao foco')
      revelarJanela(janela)
    }
  })

  app.whenReady().then(() => {
    // Agrupa a janela sob a identidade correta na barra de tarefas do Windows.
    app.setAppUserModelId('com.rodrigoreis.jarvisos')

    // Logging antes de tudo: uma falha no storage ou na criação da janela precisa
    // aparecer no arquivo. `userData/logs` fica fora do repo (ADR-005).
    initLogger(join(app.getPath('userData'), 'logs'), { console: !app.isPackaged })
    initRendererLogBridge()
    log.sistema.info('Aplicação iniciada', {
      versao: app.getVersion(),
      electron: process.versions.electron,
      plataforma: process.platform
    })

    // Storage depois do logger, antes dos handlers — que já podem consultá-lo.
    const storage = initStorage(app.getPath('userData'))
    // Usuário local da fundação: continua sendo a identidade de quem ainda não entrou.
    // Com a F03, ele deixa de ser o único — o usuário da sessão o substitui após o login.
    storage.profiles.save(LOCAL_USER_PROFILE)

    const auth = criarAuthService(app.getPath('userData'), storage, () => janela)

    /**
     * Identidade corrente: o usuário da sessão quando há login, o local caso contrário.
     *
     * É função porque o valor muda em runtime — capturar a string no boot congelaria o
     * escopo da auditoria no usuário local para sempre.
     */
    const userIdAtual = (): string => auth?.usuarioAtual()?.id ?? LOCAL_USER_ID

    const workspaces = new WorkspaceService(storage.audit, userIdAtual)
    // `nativeTheme` é a única fonte confiável do tema do SO; entra por injeção para o
    // serviço seguir testável sem Electron.
    const preferences = new PreferencesService(storage.profiles, LOCAL_USER_ID, () =>
      nativeTheme.shouldUseDarkColors ? 'escuro' : 'claro'
    )

    registerIpcHandlers({
      audit: storage.audit,
      workspaces,
      preferences,
      userId: userIdAtual,
      auth,
      minimizeToTray: () => janela?.hide()
    })

    janela = createMainWindow()
    createTray(janela)

    // Restaura a sessão do cofre depois da janela existir: a transição é empurrada ao
    // renderer, e sem janela o `webContents.send` cairia no vazio.
    void auth?.restaurar()

    // macOS: recriar a janela ao clicar no dock sem janelas abertas.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        log.sistema.info('Janela recriada a partir do dock')
        janela = createMainWindow()
      } else if (janela) {
        revelarJanela(janela)
      }
    })
  })
}

/**
 * Monta o `AuthService`, ou devolve `undefined` quando não há credenciais.
 *
 * Ausência de credencial **não** é erro fatal: o app roda com o usuário local e só o login
 * fica indisponível (documentado no `.env.example`). Derrubar o boot por falta de um
 * projeto Supabase impediria qualquer um de clonar o repo e rodar.
 */
function criarAuthService(
  userDataDir: string,
  storage: ReturnType<typeof initStorage>,
  janelaAtual: () => BrowserWindow | undefined
): AuthService | undefined {
  const config = readSupabaseConfig()

  if (!config) {
    log.auth.warn(
      'Credenciais do Supabase ausentes: login indisponível. ' +
        'Preencha SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no .env (ver .env.example).'
    )
    return undefined
  }

  const vault = new SafeStorageTokenVault(join(userDataDir, 'session.vault'))

  return new AuthService({
    supabase: createSupabaseClient(config, vault),
    vault,
    audit: storage.audit,
    profiles: storage.profiles,
    sessions: storage.sessions,
    openExternal: (url) => shell.openExternal(url),
    onChange: (snapshot) => {
      // `isDestroyed` evita erro na corrida entre o fim do login e o fechamento da janela.
      const alvo = janelaAtual()
      if (alvo && !alvo.isDestroyed()) {
        alvo.webContents.send(IPC_EVENT_CHANNELS.authChanged, snapshot)
      }
    }
  })
}

// Com tray, fechar a última janela **não** encerra o app (SPEC-02): ele continua vivo na
// bandeja. Quem encerra é o "Sair" do menu do tray.
app.on('window-all-closed', () => {
  // Sem handler algum o Electron encerraria sozinho fora do macOS; este bloco existe
  // justamente para impedir isso.
})

// Fecha banco e transports antes de sair; sem isso o último registro pode não chegar ao
// disco. Banco antes do logger: fechar o SQLite ainda pode gerar registro.
app.on('will-quit', () => {
  log.sistema.info('Aplicação encerrada')
  destroyTray()
  closeStorage()
  closeLogger()
})

// Falha não capturada é o caso em que o log mais importa — e o que mais some sem isto.
process.on('uncaughtException', (error) => {
  log.sistema.error('Exceção não capturada no processo principal', { error })
})

process.on('unhandledRejection', (reason) => {
  log.sistema.error('Promise rejeitada sem tratamento no processo principal', { reason })
})
