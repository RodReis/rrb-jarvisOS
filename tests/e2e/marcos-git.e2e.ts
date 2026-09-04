/**
 * O painel de marcos pela ponte real (SPEC-Fases-04).
 *
 * O que só este nível prova, e nenhum outro consegue:
 *
 *  1. **A leitura atravessa a ponte de produção** — `contextIsolation` ligado, preload real,
 *     `GitRunner` sobre o `TerminalEngine` de verdade, num repositório que o próprio app criou.
 *     O int-spec monta o serviço à mão; aqui o caminho é o do usuário.
 *  2. **Não existe segundo caminho de commit** (critério 3). A prova não é uma asserção sobre o
 *     que o painel chama — é sobre a **superfície**: a ponte inteira não expõe nenhum método
 *     `marcos:*` capaz de escrever no Git. Um canal desses seria o segundo caminho que a decisão
 *     da M9-F01 proíbe, e o teste falha se alguém o acrescentar.
 *  3. **Git fora da allowlist explica em vez de listar vazio.** No app real a allowlist nasce
 *     vazia, e a mensagem que o usuário lê vem do `GitRunner`, não de um dublê.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta — o mesmo limite registrado em `roadmap-aprovacoes`. O
 * gate bloqueando o `SLICE_ENTRY` e o fluxo *bloqueado → commitar marco → aceite* exigem sessão
 * autenticada, e são provados no int-spec do `RoadmapService` com identidade injetada. O que este
 * arquivo prova é o que depende do app real: a leitura pela ponte e a ausência do canal de
 * escrita.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string

interface OutcomeDaPonte {
  readonly reason: string
  readonly project?: { readonly id: string; readonly diretorio: string }
}

interface VistaDaPonte {
  readonly disponivel: boolean
  readonly linhas: readonly { readonly caminho: string; readonly estado: string }[]
  readonly repositorio: { readonly sujos: readonly string[]; readonly head: string }
  readonly mensagem?: string
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-marcos-'))

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...ambiente, NODE_ENV: 'development', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
})

test.afterEach(async () => {
  // `exit(0)` pede o encerramento; `close()` espera por ele — sem a espera o `rmSync` corre
  // contra um processo que ainda fecha o SQLite.
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
})

test('o painel lê o repositório que o app criou, pela ponte real', async () => {
  const janela = await app.firstWindow()

  const vista = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          marcosDoProjeto: (p: string, w: string) => Promise<VistaDaPonte>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    const projeto = await bridge.createProject('Projeto Marcos', workspace)

    return await bridge.marcosDoProjeto(projeto.project?.id ?? '', workspace)
  })

  /*
   * **Repositório sem commit nenhum é o estado normal de um projeto novo**, e foi este teste que
   * mostrou: `createProject` roda `git init`, mas o primeiro commit só vem com o marco
   * `estrutura-inicial`. O painel precisa dizer "árvore limpa, nada versionado ainda" — dizer
   * "Git indisponível" acusaria problema de ferramenta no caminho mais comum que existe.
   */
  expect(vista.mensagem ?? '(sem mensagem)').toBe('(sem mensagem)')
  expect(vista.disponivel).toBe(true)
  expect(vista.repositorio.head).toBe('')
  // Sem documento aceito, o painel é honesto: nenhuma linha inventada.
  expect(vista.linhas).toEqual([])
})

test('a ponte não expõe caminho de escrita no Git para o painel (critério 3)', async () => {
  const janela = await app.firstWindow()

  const superficie = await janela.evaluate(() => {
    const bridge = (window as unknown as { jarvis: Record<string, unknown> }).jarvis
    return Object.keys(bridge).filter((m) => /marco/i.test(m))
  })

  // Leitura existe; escrita não. `completeMilestone` — a retomada da M8-F01 — é o único caminho
  // de commit, e ele não é do painel: é do serviço de projeto, com mensagem determinística por
  // marco. Um `commitarMarco` aqui seria o segundo caminho de escrita.
  expect(superficie).toEqual(['marcosDoProjeto'])
})

test('sem `git` permitido, o painel explica em vez de listar vazio', async () => {
  const janela = await app.firstWindow()

  const vista = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          removeAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          marcosDoProjeto: (p: string, w: string) => Promise<VistaDaPonte>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    const projeto = await bridge.createProject('Projeto Sem Git', workspace)

    // Tirar a permissão **depois** de criar: o repositório existe, e o que falta é o comando.
    await bridge.removeAllowedCommand('git', workspace)

    return await bridge.marcosDoProjeto(projeto.project?.id ?? '', workspace)
  })

  expect(vista.disponivel).toBe(false)
  expect(vista.linhas).toEqual([])
  // A mensagem do `GitRunner`, com a ação concreta — não "algo deu errado".
  expect(vista.mensagem).toContain('Terminal Controlado')
})
