import { describe, expect, it, vi } from 'vitest'
import type { Sidecar } from './sidecar'
import { criarEngineOpenWakeWord } from './engine-openwakeword'

function criar(resposta: Record<string, unknown> = { ok: true, confianca: 0.8 }) {
  const pedidos: Record<string, unknown>[] = []
  const sidecar = {
    pedir: vi.fn(async (pedido: Record<string, unknown>) => {
      pedidos.push(pedido)
      return pedido.op === 'configurar' ? { ok: true } : resposta
    }),
    encerrar: vi.fn(async () => undefined)
  } as unknown as Sidecar
  const engine = criarEngineOpenWakeWord({
    sidecar,
    configuracao: () => ({
      modelo: 'wake.onnx',
      melspec: 'melspec.onnx',
      embedding: 'embedding.onnx',
      artefatosPresentes: () => true
    })
  })
  return { engine, pedidos, sidecar }
}

describe('adapter do detector local', () => {
  it('envia blocos de 1280 amostras na ordem, sem perder fragmentos', async () => {
    const { engine, pedidos } = criar()
    expect(await engine.alimentar(new Int16Array(1000).fill(1))).toBeNull()
    await engine.alimentar(new Int16Array(280).fill(2))
    const primeira = pedidos.find((pedido) => pedido.op === 'detectar')
    expect((primeira?.amostras as number[]).length).toBe(1_280)
    expect((primeira?.amostras as number[]).at(-1)).toBe(2)
  })

  it('limiar novo vale na análise seguinte e valor inválido não atravessa', async () => {
    const { engine } = criar()
    await engine.alimentar(new Int16Array(1_280))
    engine.definirLimiar(0.9)
    expect(await engine.alimentar(new Int16Array(1_280))).toBeNull()
    engine.definirLimiar(Infinity)
    expect(engine.obterLimiar()).toBe(0.5)
  })

  it('falha explicitamente quando o sidecar devolve confiança inválida', async () => {
    const { engine } = criar({ ok: true, confianca: NaN })
    await expect(engine.alimentar(new Int16Array(1_280))).rejects.toThrow(/confiança inválida/)
  })

  it('limpa áudio e configuração ao encerrar', async () => {
    const { engine, pedidos } = criar()
    await engine.alimentar(new Int16Array(1_280))
    await engine.encerrar()
    expect(await engine.alimentar(new Int16Array(1_000))).toBeNull()
    expect(pedidos.filter((pedido) => pedido.op === 'configurar')).toHaveLength(1)
  })
})
