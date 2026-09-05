/**
 * A jornada avança pelos fatos que o app grava (#281).
 *
 * O que só este nível prova, e nenhum outro consegue:
 *
 *  1. **O marco é commitado pelo Git de verdade.** O int-spec da jornada escreve
 *     `ultimo_marco` direto no banco — é o que o torna rápido, e também o que o impede de
 *     provar que o marco de fato nasce de um commit. Aqui o `PROMPT.md` vira revisão pelo
 *     `GitRunner` sobre o `TerminalEngine`, no repositório que o próprio app criou.
 *  2. **A cadeia atravessa a ponte de produção** — `contextIsolation` ligado, preload real,
 *     `JornadaService` montado pelo `index.ts` com o `temBrief` que lê o repositório de briefs.
 *     O int-spec injeta esse predicado; aqui ele é o do produto.
 *
 * O defeito que o arquivo trava: um projeto que salvava o prompt e commitava o marco ficava em
 * `prompt` para sempre, porque `prompt-registrado` não constava de `EVENTO_DO_MARCO` e o fluxo
 * novo não grava `respostas` do wizard. A tela não tinha botão que o tirasse dali.
 *
 * **Limite do harness, declarado e não contornado:** a metade `brief → brief-aceito` não entra
 * aqui. Gerar o brief exige uma chamada real ao modelo (dezenas de segundos, custo, e a rota da
 * assinatura pode não estar no ar no runner), e o dublê que a substituísse provaria o dublê. Essa
 * metade é medida no int-spec da jornada, com `temBrief` injetado, e no teste de tela do
 * refinamento. O que este arquivo prova é o que depende de Git real: o marco move a etapa.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string

interface OutcomeDaPonte {
  readonly reason: string
  readonly project?: { readonly id: string; readonly diretorio: string }
}

interface EstadoDaPonte {
  readonly etapa: string
  readonly cta: string
}

test.beforeEach(async () => {
  userData = mkdtempSync(`${tmpdir()}/jarvis-e2e-jornada-`)

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas mesmas razões do `login.e2e.ts`.
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...ambiente, NODE_ENV: 'development', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }
  })
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam pelo tray e pelos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`).
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)

  rmSync(userData, { recursive: true, force: true })
})

test('salvar o prompt commita o marco e leva a jornada ao refinamento', async () => {
  const janela = await app.firstWindow()

  // Etapa 1: criar o projeto e ler a etapa inicial. Separada da etapa 2 porque entre as duas
  // é preciso configurar a identidade de Git **no diretório que o app acabou de criar**, e
  // isso acontece no processo de teste, não dentro da janela.
  const criado = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          estadoDaJornada: (p: string, w: string) => Promise<EstadoDaPonte | null>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    // Sem `git` na allowlist o marco não commita — a allowlist nasce vazia no app real.
    await bridge.addAllowedCommand('git', workspace)

    const projeto = await bridge.createProject('Projeto Jornada', workspace)
    const projectId = projeto.project?.id ?? ''

    // O piso: projeto recém-criado está em `prompt`. Sem esta leitura, a asserção final não
    // provaria que foi **salvar** que moveu a jornada.
    const antes = await bridge.estadoDaJornada(projectId, workspace)

    return {
      projectId,
      workspace,
      diretorio: projeto.project?.diretorio ?? '',
      antes: antes?.etapa
    }
  })

  // Identidade de Git local ao repositório: o runner de CI pode não ter uma global, e o commit
  // do marco falharia por motivo alheio ao que se testa (lição do E2E da M8-F04). Sem isto o
  // teste passa na máquina de dev e reprova só no CI, com `commitado: false` — que parece
  // defeito do código sob teste e não é.
  execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: criado.diretorio })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: criado.diretorio })

  // Etapa 2: salvar o prompt, que commita o `PROMPT.md` e é o que deve mover a jornada.
  const depois = await janela.evaluate(
    async ({ projectId, workspace }: { projectId: string; workspace: string }) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            salvarPromptDoProjeto: (p: string, t: string, w: string) => Promise<unknown>
            estadoDaJornada: (p: string, w: string) => Promise<EstadoDaPonte | null>
          }
        }
      ).jarvis

      await bridge.salvarPromptDoProjeto(
        projectId,
        '# Prompt\n\nUm painel que mostra a IA trabalhando enquanto ela trabalha.\n',
        workspace
      )

      return await bridge.estadoDaJornada(projectId, workspace)
    },
    { projectId: criado.projectId, workspace: criado.workspace }
  )

  expect(criado.antes).toBe('prompt')
  // A prova do defeito: antes da #281 isto continuava `prompt`, e o PI ficava sem saída.
  expect(depois?.etapa).toBe('refinamento')
  // A trilha oferece a ação da etapa nova — etapa sem CTA seria avanço que o PI não vê.
  expect(depois?.cta).toBeTruthy()
})

test('sem prompt salvo a jornada não sai do lugar', async () => {
  const janela = await app.firstWindow()

  const etapa = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          estadoDaJornada: (p: string, w: string) => Promise<EstadoDaPonte | null>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)

    const criado = await bridge.createProject('Projeto Parado', workspace)
    const estado = await bridge.estadoDaJornada(criado.project?.id ?? '', workspace)

    return estado?.etapa
  })

  // O contrafactual do teste acima: a criação do projeto commita `estrutura-inicial`, que não
  // comprova evento nenhum da jornada. Se este teste passasse a devolver `refinamento`, seria
  // sinal de que um marco genérico está movendo a etapa — o defeito latente do laço.
  expect(etapa).toBe('prompt')
})
