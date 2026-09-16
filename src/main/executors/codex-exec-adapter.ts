/**
 * Adapter do `codex exec` para o runtime de executores (SPEC-Multi-Executor-03).
 *
 * Ele traduz o protocolo JSONL do Codex CLI para o contrato comum de `CodingExecutorAdapter`.
 * O kernel continua dono de fila, escopo, Git, efeitos externos e validações; este arquivo
 * só monta a invocação segura e normaliza eventos.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ambienteControlado } from '../execution/terminal-engine'
import { BINARIO_CODEX, resolverInvocacao } from '../ai/codex-profile-service'
import type {
  CodingExecutorAdapter,
  ExecutorEvent,
  ExecutorRequest,
  ModoDeCobranca
} from './executor'

const REVISOES_SUPORTADAS = ['revisao-padrao', 'm10-f03-codex-exec-adapter'] as const

type SpawnFn = typeof spawn

interface CodexExecAdapterOptions {
  readonly nome?: string
  readonly spawnImpl?: SpawnFn
  readonly resolverScript?: () => string | undefined
  readonly codexHome?: (referencia: string) => string
  readonly suportaSchemaDeSaida?: boolean
}

interface SchemaTemporario {
  readonly caminho: string
  remover(): void
}

export class CodexExecExecutorAdapter implements CodingExecutorAdapter {
  readonly nome: string
  readonly modosSuportados: readonly ModoDeCobranca[] = ['unmetered', 'subscription_limited']
  readonly revisoesSuportadas: readonly string[] = REVISOES_SUPORTADAS
  readonly suportaSchemaDeSaida: boolean

  chamadasDeExecucao = 0
  readonly requestsRecebidos: ExecutorRequest[] = []

  private readonly spawnImpl: SpawnFn
  private readonly resolverScript: () => string | undefined
  private readonly codexHome: (referencia: string) => string

  constructor(opcoes: CodexExecAdapterOptions = {}) {
    this.nome = opcoes.nome ?? 'codex-exec'
    this.spawnImpl = opcoes.spawnImpl ?? spawn
    this.resolverScript = opcoes.resolverScript ?? (() => undefined)
    this.codexHome = opcoes.codexHome ?? ((referencia) => referencia)
    this.suportaSchemaDeSaida = opcoes.suportaSchemaDeSaida ?? true
  }

  async disponivel(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      let respondido = false
      const responder = (valor: boolean): void => {
        if (respondido) return
        respondido = true
        resolve(valor)
      }

      try {
        const invocacao = resolverInvocacao(BINARIO_CODEX, ['--version'], this.resolverScript)
        const processo = this.spawnImpl(invocacao.comando, [...invocacao.args], {
          env: ambienteControlado(),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore']
        })

        const relogio = setTimeout(() => {
          processo.kill('SIGKILL')
          responder(false)
        }, 5_000)

        processo.on('error', () => {
          clearTimeout(relogio)
          responder(false)
        })
        processo.on('close', (codigo) => {
          clearTimeout(relogio)
          responder(codigo === 0)
        })
      } catch {
        responder(false)
      }
    })
  }

  async *executar(request: ExecutorRequest): AsyncIterable<ExecutorEvent> {
    this.chamadasDeExecucao += 1
    this.requestsRecebidos.push(request)

    const schema = schemaTemporario(request)
    const invocacao = resolverInvocacao(
      BINARIO_CODEX,
      argsDoCodex(request, schema),
      this.resolverScript
    )

    const processo = this.spawnImpl(invocacao.comando, [...invocacao.args], {
      cwd: request.worktree,
      env: {
        ...ambienteControlado(),
        CODEX_HOME: this.codexHome(request.autenticacao.referencia)
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const fila: ExecutorEvent[] = []
    let acordar: (() => void) | undefined
    let terminou = false
    let erroDeProcesso: string | undefined
    let resto = ''
    let recebeuStarted = false
    let recebeuTerminal = false
    let textoFinal = ''

    const empurrar = (evento: ExecutorEvent): void => {
      if (evento.tipo === 'started') recebeuStarted = true
      if (evento.tipo === 'done' || evento.tipo === 'failed' || evento.tipo === 'canceled') {
        recebeuTerminal = true
      }
      fila.push(evento)
      acordar?.()
      acordar = undefined
    }

    const consumirLinha = (linha: string): void => {
      for (const evento of eventosDaLinha(linha)) {
        if (evento.tipo === 'progress') textoFinal += evento.mensagem
        empurrar(evento)
      }
    }

    processo.stdout?.on('data', (pedaco: Buffer) => {
      const extracao = extrairLinhas(resto + pedaco.toString('utf8'))
      resto = extracao.resto
      for (const linha of extracao.linhas) consumirLinha(linha)
    })

    // Lido para não travar o pipe. Stderr pode carregar paths/sessão; não vira evidência.
    processo.stderr?.on('data', () => {})

    const abortar = (): void => {
      processo.kill('SIGKILL')
    }
    request.signal?.addEventListener('abort', abortar, { once: true })

    processo.stdin?.write(requestToPrompt(request))
    processo.stdin?.end()

    processo.on('error', (erro) => {
      erroDeProcesso =
        (erro as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'O Codex CLI não foi encontrado.'
          : 'Falha ao executar o Codex CLI.'
      terminou = true
      acordar?.()
      acordar = undefined
    })

    processo.on('close', (codigo, sinal) => {
      if (resto.trim() !== '') {
        consumirLinha(resto)
        resto = ''
      }

      if (sinal === 'SIGKILL' && erroDeProcesso === undefined) {
        erroDeProcesso = 'O Codex CLI foi interrompido.'
      } else if (codigo !== 0 && erroDeProcesso === undefined && !recebeuTerminal) {
        erroDeProcesso = `O Codex CLI terminou com código ${codigo ?? 'desconhecido'}.`
      }

      if (!recebeuStarted && erroDeProcesso === undefined) empurrar({ tipo: 'started' })
      if (!recebeuTerminal && erroDeProcesso === undefined) {
        empurrar({ tipo: 'done', resumo: textoFinal === '' ? undefined : textoFinal })
      }

      terminou = true
      acordar?.()
      acordar = undefined
    })

    try {
      for (;;) {
        while (fila.length > 0) {
          yield fila.shift() as ExecutorEvent
        }

        if (terminou) break

        await new Promise<void>((resolve) => {
          acordar = resolve
        })
      }

      if (erroDeProcesso !== undefined) throw new Error(erroDeProcesso)
    } finally {
      request.signal?.removeEventListener('abort', abortar)
      if (!terminou) processo.kill('SIGKILL')
      schema?.remover()
    }
  }
}

function argsDoCodex(request: ExecutorRequest, schema?: SchemaTemporario): readonly string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--model',
    request.modelo,
    '--cd',
    request.worktree,
    '--skip-git-repo-check',
    '--sandbox',
    'read-only'
  ]

  if (schema !== undefined) args.push('--output-schema', schema.caminho)
  if (request.sessaoAnterior !== undefined) args.push('resume', request.sessaoAnterior)
  return args
}

function requestToPrompt(request: ExecutorRequest): string {
  return [
    'Execute a tentativa de construcao autorizada pelo kernel.',
    '',
    `Run: ${request.runId}`,
    `Attempt: ${request.attemptId}`,
    `Context pack: ${request.contextPackId}`,
    '',
    'Paths permitidos:',
    ...request.pathsPermitidos.map((path) => `- ${path}`),
    '',
    'Validacoes esperadas:',
    ...request.validacoes.map((comando) => `- ${comando.join(' ')}`),
    '',
    'Retorne o resultado final conforme o schema quando houver schema.'
  ].join('\n')
}

function schemaTemporario(request: ExecutorRequest): SchemaTemporario | undefined {
  if (request.schemaDeSaida === undefined) return undefined

  const dir = mkdtempSync(join(tmpdir(), 'jarvisos-codex-schema-'))
  const caminho = join(dir, `${request.attemptId}.schema.json`)
  writeFileSync(caminho, request.schemaDeSaida, 'utf8')
  return {
    caminho,
    remover: () => {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

function extrairLinhas(buffer: string): {
  readonly linhas: readonly string[]
  readonly resto: string
} {
  const partes = buffer.split('\n')
  const resto = partes.pop() ?? ''
  return { linhas: partes.filter((linha) => linha.trim() !== ''), resto }
}

function eventosDaLinha(linha: string): readonly ExecutorEvent[] {
  let evento: Record<string, unknown>
  try {
    const analisado: unknown = JSON.parse(linha)
    if (typeof analisado !== 'object' || analisado === null) {
      return [{ tipo: 'desconhecido', bruto: linha }]
    }
    evento = analisado as Record<string, unknown>
  } catch {
    return [{ tipo: 'desconhecido', bruto: linha }]
  }

  const tipo = texto(evento.type)
  if (tipo === 'thread.started') {
    const sessao = texto(evento.thread_id)
    return [{ tipo: 'started', ...(sessao === '' ? {} : { sessao }) }]
  }

  if (tipo === 'turn.completed') {
    const uso = (evento.usage ?? {}) as Record<string, unknown>
    return [
      {
        tipo: 'usage',
        tokensEntrada: inteiro(uso.input_tokens),
        tokensSaida: inteiro(uso.output_tokens),
        duracaoMs: inteiro(uso.duration_ms)
      }
    ]
  }

  if (tipo === 'turn.failed') {
    const erro = (evento.error ?? {}) as Record<string, unknown>
    const mensagem = texto(erro.message)
    return [
      {
        tipo: 'failed',
        erro: mensagem === '' ? 'A execucao do Codex falhou.' : mensagem,
        assinatura: 'codex:turn-failed'
      }
    ]
  }

  if (tipo === 'error') {
    const mensagem = texto(evento.message)
    return [
      {
        tipo: 'failed',
        erro: mensagem === '' ? 'O Codex reportou erro.' : mensagem,
        assinatura: 'codex:error'
      }
    ]
  }

  if (tipo === 'item.completed' || tipo === 'item.started') {
    return eventosDoItem(evento)
  }

  return [{ tipo: 'desconhecido', bruto: linha }]
}

function eventosDoItem(evento: Record<string, unknown>): readonly ExecutorEvent[] {
  const item = (evento.item ?? {}) as Record<string, unknown>
  const tipo = texto(item.type)

  if (tipo === 'agent_message') {
    const conteudo = texto(item.text)
    return conteudo === '' ? [] : [{ tipo: 'progress', mensagem: conteudo }]
  }

  if (tipo === 'file_change') {
    const path = texto(item.path)
    return path === '' ? [] : [{ tipo: 'path_changed', path }]
  }

  if (tipo === 'command_execution') {
    const comando = texto(item.command)
    return [
      {
        tipo: 'tool_used',
        nome: 'command_execution',
        ...(comando === '' ? {} : { argumentos: comando })
      }
    ]
  }

  return [{ tipo: 'desconhecido', bruto: JSON.stringify(evento) }]
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function inteiro(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.max(0, Math.trunc(valor)) : 0
}
