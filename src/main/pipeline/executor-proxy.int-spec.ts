/**
 * O proxy do executor contra um servidor HTTP real (SPEC-Entrega-03, critérios 9 e 11).
 *
 * A prova é por efeito de novo: o servidor sobe de verdade, o cliente fala HTTP de verdade, e o
 * que se mede é **o que o `AiCallService` recebeu** — não o que o proxy diz ter mandado. Um
 * teste que só lesse o retorno passaria com um proxy que perde o `runId` no caminho, que é
 * exatamente o defeito que a M8-F02 descobriu no handler do IPC.
 *
 * As garantias:
 *  - a chamada do container chega ao **ponto único** (critério 11), com `runId`/`tentativa`;
 *  - a conversa multi-turn é achatada preservando os papéis (limite da emenda 6);
 *  - o erro do provider **não** atravessa para o container (caminho clássico de vazar chave);
 *  - o proxy escuta só em loopback, e `noAr()` responde o que o preflight pergunta.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { ExecutorProxy } = await import('./executor-proxy')

const WS: WorkspaceId = 'jarvis'

let proxy: InstanceType<typeof ExecutorProxy>
let recebidos: AiRequest[]
let responder: () => AsyncIterable<AiStreamEvent>

/** A URL real para o teste falar: `host.docker.internal` só resolve dentro do container. */
function urlLocal(): string {
  return proxy.url().replace('host.docker.internal', '127.0.0.1')
}

async function* streamOk(): AsyncIterable<AiStreamEvent> {
  yield { tipo: 'chunk', id: 'c-1', texto: 'olá' }
  yield { tipo: 'fim', id: 'c-1', estado: 'concluido' }
}

beforeEach(async () => {
  recebidos = []
  responder = streamOk

  const ai = {
    call: (pedido: AiRequest): AsyncIterable<AiStreamEvent> => {
      recebidos.push(pedido)
      return responder()
    }
  }

  proxy = new ExecutorProxy({
    ai: ai as never,
    userId: () => 'u-1',
    workspaceId: () => WS,
    rota: () => 'claude-code',
    contexto: () => ({ runId: 'run-7', tentativa: 2 }),
    contextPackId: () => 'pack-9'
  })
  await proxy.iniciar()
})

afterEach(async () => {
  await proxy.parar()
})

describe('ExecutorProxy', () => {
  it('sobe em loopback e responde ao preflight que está no ar', () => {
    expect(proxy.noAr()).toBe(true)
    // O container alcança o host por este nome; 127.0.0.1 lá dentro seria o próprio container.
    expect(proxy.url()).toContain('host.docker.internal')
  })

  /**
   * Critério 11: a chamada do executor chega ao ponto único **atribuída ao run e à tentativa**.
   * Sem isso, o `CostEvent` existiria mas ninguém saberia qual trabalho o gerou.
   */
  it('encaminha a chamada ao AiCallService com runId, tentativa e contextPack', async () => {
    const resposta = await fetch(urlLocal(), {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'construa a fatia' }] })
    })
    await resposta.text()

    expect(recebidos).toHaveLength(1)
    expect(recebidos[0].runId).toBe('run-7')
    expect(recebidos[0].tentativa).toBe(2)
    expect(recebidos[0].contextPackId).toBe('pack-9')
    expect(recebidos[0].provider).toBe('claude-code')
  })

  /**
   * O achatamento é a perda declarada da emenda 6 — mas os **papéis** sobrevivem. Sem eles, dez
   * turnos chegariam como um bloco indistinto, e o modelo não saberia quem disse o quê.
   */
  it('achata a conversa multi-turn preservando quem falou', async () => {
    const resposta = await fetch(urlLocal(), {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'primeiro pedido' },
          { role: 'assistant', content: [{ type: 'text', text: 'primeira resposta' }] },
          { role: 'user', content: 'segundo pedido' }
        ]
      })
    })
    await resposta.text()

    const prompt = recebidos[0].prompt
    expect(prompt).toContain('user: primeiro pedido')
    expect(prompt).toContain('assistant: primeira resposta')
    expect(prompt).toContain('user: segundo pedido')
  })

  it('devolve os chunks do modelo como SSE', async () => {
    const resposta = await fetch(urlLocal(), {
      method: 'POST',
      body: JSON.stringify({ prompt: 'oi' })
    })
    const corpo = await resposta.text()

    expect(corpo).toContain('"type":"chunk"')
    expect(corpo).toContain('olá')
    expect(corpo).toContain('"state":"concluido"')
  })

  /**
   * A mensagem crua do provider nunca atravessa: é o caminho clássico de vazar chave (o corpo
   * de um 401 pode ecoar o header enviado), e o executor não tem o que fazer com ela.
   */
  it('não repassa a mensagem crua de uma exceção ao container', async () => {
    responder = (): AsyncIterable<AiStreamEvent> => {
      throw new Error('401 Unauthorized: x-api-key sk-ant-vazando-aqui')
    }

    const resposta = await fetch(urlLocal(), {
      method: 'POST',
      body: JSON.stringify({ prompt: 'oi' })
    })
    const corpo = await resposta.text()

    expect(corpo).not.toContain('sk-ant-vazando-aqui')
    expect(corpo).not.toContain('x-api-key')
    expect(corpo).toContain('"state":"falhou"')
  })

  it('recusa método que não é POST', async () => {
    const resposta = await fetch(urlLocal(), { method: 'GET' })
    expect(resposta.status).toBe(405)
    expect(recebidos).toHaveLength(0)
  })

  it('recusa corpo sem conteúdo em vez de chamar o modelo com prompt vazio', async () => {
    const resposta = await fetch(urlLocal(), { method: 'POST', body: '{}' })
    expect(resposta.status).toBe(400)
    expect(recebidos).toHaveLength(0)
  })

  it('para de responder depois de parado — o preflight tem de ver isso', async () => {
    await proxy.parar()
    expect(proxy.noAr()).toBe(false)
  })
})
