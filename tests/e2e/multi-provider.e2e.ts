import { mkdtempSync, rmSync } from 'node:fs'
/**
 * **Nota da M8-F02:** as chamadas desta suíte declaram `diagnostico: true`.
 *
 * Não é atalho para escapar do gate do critério 1 ("nenhuma geração sem ContextPack"): é o que
 * elas de fato **são**. O que se prova aqui é o comportamento do ponto único — stream, gate de
 * orçamento, roteamento —, sem projeto e sem manifesto envolvidos, que é exatamente o caso do
 * painel de diagnóstico do Settings. O gate em si tem prova própria, com o contrafactual, em
 * `contexto-orcamento.e2e.ts`.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * Multi-provider e roteamento no **app real** (SPEC-Providers-04, critérios 1, 3, 4, 6 e 8).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que **todos** os adapters do catálogo
 * estão montados no ponto único, que o roteamento decide de verdade e que o fallback acontece
 * com o healthcheck real — a sonda aqui é a do boot, não uma dublada.
 *
 * O cenário é o do desenvolvedor comum: **sem credencial de nuvem e sem Ollama rodando**. Com
 * isso, `anthropic` e `gemini` estão indisponíveis por falta de chave, o Ollama por não ter
 * servidor, e o `claude-code` depende de o binário existir. É o pior caso — e é justamente ele
 * que prova o critério 6: provider indisponível não é escolhido.
 */

let app: ElectronApplication
let userData: string

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-providers-'))

  // `ELECTRON_RUN_AS_NODE` herdado faz o Electron subir como Node puro (ver `login.e2e.ts`).
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
      // **Sem** `JARVIS_CREDENTIAL_*`: é o que torna os providers de nuvem indisponíveis, que
      // é o cenário do teste.
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
  app.process().stdout?.on('data', (c: Buffer) => console.error(`[electron stdout] ${c}`))
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam por causa do tray e dos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`).
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
})

test('a ponte expõe os canais de provider e roteamento, e nenhum que decida', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const metodos = await janela.evaluate(() =>
    Object.keys((window as unknown as { jarvis: Record<string, unknown> }).jarvis).sort()
  )

  expect(metodos).toContain('getProviderStatus')
  expect(metodos).toContain('getProviderModels')
  expect(metodos).toContain('setProviderModel')
  expect(metodos).toContain('getRouting')
  expect(metodos).toContain('setRoute')

  // **Nenhum canal de seleção**: quem escolhe quem atende é o ponto único, no main. Um método
  // aqui daria ao renderer uma decisão que ele só poderia duplicar — e as duas divergiriam.
  expect(metodos.filter((m) => /selectProvider|chooseProvider|routeFor/i.test(m))).toEqual([])
  // E nenhum que devolva credencial, a guarda herdada da F01.
  expect(metodos.filter((m) => /reveal|secret|getCredential/i.test(m))).toEqual([])
})

test('o status cobre todos os providers do catálogo, com origem e custo corretos', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const status = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          getProviderStatus: (w: string) => Promise<
            ReadonlyArray<{
              provider: string
              estado: string
              origem: string
              unmetered: boolean
              modelo: string
            }>
          >
        }
      }
    ).jarvis.getProviderStatus('jarvis')
  )) as ReadonlyArray<{
    provider: string
    estado: string
    origem: string
    unmetered: boolean
    modelo: string
  }>

  /*
   * Os providers **por nome**, e não por contagem.
   *
   * Era `toHaveLength(4)`, e o 4 virou 5 na SPEC-Fases-06 (entrada do `codex`) — este teste
   * reprovou no CI depois de a suíte comum passar, porque o número cravado aqui é invisível para
   * quem corrige o do outro arquivo. Afirmar os nomes é mais forte e não envelhece a cada
   * provider novo: o que importa é que **cada** um chegue pela ponte com origem e custo corretos.
   */
  const porNome = Object.fromEntries(status.map((s) => [s.provider, s]))

  expect(Object.keys(porNome).sort()).toEqual(
    ['anthropic', 'claude-code', 'codex', 'gemini', 'ollama'].sort()
  )

  // Sem credencial, os de nuvem estão indisponíveis **para este usuário** — que é a pergunta
  // certa, e não "o serviço está no ar".
  expect(porNome.anthropic).toMatchObject({ estado: 'offline', origem: 'cloud', unmetered: false })
  expect(porNome.gemini).toMatchObject({ estado: 'offline', origem: 'cloud', unmetered: false })

  /*
   * O Ollama: origem e custo são fato do catálogo; o **estado** depende de haver servidor local.
   *
   * `estado` sai da asserção porque ele varia com a máquina — o CI não tem Ollama rodando, uma
   * estação de desenvolvimento costuma ter. Cravar `offline` aqui faz o teste reprovar em toda
   * máquina que o tenha instalado, e o sinal vira ruído em vez de defeito.
   */
  expect(porNome.ollama).toMatchObject({ origem: 'local', unmetered: true })

  // O `claude-code` é local e sem custo por chamada — a rota de assinatura.
  expect(porNome['claude-code']).toMatchObject({ origem: 'local', unmetered: true })

  /*
   * O `codex` é a **segunda** rota de assinatura (SPEC-Fases-06): sem custo por chamada, como o
   * Claude Code, e `cloud` — diferente dele, porque o CLI do Codex orquestra a sessão em nuvem.
   *
   * `estado` fica de fora da asserção de propósito: ele depende de o binário estar instalado no
   * runner **e** de o perfil ter login, e nenhum dos dois é verdade no CI. O que este teste mede
   * é que o provider **chega pela ponte** com origem e custo corretos.
   */
  expect(porNome.codex).toMatchObject({ origem: 'cloud', unmetered: true })

  // Todo provider tem um modelo ativo, mesmo sem troca: o padrão vale desde o primeiro boot.
  for (const s of status) expect(s.modelo).toBeTruthy()
})

test('as cinco rotas padrão existem e são editáveis pela ponte real', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const antes = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          getRouting: (w: string) => Promise<{
            rotas: Record<string, { preferencia: string[]; preferirLocal: boolean }>
          }>
        }
      }
    ).jarvis.getRouting('jarvis')
  )) as { rotas: Record<string, { preferencia: string[]; preferirLocal: boolean }> }

  expect(Object.keys(antes.rotas).sort()).toEqual([
    'chat',
    'code',
    'embedding',
    'summarize',
    'vision'
  ])

  const depois = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          setRoute: (
            r: unknown,
            w: string
          ) => Promise<{ rotas: Record<string, { preferencia: string[] }> }>
        }
      }
    ).jarvis.setRoute(
      { taskType: 'chat', preferencia: ['gemini', 'anthropic'], preferirLocal: false },
      'jarvis'
    )
  )) as { rotas: Record<string, { preferencia: string[] }> }

  expect(depois.rotas.chat.preferencia).toEqual(['gemini', 'anthropic'])
  // Editar uma rota **não** apaga as outras: a mescla com o padrão é por tipo.
  expect(depois.rotas.code.preferencia.length).toBeGreaterThan(0)
})

test('rota sem provider disponível recusa a chamada em vez de gastar às cegas', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // Rota apontando só para providers de nuvem, que estão sem credencial neste ambiente.
  await janela.evaluate(() =>
    (
      window as unknown as { jarvis: { setRoute: (r: unknown, w: string) => Promise<unknown> } }
    ).jarvis.setRoute(
      { taskType: 'chat', preferencia: ['anthropic', 'gemini'], preferirLocal: false },
      'jarvis'
    )
  )

  const fim = (await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          callAi: (r: unknown, w: string) => Promise<{ id: string }>
          onAiStreamEvent: (l: (e: Record<string, unknown>) => void) => () => void
        }
      }
    ).jarvis

    return await new Promise<Record<string, unknown>>((resolve) => {
      const parar = setTimeout(() => resolve({ erro: 'timeout no teste' }), 20_000)
      const cancelar = bridge.onAiStreamEvent((evento) => {
        if (evento.tipo === 'chunk') return
        clearTimeout(parar)
        cancelar()
        resolve(evento)
      })
      // **Sem `provider`**: quem escolhe é a rota. É o caminho novo da F04.
      void bridge.callAi({ taskType: 'chat', prompt: 'oi', diagnostico: true }, 'jarvis')
    })
  })) as { estado?: string; erro?: string }

  expect(fim.estado).toBe('falhou')
  expect(fim.erro).toMatch(/Nenhum provider disponível/i)
})

test('a seleção e as edições ficam na cadeia de auditoria, que segue íntegra', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  await janela.evaluate(() =>
    (
      window as unknown as { jarvis: { setRoute: (r: unknown, w: string) => Promise<unknown> } }
    ).jarvis.setRoute(
      { taskType: 'chat', preferencia: ['anthropic'], preferirLocal: false },
      'jarvis'
    )
  )

  await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          callAi: (r: unknown, w: string) => Promise<{ id: string }>
          onAiStreamEvent: (l: (e: Record<string, unknown>) => void) => () => void
        }
      }
    ).jarvis

    await new Promise<void>((resolve) => {
      const parar = setTimeout(() => resolve(), 20_000)
      const cancelar = bridge.onAiStreamEvent((evento) => {
        if (evento.tipo === 'chunk') return
        clearTimeout(parar)
        cancelar()
        resolve()
      })
      void bridge.callAi({ taskType: 'chat', prompt: 'oi', diagnostico: true }, 'jarvis')
    })
  })

  const eventos = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          listAuditEvents: () => Promise<
            ReadonlyArray<{ type: string; payload: Record<string, unknown> }>
          >
        }
      }
    ).jarvis.listAuditEvents()
  )) as ReadonlyArray<{ type: string; payload: Record<string, unknown> }>

  const tipos = eventos.map((e) => e.type)
  expect(tipos).toContain('routing-change')
  expect(tipos).toContain('provider-selection')

  // O veredito é `indisponivel` — e registrá-lo é o que distingue "a rota nunca caiu" de "a
  // rota nunca rodou".
  const selecoes = eventos
    .filter((e) => e.type === 'provider-selection')
    .map((e) => e.payload.decisao)
  expect(selecoes).toContain('indisponivel')

  const verificacao = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { verifyAuditChain: () => Promise<{ ok: boolean; checked: number }> }
      }
    ).jarvis.verifyAuditChain()
  )) as { ok: boolean; checked: number }

  expect(verificacao.ok).toBe(true)
  expect(verificacao.checked).toBeGreaterThan(0)
})

test('trocar o modelo pela ponte persiste, e modelo inválido é recusado', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const trocar = (modelo: string): Promise<boolean> =>
    janela.evaluate(
      (m) =>
        (
          window as unknown as {
            jarvis: { setProviderModel: (p: string, m: string, w: string) => Promise<boolean> }
          }
        ).jarvis.setProviderModel('anthropic', m, 'jarvis'),
      modelo
    )

  expect(await trocar('claude-haiku-4-5')).toBe(true)

  const status = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          getProviderStatus: (
            w: string
          ) => Promise<ReadonlyArray<{ provider: string; modelo: string }>>
        }
      }
    ).jarvis.getProviderStatus('jarvis')
  )) as ReadonlyArray<{ provider: string; modelo: string }>

  expect(status.find((s) => s.provider === 'anthropic')?.modelo).toBe('claude-haiku-4-5')

  // Modelo fora da tabela de preço é recusado: custaria zero na conta da F03, e um orçamento
  // que não vê o gasto é pior que um modelo trocado de volta.
  expect(await trocar('gpt-5')).toBe(false)
})
