import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * O conector Tavily no **app real** (SPEC-Conectores-05 e 06).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que as duas capacidades estão ligadas no
 * caminho montado — preload real, IPC real, `ConnectorService` real com governança, adapter real
 * registrado pelo `index.ts` no boot. Os testes de integração exercitam o adapter construído à
 * mão; aqui ele é o que o app compôs, e uma capacidade declarada mas não registrada apareceria
 * como `capacidade-desconhecida` vinda do próprio núcleo.
 *
 * A Tavily é substituída por um servidor local **com contador de requisições**
 * (`TAVILY_API_ORIGIN`) — a técnica das fatias anteriores. É o que torna "o gate barrou" e "a
 * chamada saiu" distinguíveis de fora: um mock diria que o adapter não foi chamado; o contador
 * diz que a requisição não saiu.
 *
 * A credencial entra pelo **cofre real**, pela ponte real (`setConnectorCredential`), com
 * `safeStorage` real — é de lá que o adapter a lê no momento da chamada. Injetar a chave no
 * teste provaria menos: o caminho chave→cofre→adapter é justamente o que a F05 acrescenta.
 */

let app: ElectronApplication
let userData: string
let servidor: Server
let origem: string

/** O que o servidor recebeu. É a asserção central deste arquivo. */
let requisicoes: { caminho: string; autorizacao: string; corpo: Record<string, unknown> }[] = []
/** O que a próxima resposta deve ser, quando o teste precisa de um status específico. */
let proximoStatus = 200
let proximoCorpo: Record<string, unknown> | undefined

const CHAVE = 'tvly-chave-do-e2e'

const BUSCA_OK = {
  results: [
    {
      title: 'Fonte A',
      url: 'https://exemplo.com/a',
      content: 'trecho do buscador',
      score: 0.9,
      domain: 'exemplo.com'
    },
    // Duplicata canônica da primeira: o app deve descartá-la sem que o teste precise pedir.
    { title: 'Fonte A de novo', url: 'https://WWW.Exemplo.com/a/?utm_source=x', content: 'outro' }
  ],
  usage: { credits: 1 },
  request_id: 'req-e2e-1'
}

const EXTRACAO_OK = {
  results: [{ url: 'https://exemplo.com/a', raw_content: 'o conteúdo completo do documento' }],
  failed_results: [{ url: 'https://caiu.com/z', error: 'timeout ao carregar' }],
  usage: { credits: 1 },
  request_id: 'req-e2e-2'
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-tavily-'))
  requisicoes = []
  proximoStatus = 200
  proximoCorpo = undefined

  servidor = createServer((req, res) => {
    let cru = ''
    req.on('data', (c: Buffer) => {
      cru += c.toString('utf8')
    })
    req.on('end', () => {
      const caminho = req.url ?? ''
      requisicoes.push({
        caminho,
        autorizacao: String(req.headers.authorization ?? ''),
        corpo: cru === '' ? {} : (JSON.parse(cru) as Record<string, unknown>)
      })

      const corpo = proximoCorpo ?? (caminho.startsWith('/extract') ? EXTRACAO_OK : BUSCA_OK)

      res.writeHead(proximoStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(corpo))
    })
  })

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

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
      SUPABASE_PUBLISHABLE_KEY: '',
      TAVILY_API_ORIGIN: origem
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
})

test.afterEach(async () => {
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await new Promise<void>((resolve) => servidor.close(() => resolve()))
  rmSync(userData, { recursive: true, force: true })
})

/** Grava a chave no cofre real pela ponte real e devolve a página. */
async function comCredencial(): Promise<import('@playwright/test').Page> {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  await janela.evaluate(async (chave: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          setConnectorCredential: (k: string, v: string, w: string) => Promise<unknown>
        }
      }
    ).jarvis

    await bridge.setConnectorCredential('tavily', chave, 'jarvis')
  }, CHAVE)

  return janela
}

/** Chama uma capacidade pelo canal real `connectors:invoke`. */
function invocar(
  janela: import('@playwright/test').Page,
  operation: string,
  input: unknown
): Promise<Record<string, unknown>> {
  return janela.evaluate(
    async ([op, entrada]: [string, unknown]) => {
      const bridge = (
        window as unknown as {
          jarvis: {
            callConnector: (r: unknown, w: string) => Promise<Record<string, unknown>>
          }
        }
      ).jarvis

      return await bridge.callConnector(
        {
          contractVersion: 1,
          connector: 'tavily',
          operation: op,
          correlationId: `e2e-${Date.now()}`,
          timeoutMs: 10_000,
          credential: { key: 'tavily', user_id: 'local', workspace_id: 'jarvis' },
          input: entrada
        },
        'jarvis'
      )
    },
    [operation, input] as [string, unknown]
  )
}

test('as duas capacidades da Tavily estão registradas no app montado', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const operacoes = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          listConnectorCapabilities: () => Promise<{ connector: string; operation: string }[]>
        }
      }
    ).jarvis

    const todas = await bridge.listConnectorCapabilities()
    return todas.filter((c) => c.connector === 'tavily').map((c) => c.operation)
  })

  // Declaradas **e registradas**: é a diferença entre a constante existir e o adapter estar no
  // registro que o `index.ts` compôs.
  expect(operacoes).toEqual(['search.query', 'extract.content'])
})

test('a busca sai autenticada com a chave do cofre e volta normalizada', async () => {
  const janela = await comCredencial()

  const desfecho = await invocar(janela, 'search.query', { query: 'mercado de agentes' })

  expect(desfecho.ok).toBe(true)

  // A prova que só o servidor dá: a requisição saiu, e com a chave que o **cofre** guardou —
  // não uma injetada pelo teste. É o caminho chave→cofre→adapter inteiro.
  expect(requisicoes).toHaveLength(1)
  expect(requisicoes[0]?.caminho).toBe('/search')
  expect(requisicoes[0]?.autorizacao).toBe(`Bearer ${CHAVE}`)

  const data = desfecho.data as { fontes: { url: string }[]; duplicadasDescartadas: number }
  // A duplicata canônica foi descartada pelo app, sem o teste pedir.
  expect(data.fontes).toHaveLength(1)
  expect(data.fontes[0]?.url).toBe('https://exemplo.com/a')
  expect(data.duplicadasDescartadas).toBe(1)
})

test('nada do que volta pela ponte contém a chave da Tavily', async () => {
  const janela = await comCredencial()

  const desfecho = await invocar(janela, 'search.query', { query: 'x' })

  // A garantia estrutural da M5-F01 valendo para o conector, medida do lado do renderer: o
  // segredo existe no main, pelo tempo da chamada, e não atravessa a ponte de volta.
  expect(JSON.stringify(desfecho)).not.toContain(CHAVE)

  const credenciais = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: { listConnectorCredentials: (w: string) => Promise<unknown> }
      }
    ).jarvis
    return await bridge.listConnectorCredentials('jarvis')
  })

  expect(JSON.stringify(credenciais)).not.toContain(CHAVE)
  expect(JSON.stringify(credenciais)).toContain('present')
})

test('a extração devolve evidência com hash e identifica a fonte que falhou', async () => {
  const janela = await comCredencial()

  const desfecho = await invocar(janela, 'extract.content', {
    urls: ['https://exemplo.com/a', 'https://caiu.com/z']
  })

  expect(desfecho.ok).toBe(true)

  const data = desfecho.data as {
    evidencias: { url: string; hashConteudo: string }[]
    falhas: { url: string; motivo: string }[]
  }

  // Falha parcial preserva a válida **e** nomeia a ausente (critério 3 da F06).
  expect(data.evidencias).toHaveLength(1)
  expect(data.evidencias[0]?.hashConteudo).toHaveLength(64)
  expect(data.falhas).toEqual([{ url: 'https://caiu.com/z', motivo: 'timeout ao carregar' }])
  expect(requisicoes[0]?.caminho).toBe('/extract')
})

test('sem credencial no cofre, a chamada não sai', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const desfecho = await invocar(janela, 'search.query', { query: 'x' })

  expect(desfecho.ok).toBe(false)
  expect(desfecho.code).toBe('credencial-ausente')
  // O contador é o que separa "recusou" de "tentou e falhou".
  expect(requisicoes).toHaveLength(0)
})

test('o teto de créditos barra a pesquisa antes de a requisição sair', async () => {
  const janela = await comCredencial()

  await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          setConnectorCreditLimits: (c: string, l: unknown, w: string) => Promise<unknown>
        }
      }
    ).jarvis

    await bridge.setConnectorCreditLimits('tavily', { dailyLimit: 0, monthlyLimit: 0 }, 'jarvis')
  })

  const desfecho = await invocar(janela, 'search.query', { query: 'x' })

  expect(desfecho.ok).toBe(false)
  expect(desfecho.code).toBe('limite-excedido')
  // A asserção que o gate existe para sustentar: a chamada **não saiu**.
  expect(requisicoes).toHaveLength(0)
})

test('o consumo entra no ledger e a cadeia de auditoria fecha', async () => {
  const janela = await comCredencial()

  await invocar(janela, 'search.query', { query: 'x' })

  const { creditos, cadeia } = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getConnectorCredits: (c: string, w: string) => Promise<{ consumido: { dia: number } }>
          verifyAuditChain: () => Promise<{ ok: boolean; checked: number }>
        }
      }
    ).jarvis

    return {
      creditos: await bridge.getConnectorCredits('tavily', 'jarvis'),
      cadeia: await bridge.verifyAuditChain()
    }
  })

  expect(creditos.consumido.dia).toBe(1)
  expect(cadeia.ok).toBe(true)
  expect(cadeia.checked).toBeGreaterThan(0)
})

test('entrada inválida é recusada pelo app antes de qualquer requisição', async () => {
  const janela = await comCredencial()

  const desfecho = await invocar(janela, 'extract.content', { urls: ['file:///etc/passwd'] })

  expect(desfecho.ok).toBe(false)
  expect(desfecho.code).toBe('validacao-invalida')
  expect(requisicoes).toHaveLength(0)
})

test('a quota da Tavily chega ao renderer como limite não retomável', async () => {
  const janela = await comCredencial()
  proximoStatus = 432
  proximoCorpo = { detail: 'plan limit exceeded' }

  const desfecho = await invocar(janela, 'search.query', { query: 'x' })

  expect(desfecho.ok).toBe(false)
  expect(desfecho.code).toBe('limite-excedido')
  expect(desfecho.retryable).toBe(false)
  // Uma requisição, e só: 432 não entra em loop, porque esperar não devolve cota comprada.
  expect(requisicoes).toHaveLength(1)
})
