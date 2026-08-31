/**
 * O proxy de autenticação do executor (SPEC-Entrega-03, emendas 1 e 6; critérios 9 e 11).
 *
 * A pergunta que este arquivo responde: **como o Claude Code dentro do container chama modelo
 * sem receber credencial nenhuma?**
 *
 * A resposta é a inversão que a emenda 1 escolheu: o container recebe apenas
 * `ANTHROPIC_BASE_URL` apontando para cá, e é o **host** que injeta a credencial da rota
 * escolhida. Nenhuma chave, nenhum token e nenhum `~/.claude` atravessam a fronteira — o
 * critério 9 continua literal, e o uso continua passando pelo ponto único do MVP-005
 * (`AiCallService`), com `CostEvent`, gate de orçamento e `AuditEvent` no lugar de sempre.
 *
 * ## Por que o servidor é `node:http` e não uma dependência
 *
 * O que este proxy precisa fazer é aceitar um POST em loopback, traduzir e responder em SSE.
 * `node:http` faz exatamente isso. Trazer um framework acrescentaria superfície (middlewares,
 * parsing, rotas) para um servidor que atende **um** endpoint e escuta só em `127.0.0.1`.
 *
 * ## O limite declarado, e por que ele é do PI
 *
 * `AiRequest` carrega `prompt: string`, não `messages[]` — então uma conversa multi-turn do
 * executor é **achatada** num prompt único (emenda 6 de 2026-08-31). É perda real de
 * fidelidade, aceita pelo PI para não abrir a camada de providers dentro desta fatia. Estender
 * `AiRequest` é a correção de raiz e ficou registrada como dívida.
 *
 * ## Loopback é a autenticação
 *
 * O servidor escuta em `127.0.0.1` com porta efêmera. Não há token de sessão de propósito: um
 * token teria de viajar como argumento de `docker run`, e o `redact` compartilhado só reconhece
 * credencial em campo nomeado ou URL `user:pass@` — ele apareceria **em claro** no `AuditEvent`
 * e no `execution_run`. Sem segredo para vazar, não há vazamento.
 */

import { createServer, type Server } from 'node:http'
import type { AiProvider, AiRequest } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AiCallService } from '../ai/call-provider'

/** Só loopback. O container alcança via `host.docker.internal`, que o Docker mapeia. */
const HOST = '127.0.0.1'

export interface ProxyDeps {
  readonly ai: AiCallService
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /**
   * A rota que o executor usa. `claude-code` é a de assinatura (subprocess no host); a paga
   * responde pelo SDK. Quem decide é a política de roteamento, não o container.
   */
  readonly rota: () => AiProvider
  /** O run e a tentativa correntes — o que amarra o custo ao trabalho (critério 11). */
  readonly contexto: () => { readonly runId: string; readonly tentativa: number } | undefined
  /** O manifesto que autorizou a construção. Sem ele o `AiCallService` recusa a chamada. */
  readonly contextPackId: () => string | undefined
}

export class ExecutorProxy {
  private servidor?: Server
  private porta?: number

  constructor(private readonly deps: ProxyDeps) {}

  /** Sobe o proxy numa porta efêmera e devolve a URL que o container recebe. */
  async iniciar(): Promise<string> {
    if (this.servidor !== undefined) return this.url()

    const servidor = createServer((req, res) => {
      void this.atender(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      servidor.once('error', reject)
      // Porta 0 = o SO escolhe uma livre. Nunca uma porta fixa: colidir com outro stack local
      // é exatamente o que o critério 3 manda evitar, e aqui evitar é de graça.
      servidor.listen(0, HOST, () => resolve())
    })

    const endereco = servidor.address()
    if (endereco === null || typeof endereco === 'string') {
      servidor.close()
      throw new Error('O proxy do executor não obteve uma porta.')
    }

    this.servidor = servidor
    this.porta = endereco.port
    log.agent.info('Proxy do executor no ar', { porta: this.porta })
    return this.url()
  }

  /** O proxy está no ar? É o que o preflight pergunta antes de liberar o run (critério 11). */
  noAr(): boolean {
    return this.servidor !== undefined && this.servidor.listening
  }

  /**
   * A URL que o container recebe.
   *
   * `host.docker.internal` e não `127.0.0.1`: dentro do container, o loopback é o **do
   * container**, e apontar para lá faria toda chamada do executor bater em nada.
   */
  url(): string {
    if (this.porta === undefined) throw new Error('O proxy do executor não foi iniciado.')
    return `http://host.docker.internal:${this.porta}`
  }

  async parar(): Promise<void> {
    const servidor = this.servidor
    if (servidor === undefined) return
    this.servidor = undefined
    this.porta = undefined
    await new Promise<void>((resolve) => servidor.close(() => resolve()))
  }

  private async atender(
    req: NodeJS.ReadableStream & { readonly method?: string },
    res: NodeJS.WritableStream & {
      writeHead: (status: number, headers?: Record<string, string>) => void
      end: (chunk?: string) => void
    }
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Só POST.' }))
      return
    }

    let corpo = ''
    for await (const pedaco of req) corpo += String(pedaco)

    const prompt = extrairPrompt(corpo)
    if (prompt === undefined) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Pedido sem conteúdo.' }))
      return
    }

    const contexto = this.deps.contexto()
    const packId = this.deps.contextPackId()

    const pedido: AiRequest = {
      provider: this.deps.rota(),
      prompt,
      ...(packId === undefined ? {} : { contextPackId: packId }),
      ...(contexto === undefined ? {} : { runId: contexto.runId, tentativa: contexto.tentativa })
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })

    try {
      for await (const evento of this.deps.ai.call(pedido, {
        userId: this.deps.userId(),
        workspace: this.deps.workspaceId()
      })) {
        if (evento.tipo === 'chunk') {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: evento.texto })}\n\n`)
          continue
        }
        // O `fim` carrega o desfecho; o custo já foi registrado pelo ponto único.
        res.write(
          `data: ${JSON.stringify({ type: 'done', state: evento.estado, error: evento.erro })}\n\n`
        )
      }
    } catch {
      // A mensagem crua nunca vai ao container: é o caminho clássico de vazar credencial, e o
      // executor não tem o que fazer com ela além de ecoá-la no log dele.
      res.write(`data: ${JSON.stringify({ type: 'done', state: 'falhou' })}\n\n`)
    } finally {
      res.end()
    }
  }
}

/**
 * O prompt do corpo, no formato que o cliente Anthropic manda.
 *
 * **Achata `messages[]` num prompt único** — a perda declarada na emenda 6. Concatena com o
 * papel à frente para que o modelo ainda distinga quem disse o quê; sem isso, uma conversa de
 * dez turnos chegaria como um bloco indistinto.
 */
function extrairPrompt(corpo: string): string | undefined {
  let json: unknown
  try {
    json = JSON.parse(corpo)
  } catch {
    return undefined
  }

  if (typeof json !== 'object' || json === null) return undefined
  const pedido = json as { messages?: unknown; prompt?: unknown }

  if (typeof pedido.prompt === 'string' && pedido.prompt !== '') return pedido.prompt

  if (!Array.isArray(pedido.messages)) return undefined
  const partes = pedido.messages
    .map((m) => {
      const mensagem = m as { role?: unknown; content?: unknown }
      const papel = typeof mensagem.role === 'string' ? mensagem.role : 'user'
      const texto = textoDoConteudo(mensagem.content)
      return texto === '' ? '' : `${papel}: ${texto}`
    })
    .filter((p) => p !== '')

  return partes.length === 0 ? undefined : partes.join('\n\n')
}

/** O conteúdo pode vir como string ou como blocos — os dois formatos do cliente Anthropic. */
function textoDoConteudo(conteudo: unknown): string {
  if (typeof conteudo === 'string') return conteudo
  if (!Array.isArray(conteudo)) return ''
  return conteudo
    .map((bloco) => {
      const b = bloco as { text?: unknown }
      return typeof b.text === 'string' ? b.text : ''
    })
    .filter((t) => t !== '')
    .join('\n')
}
