/**
 * Anexos de design e arquitetura pela ponte real (SPEC-Planejamento-05).
 *
 * O que este teste prova e nenhum outro nível consegue:
 *
 *  1. **O `BrowserWindow` oculto carrega o protótipo de verdade.** No int-spec o carregamento é
 *     dublado, e um dublê devolve o que se mandar — ele diria que a validação funciona sem nunca
 *     abrir uma página. Aqui o Chromium do app carrega HTML real do disco, roda o script de
 *     extração e devolve as jornadas que a página de fato produziu.
 *  2. **A tela em branco só aparece com render real.** Um protótipo cujo HTML é válido mas que
 *     não mostra nada é indistinguível de um bom para qualquer parser estático.
 *  3. **O gate barra no app real**, com os arquivos no disco e nada escrito.
 *  4. **Arquivo largado no diretório não conta** — a decisão do PI inteira, provada onde o
 *     filesystem é real e a tentação de varrer seria mais forte.
 *  5. **A cadeia de auditoria continua íntegra** depois de anexar e gerar.
 *
 * **Limite do harness, declarado e não contornado:** sem consentimento do Google o app para na
 * tela de login e o AppShell nunca monta — a mesma razão registrada nas fatias irmãs. O que se
 * exercita aqui é a ponte real e o efeito no disco, no banco e no navegador; a renderização tem
 * suíte própria em `anexos.test.tsx`.
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

/** Um protótipo saudável: abre, mostra conteúdo e declara jornadas e estados. */
const HTML_BOM = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Home</title></head>
<body>
  <h1>Início</h1>
  <h2>Lista vazia</h2>
  <h2>Carregando</h2>
  <h2>Erro ao salvar</h2>
  <h2>Acesso bloqueado</h2>
  <p>Conteúdo visível do protótipo.</p>
</body></html>`

/**
 * Um protótipo que **abre em branco**: o HTML é válido, mas o script que monta a tela quebra.
 * Nenhum parser estático distingue isto de um protótipo correto — só o render.
 */
const HTML_EM_BRANCO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Quebrado</title></head>
<body>
  <div id="raiz"></div>
  <script>
    // Quebra antes de montar qualquer coisa.
    naoExiste.montar(document.getElementById('raiz'))
  </script>
</body></html>`

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-anexos-'))
  externo = mkdtempSync(join(tmpdir(), 'jarvis-e2e-externo-'))

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

/** Cria um arquivo fora do projeto, para o anexo escolher. */
function arquivoExterno(nome: string, conteudo: string): string {
  const caminho = join(externo, nome)
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, conteudo, 'utf8')
  return caminho
}

/** Cria o projeto e responde as decisões que o PRD e a arquitetura usam. */
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
    const projeto = await bridge.createProject('Projeto Anexos', workspace)
    const id = projeto.project?.id ?? ''

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

test('o gate barra sem anexo, e arquivo largado no disco não conta', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await prepararProjeto(janela)
  expect(projeto.reason).toBe('criado')
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  // Os arquivos existem no disco, nos caminhos exatos que o gate usaria — largados por fora.
  mkdirSync(join(diretorio, 'docs/prototipos'), { recursive: true })
  writeFileSync(join(diretorio, 'docs/DESIGN-SYSTEM.md'), '# largado', 'utf8')
  writeFileSync(join(diretorio, 'docs/prototipos/home.html'), HTML_BOM, 'utf8')
  expect(existsSync(join(diretorio, 'docs/DESIGN-SYSTEM.md'))).toBe(true)

  const resultado = await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          listarAnexos: (p: string) => Promise<readonly unknown[]>
          gerarArquiteturaPorIa: (
            p: string,
            w: string
          ) => Promise<{ resultado: string; pendencias?: readonly string[] }>
        }
      }
    ).jarvis
    const workspace = await bridge.getWorkspace()
    return {
      anexos: (await bridge.listarAnexos(id)).length,
      arquitetura: await bridge.gerarArquiteturaPorIa(id, workspace)
    }
  }, projectId)

  // O ato não aconteceu: nenhum anexo registrado, e o gate barra nomeando os dois.
  expect(resultado.anexos).toBe(0)
  expect(resultado.arquitetura.resultado).toBe('anexos-pendentes')
  expect(resultado.arquitetura.pendencias).toEqual(['design-system', 'prototipo'])
  // E nada foi escrito.
  expect(existsSync(join(diretorio, 'docs/ARCHITECTURE.md'))).toBe(false)
})

test('anexar copia e hasheia, o protótipo é carregado de verdade, e a arquitetura sai', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await prepararProjeto(janela)
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  // Identidade de Git local ao repositório: o runner de CI pode não ter uma global, e o commit
  // do marco falharia por motivo alheio ao que se testa (lição do E2E da M8-F04).
  execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })

  const origemDs = arquivoExterno('DESIGN-SYSTEM.md', '# Design System do projeto')
  const origemProto = arquivoExterno('home.html', HTML_BOM)

  const resultado = await janela.evaluate(
    async ([id, ds, proto]: readonly string[]) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            getWorkspace: () => Promise<string>
            anexarDesign: (
              p: string,
              t: string,
              o: string,
              w: string
            ) => Promise<{ reason: string; anexo?: { caminho: string; hash: string } }>
            validarPrototipos: (
              p: string
            ) => Promise<
              readonly { jornadasCobertas: readonly string[]; achados: readonly unknown[] }[]
            >
            gerarArquiteturaPorIa: (
              p: string,
              w: string
            ) => Promise<{ resultado: string; pendencias?: readonly string[] }>
            gerarPacote: (p: string, c: string, w: string) => Promise<{ reason: string }>
            verifyAuditChain: () => Promise<{ ok: boolean }>
          }
        }
      ).jarvis
      const workspace = await bridge.getWorkspace()

      // O PRD primeiro: a arquitetura precisa citar a revisão que assume (critério 3). Consulta
      // vazia — o caminho que não gasta crédito e exercita a composição inteira.
      const prd = await bridge.gerarPacote(id ?? '', '', workspace)

      const anexoDs = await bridge.anexarDesign(id ?? '', 'design-system', ds ?? '', workspace)
      const anexoProto = await bridge.anexarDesign(id ?? '', 'prototipo', proto ?? '', workspace)

      // A validação carrega o protótipo no `BrowserWindow` oculto — Chromium de verdade.
      const validacoes = await bridge.validarPrototipos(id ?? '')

      // Com o gate aberto, a geração passa dele e chega **na rota** — que neste ambiente não
      // existe. É o desfecho que se pode provar aqui sem chamar um modelo de verdade.
      const arquitetura = await bridge.gerarArquiteturaPorIa(id ?? '', workspace)

      return {
        prd: prd.reason,
        anexoDs,
        anexoProto,
        jornadas: validacoes[0]?.jornadasCobertas ?? [],
        achados: validacoes[0]?.achados.length ?? 0,
        arquitetura,
        auditoria: await bridge.verifyAuditChain()
      }
    },
    [projectId, origemDs, origemProto]
  )

  expect(resultado.prd).toBe('gerado')

  // (1) O ato copiou para dentro do projeto e hasheou.
  expect(resultado.anexoDs.reason).toBe('anexado')
  expect(resultado.anexoDs.anexo?.caminho).toBe('docs/DESIGN-SYSTEM.md')
  expect(resultado.anexoDs.anexo?.hash).toHaveLength(64)
  expect(readFileSync(join(diretorio, 'docs/DESIGN-SYSTEM.md'), 'utf8')).toBe(
    '# Design System do projeto'
  )
  expect(readFileSync(join(diretorio, 'docs/prototipos/home.html'), 'utf8')).toBe(HTML_BOM)

  // (2) **O Chromium carregou o protótipo de verdade**: as jornadas saíram do DOM renderizado,
  // não de um dublê. Nenhum teste de integração alcança isto.
  expect(resultado.jornadas).toContain('Início')
  expect(resultado.jornadas).toContain('Lista vazia')
  // Protótipo saudável: sem achado que impeça.
  expect(resultado.achados).toBe(0)

  /*
   * (3) **O gate abriu.** Desde a SPEC-Jornada-04 a arquitetura é gerada por modelo, e este
   * ambiente não tem rota autorizada — então o desfecho provável aqui é `bloqueado-sem-rota`, e
   * **é justamente ele que prova o que interessa**: a geração passou do gate de anexos e do PRD,
   * e parou na rota. `anexos-pendentes` ou `prd-ausente` aqui significariam que o gate não
   * reconheceu o que acabou de ser anexado.
   *
   * O que a geração faz depois da rota tem prova própria no `arquitetura-service.int-spec.ts`,
   * com o modelo dublado; o que **só** este nível alcança é o Chromium carregando o protótipo,
   * medido em (2).
   */
  expect(['bloqueado-sem-rota', 'gerada']).toContain(resultado.arquitetura.resultado)
  expect(resultado.arquitetura.pendencias).toBeUndefined()

  // (4) Nada foi escrito quando a geração não aconteceu — a recusa não deixa arquivo pela metade.
  if (resultado.arquitetura.resultado === 'bloqueado-sem-rota') {
    expect(existsSync(join(diretorio, 'docs/ARCHITECTURE.md'))).toBe(false)
  }

  // (5) A cadeia de auditoria continua íntegra — inclusive com o evento do bloqueio, que é
  // registrado **antes** de qualquer chamada.
  expect(resultado.auditoria.ok).toBe(true)
})

/**
 * O teste que justifica o `BrowserWindow`: um protótipo cujo HTML é **válido** e que mesmo assim
 * não mostra nada. Parser estático nenhum distingue isto de um protótipo correto — é preciso
 * carregar a página e olhar o resultado.
 */
test('protótipo que abre em branco é detectado e impede a arquitetura', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await prepararProjeto(janela)
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })

  const origemDs = arquivoExterno('DESIGN-SYSTEM.md', '# DS')
  const origemProto = arquivoExterno('quebrado.html', HTML_EM_BRANCO)

  const resultado = await janela.evaluate(
    async ([id, ds, proto]: readonly string[]) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            getWorkspace: () => Promise<string>
            anexarDesign: (p: string, t: string, o: string, w: string) => Promise<unknown>
            gerarPacote: (p: string, c: string, w: string) => Promise<{ reason: string }>
            gerarArquiteturaPorIa: (
              p: string,
              w: string
            ) => Promise<{
              resultado: string
              achados?: readonly { pergunta: string; recomendacao: string; evidencia: string }[]
            }>
          }
        }
      ).jarvis
      const workspace = await bridge.getWorkspace()
      await bridge.gerarPacote(id ?? '', '', workspace)
      await bridge.anexarDesign(id ?? '', 'design-system', ds ?? '', workspace)
      await bridge.anexarDesign(id ?? '', 'prototipo', proto ?? '', workspace)
      return await bridge.gerarArquiteturaPorIa(id ?? '', workspace)
    },
    [projectId, origemDs, origemProto]
  )

  // O gate de anexos abriu (os dois estão lá), e mesmo assim a arquitetura não sai: o protótipo
  // não delimita fluxo nenhum, e prosseguir escreveria o que ninguém viu.
  expect(resultado.resultado).toBe('prototipos-invalidos')
  expect(resultado.achados?.length ?? 0).toBeGreaterThan(0)
  // O achado é pergunta + recomendação, como a spec pede.
  expect(resultado.achados?.[0]?.pergunta).toContain('?')
  expect(resultado.achados?.[0]?.recomendacao).toBeTruthy()

  /*
   * A evidência aponta o erro **do protótipo**, e só ele. Três coisas que o E2E pegou e que
   * nenhum dublê pegaria, porque só o Chromium real as produz:
   *
   *  - o erro do script do protótipo está lá (é o que explica a tela em branco);
   *  - o aviso de CSP do **próprio Electron** não está — ele descreveria o protótipo do PI como
   *    problemático por uma decisão nossa de como o carregamos;
   *  - nada aparece duas vezes: o Electron entrega o mesmo evento pelo caminho legado e pelo
   *    novo, e a mensagem chegava duplicada.
   */
  const evidencia = resultado.achados?.[0]?.evidencia ?? ''
  expect(evidencia).toContain('naoExiste is not defined')
  expect(evidencia).not.toContain('Electron Security Warning')
  expect(evidencia.split('naoExiste is not defined')).toHaveLength(2)

  // E nada foi escrito.
  expect(existsSync(join(diretorio, 'docs/ARCHITECTURE.md'))).toBe(false)
})
