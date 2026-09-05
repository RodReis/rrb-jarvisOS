/**
 * Adapter do Codex CLI — **subprocess app-managed** (SPEC-Fases-06 § Dentro).
 *
 * A rota de **assinatura do Codex**: `gpt-5.6-sol` e irmãos pelo binário `codex`, sem custo por
 * chamada (`ROTAS_UNMETERED`). Espelha o `ClaudeCodeAdapter` na postura e difere dele em três
 * pontos, todos medidos e não supostos:
 *
 * 1. **O formato é outro.** `codex exec --json` emite JSONL de `ThreadEvent`, não o `stream-json`
 *    do Claude Code. Daí o parser próprio (`codex-json-parser`), como o Done 1 do MVP-010 exige.
 * 2. **O perfil é o da pipeline.** `CODEX_HOME` da M10-F02 entra no ambiente do subprocess, e é
 *    ele que faz o CLI abrir a sessão da pipeline em vez do `~/.codex` pessoal do PI.
 * 3. **A invocação passa por `resolverInvocacao`.** No Windows o binário do npm é um `.cmd`, que
 *    o Node recusa com `shell: false` — o defeito que o smoke da M10-F02 achou.
 *
 * As garantias do MVP-004 continuam valendo por inteiro: binário pinado, `shell: false` (sem
 * interpolação, então não há o que escapar), args montados aqui, prompt por stdin, `env` em lista
 * de permissão, e timeout com `SIGKILL` pelo SO.
 */

import { spawn } from 'node:child_process'
import type { AdapterChunk, AdapterRequest, AiAdapter } from './adapter'
import { AdapterError } from './anthropic-adapter'
import { ambienteControlado } from '../execution/terminal-engine'
import { BINARIO_CODEX, resolverInvocacao } from './codex-profile-service'
import { extrairLinhasDoCodex, parsearLinhaDoCodex } from './codex-json-parser'
import type { GenerationEvent } from '@shared/domain/geracao'
import type { Fase } from '@shared/domain/fase'
import type { RunNeutro } from './cwd-neutro'

/**
 * Aproximação de tokens a partir de caracteres, usada **só** quando o `turn.completed` não chega.
 *
 * O CLI reporta `usage` de verdade (confirmado no SDK oficial: `TurnCompletedEvent = { type,
 * usage }`), e é esse número que vai ao ledger. A aproximação cobre o stream cortado antes do fim
 * — e é aceitável aqui pela mesma razão do Claude Code: a rota é `unmetered`, então nenhuma
 * decisão de orçamento depende dela.
 */
const CARACTERES_POR_TOKEN = 4

/**
 * A versão mínima do CLI que aceita as flags de isolamento (emenda E1 § Decisão 5).
 *
 * A instalada no PC do PI em 2026-09-05, confirmada em `codex exec --help`. Serve à mensagem de
 * erro: recusada uma flag, o usuário precisa saber contra o quê comparar.
 */
export const VERSAO_MINIMA_DO_CODEX = '0.149.0'

/**
 * As fases em que o CLI gera documento e não age (emenda E1 § Decisão 2).
 *
 * Lista positiva pela mesma razão do `ClaudeCodeAdapter`: uma fase nova nasce **com** as
 * ferramentas do agente, e é o Planejamento/Especificação que precisa ser nomeado para
 * restringir. Excluir `construcao` faria a omissão virar permissão.
 */
const FASES_SEM_FERRAMENTAS: readonly Fase[] = ['planejamento', 'especificacao']

/**
 * O que vai ao stdin do `codex exec`: o contrato da etapa e, depois, o pedido.
 *
 * O `codex exec` não tem flag de system prompt — o `--help` da versão instalada só oferece o
 * prompt, por argumento ou stdin. Concatenar é a única via, e os cabeçalhos são o que a mantém
 * honesta: sem `INSTRUÇÕES:`/`PEDIDO:` as duas partes viram um bloco de texto só, e o modelo
 * passa a tratar o contrato como conteúdo a descrever em vez de regra a seguir.
 *
 * Sem `system`, devolve o prompt intacto: acrescentar cabeçalho a um pedido solto mudaria a
 * entrada de todas as chamadas que não têm contrato, sem ganho nenhum.
 */
export function entradaDoCodex(request: AdapterRequest): string {
  if (request.system === undefined || request.system === '') return request.prompt

  return ['INSTRUÇÕES:', '', request.system, '', 'PEDIDO:', '', request.prompt].join('\n')
}

export class CodexAdapter implements AiAdapter {
  readonly nome = 'codex'

  constructor(
    /**
     * O diretório **neutro** do subprocess, resolvido por geração (emenda E1 § Regras).
     *
     * Função e não string, pela mesma razão do `ClaudeCodeAdapter`: o diretório é novo e vazio
     * a cada chamada, e capturá-lo por valor faria todas as gerações compartilharem um só.
     */
    private readonly abrirCwd: () => RunNeutro,
    /**
     * O `CODEX_HOME` da pipeline (M10-F02).
     *
     * Função e não string: o perfil é resolvido pelo `CodexProfileService`, e capturá-lo por
     * valor no boot faria o adapter guardar um caminho que pode mudar. Ausente — ou devolvendo
     * `undefined` — o CLI cairia no perfil pessoal do PI, então o boot é obrigado a passá-lo.
     */
    private readonly codexHome: () => string,
    /** Injetável só para o teste não depender do binário estar instalado. */
    private readonly spawnImpl: typeof spawn = spawn,
    /** Injetável pela mesma razão: a resolução consulta `npm root -g` e o disco. */
    private readonly resolverScript: () => string | undefined = () => undefined
  ) {}

  /**
   * Os args do `generateStream`, montados a partir da fase (emenda E1, critério 5).
   *
   * Método separado pela mesma razão do `ClaudeCodeAdapter`: a lista de flags é a decisão desta
   * fatia, e nomeá-la permite prová-la sem rodar um subprocess.
   */
  argsDaGeracao(request: AdapterRequest): readonly string[] {
    const base = ['exec', '--json', '--model', request.model]

    // O cwd neutro **não é** um repositório Git, e o `codex exec` recusa rodar fora de um sem
    // esta flag. Ela vale em qualquer fase: é consequência do cwd, não da política de fase.
    base.push('--skip-git-repo-check')

    if (request.fase === undefined || !FASES_SEM_FERRAMENTAS.includes(request.fase)) return base

    // Somente leitura nas fases de documento: o Codex não escreve nem roda comando para gerar
    // um brief. Diferente do `--tools ""` do Claude Code — o `codex exec` não desliga as
    // ferramentas, ele restringe o que elas alcançam —, e é a garantia que este CLI oferece.
    base.push('--sandbox', 'read-only')

    return base
  }

  /**
   * O binário existe e responde? (mesmo papel do `disponivel` do Claude Code)
   *
   * `--version` é a pergunta mais barata que prova as duas coisas: que o executável está
   * alcançável e que ele roda. Nunca lança — binário fora é a resposta `false`, que é informação,
   * não erro.
   */
  async disponivel(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      let respondido = false
      const responder = (valor: boolean): void => {
        if (respondido) return
        respondido = true
        resolve(valor)
      }

      const run = this.abrirCwd()
      /**
       * A limpeza pendurada na **resposta**, não no `close` — mesma razão do `ClaudeCodeAdapter`.
       *
       * O healthcheck roda em laço na tela, e o caso do binário ausente chega por `error` sem
       * necessariamente emitir `close`. Limpar só no `close` acumularia um diretório por
       * sondagem no `userData` de quem não tem o CLI instalado.
       */
      const responderELimpar = (valor: boolean): void => {
        if (respondido) return
        run.remover()
        responder(valor)
      }

      try {
        const invocacao = resolverInvocacao(BINARIO_CODEX, ['--version'], this.resolverScript)
        const processo = this.spawnImpl(invocacao.comando, [...invocacao.args], {
          cwd: run.caminho,
          env: { ...ambienteControlado(), CODEX_HOME: this.codexHome() },
          shell: false,
          windowsHide: true
        })

        processo.on('error', () => responderELimpar(false))
        processo.on('close', (codigo) => responderELimpar(codigo === 0))

        const relogio = setTimeout(() => {
          processo.kill('SIGKILL')
          responderELimpar(false)
        }, 5_000)
        processo.on('close', () => clearTimeout(relogio))
      } catch {
        responderELimpar(false)
      }
    })
  }

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
    // O diretório neutro desta geração. Removido no `finally`, em todos os desfechos.
    const run = this.abrirCwd()

    const invocacao = resolverInvocacao(
      BINARIO_CODEX,
      [...this.argsDaGeracao(request)],
      this.resolverScript
    )

    const processo = this.spawnImpl(invocacao.comando, [...invocacao.args], {
      cwd: run.caminho,
      // O `CODEX_HOME` é o que faz este processo enxergar o perfil **da pipeline**. Sem ele, o
      // CLI abriria o `~/.codex` pessoal do PI — o oposto do isolamento da M10-F02.
      env: { ...ambienteControlado(), CODEX_HOME: this.codexHome() },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const relogio = setTimeout(() => processo.kill('SIGKILL'), request.timeoutMs)

    const abortar = (): void => {
      processo.kill('SIGKILL')
    }
    request.signal?.addEventListener('abort', abortar, { once: true })

    // O `codex exec` **não tem** flag de system prompt (confirmado em `codex exec --help` da
    // versão instalada): o que existe é o prompt, por argumento ou stdin. O contrato da etapa
    // entra então **antes** do pedido, separado por cabeçalhos — sem eles as duas partes viram
    // um texto só e o modelo trata a instrução como parte do que deve descrever.
    processo.stdin?.write(entradaDoCodex(request))
    processo.stdin?.end()

    const fila: string[] = []
    let acordar: (() => void) | undefined
    let terminou = false
    let falha: string | undefined
    let caracteresEmitidos = 0
    let usoMedido: { tokensEntrada: number; tokensSaida: number } | undefined
    let resto = ''

    const empurrar = (texto: string): void => {
      fila.push(texto)
      acordar?.()
      acordar = undefined
    }

    /**
     * Entrega o evento ao console **sem deixar o console derrubar a geração**.
     *
     * Mesma proteção do `ClaudeCodeAdapter`: quem passa `onEvento` é o ponto único, que escreve
     * no banco em lote, e um erro de escrita ali chegaria como exceção no meio do `for await` do
     * stdout. O documento é o produto; o console é evidência.
     */
    const publicar = (evento: GenerationEvent): void => {
      try {
        request.onEvento?.(evento)
      } catch {
        // O console falhou. A geração, não.
      }
    }

    const consumir = (eventos: readonly GenerationEvent[]): void => {
      for (const evento of eventos) {
        publicar(evento)
        if (evento.tipo === 'texto') empurrar(evento.delta)
        if (evento.tipo === 'uso') {
          usoMedido = { tokensEntrada: evento.tokensEntrada, tokensSaida: evento.tokensSaida }
        }
      }
    }

    processo.stdout?.on('data', (pedaco: Buffer) => {
      const extracao = extrairLinhasDoCodex(resto + pedaco.toString('utf8'))
      resto = extracao.resto
      for (const linha of extracao.linhas) consumir(parsearLinhaDoCodex(linha))
    })

    /*
     * O stderr é **descartado**, e isto é diferente do `CodexProfileService`.
     *
     * Lá o stderr é sinal de estado (`login status` escreve `"Not logged in"` nele). Aqui o
     * contrato do CLI é explícito: *"In --json mode, stdout must be valid JSONL… any other output
     * must be written to stderr"* — ou seja, o stderr do `exec` é log de diagnóstico, e medi-lo
     * como conteúdo misturaria log com o documento. Lido só para não encher o pipe e travar o
     * processo.
     */
    processo.stderr?.on('data', () => {})

    processo.on('error', (erro) => {
      falha =
        (erro as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'O Codex CLI não foi encontrado. Instale o binário `codex` e verifique o PATH.'
          : 'Falha ao executar o Codex CLI.'
      terminou = true
      acordar?.()
      acordar = undefined
    })

    processo.on('close', (codigo, sinal) => {
      // A última linha pode não terminar em '\n'. Descartá-la perderia justamente o
      // `turn.completed` — a linha que carrega o `usage` medido, emitida por último.
      if (resto.trim() !== '') {
        consumir(parsearLinhaDoCodex(resto))
        resto = ''
      }

      if (sinal === 'SIGKILL' && falha === undefined) {
        falha = 'A chamada ao Codex CLI excedeu o tempo limite ou foi interrompida.'
      } else if (codigo !== 0 && falha === undefined) {
        // O stderr **não** entra na mensagem: pode carregar caminho, identificador de sessão ou
        // qualquer coisa que o CLI resolva imprimir, e mensagem de erro é caminho clássico de
        // vazamento. O código de saída é seguro; o texto, não.
        falha = `O Codex CLI terminou com código ${codigo ?? 'desconhecido'}.`
      }
      terminou = true
      acordar?.()
      acordar = undefined
    })

    try {
      for (;;) {
        while (fila.length > 0) {
          const texto = fila.shift() as string
          caracteresEmitidos += texto.length
          yield { tipo: 'texto', texto }
        }

        if (terminou) break

        await new Promise<void>((resolve) => {
          acordar = resolve
        })
      }

      // `causa` fica `undefined` de propósito: o stderr é a única causa que existiria aqui, e ele
      // pode carregar caminho de perfil ou identificador de sessão — o mesmo motivo pelo qual ele
      // não entra na mensagem.
      if (falha !== undefined) throw new AdapterError(falha, undefined)

      yield {
        tipo: 'fim',
        usage: usoMedido ?? {
          tokensEntrada: Math.ceil(request.prompt.length / CARACTERES_POR_TOKEN),
          tokensSaida: Math.ceil(caracteresEmitidos / CARACTERES_POR_TOKEN)
        }
      }
    } finally {
      clearTimeout(relogio)
      request.signal?.removeEventListener('abort', abortar)
      // Mata o processo se o consumidor abandonou o iterador no meio (um `break` no `for await`).
      // Sem isto, o filho seguiria rodando e consumindo a assinatura.
      if (!terminou) processo.kill('SIGKILL')
      // O diretório do run sai em todos os desfechos — conclusão, falha, cancelamento e
      // timeout (emenda E1, critério 1). Nunca lança: ver `abrirRunNeutro`.
      run.remover()
    }
  }
}
