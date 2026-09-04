/**
 * A jornada de criar um projeto, no app real (SPEC-Planejamento-01).
 *
 * O que este teste prova e nenhum teste de componente consegue: **a correção do erro de `git`
 * funciona de verdade**. Num teste de componente a ponte é dublada, e um dublê aceita qualquer
 * coisa — ele diria que o botão chama `addAllowedCommand` sem nunca provar que o Policy Engine
 * deixa, que o `git` roda depois pelo terminal controlado, ou que o projeto nasce no disco.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta, então a *navegação pela sidebar* fica fora do alcance
 * — automatizar a tela de consentimento de um provedor externo é justamente o que o
 * `login.e2e.ts` recusa fazer, pela mesma razão. O que se exercita aqui é a ponte real e o
 * efeito no disco; a renderização da tela tem suíte própria em `projetos.test.tsx`.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string

/** O formato do que a ponte devolve — o mesmo `ProjectOutcome` do contrato. */
interface OutcomeDaPonte {
  readonly reason: string
  readonly mensagem: string
  readonly project?: { readonly nome: string; readonly diretorio: string }
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-projetos-'))

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas razões registradas no `login.e2e.ts`.
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
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
})

test('sem o git permitido a criação é recusada, e permitir pelo mesmo canal da tela a destrava', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // Primeira metade: a allowlist de comandos nasce **vazia**, então criar projeto é recusado
  // com `git-indisponivel`. É o estado em que o usuário encontra a tela no primeiro uso.
  const recusa: OutcomeDaPonte = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    return await bridge.createProject('Projeto Teste', workspace)
  })

  expect(recusa.reason).toBe('git-indisponivel')
  // A mensagem carrega a ação concreta — é o que a tela renderiza junto do botão de correção.
  expect(recusa.mensagem).toContain('Terminal Controlado')
  expect(recusa.project).toBeUndefined()

  // Segunda metade: **o que o botão do alerta faz**. Permitir o `git` pelo canal auditado e
  // repetir a criação — exatamente a sequência de `permitirGit()` na tela.
  const depois = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          listProjects: (
            w: string
          ) => Promise<readonly { nome: string; diretorio: string; origem: string }[]>
          verifyAuditChain: () => Promise<{ ok: boolean }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    const comandos = await bridge.addAllowedCommand('git', workspace)
    const criado = await bridge.createProject('Projeto Teste', workspace)
    return {
      comandos,
      criado,
      projetos: await bridge.listProjects(workspace),
      auditoria: await bridge.verifyAuditChain()
    }
  })

  // A permissão foi registrada pelo mesmo canal da tela de Terminal — alto risco, auditado.
  expect(depois.comandos).toContain('git')
  // E a criação, retomada, produz o projeto: é o que impede o usuário de ficar com um alerta
  // resolvido e nenhum projeto.
  expect(depois.criado.reason).toBe('criado')
  expect(depois.projetos).toHaveLength(1)
  expect(depois.projetos[0]?.nome).toBe('Projeto Teste')

  // O efeito no disco, que é o que nenhum dublê produziria: estrutura documental e repositório
  // Git de verdade, criados pelo terminal controlado.
  const diretorio = depois.criado.project?.diretorio ?? ''
  expect(existsSync(join(diretorio, 'README.md'))).toBe(true)
  expect(existsSync(join(diretorio, 'docs', 'spec'))).toBe(true)
  expect(existsSync(join(diretorio, '.git'))).toBe(true)

  // A cadeia de auditoria continua íntegra depois de permissão + comandos Git + ciclo de vida.
  expect(depois.auditoria.ok).toBe(true)
})

test('desregistrar tira da lista e preserva a pasta e o histórico no disco', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const resultado = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          removeProject: (id: string, w: string) => Promise<boolean>
          listProjects: (w: string) => Promise<readonly { id: string }[]>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    const criado = await bridge.createProject('Projeto Alfa', workspace)
    const [projeto] = await bridge.listProjects(workspace)
    const removido = await bridge.removeProject(projeto?.id ?? '', workspace)
    return {
      diretorio: criado.project?.diretorio ?? '',
      removido,
      restantes: await bridge.listProjects(workspace)
    }
  })

  expect(resultado.removido).toBe(true)
  expect(resultado.restantes).toHaveLength(0)
  // A promessa que a confirmação faz ao usuário, verificada no disco: sai da lista, fica tudo.
  expect(existsSync(join(resultado.diretorio, 'README.md'))).toBe(true)
  expect(existsSync(join(resultado.diretorio, '.git'))).toBe(true)
})

/**
 * O resumo do card contra o main real (SPEC-Fases-01, critérios 2 a 5 e 7).
 *
 * O que este teste prova e o de componente não consegue: **os quatro blocos vêm compostos do
 * main, numa leitura só**. No teste de componente a ponte é dublada, e um dublê devolve o
 * formato que se pedir a ele — ele diria que o card mostra fase e gates sem nunca provar que o
 * main sabe derivá-los de um projeto de verdade, recém-criado, com a etapa que os fatos
 * sustentam.
 *
 * A renderização tem suíte própria (`projetos.test.tsx`); aqui o alvo é o canal.
 */
test('o resumo do card vem composto do main, numa leitura por projeto', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const resultado = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          listProjects: (w: string) => Promise<readonly { id: string }[]>
          resumoDeVarios: (
            ids: readonly string[],
            w: string
          ) => Promise<
            readonly {
              projectId: string
              etapa: string
              fase: string
              rotuloDaFase: string
              progresso: { posicao: number; total: number }
              cta: string
              gates: { aceitos: number; total: number }
              dataDoUltimoEvento: string | null
              rota: { decisao: string } | null
              modelo: string | null
              bloqueio: { motivo: string; acao: string } | null
            }[]
          >
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    await bridge.createProject('Projeto Fases', workspace)

    const projetos = await bridge.listProjects(workspace)
    return {
      resumos: await bridge.resumoDeVarios(
        projetos.map((p) => p.id),
        workspace
      ),
      quantidade: projetos.length
    }
  })

  expect(resultado.quantidade).toBe(1)
  expect(resultado.resumos).toHaveLength(1)

  const resumo = resultado.resumos[0]

  // Projeto recém-criado não tem fato nenhum, então abre na primeira etapa — e a fase que a
  // acompanha é a primeira. É a migração do critério 6 da SPEC-Jornada-01 vista pelo card.
  expect(resumo.etapa).toBe('prompt')
  expect(resumo.fase).toBe('planejamento')
  expect(resumo.rotuloDaFase).toBe('Planejamento')
  expect(resumo.cta).toBe('Escrever o prompt')

  // O progresso é da **fase**, não da trilha: oito etapas no Planejamento, e o projeto na
  // primeira delas.
  expect(resumo.progresso).toEqual({ posicao: 1, total: 8 })

  // Nenhum gate aceito ainda, e o denominador é o contrato: cinco etapas de aceite.
  expect(resumo.gates).toEqual({ aceitos: 0, total: 5 })

  // A rota é decidida pelo main a partir dos providers reais da máquina. Qual delas sai depende
  // do ambiente, então o que se afirma é o **acoplamento** entre rota e modelo: a rota que
  // bloqueia não anuncia modelo e traz ação concreta; a que gera anuncia. Afirmar uma decisão
  // fixa aqui testaria a máquina do CI, não o produto.
  expect(resumo.rota).not.toBeNull()

  if (resumo.rota?.decisao === 'bloqueado') {
    expect(resumo.modelo).toBeNull()
    expect(resumo.bloqueio?.acao).toBeTruthy()
  } else {
    expect(resumo.modelo).toBeTruthy()
    expect(resumo.bloqueio).toBeNull()
  }
})

/**
 * O aceite documental deixa marco no Git (#259).
 *
 * O que este teste prova e nenhum teste de integração consegue: **o commit sai de verdade**. No
 * int-spec o `concluirMarco` é dublado — grava a coluna e devolve `true` sem tocar em Git. Um
 * dublê não prova que `git add -A && git commit` roda pelo terminal controlado, que a allowlist
 * deixa, nem que a mensagem do marco novo chega ao histórico.
 *
 * O caminho da jornada até o aceite depende do wizard respondido, e montá-lo aqui testaria o
 * wizard. O que se mede é o elo que a correção acrescentou: **o marco novo commita**.
 */
test('o marco do aceite documental produz commit real no repositório', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const resultado = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          listProjects: (w: string) => Promise<readonly { id: string }[]>
          completeMilestone: (
            p: string,
            m: string,
            w: string
          ) => Promise<{ commitado: boolean; commitHash?: string } | null>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    const criado = await bridge.createProject('Projeto Marco', workspace)

    const projetos = await bridge.listProjects(workspace)
    const id = projetos[0]?.id ?? ''

    return {
      diretorio: criado.project?.diretorio ?? '',
      // Os dois marcos novos desta correção, pelo mesmo canal que a jornada usa.
      brief: await bridge.completeMilestone(id, 'brief-aceito-pelo-pi', workspace),
      prd: await bridge.completeMilestone(id, 'prd-aceito-pelo-pi', workspace)
    }
  })

  // Marco desconhecido pelo `MENSAGEM_DO_MARCO` produziria commit sem mensagem ou falha: os dois
  // saírem commitados é o que prova que o vocabulário novo chegou ao produto inteiro.
  expect(resultado.brief?.commitado).toBe(true)
  expect(resultado.prd?.commitado).toBe(true)
  expect(resultado.brief?.commitHash).toBeTruthy()
  expect(resultado.prd?.commitHash).toBeTruthy()

  // O histórico no disco, que é o que nenhum dublê produziria.
  const historico = execSync('git log --format=%s -3', {
    cwd: resultado.diretorio,
    encoding: 'utf8'
  })

  expect(historico).toContain('docs: PRD aceito pelo PI')
  expect(historico).toContain('docs: brief aceito pelo PI')
})
