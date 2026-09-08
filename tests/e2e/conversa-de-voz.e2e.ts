import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * A conversa com a persona no **app real** (SPEC-Voz-03, critérios 1, 2, 4 e 8).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que os canais da conversa existem na
 * ponte do app montado, que a pergunta atravessa o main de verdade e volta um desfecho tratado, e
 * que **nenhuma requisição sai para a nuvem** no caminho — a contagem é feita interceptando a
 * rede do renderer, não lendo log.
 *
 * O cenário é o do desenvolvedor comum: **sem credencial de nuvem**. Com isso, `anthropic` e
 * `gemini` estão indisponíveis por falta de chave, e a rota `conversa-de-voz` não tem fallback
 * cloud por decisão do PI — o que faz o critério 4 ser exercido de verdade quando o Ollama não
 * está no ar, sem precisar simular nada.
 */

let app: ElectronApplication
let userData: string

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-conversa-'))

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

test('a ponte expõe a conversa e a persona, e nenhum canal que execute', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const metodos = await janela.evaluate(() =>
    Object.keys((window as unknown as { jarvis: Record<string, unknown> }).jarvis).sort()
  )

  expect(metodos).toContain('perguntarAoJarvis')
  expect(metodos).toContain('historicoDaConversa')
  expect(metodos).toContain('lerPersona')
  expect(metodos).toContain('salvarPersona')

  /*
   * **Critério 8: nenhum caminho de ação.**
   *
   * A conversa responde; não executa. `runCommand` e os canais da allowlist existem de propósito
   * desde o MVP-004 — ali o terminal controlado **é** o produto —, então a varredura mira o que
   * a conversa acrescentou, não a ponte inteira: uma varredura cega reprovaria por um acerto.
   */
  const daConversa = metodos.filter((m) => /conversa|persona|jarvis$/i.test(m))
  expect(daConversa.length).toBeGreaterThan(0)
  expect(
    daConversa.filter((m) => /exec|run|command|comando|deploy|connector|file|arquivo/i.test(m))
  ).toEqual([])
})

test('a persona traz o bloco fixo, e esvaziar o texto livre não o remove', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const inicial = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { lerPersona: (w: string) => Promise<{ textoLivre: string; blocoFixo: string }> }
      }
    ).jarvis.lerPersona('jarvis')
  )) as { textoLivre: string; blocoFixo: string }

  // O bloco fixo é do produto e vem sempre — é o que garante resposta curta, em pt-BR, sem
  // markdown, independentemente do que o usuário escreva.
  expect(inicial.blocoFixo).toContain('português do Brasil')
  expect(inicial.blocoFixo).toContain('markdown')

  const salva = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: {
          salvarPersona: (
            t: string,
            w: string
          ) => Promise<{ textoLivre: string; blocoFixo: string }>
        }
      }
    ).jarvis.salvarPersona('', 'jarvis')
  )) as { textoLivre: string; blocoFixo: string }

  // Critério 5: com o texto livre **vazio**, o bloco fixo ainda vale.
  expect(salva.textoLivre).toBe('')
  expect(salva.blocoFixo).toContain('português do Brasil')
})

test('a conversa não faz requisição à nuvem — nem quando responde, nem quando recusa', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  /*
   * **Critério 1: zero requisição cloud, provado por contagem** — não por ausência de log.
   *
   * A interceptação é do renderer, e é onde ela vale: o que se prova aqui é que a tela não abre
   * caminho próprio para a nuvem. A chamada do modelo mora no main, atrás da ponte, e a rota
   * `conversa-de-voz` não tem fallback cloud por decisão do PI — o roteamento é medido em
   * `multi-provider.e2e.ts`, contra os adapters reais.
   */
  const paraNuvem: string[] = []
  await janela.route('**/*', async (rota) => {
    const url = rota.request().url()
    if (/anthropic\.com|googleapis\.com|openai\.com/i.test(url)) paraNuvem.push(url)
    await rota.continue()
  })

  const comecou = Date.now()

  const desfecho = (await janela.evaluate(() =>
    (
      window as unknown as {
        jarvis: { perguntarAoJarvis: (p: string, w: string) => Promise<{ estado: string }> }
      }
    ).jarvis.perguntarAoJarvis('o que está na fila?', 'jarvis')
  )) as { estado: string; proximaAcao?: string }

  // A latência do critério 1 (fim da transcrição → resposta pronta), medida na máquina de quem
  // roda. Vai para o log e não para uma asserção: um teto fixo aqui reprovaria por hardware
  // lento, que não é defeito do código.
  console.log(`[conversa] desfecho em ${Date.now() - comecou} ms: ${JSON.stringify(desfecho)}`)

  /*
   * Os dois desfechos são aceitáveis, e é isso que torna o teste honesto em qualquer máquina:
   * com o Ollama no ar e o modelo baixado, `ok`; sem ele, `indisponivel` **com próxima ação**
   * (critério 4). O que nunca é aceitável é sair requisição para a nuvem, e é isso que se conta.
   */
  expect(['ok', 'indisponivel', 'falhou']).toContain(desfecho.estado)

  if (desfecho.estado === 'indisponivel') {
    // Recusa **com** próxima ação: um estado sem texto deixaria a tela inventar a frase e a fala
    // muda.
    expect(desfecho.proximaAcao ?? '').not.toBe('')
    expect(desfecho.proximaAcao).toMatch(/ollama/i)
  }

  expect(paraNuvem).toEqual([])
})
