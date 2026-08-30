/**
 * Roadmap e centro de aprovações pela ponte real (SPEC-Planejamento-06).
 *
 * O que este teste prova e nenhum outro nível consegue:
 *
 *  1. **O `STATUS.md` existe no disco do projeto**, com o índice Fatia ↔ SPEC — a invariante 1
 *     tomando forma de arquivo, e não de estrutura em memória.
 *  2. **A SPEC da próxima fatia é escrita, e nasce `rascunho`** — no int-spec o conteúdo é
 *     verificado em memória; aqui ele está no arquivo que o MVP-009 vai ler.
 *  3. **Sem sessão autenticada, o gate falha fechado no app real.** O E2E roda sem consentimento
 *     do Google, então `auth.usuarioAtual()` é `undefined` — que é exatamente a condição da
 *     decisão cravada da spec. Nos testes o `identidade` é injetado; aqui é o de produção.
 *  4. **A cadeia de auditoria continua íntegra** depois de gerar.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta — a mesma razão registrada nas fatias irmãs. Isso torna
 * o E2E do *caminho feliz* de aprovação impossível aqui (não há sessão para aprovar), e é por
 * isso que ele é exercitado no int-spec, com identidade injetada. O que este arquivo prova é o
 * inverso, e é o que só o app real prova: **sem sessão, não aprova**.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string
let externo: string

interface OutcomeDaPonte {
  readonly reason: string
  readonly mensagem: string
  readonly project?: { readonly id: string; readonly nome: string; readonly diretorio: string }
}

/** Um protótipo com jornadas declaradas: é delas que o roadmap compõe os MVPs. */
const HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Home</title></head>
<body>
  <h1>Cadastro de cliente</h1>
  <h2>Lista vazia</h2>
  <h2>Carregando</h2>
  <h2>Erro ao salvar</h2>
  <h2>Acesso bloqueado</h2>
  <p>Conteúdo visível.</p>
</body></html>`

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-roadmap-'))
  externo = mkdtempSync(join(tmpdir(), 'jarvis-e2e-roadmap-ext-'))

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
  rmSync(externo, { recursive: true, force: true })
})

function arquivoExterno(nome: string, conteudo: string): string {
  const caminho = join(externo, nome)
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, conteudo, 'utf8')
  return caminho
}

/** Cria o projeto, decide o escopo e anexa o protótipo de onde as jornadas saem. */
async function prepararProjeto(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  ds: string,
  proto: string
): Promise<OutcomeDaPonte> {
  return await janela.evaluate(
    async ([dsPath, protoPath]: readonly string[]) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            getWorkspace: () => Promise<string>
            addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
            createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
            answerWizard: (p: string, r: unknown, w: string) => Promise<{ reason: string }>
            anexarDesign: (p: string, t: string, o: string, w: string) => Promise<unknown>
          }
        }
      ).jarvis
      const workspace = await bridge.getWorkspace()
      await bridge.addAllowedCommand('git', workspace)
      const projeto = await bridge.createProject('Projeto Roadmap', workspace)
      const id = projeto.project?.id ?? ''

      for (const [perguntaId, escolha] of [
        ['escopo', 'fatia-vertical'],
        ['publico', 'uso-proprio'],
        ['superficie', 'interface-grafica']
      ]) {
        await bridge.answerWizard(id, { perguntaId, escolha, texto: null, autor: 'pi' }, workspace)
      }

      await bridge.anexarDesign(id, 'design-system', dsPath ?? '', workspace)
      await bridge.anexarDesign(id, 'prototipo', protoPath ?? '', workspace)

      return projeto
    },
    [ds, proto]
  )
}

test('o roadmap sai das jornadas, escreve STATUS e a SPEC nasce rascunho', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const ds = arquivoExterno('DESIGN-SYSTEM.md', '# DS')
  const proto = arquivoExterno('home.html', HTML)
  const projeto = await prepararProjeto(janela, ds, proto)

  expect(projeto.reason).toBe('criado')
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  // Identidade de Git local ao repositório: o runner de CI pode não ter uma global (lição da
  // M8-F04). O app não configura identidade de propósito — o repositório é do usuário.
  execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })

  const resultado = await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          gerarRoadmap: (
            p: string,
            w: string
          ) => Promise<{
            reason: string
            mensagem: string
            proxima?: { specSlug: string; titulo: string }
            roadmap?: { mvps: readonly { titulo: string; estado: string }[] }
          }>
          verifyAuditChain: () => Promise<{ ok: boolean }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    return {
      roadmap: await bridge.gerarRoadmap(id, workspace),
      auditoria: await bridge.verifyAuditChain()
    }
  }, projectId)

  expect(resultado.roadmap.reason).toBe('gerado')

  // (1) O MVP saiu da **jornada que o protótipo mostrou** — não de uma invenção.
  expect(resultado.roadmap.roadmap?.mvps.map((m) => m.titulo)).toContain('Cadastro de cliente')

  // (2) Os MVPs nascem propostos: gerar não promove (critério 3).
  expect(resultado.roadmap.roadmap?.mvps.every((m) => m.estado === 'proposto')).toBe(true)

  // (3) O STATUS existe no disco, com o índice que a invariante 1 protege.
  const status = readFileSync(join(diretorio, 'docs/STATUS.md'), 'utf8')
  expect(status).toContain('Índice Fatia ↔ SPEC')
  expect(status).toContain('Fonte única')
  expect(existsSync(join(diretorio, 'docs/STATUS-ARQUIVO.md'))).toBe(true)

  // (4) A SPEC da próxima fatia está no disco e **nasce rascunho** — uma spec que nascesse
  // aprovada faria a geração aprovar a si mesma.
  const specPath = resultado.roadmap.proxima?.specSlug ?? ''
  expect(specPath).toBeTruthy()
  const spec = readFileSync(join(diretorio, specPath), 'utf8')
  expect(spec).toContain('**rascunho**')
  expect(spec).not.toContain('aprovada-pi')

  // (5) A cadeia de auditoria continua íntegra.
  expect(resultado.auditoria.ok).toBe(true)
})

/**
 * O teste que só o app real permite: **sem sessão autenticada, o gate falha fechado**.
 *
 * No int-spec a identidade é injetada, então "sem sessão" é uma condição simulada. Aqui ela é a
 * condição de produção — o E2E roda sem consentimento do Google, e `auth.usuarioAtual()` devolve
 * `undefined` de verdade. É a decisão cravada da spec sendo exercitada pelo caminho real.
 */
test('sem sessão autenticada, o gate recusa e não grava aprovação', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const ds = arquivoExterno('DESIGN-SYSTEM.md', '# DS')
  const proto = arquivoExterno('home.html', HTML)
  const projeto = await prepararProjeto(janela, ds, proto)
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })

  const resultado = await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          gerarRoadmap: (p: string, w: string) => Promise<{ reason: string }>
          revisoesDoGate: (
            p: string,
            g: string,
            w: string
          ) => Promise<readonly { artefato: string; hash: string }[]>
          aprovarGate: (
            p: string,
            g: string,
            w: string
          ) => Promise<{ reason: string; mensagem: string }>
          listarAprovacoes: (p: string, w: string) => Promise<readonly unknown[]>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    await bridge.gerarRoadmap(id, workspace)

    return {
      // O gate **tem** o que aprovar — as revisões existem.
      revisoes: (await bridge.revisoesDoGate(id, 'MVP_ENTRY', workspace)).length,
      aprovacao: await bridge.aprovarGate(id, 'MVP_ENTRY', workspace),
      registradas: (await bridge.listarAprovacoes(id, workspace)).length
    }
  }, projectId)

  // Há o que aprovar, e mesmo assim recusa: a falta é de **identidade**, não de objeto.
  expect(resultado.revisoes).toBeGreaterThan(0)
  expect(resultado.aprovacao.reason).toBe('sem-identidade')
  // A mensagem diz o que fazer, não só que falhou.
  expect(resultado.aprovacao.mensagem).toContain('conta')
  // E nenhuma linha foi gravada: falha fechado, nunca "aprova como anônimo".
  expect(resultado.registradas).toBe(0)
})
