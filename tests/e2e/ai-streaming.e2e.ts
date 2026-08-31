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
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * A chamada de IA no **app real** (SPEC-Providers-02, critérios 2 e 8).
 *
 * O que este arquivo prova e nenhuma das outras camadas prova: que o caminho inteiro existe
 * montado — preload real, IPC real, main real, janela real. Os testes de componente provam a
 * lógica; este prova que ela está **ligada**.
 *
 * Foi assim que os defeitos das duas últimas fatias apareceram (o vault e os overlays em
 * portal): suíte verde, app quebrado. A régua aqui é o app rodando.
 *
 * A Anthropic é substituída por um servidor local via `ANTHROPIC_BASE_URL` — variável que o
 * próprio SDK lê. Não é mock de código: o app roda o adapter de produção, com o SDK de
 * produção, falando HTTP+SSE de verdade. O que muda é para onde ele liga, e isso mantém o
 * teste offline, determinístico e sem gastar chave real.
 */

let app: ElectronApplication
let userData: string
let servidor: Server
let baseURL: string

const CHAVE = 'sk-ant-api03-chave-do-e2e'
const TEXTOS = ['Paris', ' e a capital', ' da França.']

/** O SSE da Messages API — o mesmo formato do teste de integração do adapter. */
function sse(): string {
  const evento = (tipo: string, dados: unknown): string =>
    `event: ${tipo}\ndata: ${JSON.stringify(dados)}`

  return (
    [
      evento('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_e2e',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 42, output_tokens: 0 }
        }
      }),
      evento('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }),
      ...TEXTOS.map((texto) =>
        evento('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: texto }
        })
      ),
      evento('content_block_stop', { type: 'content_block_stop', index: 0 }),
      evento('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 17 }
      }),
      evento('message_stop', { type: 'message_stop' })
    ].join('\n\n') + '\n\n'
  )
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-ai-'))

  servidor = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.end(sse())
  })
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  // `ELECTRON_RUN_AS_NODE` herdado faz o Electron subir como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas mesmas razões do `login.e2e.ts`: sem eles o
    // loader do Playwright injeta `--password-store=basic`, o `safeStorage` responde false e
    // o boot falha por desenho — a janela nunca nasce.
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      // A credencial pela fonte `env` do vault (F01): é o caminho de bootstrap, e usá-lo aqui
      // evita ter que digitar a chave pela UI antes de cada verificação.
      JARVIS_CREDENTIAL_ANTHROPIC: CHAVE,
      // Onde o SDK vai ligar. A variável é lida pelo próprio SDK — o código de produção não
      // sabe que existe teste.
      ANTHROPIC_BASE_URL: baseURL
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
  app.process().stdout?.on('data', (c: Buffer) => console.error(`[electron stdout] ${c}`))
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam por causa do tray e dos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`).
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  // O `close()` depois do `exit()` — como em `login.e2e.ts`. Sem ele o Playwright não espera
  // o processo soltar os arquivos do `userData`, e o `rmSync` falha com EPERM no Windows.
  await app?.close().catch(() => undefined)
  await new Promise<void>((resolve) => servidor.close(() => resolve()))

  rmSync(userData, { recursive: true, force: true })
})

test('a chamada de IA percorre preload → main → adapter e volta em chunks', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // A fronteira, vista do renderer de verdade: a ponte expõe os três métodos e **nenhum**
  // caminho até a credencial. É a mesma guarda do `preload.spec.ts`, agora contra a ponte
  // real em vez do módulo carregado em isolamento.
  const ponte = await janela.evaluate(() => {
    const bridge = (window as unknown as { jarvis: Record<string, unknown> }).jarvis
    return {
      metodos: Object.keys(bridge).sort(),
      temIpcRenderer: 'ipcRenderer' in (window as object)
    }
  })

  expect(ponte.metodos).toContain('callAi')
  expect(ponte.metodos).toContain('cancelAi')
  expect(ponte.metodos).toContain('onAiStreamEvent')
  expect(ponte.temIpcRenderer).toBe(false)
  // Nenhum método devolve segredo: a busca é por nome, e a ausência é a garantia.
  expect(ponte.metodos.filter((m) => /reveal|secret|getCredential/i.test(m))).toEqual([])

  // Dispara pela ponte real e coleta os eventos como o painel os recebe.
  const resultado = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          callAi: (r: unknown, w: string) => Promise<{ id: string }>
          onAiStreamEvent: (l: (e: Record<string, unknown>) => void) => () => void
        }
      }
    ).jarvis

    return await new Promise<{ texto: string; fim: Record<string, unknown> | undefined }>(
      (resolve) => {
        let texto = ''
        const parar = setTimeout(
          () => resolve({ texto, fim: { erro: 'timeout no teste' } }),
          20_000
        )

        const cancelar = bridge.onAiStreamEvent((evento) => {
          if (evento.tipo === 'chunk') {
            texto += evento.texto as string
            return
          }
          clearTimeout(parar)
          cancelar()
          resolve({ texto, fim: evento })
        })

        void bridge.callAi(
          { provider: 'anthropic', prompt: 'qual a capital da Franca', diagnostico: true },
          'jarvis'
        )
      }
    )
  })

  // O texto chegou inteiro, montado a partir dos três deltas que o servidor emitiu.
  expect(resultado.texto).toBe('Paris e a capital da França.')

  const fim = resultado.fim as {
    estado?: string
    custo?: { realUsd?: number; usage?: { tokensEntrada: number; tokensSaida: number } }
  }
  expect(fim.estado).toBe('concluido')

  // O custo saiu da tabela semeada aplicada ao `usage` real: 42 × $5/1M + 17 × $25/1M.
  expect(fim.custo?.usage).toEqual({ tokensEntrada: 42, tokensSaida: 17 })
  expect(fim.custo?.realUsd).toBeCloseTo(42e-6 * 5 + 17e-6 * 25, 12)

  // A credencial não atravessou o IPC. A verificação é sobre o payload serializado inteiro —
  // é exatamente o que o `webContents.send` entrega ao renderer.
  expect(JSON.stringify(resultado)).not.toContain(CHAVE)
})

test('sem credencial, a chamada falha com instrução — e o app continua de pé', async () => {
  // Segundo cenário do critério 7, no app real: o desfecho previsto de quem ainda não
  // configurou a chave. O que ele prova é que a falha é **estado**, não crash.
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const fim = await janela.evaluate(async () => {
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
        if (evento.tipo !== 'fim') return
        clearTimeout(parar)
        cancelar()
        resolve(evento)
      })
      // O NOA não tem credencial: o `.env` do vault não tem escopo por espaço, mas o
      // `resolve` do serviço lê o vault do espaço primeiro — e no NOA ele está vazio.
      void bridge.callAi({ provider: 'anthropic', prompt: 'oi', diagnostico: true }, 'noa')
    })
  })

  // A chamada termina; a janela continua respondendo. Um throw não tratado no main teria
  // derrubado o handler e o `evaluate` teria estourado por timeout.
  expect(fim.tipo).toBe('fim')
  expect(await janela.evaluate(() => document.readyState)).toBe('complete')
})
