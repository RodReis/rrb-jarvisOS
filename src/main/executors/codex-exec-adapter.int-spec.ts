/**
 * Testes do adapter `codex exec` (SPEC-Multi-Executor-03).
 *
 * Usa `node` como binário dublê para exercitar subprocess real com `shell: false`, stdin,
 * stdout JSONL, cancelamento e código de saída, sem depender do Codex instalado para a suíte.
 */

import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CodexExecExecutorAdapter } from './codex-exec-adapter'
import {
  requestDeTeste,
  rodarContractDoExecutor,
  type CenarioDoContrato
} from './coding-executor-contract'
import { CodingExecutorRuntime } from './coding-executor-runtime'
import type { CodingExecutorAdapter, ExecutorRequest } from './executor'

interface ChamadaDoSpawn {
  readonly comando: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly shell?: boolean | string
}

function linhaStarted(sessao = 'thread-1'): string {
  return JSON.stringify({ type: 'thread.started', thread_id: sessao })
}

function linhaTexto(texto: string): string {
  return JSON.stringify({
    type: 'item.completed',
    item: { id: 'msg_1', type: 'agent_message', text: texto }
  })
}

function linhaPath(path: string): string {
  return JSON.stringify({
    type: 'item.completed',
    item: { id: 'file_1', type: 'file_change', path }
  })
}

function linhaUso(entrada: number, saida: number): string {
  return JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: entrada, output_tokens: saida, duration_ms: 12 }
  })
}

function linhaFalha(mensagem = 'falha do executor'): string {
  return JSON.stringify({
    type: 'turn.failed',
    error: { message: mensagem }
  })
}

function scriptQueEmite(linhas: readonly string[], semQuebraFinal = false): string {
  const texto = linhas.join('\n') + (semQuebraFinal ? '' : '\n')
  return `process.stdin.on("data",()=>{});process.stdout.write(${JSON.stringify(texto)});process.exit(0);`
}

function scriptPendurado(): string {
  return 'process.stdin.on("data",()=>{});setInterval(()=>{},1000);'
}

function scriptIgnoraSinal(): string {
  return [
    'process.stdin.on("data",()=>{});',
    'process.on("SIGTERM",()=>{});',
    'process.on("SIGINT",()=>{});',
    'setInterval(()=>{},1000);'
  ].join('')
}

function scriptComSaidaParcial(): string {
  const primeira = linhaStarted()
  const segunda = linhaTexto('parcial ok')
  return [
    'process.stdin.on("data",()=>{});',
    `process.stdout.write(${JSON.stringify(primeira + '\n' + segunda.slice(0, 12))});`,
    `setTimeout(()=>{process.stdout.write(${JSON.stringify(segunda.slice(12) + '\n')});process.exit(0);}, 20);`
  ].join('')
}

function adapterComScript(
  script: string,
  chamadas?: ChamadaDoSpawn[],
  opcoes: { readonly suportaSchemaDeSaida?: boolean } = {}
): CodexExecExecutorAdapter {
  const spawnDuble = ((
    comando: string,
    args: readonly string[],
    opcoes: {
      cwd?: string
      env?: NodeJS.ProcessEnv
      shell?: boolean | string
    }
  ) => {
    chamadas?.push({
      comando,
      args: [...args],
      cwd: opcoes.cwd,
      env: opcoes.env,
      shell: opcoes.shell
    })
    return spawn(process.execPath, ['-e', script], { ...opcoes, cwd: process.cwd() })
  }) as typeof spawn

  return new CodexExecExecutorAdapter({
    nome: 'fake',
    spawnImpl: spawnDuble,
    codexHome: (referencia) => `CODEX_HOME:${referencia}`,
    ...opcoes
  })
}

function cenarios(): CenarioDoContrato {
  return {
    sucesso: () =>
      adapterComScript(
        scriptQueEmite([
          linhaStarted(),
          linhaPath('src/a.ts'),
          linhaTexto('feito'),
          linhaUso(10, 4)
        ])
      ),
    falha: () => adapterComScript(scriptQueEmite([linhaStarted(), linhaFalha()])),
    pendurado: () => adapterComScript(scriptPendurado()),
    ignoraCancelamento: () => adapterComScript(scriptIgnoraSinal()),
    comSessao: (sessao) =>
      adapterComScript(scriptQueEmite([linhaStarted(sessao), linhaTexto('feito'), linhaUso(1, 1)])),
    eventosDesordenados: () =>
      adapterComScript(
        scriptQueEmite([
          '{linha quebrada',
          linhaStarted(),
          linhaPath('src/a.ts'),
          linhaPath('src/a.ts'),
          linhaTexto('feito'),
          linhaUso(1, 1),
          JSON.stringify({ type: 'evento.novo', payload: true })
        ])
      ),
    restrito: () =>
      adapterComScript(scriptQueEmite([linhaStarted(), linhaTexto('feito')]), undefined, {
        suportaSchemaDeSaida: false
      })
  }
}

rodarContractDoExecutor('codex-exec', cenarios)

describe('CodexExecExecutorAdapter — invocação segura', () => {
  it('usa shell false, cwd do request e CODEX_HOME derivado da referência opaca', async () => {
    const chamadas: ChamadaDoSpawn[] = []
    const adapter = adapterComScript(scriptQueEmite([linhaStarted(), linhaTexto('ok')]), chamadas)
    const runtime = new CodingExecutorRuntime()

    await runtime.executar(
      requestDeTeste({
        worktree: process.cwd(),
        autenticacao: { referencia: 'perfil-pipeline' }
      }),
      adapter
    )

    expect(chamadas[0]?.shell).toBe(false)
    expect(chamadas[0]?.cwd).toBe(process.cwd())
    expect(chamadas[0]?.env?.CODEX_HOME).toBe('CODEX_HOME:perfil-pipeline')
  })

  it('passa prompt por stdin e não coloca instrução, segredo ou path permitido nos argumentos', async () => {
    const chamadas: ChamadaDoSpawn[] = []
    const adapter = adapterComScript(scriptQueEmite([linhaStarted(), linhaTexto('ok')]), chamadas)
    const runtime = new CodingExecutorRuntime()

    await runtime.executar(
      requestDeTeste({
        modelo: 'gpt-5.6-sol',
        pathsPermitidos: ['src/segredo-nao-vai-em-argv.ts']
      }),
      adapter
    )

    const args = chamadas[0]?.args ?? []
    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--ephemeral')
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-sol')
    expect(args.join(' ')).not.toContain('segredo-nao-vai-em-argv')
  })

  it('materializa schema em arquivo temporário e passa por --output-schema', async () => {
    const chamadas: ChamadaDoSpawn[] = []
    const adapter = adapterComScript(scriptQueEmite([linhaStarted(), linhaTexto('ok')]), chamadas)
    const runtime = new CodingExecutorRuntime()

    await runtime.executar(
      requestDeTeste({
        schemaDeSaida: '{"type":"object","additionalProperties":false}'
      }),
      adapter
    )

    const args = chamadas[0]?.args ?? []
    const schemaPath = args[args.indexOf('--output-schema') + 1]
    expect(schemaPath).toContain('jarvisos-codex-schema-')
    expect(schemaPath).toContain('att-1.schema.json')
  })
})

describe('CodexExecExecutorAdapter — JSONL do Codex', () => {
  it('recompõe linha parcial antes de parsear', async () => {
    const adapter = adapterComScript(scriptComSaidaParcial())
    const runtime = new CodingExecutorRuntime()

    const resultado = await runtime.executar(requestDeTeste(), adapter)

    expect(resultado.status).toBe('concluido')
    expect(resultado.resumo).toBe('parcial ok')
  })

  it('preserva evento desconhecido e linha inválida como diagnóstico', async () => {
    const adapter = adapterComScript(
      scriptQueEmite([
        linhaStarted(),
        '{nao-json',
        JSON.stringify({ type: 'novo.evento', payload: { x: 1 } }),
        linhaTexto('ok')
      ])
    )
    const runtime = new CodingExecutorRuntime()

    const resultado = await runtime.executar(requestDeTeste(), adapter)

    expect(resultado.status).toBe('concluido')
    expect(resultado.diagnosticos.length).toBeGreaterThanOrEqual(2)
  })

  it('lê a última linha mesmo sem quebra no fim', async () => {
    const adapter = adapterComScript(
      scriptQueEmite([linhaStarted(), linhaTexto('sem quebra'), linhaUso(5, 7)], true)
    )
    const runtime = new CodingExecutorRuntime()

    const resultado = await runtime.executar(requestDeTeste(), adapter)

    expect(resultado.status).toBe('concluido')
    expect(resultado.resumo).toBe('sem quebra')
    expect(resultado.uso?.tokensEntrada).toBe(5)
    expect(resultado.uso?.tokensSaida).toBe(7)
  })

  it('código não-zero não vaza stderr para evidência', async () => {
    const script =
      'process.stdin.on("data",()=>{});process.stderr.write("CAMINHO/SECRETO/auth.json");process.exit(3);'
    const adapter = adapterComScript(script)
    const runtime = new CodingExecutorRuntime()

    const resultado = await runtime.executar(requestDeTeste(), adapter)

    expect(resultado.status).toBe('falhou')
    expect(resultado.evidencias.join('\n')).not.toContain('SECRETO')
    expect(resultado.evidencias.join('\n')).toContain('código 3')
  })
})

describe('CodexExecExecutorAdapter — disponibilidade', () => {
  it('disponivel retorna true quando --version fecha com zero', async () => {
    const adapter = adapterComScript('process.exit(0);')

    await expect(adapter.disponivel()).resolves.toBe(true)
  })

  it('disponivel retorna false quando o binário falha', async () => {
    const spawnDuble = (() => spawn('binario-inexistente-jarvisos', [])) as unknown as typeof spawn
    const adapter = new CodexExecExecutorAdapter({ spawnImpl: spawnDuble })

    await expect(adapter.disponivel()).resolves.toBe(false)
  })
})

describe('CodexExecExecutorAdapter — instrumentação de contrato', () => {
  it('expõe requests recebidos para o contract test', async () => {
    const adapter = adapterComScript(scriptQueEmite([linhaStarted(), linhaTexto('ok')]))
    const runtime = new CodingExecutorRuntime()
    const request: ExecutorRequest = requestDeTeste()

    await runtime.executar(request, adapter as CodingExecutorAdapter)

    expect(adapter.chamadasDeExecucao).toBe(1)
    expect(adapter.requestsRecebidos[0]).toBeDefined()
  })
})
