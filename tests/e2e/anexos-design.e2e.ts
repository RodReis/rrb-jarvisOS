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
 * Um protótipo como as ferramentas de design os exportam: a tela é declarada em
 * `data-screen-label` e o estado aparece no **corpo** de um cartão, não num heading.
 *
 * O `HTML_BOM` acima põe cada estado num `h2` — a única forma que o extrator enxergava —, e por
 * isso passava com o defeito presente. Este fixture é o protótipo real do PI reduzido ao osso:
 * ele **mostra** o bloqueio ("Assinatura necessária", "Desbloqueie o painel"), e a validação
 * afirmava que o estado não existe. Um achado falso ensina o PI a ignorar a lista inteira, que é
 * o que `SINAIS_DO_ESTADO` diz existir para evitar (issue #332).
 */
const HTML_ESTADO_FORA_DO_HEADING = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Painel</title></head>
<body>
  <div data-screen-label="Dashboard">
    <h1>Painel de cotações</h1>
    <div class="card">
      <span class="tag">Assinatura necessária</span>
      <div class="card-title">Desbloqueie o painel de cotações</div>
      <p>Assine para acompanhar a cotação na sua região.</p>
    </div>
    <div class="card">
      <div class="card-title">Nenhum material selecionado</div>
      <p>Carregando as cotações do dia…</p>
      <p>Erro ao consultar a fonte de preços.</p>
    </div>
  </div>
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

test('anexar copia e hasheia, e o protótipo é carregado de verdade', async () => {
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

      // O pacote estrutural da M8-F04, com consulta vazia: o caminho que não gasta crédito.
      // Ele **não** basta para a arquitetura desde a SPEC-Jornada-04 — ver a nota em (3).
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
   * (3) **O gate de anexos abriu, e a geração parou no PRD.**
   *
   * `prd-ausente` é o desfecho **correto** aqui, e não uma falha do teste: desde a
   * SPEC-Jornada-04 a arquitetura ancora cada afirmação num **id de requisito** do PRD gerado
   * (tabela `project_prd`), e `gerarPacote` é o caminho da M8-F04 — ele escreve os documentos
   * compostos, cujas afirmações não têm id para citar. Semear o PRD novo exigiria a rota de IA,
   * que este ambiente não tem.
   *
   * O que **importa** e está provado: não veio `anexos-pendentes`. O gate reconheceu os dois
   * anexos que acabaram de ser copiados e hasheados, que é a fronteira que este nível mede.
   * O resto da geração tem prova própria no `arquitetura-service.int-spec.ts`, com o modelo
   * dublado, e o que só aqui se alcança é o Chromium carregando o protótipo, medido em (2).
   */
  expect(resultado.arquitetura.resultado).not.toBe('anexos-pendentes')
  expect(resultado.arquitetura.pendencias).toBeUndefined()

  // (4) Nada foi escrito: a recusa não deixa arquivo pela metade.
  expect(existsSync(join(diretorio, 'docs/ARCHITECTURE.md'))).toBe(false)

  // (5) A cadeia de auditoria continua íntegra.
  expect(resultado.auditoria.ok).toBe(true)
})

/**
 * O teste que justifica o `BrowserWindow`: um protótipo cujo HTML é **válido** e que mesmo assim
 * não mostra nada. Parser estático nenhum distingue isto de um protótipo correto — é preciso
 * carregar a página e olhar o resultado.
 */
test('protótipo que abre em branco é detectado pela validação', async () => {
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
            validarPrototipos: (p: string) => Promise<
              readonly {
                achados: readonly { pergunta: string; recomendacao: string; evidencia: string }[]
              }[]
            >
          }
        }
      ).jarvis
      const workspace = await bridge.getWorkspace()
      await bridge.anexarDesign(id ?? '', 'design-system', ds ?? '', workspace)
      await bridge.anexarDesign(id ?? '', 'prototipo', proto ?? '', workspace)

      // **A validação, não a geração.** O achado que impede a arquitetura nasce aqui — é o que
      // o `ArquiteturaService` lê antes de chamar o modelo, e é o que só o Chromium produz.
      // Passar pela geração exigiria o PRD novo e a rota de IA, e mediria outra coisa.
      const validacoes = await bridge.validarPrototipos(id ?? '')
      return { achados: validacoes.flatMap((v) => v.achados) }
    },
    [projectId, origemDs, origemProto]
  )

  // O protótipo está anexado e mesmo assim não delimita fluxo nenhum: o achado é o que impede
  // a arquitetura de prometer o que ninguém viu.
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

/**
 * O estado que o protótipo **mostra** fora de um heading.
 *
 * O extrator lia texto só de `h1, h2, h3, [data-jornada], [data-estado]`, e é assim que o
 * `HTML_BOM` declara os quatro estados — por isso ele passava com o defeito presente. Protótipo
 * de ferramenta de design não se parece com aquilo: a tela vem em `data-screen-label` e o estado
 * aparece no corpo de um cartão. O teste do PI encontrou a consequência: a validação afirmando
 * que não há estado de bloqueio num protótipo cujo cartão diz "Assinatura necessária" em três
 * telas (issue #332).
 *
 * O que se afirma aqui é a **ausência** do achado falso, e a presença dos verdadeiros: o
 * protótipo cobre bloqueio, vazio, loading e erro, então nenhuma das quatro perguntas de estado
 * deve sair. Afirmar só "há menos achados" passaria com o extrator antigo.
 */
test('estado mostrado fora de heading é reconhecido pela validação', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const projeto = await prepararProjeto(janela)
  const projectId = projeto.project?.id ?? ''
  const diretorio = projeto.project?.diretorio ?? ''

  execFileSync('git', ['config', 'user.email', 'teste@jarvis'], { cwd: diretorio })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: diretorio })

  const origemDs = arquivoExterno('DESIGN-SYSTEM.md', '# DS')
  const origemProto = arquivoExterno('painel.html', HTML_ESTADO_FORA_DO_HEADING)

  const resultado = await janela.evaluate(
    async ([id, ds, proto]: readonly string[]) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            getWorkspace: () => Promise<string>
            anexarDesign: (p: string, t: string, o: string, w: string) => Promise<unknown>
            validarPrototipos: (p: string) => Promise<
              readonly {
                jornadasCobertas: readonly string[]
                achados: readonly { id: string; pergunta: string }[]
              }[]
            >
          }
        }
      ).jarvis
      const workspace = await bridge.getWorkspace()
      await bridge.anexarDesign(id ?? '', 'design-system', ds ?? '', workspace)
      await bridge.anexarDesign(id ?? '', 'prototipo', proto ?? '', workspace)

      const validacoes = await bridge.validarPrototipos(id ?? '')
      return {
        jornadas: validacoes[0]?.jornadasCobertas ?? [],
        achados: validacoes.flatMap((v) => v.achados).map((a) => a.id)
      }
    },
    [projectId, origemDs, origemProto]
  )

  // Os quatro estados estão na tela, então nenhuma pergunta de estado ausente se justifica.
  const estadosAusentes = resultado.achados.filter((id) => id.includes(':estado-ausente:'))
  expect(estadosAusentes).toEqual([])

  // E a tela declarada em `data-screen-label` é jornada coberta: é ela que a arquitetura cita
  // como âncora, e sem lê-la o fluxo do dashboard não teria tela que o desenhou.
  expect(resultado.jornadas).toContain('Dashboard')
})
