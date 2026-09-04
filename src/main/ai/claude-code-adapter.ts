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
 * - **cwd controlado** — o diretório do app, não o do usuário;
 * - **`env` em lista de permissão**, reusando `ambienteControlado()` do terminal do MVP-004: a
 *   lição de que `process.env` do main não pode alcançar o filho vale igual aqui;
 * - **Timeout + kill** pelo SO (`SIGKILL`), não uma promessa nossa de parar de escutar.
 */

import { spawn } from 'node:child_process'
import type { AdapterChunk, AdapterRequest, AiAdapter } from './adapter'
import { AdapterError } from './anthropic-adapter'
import { ambienteControlado } from '../execution/terminal-engine'
import { extrairLinhas, parsearLinha } from './stream-json-parser'
import type { GenerationEvent } from '@shared/domain/geracao'

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

export class ClaudeCodeAdapter implements AiAdapter {
  readonly nome = 'claude-code'

  constructor(
    /** O cwd do subprocess. O diretório do app, nunca o do usuário. */
    private readonly cwd: string = process.cwd(),
    /** Injetável só para o teste não depender do binário estar instalado. */
    private readonly spawnImpl: typeof spawn = spawn
  ) {}

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

      try {
        const processo = this.spawnImpl(BINARIO, ['--version'], {
          cwd: this.cwd,
          env: ambienteControlado(),
          shell: false,
          windowsHide: true
        })

        // `error` cobre o caso mais comum — binário não instalado (ENOENT). Sem este ramo, a
        // promessa nunca resolveria e a tela de providers ficaria carregando para sempre.
        processo.on('error', () => responder(false))
        processo.on('close', (codigo) => responder(codigo === 0))

        const relogio = setTimeout(() => {
          processo.kill('SIGKILL')
          responder(false)
        }, 3_000)
        processo.on('close', () => clearTimeout(relogio))
      } catch {
        responder(false)
      }
    })
  }

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
    const processo = this.spawnImpl(
      BINARIO,
      // Args fixos e montados aqui — nada vem de entrada do usuário além do **modelo**, que é
      // validado contra a tabela de preço antes de chegar ao adapter. O prompt vai por stdin.
      //
      // `stream-json` + `verbose` (SPEC-Fases-03 § Adapter): é o formato que traz as ferramentas
      // e o `usage` medido. `--verbose` não é opcional — sem ele o CLI recusa `stream-json` com
      // `--print`. O texto continua saindo igual; o que muda é que agora ele vem etiquetado.
      ['--print', '--model', request.model, '--output-format', 'stream-json', '--verbose'],
      {
        cwd: this.cwd,
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

    processo.stdout?.on('data', (pedaco: Buffer) => {
      const extracao = extrairLinhas(resto + pedaco.toString('utf8'))
      resto = extracao.resto

      for (const linha of extracao.linhas) {
        for (const evento of parsearLinha(linha)) {
          publicar(evento)

          // O texto do documento sai **daqui**, dos eventos de texto — é o mesmo conteúdo de
          // antes, agora desembrulhado do JSON em vez de repassado cru. Sem isto, o `--print`
          // com `stream-json` faria o documento nascer como um despejo de NDJSON.
          if (evento.tipo === 'texto') empurrar(evento.delta)

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
        for (const evento of parsearLinha(resto)) {
          publicar(evento)
          if (evento.tipo === 'texto') fila.push(evento.delta)
          if (evento.tipo === 'uso') {
            usoMedido = { tokensEntrada: evento.tokensEntrada, tokensSaida: evento.tokensSaida }
          }
        }
        resto = ''
      }

      if (sinal === 'SIGKILL' && falha === undefined) {
        falha = 'A chamada ao Claude Code CLI excedeu o tempo limite ou foi interrompida.'
      } else if (codigo !== 0 && falha === undefined) {
        // O stderr **não** entra na mensagem: pode carregar caminho, token de sessão ou
        // qualquer coisa que o CLI resolva imprimir, e a mensagem de erro é caminho clássico
        // de vazamento. O código de saída é seguro; o texto, não.
        falha = `O Claude Code CLI terminou com código ${codigo ?? 'desconhecido'}.`
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
    }
  }
}
