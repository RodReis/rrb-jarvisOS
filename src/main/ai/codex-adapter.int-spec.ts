/**
 * O adapter do Codex contra subprocess real (SPEC-Fases-06, critérios 1, 3 e 8).
 *
 * Arquivo próprio, e não mais um bloco em `adapters-novos.int-spec.ts`: aquele já tem 670 linhas,
 * e o Codex traz um formato inteiro a exercitar. A regra do projeto é arquivo focado.
 *
 * `node` como binário dublê, pelo mesmo motivo do bloco do Claude Code: exercita `spawn` de
 * verdade — `shell: false`, stdin, timeout, kill — sem depender de o `codex` estar instalado. O
 * que se prova aqui são as garantias do subprocess, que são minhas; o protocolo do CLI é dele, e
 * as linhas usadas são as **medidas** no 0.149.0 mais os nomes da fonte (`exec_events.rs`).
 *
 * **O critério 8 fecha por construção:** este arquivo exercita o `CodexAdapter` pela mesma
 * interface `AiAdapter` dos outros quatro, e o `call-provider` não ganha um ramo sequer.
 */

import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { AdapterChunk } from './adapter'
import type { GenerationEvent } from '@shared/domain/geracao'
import { AdapterError } from './anthropic-adapter'
import { CodexAdapter } from './codex-adapter'

const CODEX_HOME_DA_PIPELINE = '/userData/codex-pipeline'

/** Uma chamada capturada ao `spawn`, para as asserções sobre args e ambiente. */
interface ChamadaDoCodex {
  readonly args: readonly string[]
  readonly env?: NodeJS.ProcessEnv
}

async function coletar(stream: AsyncIterable<AdapterChunk>): Promise<readonly AdapterChunk[]> {
  const chunks: AdapterChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function comBinarioDuble(script: string, capturadas?: ChamadaDoCodex[]): CodexAdapter {
  const spawnDuble = ((
    _binario: string,
    args: readonly string[],
    opcoes: { env?: NodeJS.ProcessEnv }
  ) => {
    capturadas?.push({ args: [...args], env: opcoes.env })
    return spawn(process.execPath, ['-e', script], opcoes)
  }) as typeof spawn

  return new CodexAdapter(process.cwd(), () => CODEX_HOME_DA_PIPELINE, spawnDuble)
}

/** O texto do documento vem em `agent_message`, dentro de um `item.completed`. */
function linhaDeTexto(texto: string): string {
  return JSON.stringify({
    type: 'item.completed',
    item: { id: 'msg_1', type: 'agent_message', text: texto }
  })
}

/** O `usage` medido chega no `turn.completed` (SDK oficial: `TurnCompletedEvent`). */
function linhaDeUso(entrada: number, saida: number): string {
  return JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: entrada, output_tokens: saida }
  })
}

function scriptQueEmite(...linhas: readonly string[]): string {
  const escritas = linhas
    .map((l) => `process.stdout.write(${JSON.stringify(l + '\n')});`)
    .join('')
  return `process.stdin.on("data",()=>{});${escritas}process.exit(0)`
}

function juntarTexto(chunks: readonly AdapterChunk[]): string {
  return chunks
    .filter((c) => c.tipo === 'texto')
    .map((c) => (c.tipo === 'texto' ? c.texto : ''))
    .join('')
}

describe('CodexAdapter — texto e uso', () => {
  it('monta o texto do JSONL e fecha com o usage medido', async () => {
    const chunks = await coletar(
      comBinarioDuble(
        scriptQueEmite(linhaDeTexto('O brief está pronto.'), linhaDeUso(1200, 340))
      ).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'gere o brief',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    expect(juntarTexto(chunks)).toBe('O brief está pronto.')

    const fim = chunks.at(-1)
    expect(fim?.tipo === 'fim' ? fim.usage : undefined).toEqual({
      tokensEntrada: 1200,
      tokensSaida: 340
    })
  })

  /**
   * O `turn.completed` é o último evento e pode não terminar em `\n`. Descartar o resto do buffer
   * perderia justamente o `usage` medido — o mesmo caso que o adapter do Claude Code cobre.
   */
  it('lê a última linha mesmo sem quebra de linha no fim', async () => {
    const script = `process.stdin.on("data",()=>{});process.stdout.write(${JSON.stringify(
      linhaDeTexto('oi') + '\n' + linhaDeUso(3, 5)
    )});process.exit(0)`

    const chunks = await coletar(
      comBinarioDuble(script).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'oi',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    expect(juntarTexto(chunks)).toBe('oi')
    expect(chunks.at(-1)).toMatchObject({ usage: { tokensEntrada: 3, tokensSaida: 5 } })
  })

  /** Sem `turn.completed`, cai na aproximação — aceitável porque a rota é `unmetered`. */
  it('aproxima o uso quando o CLI não reporta usage', async () => {
    const chunks = await coletar(
      comBinarioDuble(scriptQueEmite(linhaDeTexto('resposta sem uso'))).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'oi',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    const fim = chunks.at(-1)
    expect(fim?.tipo === 'fim' ? fim.usage.tokensSaida : 0).toBeGreaterThan(0)
  })
})

describe('CodexAdapter — o perfil e os argumentos', () => {
  /**
   * **O `CODEX_HOME` da pipeline chega ao subprocess** (SPEC-Multi-Executor-02, critério 3).
   *
   * A asserção é sobre o `env` que o adapter montou. Um adapter que esquecesse a variável abriria
   * o `~/.codex` **pessoal** do PI — e passaria em todos os outros testes deste arquivo, porque o
   * texto sairia igual.
   */
  it('aponta o perfil da pipeline, e não o pessoal', async () => {
    const chamadas: ChamadaDoCodex[] = []

    await coletar(
      comBinarioDuble(scriptQueEmite(linhaDeUso(1, 1)), chamadas).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'oi',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    expect(chamadas[0]?.env?.CODEX_HOME).toBe(CODEX_HOME_DA_PIPELINE)
  })

  /** O modelo do PI vira `--model`; o prompt vai por stdin e **nunca** como argumento. */
  it('passa o modelo por --model e mantém o prompt fora dos argumentos', async () => {
    const chamadas: ChamadaDoCodex[] = []

    await coletar(
      comBinarioDuble(scriptQueEmite(linhaDeUso(1, 1)), chamadas).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'um prompt que nao pode virar argumento',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    const args = chamadas[0]?.args ?? []
    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-sol')
    expect(args.join(' ')).not.toContain('nao pode virar argumento')
  })

  /** O ambiente do main não alcança o filho — a lição da M4-F02 vale igual aqui. */
  it('não repassa o ambiente do main ao subprocess', async () => {
    const chamadas: ChamadaDoCodex[] = []
    process.env.SEGREDO_DO_MAIN_M26F06 = 'nao-deve-vazar'

    try {
      await coletar(
        comBinarioDuble(scriptQueEmite(linhaDeUso(1, 1)), chamadas).generateStream({
          model: 'gpt-5.6-sol',
          prompt: 'oi',
          maxTokens: 100,
          timeoutMs: 5_000
        })
      )

      expect(chamadas[0]?.env?.SEGREDO_DO_MAIN_M26F06).toBeUndefined()
    } finally {
      delete process.env.SEGREDO_DO_MAIN_M26F06
    }
  })
})

describe('CodexAdapter — console e falhas', () => {
  it('entrega ferramentas e uso ao console, na ordem em que o CLI as emitiu (critério 3)', async () => {
    const eventos: GenerationEvent[] = []

    await coletar(
      comBinarioDuble(
        scriptQueEmite(
          linhaDeTexto('vou rodar os testes'),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'cmd_1',
              type: 'command_execution',
              command: 'npm test',
              exit_code: 0,
              aggregated_output: '3 passed'
            }
          }),
          linhaDeUso(10, 20)
        )
      ).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'rode os testes',
        maxTokens: 100,
        timeoutMs: 5_000,
        onEvento: (e) => eventos.push(e)
      })
    )

    expect(eventos.map((e) => e.tipo)).toEqual([
      'texto',
      'ferramenta-inicio',
      'ferramenta-fim',
      'uso'
    ])
  })

  /**
   * O console **não derruba a geração**: um `onEvento` que lança é engolido.
   *
   * Quem passa o callback é o ponto único, que escreve no banco em lote — um disco cheio ali
   * chegaria como exceção no meio do `for await` do stdout e mataria o documento.
   */
  it('sobrevive a um console que lança', async () => {
    const chunks = await coletar(
      comBinarioDuble(scriptQueEmite(linhaDeTexto('resposta'), linhaDeUso(1, 1))).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'oi',
        maxTokens: 100,
        timeoutMs: 5_000,
        onEvento: () => {
          throw new Error('banco travado')
        }
      })
    )

    expect(juntarTexto(chunks)).toBe('resposta')
  })

  /**
   * Saída não-zero vira `AdapterError` com o **código**, nunca com o stderr.
   *
   * Mensagem de erro é caminho clássico de vazamento: o stderr do CLI pode carregar caminho de
   * perfil, identificador de sessão ou o que ele resolver imprimir.
   */
  it('falha com o código de saída, sem repassar o stderr', async () => {
    const script =
      'process.stdin.on("data",()=>{});process.stderr.write("CAMINHO/SECRETO/auth.json");process.exit(3)'

    await expect(
      coletar(
        comBinarioDuble(script).generateStream({
          model: 'gpt-5.6-sol',
          prompt: 'oi',
          maxTokens: 100,
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(AdapterError)
  })

  it('não deixa o caminho do stderr aparecer na mensagem de erro', async () => {
    const script =
      'process.stdin.on("data",()=>{});process.stderr.write("CAMINHO/SECRETO/auth.json");process.exit(3)'

    try {
      await coletar(
        comBinarioDuble(script).generateStream({
          model: 'gpt-5.6-sol',
          prompt: 'oi',
          maxTokens: 100,
          timeoutMs: 5_000
        })
      )
      expect.unreachable('deveria ter lançado')
    } catch (erro) {
      expect((erro as Error).message).not.toContain('SECRETO')
      expect((erro as Error).message).toContain('3')
    }
  })

  /**
   * Linha malformada vira `erro` no console e a geração **continua** — falha aberta para o texto.
   *
   * Uma mudança de formato do CLI não pode parar a jornada: o documento é o produto.
   */
  it('continua a geração quando uma linha do JSONL vem malformada', async () => {
    const eventos: GenerationEvent[] = []

    const chunks = await coletar(
      comBinarioDuble(
        scriptQueEmite('{isto nao e json', linhaDeTexto('mesmo assim'), linhaDeUso(1, 1))
      ).generateStream({
        model: 'gpt-5.6-sol',
        prompt: 'oi',
        maxTokens: 100,
        timeoutMs: 5_000,
        onEvento: (e) => eventos.push(e)
      })
    )

    expect(juntarTexto(chunks)).toBe('mesmo assim')
    expect(eventos.some((e) => e.tipo === 'erro')).toBe(true)
  })
})
