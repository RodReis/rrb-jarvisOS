/**
 * O pacote estrutural pela ponte real (SPEC-Planejamento-04).
 *
 * O que este teste prova e nenhum teste de componente consegue: **os documentos existem no disco
 * do projeto, com origem em cada linha, e o pacote atravessou IPC, serviço, banco e Git**. No
 * teste de componente a ponte é dublada, e um dublê aceita qualquer coisa — ele diria que a tela
 * pede a geração sem nunca provar que o `PRD.md` foi escrito, que a marca de origem chegou ao
 * arquivo, ou que a pesquisa bloqueada **não** deixou documento nenhum.
 *
 * Os quatro fatos que só existem aqui:
 *  1. Os três arquivos aparecem sob `docs/` do projeto real, escritos pelo main.
 *  2. Cada afirmação do PRD carrega a decisão que a originou — no arquivo, não em memória.
 *  3. **Sem credencial da Tavily, a pesquisa bloqueia e nada é escrito** (critério 3) — e o
 *     bloqueio chega com os cinco campos que a CONVENTION §4 exige.
 *  4. A cadeia de auditoria continua íntegra depois de tudo.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta — a mesma razão registrada nas fatias irmãs. O que se
 * exercita aqui é a ponte real e o efeito no disco e no banco; a renderização tem suíte própria
 * em `pacote.test.tsx`.
 *
 * **A Tavily não é chamada de verdade.** Sem credencial configurada, o `ConnectorService` recusa
 * antes de qualquer rede — e é justamente esse o caminho que o critério 3 descreve. Exercitar a
 * API real gastaria crédito para provar o que a M6-F05/F06 já prova no smoke dela.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-pacote-'))

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

/** Cria um projeto real e responde as três perguntas que o PRD usa. */
async function prepararProjeto(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<OutcomeDaPonte> {
  return await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          answerWizard: (p: string, r: unknown, w: string) => Promise<{ reason: string }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)
    const projeto = await bridge.createProject('Projeto Pacote', workspace)
    const id = projeto.project?.id ?? ''

    // As três decisões que o PRD consome, pelo caminho real do wizard (M8-F03).
    for (const [perguntaId, escolha] of [
      ['escopo', 'fatia-vertical'],
      ['publico', 'uso-proprio'],
      ['superficie', 'interface-grafica']
    ]) {
      await bridge.answerWizard(id, { perguntaId, escolha, texto: null, autor: 'pi' }, workspace)
    }

    return projeto
  })
}

test('o pacote nasce das decisões, vira arquivo com origem e commita', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await prepararProjeto(janela)
  expect(projeto.reason).toBe('criado')
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  // Consulta vazia: o Landscape sai sem cenário e **declara** isso. É o caminho que não gasta
  // crédito e ainda exercita a composição inteira, a escrita e o commit.
  const resultado = await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          gerarPacote: (
            p: string,
            c: string,
            w: string
          ) => Promise<{
            reason: string
            mensagem: string
            pacote?: {
              hash: string
              commitHash: string | null
              documentos: readonly { documento: string; caminho: string; hash: string }[]
            }
          }>
          listarPacotes: (p: string) => Promise<readonly { hash: string }[]>
          verifyAuditChain: () => Promise<{ ok: boolean }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    const primeiro = await bridge.gerarPacote(id, '', workspace)
    // Gerar de novo com o mesmo conteúdo é a **mesma** revisão (invariante 2 do CONVENTION §4).
    const segundo = await bridge.gerarPacote(id, '', workspace)

    return {
      primeiro,
      mesmoHash: primeiro.pacote?.hash === segundo.pacote?.hash,
      pacotes: (await bridge.listarPacotes(id)).length,
      auditoria: await bridge.verifyAuditChain()
    }
  }, projectId)

  expect(resultado.primeiro.reason).toBe('gerado')

  // (1) Os três arquivos existem no disco do projeto.
  for (const nome of ['PRD.md', 'LANDSCAPE.md', 'CONVENTION.md']) {
    expect(existsSync(join(diretorio, 'docs', nome))).toBe(true)
  }

  // (2) A marca de origem chegou ao arquivo — não é promessa em memória.
  const prd = readFileSync(join(diretorio, 'docs', 'PRD.md'), 'utf8')
  expect(prd).toContain('<!-- origem: decisao/escopo')
  expect(prd).toContain('## Escopo')
  expect(prd).toContain('## Não objetivos')

  // A Convention não importou política deste repositório.
  const convention = readFileSync(join(diretorio, 'docs', 'CONVENTION.md'), 'utf8')
  expect(convention).not.toContain('proplan:')

  // O Landscape sem pesquisa **declara** a ausência em vez de fingir cobertura.
  const landscape = readFileSync(join(diretorio, 'docs', 'LANDSCAPE.md'), 'utf8')
  expect(landscape).toContain('## Cenário')
  expect(landscape).toContain('_Sem conteúdo registrado nesta revisão._')

  // Mesma revisão não vira pacote novo.
  expect(resultado.mesmoHash).toBe(true)
  expect(resultado.pacotes).toBe(1)

  // O marco virou commit no repositório do projeto.
  expect(resultado.primeiro.pacote?.commitHash).toBeTruthy()

  // (4) Nada disso quebrou a cadeia de auditoria.
  expect(resultado.auditoria.ok).toBe(true)
})

test('sem credencial da Tavily a pesquisa bloqueia e nada é escrito (critério 3)', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await prepararProjeto(janela)
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  const resultado = await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          gerarPacote: (
            p: string,
            c: string,
            w: string
          ) => Promise<{
            reason: string
            bloqueio?: {
              causa: string
              evidencia: string
              tentativas: number
              porQueNaoSeguir: string
              retomada: string
            }
          }>
          listarPacotes: (p: string) => Promise<readonly unknown[]>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    // Com consulta, a pesquisa sai — e sem credencial configurada o `ConnectorService` recusa
    // antes de tocar a rede.
    const bloqueado = await bridge.gerarPacote(id, 'concorrentes de gestor de tarefas', workspace)

    return { bloqueado, pacotes: (await bridge.listarPacotes(id)).length }
  }, projectId)

  expect(resultado.bloqueado.reason).toBe('pesquisa-bloqueada')

  // Os cinco campos que a CONVENTION §4 exige — "sem esses campos, o bloqueio é inválido".
  const b = resultado.bloqueado.bloqueio
  expect(b?.causa).toBeTruthy()
  expect(b?.evidencia).toBeTruthy()
  expect(b?.tentativas).toBeGreaterThan(0)
  expect(b?.porQueNaoSeguir).toBeTruthy()
  expect(b?.retomada).toBeTruthy()

  // E o que o critério 3 realmente protege: **nada foi escrito**.
  expect(resultado.pacotes).toBe(0)
  expect(existsSync(join(diretorio, 'docs', 'PRD.md'))).toBe(false)
  expect(existsSync(join(diretorio, 'docs', 'LANDSCAPE.md'))).toBe(false)
})
