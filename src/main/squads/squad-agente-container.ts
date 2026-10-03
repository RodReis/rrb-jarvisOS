/**
 * O agente do escritor, rodando **dentro do container** do sandbox (SPEC-Squads-03, decisão 2 do PI).
 *
 * O agente é o Claude Code, lançado com `docker exec` no container que o Preflight preparou: o
 * worktree do escritor montado em `/work`, o `.git` principal somente-leitura, sem credencial no
 * ambiente (só o `ANTHROPIC_BASE_URL` do sidecar) e sem rede além do proxy. Aqui só se decide
 * **com que ferramentas** ele roda e **como** o processo é conduzido:
 *
 *  - `--tools` restringe o conjunto de ferramentas **disponíveis** a leitura e edição: não há
 *    `Bash`, então o agente não tem como executar Git nem nenhum outro comando (critério 1). É
 *    mais forte que `--allowedTools`, que só pré-aprova e deixaria o resto pedir permissão;
 *  - `--setting-sources ""` e `--strict-mcp-config` ignoram settings, hooks e servidores MCP que o
 *    repositório do projeto (conteúdo que o agente não controla, mas que também não é nosso) traga;
 *  - o prompt vai por **stdin**: o material de contexto passa de dezenas de KB, e a linha de comando
 *    do Windows não comporta isso;
 *  - o processo é **assíncrono**, e é por isso que ele não usa o `docker exec` síncrono do terminal:
 *    um `spawnSync` bloquearia o laço de eventos até o fim, e o heartbeat do slot e o cancelamento
 *    só rodariam depois — com o lease de 30 s já expirado.
 *
 * O que o agente fez nos arquivos o kernel prova pelo diff; o que ele diz no fim é dado não confiável.
 */

import { spawn } from 'node:child_process'
import { ambienteControlado } from '../execution/terminal-engine'
import type { AgenteDoEscritor, PedidoAoAgente } from './squad-escritor'

/** As únicas ferramentas do escritor: ler e editar. Nenhuma executa comando. */
export const FERRAMENTAS_DO_ESCRITOR = ['Read', 'Edit', 'Write', 'Grep', 'Glob'] as const

/** Onde o worktree do escritor está montado dentro do container. */
export const CWD_DO_ESCRITOR_NO_CONTAINER = '/work'

/** Mais saída que isto é um agente fora de controle: corta e segue com o que há. */
const MAX_BYTES_DA_SAIDA = 1024 * 1024

export interface PedidoDeProcesso {
  readonly binario: string
  readonly args: readonly string[]
  /** Escrito no stdin do processo, que se fecha em seguida. */
  readonly stdin: string
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
}

export interface SaidaDoProcesso {
  readonly codigo: number | null
  readonly stdout: string
  readonly stderr: string
  /** O sinal foi abortado e o processo, morto por isso. */
  readonly abortado: boolean
}

export type ExecutorDeProcesso = (pedido: PedidoDeProcesso) => Promise<SaidaDoProcesso>

export interface OpcoesDoClaudeNoContainer {
  readonly container: string
  readonly modelo: string
  readonly system: string
  readonly maxTurnos: number
}

/** Os argumentos do `docker exec`. O prompt **não** está aqui: vai por stdin. */
export function argsDoClaudeNoContainer(o: OpcoesDoClaudeNoContainer): readonly string[] {
  return [
    'exec',
    '-i',
    '-w',
    CWD_DO_ESCRITOR_NO_CONTAINER,
    o.container,
    'claude',
    '--print',
    '--model',
    o.modelo,
    '--output-format',
    'text',
    '--tools',
    FERRAMENTAS_DO_ESCRITOR.join(','),
    '--permission-mode',
    'acceptEdits',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    String(o.maxTurnos),
    '--append-system-prompt',
    o.system
  ]
}

/** O processo de verdade: `spawn` sem shell, ambiente controlado, stdin, e morte pelo sinal. */
export const executarProcessoReal: ExecutorDeProcesso = (pedido) =>
  new Promise<SaidaDoProcesso>((resolve) => {
    const filho = spawn(pedido.binario, [...pedido.args], {
      shell: false,
      env: pedido.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let abortado = false
    const acumular = (atual: string, pedaco: Buffer): string =>
      atual.length >= MAX_BYTES_DA_SAIDA ? atual : atual + pedaco.toString('utf8')
    filho.stdout.on('data', (d: Buffer) => (stdout = acumular(stdout, d)))
    filho.stderr.on('data', (d: Buffer) => (stderr = acumular(stderr, d)))

    const parar = (): void => {
      abortado = true
      filho.kill('SIGKILL')
    }
    if (pedido.signal.aborted) parar()
    else pedido.signal.addEventListener('abort', parar, { once: true })

    const fim = (codigo: number | null): void => {
      pedido.signal.removeEventListener('abort', parar)
      resolve({ codigo, stdout, stderr, abortado })
    }
    filho.on('error', (erro) => {
      stderr += erro.name
      fim(null)
    })
    filho.on('close', (codigo) => fim(codigo))
    // Um stdin que o processo já fechou (morto pelo sinal) devolve EPIPE: não é falha nossa.
    filho.stdin.on('error', () => undefined)
    filho.stdin.end(pedido.stdin)
  })

export interface ContainerDoEscritor {
  readonly container: string
}

export interface DependenciasDoAgenteNoContainer {
  /** Qual container atende este pedido. Quem preparou o sandbox sabe. */
  readonly containerDe: (pedido: PedidoAoAgente) => ContainerDoEscritor | undefined
  /** Mata o que o agente deixou rodando dentro do container (`pkill`), ao abortar. */
  readonly matarNoContainer: (container: string) => void
  readonly executarProcesso?: ExecutorDeProcesso
  readonly binario?: string
}

export class AgenteNoContainer implements AgenteDoEscritor {
  constructor(private readonly deps: DependenciasDoAgenteNoContainer) {}

  async executar(
    pedido: PedidoAoAgente
  ): Promise<{ ok: true; texto: string } | { ok: false; motivo: string }> {
    // O Claude Code é o único agente que roda no container com este conjunto de ferramentas.
    if (pedido.modelo.provider !== 'claude-code')
      return { ok: false, motivo: 'modelo-nao-suportado' }
    const alvo = this.deps.containerDe(pedido)
    if (alvo === undefined) return { ok: false, motivo: 'container-desconhecido' }

    const rodar = this.deps.executarProcesso ?? executarProcessoReal
    const saida = await rodar({
      binario: this.deps.binario ?? 'docker',
      args: argsDoClaudeNoContainer({
        container: alvo.container,
        modelo: pedido.modelo.modelo,
        system: pedido.system,
        maxTurnos: pedido.limites.maxTurnos
      }),
      stdin: pedido.prompt,
      env: ambienteControlado(),
      signal: pedido.signal
    })

    if (saida.abortado) {
      // Matar o cliente do `docker exec` não mata o que roda dentro do container.
      this.deps.matarNoContainer(alvo.container)
      return { ok: false, motivo: 'interrompido' }
    }
    if (saida.codigo !== 0) {
      return { ok: false, motivo: `claude-saiu-com-codigo-${saida.codigo ?? 'nenhum'}` }
    }
    return { ok: true, texto: saida.stdout.trim() }
  }
}
