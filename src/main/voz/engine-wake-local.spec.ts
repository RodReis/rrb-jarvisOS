import { describe, expect, it, vi } from 'vitest'
import type { Sidecar } from './sidecar'
import { criarEngineWakeLocal } from './engine-wake-local'

function criar(resposta: Record<string, unknown> = { ok: true, confianca: 0.8 }) {
  const pedidos: Record<string, unknown>[] = []
  const sidecar = {
    pedir: vi.fn(async (pedido: Record<string, unknown>) => {
      pedidos.push(pedido)
      return pedido.op === 'configurar' ? { ok: true } : resposta
    }),
    encerrar: vi.fn(async () => undefined)
  } as unknown as Sidecar
  const engine = criarEngineWakeLocal({
    sidecar,
    configuracao: () => ({ modelo: 'wake.onnx', artefatosPresentes: () => true })
  })
  return { engine, pedidos, sidecar }
}

describe('adaptador do detector local', () => {
  it('analisa janela de dois segundos a cada 250 ms, preservando a ordem', async () => {
    const { engine, pedidos } = criar({ ok: true, confianca: 0.02 })
    expect(await engine.alimentar(new Int16Array(31_000).fill(1))).toBeNull()
    await engine.alimentar(new Int16Array(1_000).fill(2))
    const primeira = pedidos.find((pedido) => pedido.op === 'detectar')
    expect((primeira?.amostras as number[]).length).toBe(32_000)
    expect((primeira?.amostras as number[]).at(-1)).toBe(2)
    await engine.alimentar(new Int16Array(4_000).fill(3))
    expect(pedidos.filter((pedido) => pedido.op === 'detectar')).toHaveLength(2)
  })

  it('limiar novo vale na análise seguinte e valor inválido não atravessa', async () => {
    const { engine } = criar()
    await engine.alimentar(new Int16Array(32_000))
    engine.definirLimiar(0.9)
    expect(await engine.alimentar(new Int16Array(4_000))).toBeNull()
    engine.definirLimiar(Infinity)
    expect(engine.obterLimiar()).toBe(0.95)
  })

  it('falha explicitamente quando o sidecar devolve confiança inválida', async () => {
    const { engine } = criar({ ok: true, confianca: NaN })
    await expect(engine.alimentar(new Int16Array(32_000))).rejects.toThrow(/confiança inválida/)
  })

  it('limpa áudio e configuração ao encerrar', async () => {
    const { engine, pedidos } = criar()
    await engine.alimentar(new Int16Array(32_000))
    await engine.encerrar()
    expect(await engine.alimentar(new Int16Array(1_000))).toBeNull()
    expect(pedidos.filter((pedido) => pedido.op === 'configurar')).toHaveLength(1)
  })
})
