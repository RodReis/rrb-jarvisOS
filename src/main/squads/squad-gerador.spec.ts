import { describe, expect, it } from 'vitest'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import type { PedidoAoGerador } from './squad-planejador'
import { GeradorViaPontoUnico, MAX_TOKENS_DO_PLANO } from './squad-gerador'
import type { ChamadorDeIa } from './squad-gerador'

const CTX = { userId: 'u1', workspace: 'jarvis' as const }
const VINCULOS = { contextPackId: 'pack-1', runId: 'run-1' }
const PEDIDO: PedidoAoGerador = {
  system: 'sistema',
  prompt: 'pedido',
  jsonSchema: '{"type":"object"}',
  tentativa: 2
}

/** Um ponto único falso que responde pelo roteiro e guarda o pedido que recebeu. */
function chamador(eventos: readonly AiStreamEvent[] | (() => never)): ChamadorDeIa & {
  pedidos: AiRequest[]
} {
  const pedidos: AiRequest[] = []
  return {
    pedidos,
    call: (request) => {
      pedidos.push(request)
      if (typeof eventos === 'function') eventos()
      return (async function* () {
        for (const e of eventos as readonly AiStreamEvent[]) yield e
      })()
    }
  }
}

const chunk = (texto: string): AiStreamEvent => ({ tipo: 'chunk', id: 'c', texto })
const fim = (estado: 'concluido' | 'falhou', erro?: string): AiStreamEvent => ({
  tipo: 'fim',
  id: 'c',
  estado,
  ...(erro === undefined ? {} : { erro })
})

const LOCAL = { provider: 'ollama', modelo: 'qwen3:8b' } as const
const FASE = { provider: 'claude-code', modelo: 'claude-fable-5-1' } as const

describe('gerador local pelo ponto único', () => {
  it('pede ao Ollama a janela e o formato, com o run, a tentativa e o ContextPack', async () => {
    const ia = chamador([chunk('{"tarefas":'), chunk('[]}'), fim('concluido')])
    const g = new GeradorViaPontoUnico('local', LOCAL, ia, CTX, VINCULOS)

    const r = await g.propor({ ...PEDIDO, numCtx: 8192 })

    expect(r).toEqual({ ok: true, texto: '{"tarefas":[]}' })
    expect(ia.pedidos[0]).toMatchObject({
      provider: 'ollama',
      model: 'qwen3:8b',
      system: 'sistema',
      prompt: 'pedido',
      contextPackId: 'pack-1',
      runId: 'run-1',
      tentativa: 2,
      maxTokens: MAX_TOKENS_DO_PLANO,
      opcoesLocais: { numCtx: 8192, formato: '{"type":"object"}' }
    })
  })

  it('qualquer falha do local é indisponibilidade — a fase assume, com o motivo', async () => {
    const g = new GeradorViaPontoUnico(
      'local',
      LOCAL,
      chamador([fim('falhou', 'Não foi possível falar com o Ollama.')]),
      CTX,
      VINCULOS
    )
    expect(await g.propor({ ...PEDIDO, numCtx: 8192 })).toEqual({
      ok: false,
      motivo: 'INDISPONIVEL',
      detalhe: 'Não foi possível falar com o Ollama.'
    })
  })

  it('o local sem num_ctx no pedido é erro de montagem, não chamada sem janela', async () => {
    const ia = chamador([chunk('{}'), fim('concluido')])
    const g = new GeradorViaPontoUnico('local', LOCAL, ia, CTX, VINCULOS)
    const r = await g.propor(PEDIDO)
    expect(r.ok).toBe(false)
    expect(ia.pedidos).toHaveLength(0)
  })
})

describe('gerador da fase pelo ponto único', () => {
  it('manda o esquema ao CLI, sem opções locais, pelo provider da fase', async () => {
    const ia = chamador([chunk('{}'), fim('concluido')])
    const g = new GeradorViaPontoUnico('fase', FASE, ia, CTX, VINCULOS)

    expect(await g.propor(PEDIDO)).toEqual({ ok: true, texto: '{}' })
    expect(ia.pedidos[0]).toMatchObject({
      provider: 'claude-code',
      model: 'claude-fable-5-1',
      jsonSchema: '{"type":"object"}'
    })
    expect(ia.pedidos[0]).not.toHaveProperty('opcoesLocais')
  })

  it('falha da fase é falha, não indisponibilidade', async () => {
    const g = new GeradorViaPontoUnico(
      'fase',
      FASE,
      chamador([fim('falhou', 'sessão expirada')]),
      CTX,
      VINCULOS
    )
    expect(await g.propor(PEDIDO)).toEqual({
      ok: false,
      motivo: 'FALHOU',
      detalhe: 'sessão expirada'
    })
  })
})

describe('o que nunca acontece', () => {
  it('nunca lança: exceção do ponto único vira resposta', async () => {
    const quebra = chamador(() => {
      throw new Error('boom')
    })
    for (const origem of ['local', 'fase'] as const) {
      const g = new GeradorViaPontoUnico(
        origem,
        origem === 'local' ? LOCAL : FASE,
        quebra,
        CTX,
        VINCULOS
      )
      const r = await g.propor({ ...PEDIDO, numCtx: 8192 })
      expect(r.ok).toBe(false)
    }
  })

  it('stream que termina sem `fim` não é sucesso', async () => {
    const g = new GeradorViaPontoUnico('fase', FASE, chamador([chunk('{}')]), CTX, VINCULOS)
    expect((await g.propor(PEDIDO)).ok).toBe(false)
  })

  it('resposta vazia não é plano', async () => {
    const g = new GeradorViaPontoUnico('fase', FASE, chamador([fim('concluido')]), CTX, VINCULOS)
    expect((await g.propor(PEDIDO)).ok).toBe(false)
  })

  it('o detalhe do erro não carrega o que o ponto único não deixa passar', async () => {
    const g = new GeradorViaPontoUnico('fase', FASE, chamador([fim('falhou')]), CTX, VINCULOS)
    const r = await g.propor(PEDIDO)
    expect(r.ok === false && r.detalhe.length).toBeGreaterThan(0)
  })
})
