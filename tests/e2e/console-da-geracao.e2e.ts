/**
 * O console da geração no app real, na etapa **Refinamento** (SPEC-Fases-03, critérios 1, 3, 4,
 * 6 e 8).
 *
 * O que este arquivo prova e nenhuma das outras camadas prova: que o caminho inteiro existe
 * **montado**. O `stream-json-parser.spec` prova o parser; o `generation-trace.int-spec` prova a
 * persistência em lote; o `console-da-geracao.test.tsx` prova a tela contra uma ponte dublada. Os
 * três passariam com o adapter desligado do coletor, com o coletor desligado do IPC, ou com o IPC
 * apontando a um canal que ninguém escuta. Aqui os quatro elos são os de produção:
 *
 *   adapter (subprocess real) → `onEvento` → coletor → SQLite → `webContents.send` → ponte.
 *
 * ## Como o adapter é dublado — e por que não é dublê de código
 *
 * O `ClaudeCodeAdapter` **não** é injetável no app empacotado: o binário é pinado (`BINARIO`,
 * constante por decisão de segurança) e o `spawnImpl` só entra pelo construtor, que o `main` chama
 * sem argumentos. O que **é** configurável, e de propósito, é o `PATH`: `ambienteControlado()`
 * repassa `PATH` ao subprocess, e é o SO quem resolve o nome `claude`.
 *
 * Então a substituição acontece **fora do app**, como o `ANTHROPIC_BASE_URL` do `ai-streaming`:
 * um executável chamado `claude` num diretório temporário, primeiro no `PATH` do processo do
 * Electron. O app roda o adapter de produção, com `spawn` de verdade, `shell: false`, stdin,
 * timeout e o parser de produção lendo NDJSON de verdade. O que muda é **qual** binário atende —
 * e isso mantém o teste offline, determinístico e sem gastar a assinatura.
 *
 * O mesmo binário atende ao `--version` do healthcheck (é o que faz `assinaturaDisponivel` virar
 * `true` e a rota de assinatura ser escolhida) e à geração com `--print`.
 *
 * ## Dois limites do harness, declarados e não contornados
 *
 * 1. **A tela não entra.** Sem consentimento do Google o app para no login e o AppShell nunca
 *    monta — a mesma razão registrada em `projetos-locais.e2e.ts`, `contexto-orcamento.e2e.ts` e
 *    `anexos-design.e2e.ts`. O que se prova aqui é o que chega à ponte, que é exatamente o que o
 *    `ConsoleDaGeracao` consome (`onGenerationEvent`, `generationHistory`, `generationEvents`); a
 *    renderização — painel que abre sozinho, resultado colapsado que abre no clique — tem suíte
 *    própria em `console-da-geracao.test.tsx`.
 * 2. **Windows fica de fora.** O adapter roda `spawn` com `shell: false`, e no Windows isso não
 *    resolve `.cmd` (o mesmo motivo pelo qual `scripts/test-report.mjs` precisa de `shell: true`
 *    lá). Um dublê que só existisse como `.cmd` não seria encontrado pelo adapter — e um teste que
 *    passasse por outro caminho não estaria provando este. O CI roda Linux, que é onde o gate
 *    olha.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

let app: ElectronApplication
let userData: string
let binarios: string

interface OutcomeDaPonte {
  readonly reason: string
  readonly mensagem: string
  readonly project?: { readonly id: string; readonly nome: string; readonly diretorio: string }
}

/** O caminho do arquivo que o `Read` dublado diz ter lido. Reaparece na asserção. */
const ARQUIVO_LIDO = '/tmp/manifesto-do-projeto.md'

/**
 * O segredo que o `Bash` dublado carrega no comando (critério 3).
 *
 * Formato de token do GitHub porque é um dos padrões que o redator de auditoria (ADR-004)
 * reconhece — um valor inventado provaria só que uma string atravessou o app.
 */
const SEGREDO = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'

/** O resultado do `Read`, maior que os 2 KB do `LIMITE_RESUMO_BYTES` (critério 4). */
const RESULTADO_GRANDE = 'M'.repeat(5000)

/**
 * As perguntas que o modelo "produz". JSON válido de propósito: o console é evidência, e a
 * evidência não pode ser o motivo de o documento sair errado — se o refinamento falhasse aqui, a
 * geração teria terminado em `saida-invalida` e o trace fecharia `falhou`, escondendo o que este
 * teste mede.
 */
const PERGUNTAS = {
  perguntas: [
    {
      bloco: 'problema-usuarios-resultado',
      porQue: 'O prompt não diz para quem o produto é.',
      titulo: 'Quem é o usuário principal?',
      enunciado: 'Para quem este produto resolve o problema primeiro?',
      opcoes: [
        { id: 'time-interno', rotulo: 'Time interno', impacto: 'Menos onboarding, menos alcance.' },
        { id: 'cliente-final', rotulo: 'Cliente final', impacto: 'Mais alcance, mais suporte.' }
      ],
      recomendada: 'time-interno',
      justificativa: 'O prompt descreve uma ferramenta de operação, não um produto de mercado.',
      aceitaTextoLivre: true,
      delegavel: true
    }
  ]
}

/** Uma linha de `assistant` com texto, no formato exato do `stream-json`. */
const linhaDeTexto = (texto: string): string =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: texto }] }
  })

/** Uma linha de `assistant` com `tool_use` — o modelo pedindo uma ferramenta. */
const linhaDeFerramenta = (id: string, nome: string, input: unknown): string =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: nome, input }] }
  })

/** Uma linha de `user` com `tool_result` — a ferramenta respondendo. */
const linhaDeResultado = (id: string, conteudo: string, erro = false): string =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: conteudo, is_error: erro }]
    }
  })

/** O `result` final, com o `usage` medido. */
const linhaDeResult = JSON.stringify({
  type: 'result',
  subtype: 'success',
  duration_api_ms: 2600,
  usage: { input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 340 }
})

/**
 * O conjunto completo que o dublê emite, **nesta ordem** — é a ordem que o critério 1 exige que
 * sobreviva até a ponte.
 *
 * Uma linha corrompida no meio (critério 5): ela vira `erro` de parser e a geração continua, com
 * o texto do documento intacto. Um dublê que só emitisse linhas boas nunca provaria isso.
 */
const LINHAS: readonly string[] = [
  // Ruído de sessão que o parser ignora por omissão. Está aqui porque o CLI real o emite, e um
  // dublê limpo demais esconderia um parser que virasse `erro` diante dele.
  JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read', 'Bash'] }),
  linhaDeFerramenta('call-1', 'Read', { file_path: ARQUIVO_LIDO }),
  linhaDeResultado('call-1', RESULTADO_GRANDE),
  linhaDeFerramenta('call-2', 'Bash', { command: `curl -H "Authorization: ${SEGREDO}" /health` }),
  linhaDeResultado('call-2', 'exit 1', true),
  '{ isto nao e json',
  // **O único `texto` do roteiro, e ele é o documento inteiro.**
  //
  // A primeira versão emitia uma frase ("Vou ler o manifesto antes de perguntar.") antes deste
  // JSON, imitando um modelo que comenta o que vai fazer. Mas o texto do documento é a
  // **concatenação de todos os `texto`** — é assim que o adapter o monta —, e
  // `lerPerguntasDoModelo` faz `JSON.parse` do resultado inteiro. A frase antes fazia o parse
  // falhar, e a geração terminava em `saida-invalida`: comportamento correto do app, defeito do
  // dublê. Só o CI pegou, porque no Windows este arquivo é pulado.
  linhaDeTexto(JSON.stringify(PERGUNTAS)),
  linhaDeResult
]

/**
 * Escreve o `claude` dublado e devolve o diretório onde ele mora.
 *
 * Script POSIX com shebang, e não `.cmd`: é o que `spawn` com `shell: false` encontra. `--version`
 * responde e sai 0 (o healthcheck do `RoutingService`); qualquer outra invocação despeja o NDJSON.
 * O stdin é drenado porque o adapter escreve o prompt lá e fecha — não ler deixaria o `write` do
 * lado do app com EPIPE.
 */
function escreverDubleDoCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-claude-bin-'))
  const alvo = join(dir, 'claude')

  // Só builtins: `read` drena o stdin e `printf` emite, sem depender de `cat` estar no PATH que o
  // `ambienteControlado()` monta. O `printf '%s\n'` preserva cada linha inteira — inclusive a
  // corrompida —, e as aspas simples impedem o shell de expandir qualquer coisa do JSON.
  const corpo = [
    '#!/bin/sh',
    'for arg in "$@"; do',
    '  if [ "$arg" = "--version" ]; then printf "1.0.0 (duble do E2E)\\n"; exit 0; fi',
    'done',
    // O adapter escreve o prompt no stdin e fecha; não drenar deixaria o `write` do lado do app
    // com EPIPE. `|| true` porque `read` sai diferente de zero no EOF, e `sh -e` não é garantido.
    'while read -r _linha; do :; done || true',
    ...LINHAS.map((linha) => `printf '%s\\n' ${aspasDeShell(linha)}`),
    'exit 0',
    ''
  ].join('\n')

  writeFileSync(alvo, corpo, 'utf8')
  chmodSync(alvo, 0o755)
  return dir
}

/** Aspas simples de shell: a única sequência a tratar é a própria aspa. */
function aspasDeShell(valor: string): string {
  return `'${valor.replaceAll("'", `'\\''`)}'`
}

// Windows: ver o limite 2 no cabeçalho. No escopo do arquivo, e não dentro do `beforeEach`, para
// que os hooks também não rodem — pular no hook deixaria o `afterEach` limpando o que ninguém criou.
test.skip(
  process.platform === 'win32',
  'o dublê do `claude` é um script POSIX; `spawn` com `shell: false` não o resolve no Windows'
)

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-console-'))
  binarios = escreverDubleDoCli()

  // `ELECTRON_RUN_AS_NODE` herdado sobe o Electron como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas mesmas razões do `login.e2e.ts`.
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      // O dublê **primeiro** no PATH. É por aqui que ele entra: `ambienteControlado()` repassa
      // `PATH` ao subprocess, e quem resolve o nome `claude` é o SO.
      PATH: `${binarios}:${ambiente.PATH ?? ''}`
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
  app.process().stdout?.on('data', (c: Buffer) => console.error(`[electron stdout] ${c}`))
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam pelo tray e pelos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`). O `close()` depois espera o
  // processo soltar os arquivos do `userData`, sem o que o `rmSync` falha com EPERM no Windows.
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)

  rmSync(userData, { recursive: true, force: true })
  rmSync(binarios, { recursive: true, force: true })
})

/**
 * Leva o projeto até onde o Refinamento consegue gerar: projeto criado com `git` permitido,
 * prompt salvo (que vira `docs/PROMPT.md` commitado, sem o que não há `ContextPack` e a geração
 * fica presa no gate da M8-F02).
 */
async function projetoComPrompt(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<{ readonly projectId: string; readonly workspace: string }> {
  return await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
          createProject: (n: string, w: string) => Promise<OutcomeDaPonte>
          salvarPromptDoProjeto: (p: string, t: string, w: string) => Promise<unknown>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    await bridge.addAllowedCommand('git', workspace)

    const criado = await bridge.createProject('Projeto Console', workspace)
    const projectId = criado.project?.id ?? ''

    await bridge.salvarPromptDoProjeto(
      projectId,
      '# Prompt\n\nUm painel que mostra a IA trabalhando enquanto ela trabalha.\n',
      workspace
    )

    return { projectId, workspace }
  })
}

/** O que a assinatura do console entregou ao renderer, mais o desfecho da geração. */
interface Colhido {
  readonly eventos: readonly Record<string, unknown>[]
  readonly traceIds: readonly string[]
  readonly resultado: string
}

/**
 * Dispara o refinamento **assinando o console antes**, e devolve o que chegou.
 *
 * A ordem importa: a geração vai por `invoke`, que só resolve no fim, então assinar depois
 * perderia todos os eventos. É a mesma razão pela qual o `traceId` não pode ser argumento da
 * assinatura (ver o comentário do `onGenerationEvent` no preload).
 */
async function gerarColhendoEventos(
  janela: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  projectId: string
): Promise<Colhido> {
  return await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          onGenerationEvent: (
            l: (p: { traceId: string; evento: Record<string, unknown> }) => void
          ) => () => void
          gerarPerguntasDeRefinamento: (
            p: string,
            w: string
          ) => Promise<{ resultado: string; mensagem: string }>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    const eventos: Record<string, unknown>[] = []
    const traceIds: string[] = []

    const cancelar = bridge.onGenerationEvent(({ traceId, evento }) => {
      eventos.push(evento)
      if (!traceIds.includes(traceId)) traceIds.push(traceId)
    })

    try {
      const saida = await bridge.gerarPerguntasDeRefinamento(id, workspace)
      return { eventos, traceIds, resultado: saida.resultado }
    } finally {
      cancelar()
    }
  }, projectId)
}

test('a geração do Refinamento empurra o conjunto completo de eventos, na ordem do CLI', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const { projectId } = await projetoComPrompt(janela)
  expect(projectId).not.toBe('')

  const colhido = await gerarColhendoEventos(janela, projectId)

  // O documento saiu: as perguntas foram lidas e gravadas. É o que garante que o resto das
  // asserções fala de uma geração que **aconteceu**, e não do trace de uma falha.
  expect(colhido.resultado).toBe('gerado')

  // Uma geração, um trace (critério 6: é ele que o painel usa para separar uma da seguinte).
  expect(colhido.traceIds).toHaveLength(1)

  // **A ordem** (critério 1): ferramenta, resultado, ferramenta, resultado, erro de parser,
  // texto, uso. A linha `system/init` não aparece — é ruído de sessão, não a geração.
  expect(colhido.eventos.map((e) => e.tipo)).toEqual([
    'ferramenta-inicio',
    'ferramenta-fim',
    'ferramenta-inicio',
    'ferramenta-fim',
    'erro',
    'texto',
    'uso'
  ])

  // A linha de ferramenta que o painel desenha: `nome · resumo · status`.
  expect(colhido.eventos[0]).toMatchObject({ nome: 'Read', resumoDoArgumento: ARQUIVO_LIDO })

  const fimDoRead = colhido.eventos[1] as { status: string; resumoDoResultado: string }
  expect(fimDoRead.status).toBe('ok')
  // Critério 4: o resultado de 5000 bytes chegou truncado nos 2 KB, com o tamanho original ao
  // lado — é o que o painel mostra como "Resumo de N".
  expect(fimDoRead.resumoDoResultado.length).toBe(2048)
  expect(colhido.eventos[1]).toMatchObject({ tamanhoOriginal: RESULTADO_GRANDE.length })

  // A ferramenta que falhou é `erro`, não silêncio.
  expect(colhido.eventos[3]).toMatchObject({ status: 'erro', resumoDoResultado: 'exit 1' })

  // Critério 5: a linha corrompida virou `erro` de parser **e a geração continuou** — o texto
  // seguinte (o JSON das perguntas) chegou depois dela, e o `resultado` acima é `gerado`.
  expect(colhido.eventos[4]).toMatchObject({ tipo: 'erro' })

  // Tokens e duração ao fim. `1200 + 300` de cache: o parser soma o cache na entrada, e o painel
  // mostra o número somado.
  expect(colhido.eventos[6]).toEqual({
    tipo: 'uso',
    tokensEntrada: 1500,
    tokensSaida: 340,
    duracaoMs: 2600
  })

  // O comando do `Bash` chegou ao renderer **sem o token**.
  //
  // Esta asserção nasceu invertida: o E2E mediu o segredo atravessando o IPC em claro, porque a
  // redação morava só na gravação (`generation-trace-repository.ts` → `eventoSeguro`) e o caminho
  // ao vivo (`Coletor.registrar` → `publicar`) não passava por ela. Pela letra do critério 3
  // ("argumento e resultado **persistidos**") não era violação; pelo ADR-005 ("sem vazar
  // segredo/PII") era, e a superfície afetada era justamente a que o PI olha durante a geração.
  //
  // A correção moveu `eventoSeguro` para a **entrada** do coletor, o que protege o banco e a tela
  // de uma vez e por construção. O comando sobrevive redigido — cegar a linha inteira esconderia
  // a ferramenta em vez de esconder o segredo dela.
  expect(JSON.stringify(colhido.eventos)).not.toContain(SEGREDO)
  expect(JSON.stringify(colhido.eventos)).toContain('curl')
})

test('a geração vai para o histórico da etapa, e reabri-la devolve a mesma trilha (critério 6)', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const { projectId } = await projetoComPrompt(janela)
  const aoVivo = await gerarColhendoEventos(janela, projectId)
  expect(aoVivo.resultado).toBe('gerado')

  const doHistorico = await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          generationHistory: (
            p: string,
            e: string,
            w: string
          ) => Promise<
            ReadonlyArray<{
              id: string
              ledgerEntryId: string
              etapa: string
              fase: string
              provider: string
              modelo: string
              status: string
            }>
          >
          generationEvents: (t: string, w: string) => Promise<readonly Record<string, unknown>[]>
        }
      }
    ).jarvis

    const workspace = await bridge.getWorkspace()
    const lista = await bridge.generationHistory(id, 'refinamento', workspace)
    const primeiro = lista[0]

    return {
      lista,
      eventos: primeiro === undefined ? [] : await bridge.generationEvents(primeiro.id, workspace)
    }
  }, projectId)

  // A geração que acabou de correr é a que o seletor do painel oferece.
  expect(doHistorico.lista).toHaveLength(1)
  const trace = doHistorico.lista[0]
  expect(trace).toMatchObject({
    etapa: 'refinamento',
    fase: 'planejamento',
    provider: 'claude-code',
    status: 'concluido'
  })
  // O `traceId` que chegou ao vivo é o que ficou gravado — um id novo aqui significaria trace
  // órfão, e o painel reabriria uma geração que ninguém viu.
  expect(trace?.id).toBe(aoVivo.traceIds[0])
  // Critério 2: todo trace tem `ledgerEntryId`. Ele é o `call_id` do ponto único — sem ele o
  // trace seria uma segunda contabilidade de uso, paralela ao ledger.
  expect(trace?.ledgerEntryId).toBeTruthy()

  // Critério 6, a metade que só o banco prova: reabrir do histórico devolve **a mesma trilha**,
  // evento por evento. A ida e volta pelo SQLite preserva a ordem (`seq`) e cada payload.
  //
  // Comparação inteira, e não evento a evento com índices escolhidos: a igualdade completa é a
  // afirmação que interessa, e uma lista de índices deixa de fora justamente o que ninguém
  // pensou em conferir. Ela só é possível porque a redação agora roda na **entrada** do coletor
  // — antes, o ao vivo trazia o token e o gravado não, e os dois nunca batiam.
  expect(doHistorico.eventos).toEqual(aoVivo.eventos)

  // Critério 3: o token do `Bash` não está em nenhum dos dois lados.
  expect(JSON.stringify(doHistorico.eventos)).not.toContain(SEGREDO)
  expect(doHistorico.eventos[2]).toMatchObject({ nome: 'Bash' })
})
