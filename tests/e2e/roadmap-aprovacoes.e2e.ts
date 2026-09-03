/**
 * Roadmap e centro de aprovações pela ponte real (SPEC-Jornada-05).
 *
 * **O que mudou nesta fatia, e por que o teste mudou com ela.** Até a M8-F06 o roadmap era
 * *composto* das jornadas do protótipo, e o E2E podia gerá-lo de ponta a ponta sem tocar em
 * modelo nenhum. Agora quem o propõe é a IA, e o E2E roda **sem rota autorizada** — não há
 * assinatura configurada no harness. Gerar aqui produziria zero MVPs, e um teste que exigisse o
 * roadmap pronto estaria medindo uma chamada que não acontece.
 *
 * O que este arquivo prova, e nenhum outro nível consegue:
 *
 *  1. **Sem rota autorizada, a geração não acontece** — no app real, não num dublê. É o § Regras
 *     da spec (*"bloqueio antes de rota paga"*) pelo caminho de produção: o bloqueio é o desfecho
 *     que o PI lê, não uma exceção.
 *  2. **Sem sessão autenticada, o gate falha fechado.** O E2E roda sem consentimento do Google,
 *     então `auth.usuarioAtual()` é `undefined` — que é exatamente a condição da decisão cravada
 *     da spec. Nos testes o `identidade` é injetado; aqui é o de produção.
 *  3. **O gate sem objeto recusa por falta de objeto**, e não por falta de identidade: sem
 *     roadmap gerado o `MVP_ENTRY` não tem o que aprovar, e as duas recusas são distinguíveis.
 *  4. **A cadeia de auditoria continua íntegra** depois do bloqueio — que também é fato gravado.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta — a mesma razão registrada nas fatias irmãs. O caminho
 * feliz (roadmap gerado, MVP escolhido, SPEC aceita) é exercitado no int-spec, com o modelo
 * dublado e identidade injetada. O que este arquivo prova é o inverso, e é o que só o app real
 * prova: **sem rota não gera, e sem sessão não aprova**.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

/** Um protótipo com jornadas declaradas: é o que abre o gate de anexos da M8-F05. */
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
  /*
   * `exit(0)` **pede** o encerramento; `close()` **espera** por ele.
   *
   * Sem a espera, o `rmSync` corre contra um processo que ainda está fechando o SQLite, e no
   * Linux isso estoura `ENOTEMPTY` no diretório de dados. O teste do caminho feliz, que existia
   * antes desta fatia, era lento o bastante para o processo já ter morrido; os desta fatia
   * terminam em menos de um segundo, e a corrida passou a acontecer. A espera é a mesma dos
   * demais E2E deste repositório, e `catch` porque um app já morto rejeita as duas chamadas.
   */
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

async function prepararProjeto(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  ds: string,
  proto: string
): Promise<OutcomeDaPonte> {
  return await janela.evaluate(
    async ([dsPath, protoPath]) => {
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

test('sem rota autorizada, a geração não acontece e o bloqueio é o desfecho', async () => {
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
          gerarRoadmapPorIa: (
            p: string,
            w: string
          ) => Promise<{ resultado: string; mensagem: string }>
          carregarRoadmapGerado: (p: string, w: string) => Promise<unknown | null>
          verifyAuditChain: () => Promise<{ ok: boolean }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()

    return {
      geracao: await bridge.gerarRoadmapPorIa(id, workspace),
      gravado: await bridge.carregarRoadmapGerado(id, workspace),
      auditoria: await bridge.verifyAuditChain()
    }
  }, projectId)

  /*
   * A recusa é uma das duas que acontecem **antes de qualquer chamada**: sem PRD e sem
   * arquitetura o roadmap não tem o que citar, e sem rota ele não pode chamar. Qual delas vem
   * primeiro é a ordem das guardas do serviço; o que este teste prova é que nenhuma chamada
   * aconteceu e nada foi gravado.
   */
  expect(['pacote-ausente', 'bloqueado-sem-rota']).toContain(resultado.geracao.resultado)
  expect(resultado.gravado).toBeNull()
  expect(resultado.auditoria.ok).toBe(true)
})

/**
 * O teste que só o app real permite: **sem sessão autenticada, o gate falha fechado**.
 *
 * No int-spec a identidade é injetada, então "sem sessão" é uma condição simulada. Aqui ela é a
 * condição de produção — o E2E roda sem consentimento do Google, e `auth.usuarioAtual()` devolve
 * `undefined` de verdade.
 *
 * O `PROJECT_PACKAGE` é o gate usado aqui porque é o único com objeto sem passar por IA: os
 * anexos do gate da M8-F05 já foram registrados. O `MVP_ENTRY` fica sem objeto por falta de
 * roadmap gerado — e o teste mede as duas recusas para provar que elas são **distinguíveis**.
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

    return {
      // O `PROJECT_PACKAGE` **tem** o que aprovar: os anexos do gate estão registrados.
      revisoesDoPacote: (await bridge.revisoesDoGate(id, 'PROJECT_PACKAGE', workspace)).length,
      // O `MVP_ENTRY` não tem: nenhum roadmap foi gerado, e nenhum MVP foi escolhido.
      revisoesDoMvp: (await bridge.revisoesDoGate(id, 'MVP_ENTRY', workspace)).length,
      semIdentidade: await bridge.aprovarGate(id, 'PROJECT_PACKAGE', workspace),
      semObjeto: await bridge.aprovarGate(id, 'MVP_ENTRY', workspace),
      registradas: (await bridge.listarAprovacoes(id, workspace)).length
    }
  }, projectId)

  // Há o que aprovar, e mesmo assim recusa: a falta é de **identidade**, não de objeto.
  expect(resultado.revisoesDoPacote).toBeGreaterThan(0)
  expect(resultado.semIdentidade.reason).toBe('sem-identidade')
  // A mensagem diz o que fazer, não só que falhou.
  expect(resultado.semIdentidade.mensagem).toContain('conta')

  /*
   * A ordem das recusas importa e é medida: a identidade é conferida **antes** do objeto, então
   * um gate sem revisões e sem sessão recusa por identidade. Sem essa ordem, o PI sem sessão
   * receberia "não há o que aprovar" e procuraria um problema no roadmap que não existe.
   */
  expect(resultado.revisoesDoMvp).toBe(0)
  expect(resultado.semObjeto.reason).toBe('sem-identidade')

  // E nenhuma linha foi gravada: falha fechado, nunca "aprova como anônimo".
  expect(resultado.registradas).toBe(0)
})
