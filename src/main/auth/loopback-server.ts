/**
 * Servidor loopback temporário que recebe o retorno do OAuth (SPEC-03, pergunta 2 do PI).
 *
 * Por que loopback e não webview: o fluxo abre no **navegador do sistema**, onde o usuário
 * vê a barra de endereço real do Google e o app não enxerga o que ele digita. Um webview
 * embutido daria ao app acesso ao formulário de senha — exatamente o que se quer evitar.
 *
 * O servidor nasce no `login()`, atende **uma** requisição e morre. Não fica escutando:
 * porta aberta ociosa num app desktop é superfície de ataque sem contrapartida.
 */

import { createServer, type Server } from 'node:http'
import { log } from '../logging/logger'

/** Porta 0 = o SO escolhe uma livre. Fixar porta quebraria com duas instâncias. */
const PORTA_EFEMERA = 0

/** O que o Google/Supabase devolve na query string do redirect. */
export interface CallbackResult {
  readonly code?: string
  readonly error?: string
}

/** Página mostrada no navegador ao fim do fluxo — o usuário volta para o app sozinho. */
function paginaDeRetorno(sucesso: boolean): string {
  const titulo = sucesso ? 'Login concluído' : 'Login não concluído'
  const corpo = sucesso
    ? 'Você já pode voltar para o JARVIS OS.'
    : 'Algo deu errado. Volte para o JARVIS OS e tente novamente.'

  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>${titulo}</title></head>
  <body style="font-family: system-ui, sans-serif; display: grid; place-items: center; height: 100vh; margin: 0;">
    <main style="text-align: center;">
      <h1 style="font-size: 1.25rem;">${titulo}</h1>
      <p style="color: #555;">${corpo}</p>
    </main>
  </body>
</html>`
}

export interface LoopbackHandle {
  /** URL que o Supabase deve usar como `redirectTo`. */
  readonly redirectUri: string
  /** Resolve quando o navegador bater de volta; rejeita no timeout ou no cancelamento. */
  readonly resultado: Promise<CallbackResult>
  /** Derruba o servidor. Idempotente — seguro chamar no `finally`. */
  close(): void
}

/**
 * Sobe o servidor e devolve a URI de retorno junto com a promessa do resultado.
 *
 * `timeoutMs` existe para o fluxo não ficar pendurado quando o usuário abandona a aba do
 * navegador: sem ele, a promessa nunca resolveria e o estado `autenticando` travaria a UI.
 */
export function startLoopbackServer(timeoutMs = 5 * 60 * 1000): Promise<LoopbackHandle> {
  return new Promise<LoopbackHandle>((resolveHandle, rejectHandle) => {
    let servidor: Server
    let encerrado = false
    let temporizador: NodeJS.Timeout

    const resultado = new Promise<CallbackResult>((resolve, reject) => {
      servidor = createServer((req, res) => {
        // `req.url` é sempre relativo; a base só existe para o parser aceitar.
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const code = url.searchParams.get('code') ?? undefined
        const error = url.searchParams.get('error') ?? undefined

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(paginaDeRetorno(Boolean(code)))

        resolve({ code, error })
      })

      temporizador = setTimeout(() => {
        reject(new Error('Tempo esgotado aguardando o retorno do login.'))
      }, timeoutMs)

      // Falha de bind (porta ocupada, permissão) precisa rejeitar **os dois**: quem
      // espera o handle e quem espera o resultado. Só o segundo deixaria o `login()`
      // pendurado para sempre no `await startLoopbackServer()`.
      servidor.on('error', (error) => {
        log.auth.error('Falha no servidor de retorno do login', { error })
        rejectHandle(error)
        reject(error)
      })

      // `127.0.0.1` e não `localhost`: evita depender da resolução de nome e impede
      // que a porta atenda em interface externa.
      servidor.listen(PORTA_EFEMERA, '127.0.0.1', () => {
        const address = servidor.address()

        if (typeof address === 'string' || address === null) {
          const erro = new Error('Não foi possível determinar a porta do servidor de retorno.')
          rejectHandle(erro)
          reject(erro)
          return
        }

        const redirectUri = `http://127.0.0.1:${address.port}`
        log.auth.info('Servidor de retorno do login iniciado', { porta: address.port })

        resolveHandle({
          redirectUri,
          resultado,
          close: () => {
            if (encerrado) return
            encerrado = true
            clearTimeout(temporizador)
            servidor.close()
            log.auth.info('Servidor de retorno do login encerrado')
          }
        })
      })
    })

    // Sem isto, um `reject` antes de alguém assinar `resultado` viraria unhandled rejection
    // e derrubaria o processo pelo handler global do `main/index.ts`.
    resultado.catch(() => undefined)
  })
}
