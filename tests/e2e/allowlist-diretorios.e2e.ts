/**
 * A jornada que a fatia existe para fechar (SPEC-ExecucaoReal-03, critérios 6 e 7).
 *
 * O buraco que originou a fatia foi encontrado exatamente aqui, no app real: os canais da
 * allowlist existiam desde o MVP-002 e nenhuma tela os usava, então pelo aplicativo o usuário
 * não conseguia permitir pasta nenhuma — e sem isso o terminal recusava todo cwd. A
 * verificação da M4-F02 só terminou porque foi usada a ponte direto, fora da UI.
 *
 * Este teste prova a jornada **pela ponte real**: uma pasta que o terminal recusa antes de ser
 * permitida passa a ser aceita depois. É o critério 7, e é o que nenhum teste de componente
 * consegue afirmar — lá a ponte é dublada, e uma ponte dublada aceita qualquer cwd.
 *
 * O **seletor nativo** fica fora do recorte, pela mesma razão que a tela de consentimento do
 * Google fica fora do `login.e2e.ts`: `dialog.showOpenDialog` é janela do sistema operacional,
 * fora do alcance do Playwright, e automatizá-la mediria o gerenciador de arquivos do SO em vez
 * do nosso app. O que o diálogo faz **depois** da escolha — canonizar e adicionar — é o que os
 * testes do handler provam, com o diálogo dublado.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string
/** Uma pasta real fora do `userData` — o cwd que o terminal recusa antes de ser permitido. */
let pastaDeFora: string

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-allowlist-'))
  pastaDeFora = mkdtempSync(join(tmpdir(), 'jarvis-e2e-projeto-'))

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas razões registradas no `login.e2e.ts`: sem
    // eles o loader do Playwright injeta `--password-store=basic` e o boot falha por desenho.
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: ''
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam pelo tray e pelos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`).
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  // O `close()` depois do `exit()` para o Playwright esperar o processo soltar os arquivos —
  // sem ele o `rmSync` falha com EPERM no Windows.
  await app?.close().catch(() => undefined)

  rmSync(userData, { recursive: true, force: true })
  rmSync(pastaDeFora, { recursive: true, force: true })
})

test('permitir uma pasta pela ponte real faz o terminal aceitar aquele cwd', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // A fronteira do critério 6, vista do renderer de verdade: os quatro métodos da allowlist
  // existem e **nenhum** caminho de filesystem existe ao lado deles. A ausência é a garantia —
  // um `require`, um `fs` ou um `showDirectoryPicker` apareceriam nesta lista.
  const ponte = await janela.evaluate(() => {
    const bridge = (window as unknown as { jarvis: Record<string, unknown> }).jarvis
    return {
      metodos: Object.keys(bridge).sort(),
      temIpcRenderer: 'ipcRenderer' in (window as object),
      temRequire: 'require' in (window as object)
    }
  })

  expect(ponte.metodos).toContain('listAllowedDirectories')
  expect(ponte.metodos).toContain('getAppDirectory')
  expect(ponte.metodos).toContain('pickAllowedDirectory')
  expect(ponte.metodos).toContain('removeAllowedDirectory')
  expect(ponte.temIpcRenderer).toBe(false)
  expect(ponte.temRequire).toBe(false)
  // Nenhum método dá acesso a arquivo: a busca é por nome, e o vazio é o que se afirma.
  expect(ponte.metodos.filter((m) => /readFile|writeFile|^fs$|openFile/i.test(m))).toEqual([])

  // O default de fábrica: só a pasta do app, que é o estado em que o usuário encontra a tela.
  const inicial = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          listAllowedDirectories: () => Promise<readonly string[]>
          getAppDirectory: () => Promise<string>
        }
      }
    ).jarvis
    return {
      lista: await bridge.listAllowedDirectories(),
      appDir: await bridge.getAppDirectory()
    }
  })

  expect(inicial.lista).toEqual([inicial.appDir])

  /**
   * O comando que a jornada usa. O binário precisa estar na allowlist de **comandos** (1ª
   * barreira) para que a recusa que interessa seja a do **cwd** (2ª barreira) e não a do
   * binário — sem isso o teste veria `binario-fora-da-allowlist` nas duas metades e não
   * provaria nada sobre diretórios.
   */
  const executarEm = async (cwd: string): Promise<{ state: string; reason: string }> =>
    await janela.evaluate(async (diretorio) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            getWorkspace: () => Promise<string>
            addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
            runCommand: (
              s: { binary: string; args: readonly string[]; cwd: string },
              w: string
            ) => Promise<{ state: string; reason: string }>
          }
        }
      ).jarvis

      const workspace = await bridge.getWorkspace()
      await bridge.addAllowedCommand('node', workspace)
      return await bridge.runCommand(
        { binary: 'node', args: ['--version'], cwd: diretorio },
        workspace
      )
    }, cwd)

  // ANTES: a pasta está fora da allowlist e o terminal a recusa. É o estado em que o app
  // esteve durante todo o MVP-004 para qualquer pasta que não fosse a do próprio app.
  const antes = await executarEm(pastaDeFora)
  expect(antes.state).toBe('bloqueado')
  expect(antes.reason).toBe('cwd-fora-da-allowlist')

  // A permissão. No app é o seletor nativo que entrega este path; aqui ele entra pelo canal
  // que o seletor usa depois da escolha — o que muda é quem escolheu, não o que acontece.
  const depoisDeAdicionar = await janela.evaluate(async (diretorio) => {
    const bridge = (
      window as unknown as {
        jarvis: { addAllowedDirectory: (p: string) => Promise<readonly string[]> }
      }
    ).jarvis
    return await bridge.addAllowedDirectory(diretorio)
  }, pastaDeFora)

  expect(depoisDeAdicionar).toContain(inicial.appDir)
  expect(depoisDeAdicionar.length).toBe(2)

  // DEPOIS: o mesmo comando, no mesmo cwd, deixa de ser recusado por diretório. É o critério 7
  // — a tela que a fatia entrega é o que dá ao usuário acesso a este caminho.
  const depois = await executarEm(pastaDeFora)
  expect(depois.reason).not.toBe('cwd-fora-da-allowlist')
  expect(depois.state).not.toBe('bloqueado')

  // A cadeia de auditoria continua íntegra depois da edição (critério 5) — a allowlist é
  // evidência, e uma edição que a corrompesse invalidaria tudo o que ela registra.
  const cadeia = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: { verifyAuditChain: () => Promise<{ ok: boolean; checked: number }> }
      }
    ).jarvis
    return await bridge.verifyAuditChain()
  })

  expect(cadeia.ok).toBe(true)
  expect(cadeia.checked).toBeGreaterThan(0)
})
