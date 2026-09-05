/**
 * Adapter do Claude Code CLI — **subprocess app-managed** (SPEC-Providers-04, critérios 1 e 2).
 *
 * A rota de **assinatura**: o plano Claude MAX pelo binário `claude`, sem custo por chamada
 * (emenda do PI de 2026-08-29 — `unmetered`, registra uso sem valor monetário).
 *
 * ## Por que não passa pela allowlist do MVP-004
 *
 * A allowlist de comandos governa o terminal **do usuário**: uma superfície onde qualquer
 * binário pode ser pedido, e por isso cada um precisa ser permitido explicitamente. Aqui o
 * caso é outro — o app invoca **uma dependência sua**, com binário fixo e argumentos que ele
 * mesmo monta. Não há superfície livre a governar (nota de reconciliação da spec, PI ciente).
 *
 * O que substitui a allowlist são as garantias deste arquivo, e elas não são menores:
 *
 * - **Binário pinado** (`BINARIO`), nunca vindo de entrada;
 * - **`shell: false`** — sem interpolação de string, então metacaractere não existe em vez de
 *   ser rejeitado por lista. É a garantia mais importante do arquivo;
 * - **Args controlados**: o prompt vai por **stdin**, não como argumento, para não depender de
 *   escape em nenhuma camada;
 * - **cwd neutro** — um diretório vazio por geração, sob o `userData` do Electron, removido no
 *   fim (emenda E1). Não é mais "o diretório do app": em dev esse diretório **é** o repositório
 *   do JarvisOS, e o CLI carregava a governança deste projeto para gerar o documento de outro;
 * - **`env` em lista de permissão**, reusando `ambienteControlado()` do terminal do MVP-004: a
 *   lição de que `process.env` do main não pode alcançar o filho vale igual aqui;
 * - **Timeout + kill** pelo SO (`SIGKILL`), não uma promessa nossa de parar de escutar.
 */

import { spawn } from 'node:child_process'
import type { AdapterChunk, AdapterRequest, AiAdapter } from './adapter'
import { AdapterError } from './anthropic-adapter'
import { ambienteControlado } from '../execution/terminal-engine'
import { extrairLinhas, novoEstadoDoParser, parsearLinha } from './stream-json-parser'
import type { GenerationEvent } from '@shared/domain/geracao'
import type { Fase } from '@shared/domain/fase'
import type { RunNeutro } from './cwd-neutro'

/**
 * O binário, **pinado**. Constante e não configuração: o dia em que este nome vier de fora é o
 * dia em que "subprocess app-managed" vira execução arbitrária com outro nome.
 */
export const BINARIO = 'claude'

/**
 * Aproximação de tokens a partir de caracteres (~4 por token).
 *
 * O CLI **não reporta `usage`** — ele imprime texto. Sem número medido, a escolha é entre
 * aproximar e mentir com zero. Aproximar é honesto aqui porque a rota é `unmetered`: o número
 * serve para o usuário ver volume de uso, e nenhuma decisão de orçamento depende dele (a
 * `BudgetPolicy` não barra rota de assinatura). Num provider pago, esta aproximação seria
 * inaceitável — lá o `usage` vem do provider.
 */
const CARACTERES_POR_TOKEN = 4

/**
 * A versão mínima do CLI que aceita todas as flags de isolamento (emenda E1 § Decisão 5).
 *
 * É a instalada no PC do PI em 2026-09-05, confirmada flag a flag em `claude --help`. Serve à
 * mensagem de erro: quando uma flag é recusada, o usuário precisa saber contra o quê comparar.
 */
export const VERSAO_MINIMA_DO_CLI = '2.1.258'

/**
 * As fases em que o CLI é um **gerador de documento**, não um agente (emenda E1 § Decisão 2).
 *
 * Na Construção o agente é legítimo: ele lê arquivos, roda comandos e escreve código, e as
 * restrições abaixo o quebrariam. Por isso a lista é positiva — nomeia onde restringir — em vez
 * de excluir `construcao`: uma fase nova nasceria sem isolamento por omissão, e a omissão é
 * justamente o defeito que esta emenda corrige.
 */
const FASES_SEM_FERRAMENTAS: readonly Fase[] = ['planejamento', 'especificacao']

/**
 * O trecho do stderr que denuncia uma flag que a versão instalada não conhece.
 *
 * O CLI recusa opção desconhecida pelo parser de linha de comando, que escreve
 * `error: unknown option '--x'` e sai com código 1. Sem reconhecer esse caso, a mensagem ao
 * usuário seria "o CLI terminou com código 1" — que descreve o sintoma e esconde a causa, e a
 * causa aqui tem conserto: atualizar o binário.
 */
const MARCA_DE_FLAG_DESCONHECIDA = 'unknown option'

/**
 * O nome da flag que o CLI recusou, lido do stderr — ou `undefined` se a falha foi outra.
 *
 * Devolve **só o nome da flag**, e não o stderr: o texto do CLI pode carregar caminho de
 * sessão, e a mensagem de erro é caminho clássico de vazamento. O nome da flag é dado nosso —
 * nós é que a passamos —, então repeti-lo não revela nada que o app já não soubesse.
 */
export function flagRecusada(stderr: string): string | undefined {
  if (!stderr.includes(MARCA_DE_FLAG_DESCONHECIDA)) return undefined

  // O formato do parser de linha de comando é `unknown option '--x'`. Sem a captura, a
  // alternativa seria devolver o stderr inteiro — que é exatamente o que não pode sair daqui.
  const achado = /unknown option '?(--[\w-]+)'?/.exec(stderr)
  return achado?.[1]
}

export class ClaudeCodeAdapter implements AiAdapter {
  readonly nome = 'claude-code'

  constructor(
    /**
     * O diretório **neutro** do subprocess, resolvido por geração (emenda E1 § Regras).
     *
     * Função e não string: o cwd é um diretório novo e vazio a cada chamada, e capturá-lo por
     * valor no boot faria todas as gerações compartilharem o mesmo — que é o oposto do
     * isolamento. Devolve o caminho e a função que o remove; o `finally` a chama.
     *
     * O padrão existe só para o teste: em produção quem o passa é o boot, que conhece o
     * `userData` do Electron.
     */
    private readonly abrirCwd: () => RunNeutro,
    /** Injetável só para o teste não depender do binário estar instalado. */
    private readonly spawnImpl: typeof spawn = spawn
  ) {}

  /**
   * Os args do `generateStream`, montados a partir da fase.
   *
   * Método separado, e é o que o critério 2 da emenda inspeciona: a lista de flags é a decisão
   * desta fatia, e tê-la como expressão nomeada permite prová-la sem rodar um subprocess.
   */
  argsDaGeracao(request: AdapterRequest): readonly string[] {
    const base = [
      '--print',
      '--model',
      request.model,
      '--output-format',
      'stream-json',
      '--verbose'
    ]

    // `--system-prompt` vale em **qualquer** fase: entregar o contrato da etapa ao modelo é o
    // defeito da #271, e ele não tem nada a ver com ferramentas. Só a ausência de `system` tira
    // a flag — passar string vazia substituiria o prompt padrão por nada.
    if (request.system !== undefined && request.system !== '') {
      base.push('--system-prompt', request.system)
    }

    // O resto do isolamento é **por fase**. Sem fase declarada não há isolamento: é a chamada
    // que não pertence a etapa nenhuma (o painel de teste do Settings), e restringi-la seria
    // impor a uma chamada avulsa a política de uma geração de documento.
    if (request.fase === undefined || !FASES_SEM_FERRAMENTAS.includes(request.fase)) return base

    base.push(
      // Nenhuma ferramenta: sem `Bash`, sem `Read`, sem `Skill`. Gerar documento não precisa de
      // ferramenta, e foi a `Skill` que despejou 30 KB de corpo de skill na saída (#272).
      '--tools',
      '',
      // Sem settings do ambiente: hooks, permissões e plugins do PC do PI não entram numa
      // geração sobre outro projeto.
      '--setting-sources',
      '',
      // Sem `--mcp-config`, esta flag zera os servidores MCP em vez de herdar os do ambiente.
      '--strict-mcp-config',
      // A geração não deixa transcript fora do trace: o registro dela é o console, não um
      // arquivo de sessão no disco do CLI.
      '--no-session-persistence'
    )

    // O schema é a barreira que sobra quando o modelo desobedece o prompt. Ausente quando a
    // etapa não produz JSON — o termo de pesquisa pede texto puro, e impor schema o quebraria.
    if (request.jsonSchema !== undefined) base.push('--json-schema', request.jsonSchema)

    return base
  }

  /**
   * O binário existe e responde? (critério 6)
   *
   * `--version` é a pergunta mais barata que prova as duas coisas: que o executável está no
   * PATH e que ele roda. Nunca lança — servidor/binário fora é a resposta `false`, que é
   * informação, não erro.
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
       * A limpeza pendurada na **resposta**, não no `close`.
       *
       * Este healthcheck roda em laço na tela de providers, e o caso mais comum dele é o binário
       * não instalado — que chega por `error` e pode nunca emitir `close`. Remover só no `close`
       * deixaria um diretório por sondagem acumulando no `userData` de quem não tem o CLI, que é
       * justamente quem mais sonda.
       */
      const responderELimpar = (valor: boolean): void => {
        if (respondido) return
        run.remover()
        responder(valor)
      }

      try {
        const processo = this.spawnImpl(BINARIO, ['--version'], {
          cwd: run.caminho,
          env: ambienteControlado(),
          shell: false,
          windowsHide: true
        })

        // `error` cobre o caso mais comum — binário não instalado (ENOENT). Sem este ramo, a
        // promessa nunca resolveria e a tela de providers ficaria carregando para sempre.
        processo.on('error', () => responderELimpar(false))
        processo.on('close', (codigo) => responderELimpar(codigo === 0))

        const relogio = setTimeout(() => {
          processo.kill('SIGKILL')
          responderELimpar(false)
        }, 3_000)
        processo.on('close', () => clearTimeout(relogio))
      } catch {
        responderELimpar(false)
      }
    })
  }

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
    // O diretório neutro desta geração. Aberto antes do spawn e removido no `finally` — também
    // em cancelamento e timeout, que passam pelo mesmo caminho (emenda E1, critério 1).
    const run = this.abrirCwd()

    const processo = this.spawnImpl(
      BINARIO,
      // Args montados por `argsDaGeracao` — nada vem de entrada do usuário além do **modelo**,
      // validado contra a tabela de preço antes de chegar ao adapter, e do `system`/`jsonSchema`,
      // que são constantes do domínio. O prompt vai por stdin.
      //
      // `stream-json` + `verbose` (SPEC-Fases-03 § Adapter): é o formato que traz as ferramentas
      // e o `usage` medido. `--verbose` não é opcional — sem ele o CLI recusa `stream-json` com
      // `--print`. O texto continua saindo igual; o que muda é que agora ele vem etiquetado.
      [...this.argsDaGeracao(request)],
      {
        cwd: run.caminho,
        env: ambienteControlado(),
        // A garantia central: sem shell, não há interpolação, então não há o que escapar.
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )

    // Timeout + kill pelo SO. `SIGKILL` e não `SIGTERM`: um processo que ignora o pedido
    // educado é exatamente o que o timeout existe para resolver.
    const relogio = setTimeout(() => processo.kill('SIGKILL'), request.timeoutMs)

    // O `signal` do ponto de chamada (usuário cancelou) mata pelo mesmo caminho — abortar e
    // esperar o processo terminar sozinho deixaria um filho órfão consumindo a assinatura.
    const abortar = (): void => {
      processo.kill('SIGKILL')
    }
    request.signal?.addEventListener('abort', abortar, { once: true })

    // O prompt entra por stdin, não como argumento: tira do caminho qualquer dependência de
    // escape, e evita o limite de tamanho de linha de comando do SO com prompt longo.
    processo.stdin?.write(request.prompt)
    processo.stdin?.end()

    /**
     * A ponte entre os eventos do processo e o `AsyncIterable`.
     *
     * Fila + promessa pendente, e não um array coletado no fim: o ponto do streaming é o texto
     * aparecer **enquanto** chega, e juntar tudo para emitir no fim entregaria o mesmo conteúdo
     * depois de o usuário ter esperado por ele em silêncio.
     */
    const fila: string[] = []
    let acordar: (() => void) | undefined
    let terminou = false
    let falha: string | undefined
    let saidaDeErro = ''
    let caracteresEmitidos = 0
    /** O `usage` que o CLI **mediu**, quando ele chega. Ver `CARACTERES_POR_TOKEN`. */
    let usoMedido: { tokensEntrada: number; tokensSaida: number } | undefined
    /** O pedaço de linha que ainda não fechou entre dois `data` do stdout. */
    let resto = ''
    /**
     * O estado do parser desta geração (#272).
     *
     * Um por `generateStream` e não um do módulo: duas gerações simultâneas compartilhariam a
     * global, e o texto injetado numa apareceria pendurado na ferramenta da outra.
     */
    const estadoDoParser = novoEstadoDoParser()

    const empurrar = (texto: string): void => {
      fila.push(texto)
      acordar?.()
      acordar = undefined
    }

    /**
     * Entrega o evento ao console **sem deixar o console derrubar a geração**.
     *
     * O `try/catch` não é paranoia: quem passa `onEvento` é o ponto único, que dele escreve no
     * banco em lote. Um erro de escrita ali (disco cheio, banco travado) chegaria aqui como
     * exceção no meio do `for await` do stdout e mataria a geração — que é exatamente a inversão
     * que a spec proíbe: o documento é o produto, o console é evidência.
     */
    const publicar = (evento: GenerationEvent): void => {
      try {
        request.onEvento?.(evento)
      } catch {
        // O console falhou. A geração, não.
      }
    }

    /**
     * Uma ferramenta foi chamada numa fase que não tem ferramentas? (emenda E1, critério 3)
     *
     * Com `--tools ""` isto não deveria acontecer — e é justamente por isso que existe. A flag é
     * promessa de terceiro: se uma versão do CLI a ignorar, ou se a lista de fases divergir do
     * que o adapter monta, o defeito voltaria em silêncio e o documento nasceria de novo com o
     * corpo de uma skill dentro. Aqui ele para de ser silencioso: o console recebe o erro e o
     * texto que vier depois não entra no documento.
     */
    let ferramentaProibida = false
    const semFerramentas =
      request.fase !== undefined && FASES_SEM_FERRAMENTAS.includes(request.fase)

    processo.stdout?.on('data', (pedaco: Buffer) => {
      const extracao = extrairLinhas(resto + pedaco.toString('utf8'))
      resto = extracao.resto

      for (const linha of extracao.linhas) {
        for (const evento of parsearLinha(linha, estadoDoParser)) {
          publicar(evento)

          if (semFerramentas && evento.tipo === 'ferramenta-inicio' && !ferramentaProibida) {
            ferramentaProibida = true
            publicar({
              tipo: 'erro',
              mensagem: `O modelo chamou a ferramenta ${evento.nome} numa fase sem ferramentas. O documento foi interrompido.`
            })
            // Encerra a geração pelo mesmo caminho do timeout: o que veio antes do desvio já
            // está no documento e é honesto; o que vier depois nasceu de uma sessão que saiu do
            // contrato, e deixá-lo entrar seria repetir o defeito com um aviso ao lado.
            processo.kill('SIGKILL')
          }

          // O texto do documento sai **daqui**, dos eventos de texto — é o mesmo conteúdo de
          // antes, agora desembrulhado do JSON em vez de repassado cru. Sem isto, o `--print`
          // com `stream-json` faria o documento nascer como um despejo de NDJSON.
          //
          // `ferramentaProibida` corta o texto **posterior** ao desvio (critério 3).
          if (evento.tipo === 'texto' && !ferramentaProibida) empurrar(evento.delta)

          // O CLI **reporta** `usage` no `result`. Preferir o número medido à aproximação é o
          // ganho de graça desta fatia: `CARACTERES_POR_TOKEN` deixa de ser o que vai ao ledger
          // sempre que o CLI disser o número de verdade.
          if (evento.tipo === 'uso') {
            usoMedido = { tokensEntrada: evento.tokensEntrada, tokensSaida: evento.tokensSaida }
          }
        }
      }
    })
    // O stderr é acumulado, não emitido: é diagnóstico, não resposta. Emiti-lo como texto
    // misturaria aviso do CLI com o conteúdo que o usuário pediu.
    processo.stderr?.on('data', (pedaco: Buffer) => {
      saidaDeErro += pedaco.toString('utf8')
    })

    processo.on('error', (erro) => {
      // ENOENT é o caso comum: o CLI não está instalado. A mensagem diz o que fazer.
      falha =
        (erro as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'O Claude Code CLI não foi encontrado. Instale o binário `claude` e verifique o PATH.'
          : 'Falha ao executar o Claude Code CLI.'
      terminou = true
      acordar?.()
      acordar = undefined
    })

    processo.on('close', (codigo, sinal) => {
      // A última linha pode não ter terminado em '\n'. Descartá-la perderia justamente o
      // `result` — a linha que carrega o `usage` medido, que o CLI emite por último.
      if (resto.trim() !== '') {
        for (const evento of parsearLinha(resto, estadoDoParser)) {
          publicar(evento)
          // Mesma guarda do laço do stdout: a última linha não escapa do critério 3.
          if (evento.tipo === 'texto' && !ferramentaProibida) fila.push(evento.delta)
          if (evento.tipo === 'uso') {
            usoMedido = { tokensEntrada: evento.tokensEntrada, tokensSaida: evento.tokensSaida }
          }
        }
        resto = ''
      }

      if (sinal === 'SIGKILL' && ferramentaProibida) {
        // O `SIGKILL` **fomos nós** (critério 3), e não o timeout: a geração **termina**, não
        // falha. O texto anterior ao desvio já está no documento e é honesto; o erro que explica
        // o corte já foi ao console. Reportar falha aqui descartaria conteúdo válido e diria ao
        // PI que o CLI travou, quando o que houve foi o modelo sair do contrato.
      } else if (sinal === 'SIGKILL' && falha === undefined) {
        falha = 'A chamada ao Claude Code CLI excedeu o tempo limite ou foi interrompida.'
      } else if (codigo !== 0 && falha === undefined) {
        // Flag recusada é o **único** caso em que o stderr vira mensagem, e mesmo assim só o
        // nome da flag: sem isto a falha chegaria como "terminou com código 1", que esconde a
        // causa justamente onde ela tem conserto. Nunca cair para a invocação sem isolamento —
        // rodar sem `--tools ""` é o defeito que esta emenda existe para fechar (critério 6).
        const flag = flagRecusada(saidaDeErro)
        falha =
          flag === undefined
            ? // O stderr **não** entra na mensagem: pode carregar caminho, token de sessão ou
              // qualquer coisa que o CLI resolva imprimir, e mensagem de erro é caminho clássico
              // de vazamento. O código de saída é seguro; o texto, não.
              `O Claude Code CLI terminou com código ${codigo ?? 'desconhecido'}.`
            : `O Claude Code CLI não reconhece a opção ${flag}. Atualize o binário \`claude\` para a versão ${VERSAO_MINIMA_DO_CLI} ou mais recente.`
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

      if (falha !== undefined) {
        throw new AdapterError(falha, saidaDeErro === '' ? undefined : new Error('stderr'))
      }

      // O `usage` **medido**, quando o CLI o reportou no `result`; a aproximação só cobre o
      // caso em que ele não chegou (versão antiga do CLI, ou stream cortado antes do fim).
      // Ver o comentário de `CARACTERES_POR_TOKEN` para por que aproximar é aceitável aqui.
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
      // Mata o processo se o consumidor abandonou o iterador no meio (um `break` no
      // `for await`). Sem isto, o filho seguiria rodando e consumindo a assinatura.
      if (!terminou) processo.kill('SIGKILL')
      // O diretório do run sai por aqui **em todos os desfechos** — conclusão, falha,
      // cancelamento e timeout —, que é o que o critério 1 da emenda pede. Nunca lança: ver
      // `abrirRunNeutro`.
      run.remover()
    }
  }
}
