import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * O gate de orçamento no **app real** (SPEC-Providers-03, critérios 2, 3, 4 e 8).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que o gate está **ligado** no caminho
 * montado — preload real, IPC real, main real, banco real. Os testes de integração provam a
 * regra com um `AiCallService` construído à mão; aqui o serviço é o que o `index.ts` compôs no
 * boot, e uma dependência esquecida ali apareceria como orçamento que não barra.
 *
 * O provider é substituído por um servidor local via `ANTHROPIC_BASE_URL` — a mesma técnica de
 * `ai-streaming.e2e.ts`. O adapter e o SDK são os de produção; muda só para onde ligam.
 *
 * O servidor reporta um `usage` **caro** de propósito: é o que torna verificável o critério 4
 * — a estimativa cabe no orçamento, o custo real não, e a chamada seguinte é a barrada.
 */

let app: ElectronApplication
let userData: string
let servidor: Server
let baseURL: string

const CHAVE = 'sk-ant-api03-chave-do-e2e-orcamento'

/**
 * `usage` caro: 100 mil tokens de entrada e 100 mil de saída no `claude-opus-5` ($5/$25 por
 * milhão) custam US$ 3,00 — acima do limite de US$ 1,00 que o teste configura. A estimativa
 * pré-chamada de um prompt curto com `maxTokens` 4096 fica em ~US$ 0,10, então a primeira
 * chamada **passa** pelo gate e só depois se descobre cara. É o cenário do critério 4.
 */
const USAGE_CARO = { entrada: 100_000, saida: 100_000 }

function sse(): string {
  const evento = (tipo: string, dados: unknown): string =>
    `event: ${tipo}\ndata: ${JSON.stringify(dados)}`

  return (
    [
      evento('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_e2e_orcamento',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: USAGE_CARO.entrada, output_tokens: 0 }
        }
      }),
      evento('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }),
      evento('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'resposta cara' }
      }),
      evento('content_block_stop', { type: 'content_block_stop', index: 0 }),
      evento('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: USAGE_CARO.saida }
      }),
      evento('message_stop', { type: 'message_stop' })
    ].join('\n\n') + '\n\n'
  )
}

/** Quantas vezes o provider foi realmente chamado — a prova de que o gate barrou antes. */
let chamadasAoProvider = 0

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-orcamento-'))
  chamadasAoProvider = 0

  servidor = createServer((_req, res) => {
    chamadasAoProvider += 1
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.end(sse())
  })
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  // `ELECTRON_RUN_AS_NODE` herdado faz o Electron subir como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas razões do `login.e2e.ts`: sem eles o loader
    // do Playwright injeta `--password-store=basic`, o `safeStorage` responde false e o boot
    // falha por desenho.
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      JARVIS_CREDENTIAL_ANTHROPIC: CHAVE,
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
  await app?.close().catch(() => undefined)
  await new Promise<void>((resolve) => servidor.close(() => resolve()))

  rmSync(userData, { recursive: true, force: true })
})

/**
 * Dispara uma chamada pela ponte real e devolve o evento `fim`.
 *
 * Função, e não string: `evaluate` com string não é avaliada como corpo assíncrono aqui — o
 * `fim` voltava indefinido e o teste falhava sem que a chamada tivesse acontecido.
 */
function disparar(janela: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return janela.evaluate(async () => {
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
      void bridge.callAi({ provider: 'anthropic', prompt: 'qual a capital da Franca' }, 'jarvis')
    })
  })
}

test('o gate de orçamento barra a chamada antes de ela chegar ao provider', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // A ponte expõe os dois canais de orçamento — e **nenhum** que pergunte "esta chamada cabe?".
  // A decisão é do main; um canal assim daria ao renderer uma resposta que ele só duplicaria.
  const metodos = await janela.evaluate(() =>
    Object.keys((window as unknown as { jarvis: Record<string, unknown> }).jarvis).sort()
  )
  expect(metodos).toContain('getBudget')
  expect(metodos).toContain('setBudgetLimits')
  expect(metodos.filter((m) => /checkBudget|canSpend/i.test(m))).toEqual([])

  // Orçamento zerado pela ponte real: qualquer estimativa positiva estoura.
  const zerado = await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { setBudgetLimits: (l: unknown, w: string) => Promise<{ policy: unknown }> }
      }
    ).jarvis.setBudgetLimits({ dailyLimit: 0, monthlyLimit: 0, alertThreshold: 0.8 }, 'jarvis')
  )
  expect((zerado.policy as { dailyLimit: number }).dailyLimit).toBe(0)

  const fim = (await disparar(janela)) as { estado?: string; erro?: string }

  expect(fim.estado).toBe('falhou')
  expect(fim.erro).toContain('Orçamento')
  // A prova mais forte do critério 2: o servidor do provider **não recebeu requisição**. O
  // bloqueio não é uma mensagem depois do gasto; é a chamada não saindo.
  expect(chamadasAoProvider).toBe(0)

  // E o bloqueio não registra gasto: a chamada não saiu, então não custou.
  const acumulado = await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { getBudget: (w: string) => Promise<{ gasto: { diaUsd: number } }> }
      }
    ).jarvis.getBudget('jarvis')
  )
  expect(acumulado.gasto.diaUsd).toBe(0)
})

test('estouro no meio do stream: a chamada corrente termina e a próxima é barrada', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // US$ 1,00/dia: a estimativa (~US$ 0,10) cabe, o custo real (US$ 3,00) não.
  await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { setBudgetLimits: (l: unknown, w: string) => Promise<unknown> }
      }
    ).jarvis.setBudgetLimits({ dailyLimit: 1, monthlyLimit: 1000, alertThreshold: 0.8 }, 'jarvis')
  )

  // A primeira **passa** pelo gate e conclui — não é morta no meio (decisão do PI).
  const primeira = (await disparar(janela)) as {
    estado?: string
    custo?: { realUsd?: number }
  }
  expect(primeira.estado).toBe('concluido')
  expect(primeira.custo?.realUsd).toBeCloseTo(0.1 * 5 + 0.1 * 25, 6)
  expect(chamadasAoProvider).toBe(1)

  // O gasto real foi registrado, e o acumulado do dia já passou do limite.
  const depoisDaPrimeira = await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { getBudget: (w: string) => Promise<{ gasto: { diaUsd: number } }> }
      }
    ).jarvis.getBudget('jarvis')
  )
  expect(depoisDaPrimeira.gasto.diaUsd).toBeGreaterThan(1)

  // A **segunda** é a barrada — e de novo sem tocar o provider.
  const segunda = (await disparar(janela)) as { estado?: string; erro?: string }
  expect(segunda.estado).toBe('falhou')
  expect(segunda.erro).toContain('Orçamento')
  expect(chamadasAoProvider).toBe(1)
})

test('a cadeia de auditoria continua íntegra depois das decisões do gate', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { setBudgetLimits: (l: unknown, w: string) => Promise<unknown> }
      }
    ).jarvis.setBudgetLimits({ dailyLimit: 0, monthlyLimit: 0, alertThreshold: 0.8 }, 'jarvis')
  )
  await disparar(janela)

  const verificacao = await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { verifyAuditChain: () => Promise<{ ok: boolean; checked: number }> }
      }
    ).jarvis.verifyAuditChain()
  )
  expect(verificacao.ok).toBe(true)
  expect(verificacao.checked).toBeGreaterThan(0)

  // As duas decisões do gate estão na cadeia, com tipos próprios: `budget-change` (o usuário
  // editou o limite) e `budget-decision` (o veredito sobre a chamada). Tipos separados são o
  // que permite contar "quantas vezes o orçamento barrou" sem parsear o payload.
  const tipos = await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { listAuditEvents: (t?: string) => Promise<ReadonlyArray<{ type: string }>> }
      }
    ).jarvis
      .listAuditEvents()
      .then((eventos) => eventos.map((e) => e.type))
  )
  expect(tipos).toContain('budget-change')
  expect(tipos).toContain('budget-decision')

  // O veredito auditado é o **bloqueio** — e o `ai-call` que o acompanha registra uma só fase.
  //
  // A distinção importa: auditar `decisao: 'bloqueado'` sozinho não prova enforcement, porque o
  // gate em report-only produziria exatamente o mesmo evento (o serviço decide; quem barra é o
  // ponto único). O que separa os dois é a **ausência** da fase `requisicao`: ela só é
  // auditada depois do gate, então uma chamada barrada tem `conclusao` e mais nada.
  const eventos = await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          listAuditEvents: () => Promise<
            ReadonlyArray<{ type: string; payload: Record<string, unknown> }>
          >
        }
      }
    ).jarvis.listAuditEvents()
  )

  expect(eventos.filter((e) => e.type === 'budget-decision').map((e) => e.payload.decisao)).toEqual(
    ['bloqueado']
  )
  expect(eventos.filter((e) => e.type === 'ai-call').map((e) => e.payload.fase)).toEqual([
    'conclusao'
  ])
})
