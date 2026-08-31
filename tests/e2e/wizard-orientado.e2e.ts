/**
 * O wizard orientado pela ponte real (SPEC-Planejamento-03).
 *
 * O que este teste prova e nenhum teste de componente consegue: **a trilha de decisões
 * sobrevive ao processo**. No teste de componente a ponte é dublada, e um dublê aceita
 * qualquer coisa — ele diria que a tela manda a resposta sem nunca provar que a decisão chegou
 * ao SQLite com a autoria certa, que a substituição preservou a linha anterior, e que a cadeia
 * de auditoria continuou íntegra depois disso.
 *
 * Os quatro fatos que só existem aqui:
 *  1. **A retomada é real**: o estado vem do banco, e ler duas vezes devolve a mesma pergunta.
 *  2. **"Decide por mim" grava o agente**, não o PI — atravessando IPC, serviço e persistência.
 *  3. **A contradição não grava**: o banco tem o mesmo número de linhas depois da recusa.
 *  4. O autosave espelhou a decisão na `PlanningSession`, e a auditoria segue verificável.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta, então a navegação pela sidebar fica fora do alcance —
 * a mesma razão registrada em `projetos-locais.e2e.ts` e `contexto-orcamento.e2e.ts`. O que se
 * exercita aqui é a ponte real e o efeito no banco; a renderização tem suíte própria em
 * `wizard.test.tsx`.
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
  readonly mensagem: string
  readonly project?: { readonly id: string; readonly nome: string; readonly diretorio: string }
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-wizard-'))

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
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

/** Cria um projeto real pela ponte, com o `git` permitido. Devolve o desfecho. */
async function criarProjeto(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<OutcomeDaPonte> {
  return await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    return await bridge.createProject('Projeto Wizard', workspace)
  })
}

test('a decisão atravessa a ponte, grava com autoria e a contradição não escreve', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await criarProjeto(janela)
  expect(projeto.reason).toBe('criado')
  const projectId = projeto.project?.id ?? ''

  const resultado = await janela.evaluate(async (id: string) => {
    interface Decisao {
      readonly id: string
      readonly perguntaId: string
      readonly escolha: string | null
      readonly autor: string
      readonly motivo: string
      readonly substituiu: string | null
    }
    interface Vista {
      readonly estado:
        | { tipo: 'pergunta'; pergunta: { id: string; delegavel: boolean }; restantes: number }
        | { tipo: 'concluido'; decisoes: readonly Decisao[] }
        | { tipo: 'bloqueado'; motivo: string; retomada: string }
      readonly historico: readonly Decisao[]
    }
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          getWizardState: (p: string, w: string) => Promise<Vista | null>
          answerWizard: (
            p: string,
            r: unknown,
            w: string
          ) => Promise<{ reason: string; mensagem: string; contradicoes?: readonly unknown[] }>
          getPlanningSession: (
            p: string,
            w: string
          ) => Promise<{ etapa: string; respostas: Record<string, unknown> } | null>
          verifyAuditChain: () => Promise<{ ok: boolean }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    // 1. Ler não avança: duas leituras seguidas devolvem a mesma pergunta (critério 6).
    const primeira = await bridge.getWizardState(id, workspace)
    const segunda = await bridge.getWizardState(id, workspace)
    const perguntaInicial =
      primeira?.estado.tipo === 'pergunta' ? primeira.estado.pergunta.id : null
    const perguntaRepetida = segunda?.estado.tipo === 'pergunta' ? segunda.estado.pergunta.id : null

    // 2. O PI escolhe a primeira pergunta.
    const escolhida = await bridge.answerWizard(
      id,
      { perguntaId: 'escopo', escolha: 'fatia-vertical', texto: null, autor: 'pi' },
      workspace
    )

    // 3. Delegação: quem escolhe é o main, e o autor gravado é o agente (critério 3).
    const delegada = await bridge.answerWizard(
      id,
      { perguntaId: 'publico', escolha: null, texto: null, autor: 'agente' },
      workspace
    )

    // 4. Pergunta não delegável recusa a delegação, mesmo vindo direto pela ponte.
    const recusada = await bridge.answerWizard(
      id,
      { perguntaId: 'design-de-origem', escolha: null, texto: null, autor: 'agente' },
      workspace
    )

    // 5. Responder `superficie` cria a dependência que a revisão de `escopo` vai contradizer.
    await bridge.answerWizard(
      id,
      { perguntaId: 'superficie', escolha: 'interface-grafica', texto: null, autor: 'pi' },
      workspace
    )

    const antesDaContradicao = (await bridge.getWizardState(id, workspace))?.historico.length ?? -1

    // 6. Revisar `escopo` contradiz `superficie`: devolve **sem gravar** (critério 5).
    const contradicao = await bridge.answerWizard(
      id,
      { perguntaId: 'escopo', escolha: 'fundacao-ampla', texto: null, autor: 'pi' },
      workspace
    )
    const depoisDaContradicao = (await bridge.getWizardState(id, workspace))?.historico.length ?? -1

    // 7. Com o aceite explícito, grava — e a decisão anterior continua no histórico.
    const substituida = await bridge.answerWizard(
      id,
      {
        perguntaId: 'escopo',
        escolha: 'fundacao-ampla',
        texto: null,
        autor: 'pi',
        aceitarSubstituicao: true
      },
      workspace
    )

    const final = await bridge.getWizardState(id, workspace)
    const sessao = await bridge.getPlanningSession(id, workspace)

    return {
      perguntaInicial,
      perguntaRepetida,
      escolhida: escolhida.reason,
      delegada: delegada.reason,
      recusada: recusada.reason,
      contradicao: contradicao.reason,
      temContradicoes: (contradicao.contradicoes?.length ?? 0) > 0,
      antesDaContradicao,
      depoisDaContradicao,
      substituida: substituida.reason,
      historico: final?.historico ?? [],
      etapaDaSessao: sessao?.etapa ?? null,
      respostasDaSessao: sessao?.respostas ?? {},
      auditoria: await bridge.verifyAuditChain()
    }
  }, projectId)

  // Retomada: ler não avança (critério 6).
  expect(resultado.perguntaInicial).toBe('escopo')
  expect(resultado.perguntaRepetida).toBe('escopo')

  // A escolha do PI e a delegação ao agente gravaram.
  expect(resultado.escolhida).toBe('registrada')
  expect(resultado.delegada).toBe('registrada')

  // A pergunta não delegável recusa mesmo por chamada direta à ponte — a regra é do main, não
  // do botão que a tela mostra.
  expect(resultado.recusada).toBe('nao-delegavel')

  // A contradição devolveu a decisão anterior e **não escreveu** (critério 5).
  expect(resultado.contradicao).toBe('contradicao-pendente')
  expect(resultado.temContradicoes).toBe(true)
  expect(resultado.depoisDaContradicao).toBe(resultado.antesDaContradicao)

  // Com o aceite, gravou como substituição — e o append-only preservou a linha anterior.
  expect(resultado.substituida).toBe('registrada')
  const doEscopo = resultado.historico.filter((d) => d.perguntaId === 'escopo')
  expect(doEscopo).toHaveLength(2)
  expect(doEscopo[1]?.substituiu).toBe(doEscopo[0]?.id)
  expect(doEscopo[1]?.motivo).toBe('substituida')

  // A autoria sobreviveu ao IPC: delegado é do agente, escolhido é do PI (invariante 3).
  const doPublico = resultado.historico.find((d) => d.perguntaId === 'publico')
  expect(doPublico?.autor).toBe('agente')
  expect(doPublico?.motivo).toBe('delegada')
  expect(doEscopo[0]?.autor).toBe('pi')

  // O autosave espelhou as decisões vigentes no rascunho da sessão.
  expect(resultado.etapaDaSessao).toBe('contexto')
  expect(resultado.respostasDaSessao.escopo).toBe('fundacao-ampla')

  // E nada disso quebrou a cadeia de auditoria.
  expect(resultado.auditoria.ok).toBe(true)
})
