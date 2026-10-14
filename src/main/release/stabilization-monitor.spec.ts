import { describe, expect, it } from 'vitest'
import { ESTABILIZACAO_PADRAO } from '@shared/domain/release-promotion'
import { FakeClock } from './promotion-test-doubles'
import { StabilizationMonitor } from './stabilization-monitor'

const MIN = 60_000

function montar(
  saude: boolean[],
  opcoes: { smoke?: () => Promise<boolean>; maxRestarts?: number } = {}
) {
  const clock = new FakeClock()
  const inicio = clock.nowMs()
  const fila = [...saude]
  const observacoes: { t: number; saudavel: boolean }[] = []
  const reinicios: number[] = []
  let renovacoes = 0
  const monitor = new StabilizationMonitor({
    config: { ...ESTABILIZACAO_PADRAO, maxRestarts: opcoes.maxRestarts ?? 1 },
    health: async () => {
      const saudavel = fila.length ? fila.shift()! : true
      observacoes.push({ t: clock.nowMs() - inicio, saudavel })
      return saudavel
    },
    smoke: opcoes.smoke ?? (async () => true),
    renew: () => {
      renovacoes += 1
    },
    nowMs: clock.nowMs,
    sleep: clock.sleep,
    onRestart: (n) => reinicios.push(n)
  })
  return { monitor, clock, inicio, observacoes, reinicios, renovacoes: () => renovacoes }
}

describe('StabilizationMonitor', () => {
  it('cinco minutos saudáveis estabilizam, com health a cada trinta segundos', async () => {
    const { monitor, observacoes, clock, inicio } = montar([])
    expect(await monitor.run()).toEqual({ state: 'stable', restarts: 0 })
    expect(clock.nowMs() - inicio).toBe(5 * MIN)
    expect(observacoes.map((o) => o.t)).toEqual(Array.from({ length: 11 }, (_, i) => i * 30_000))
  })

  it('renova a posse a cada observação: uma janela longa não perde o lease', async () => {
    const { monitor, renovacoes } = montar([])
    await monitor.run()
    expect(renovacoes()).toBe(11)
  })

  it('uma falha isolada reinicia a contagem a partir da falha', async () => {
    // 4 saudáveis (t=0..90s), falha em t=120s, depois tudo saudável.
    const { monitor, clock, inicio, reinicios } = montar([true, true, true, true, false])
    expect(await monitor.run()).toEqual({ state: 'stable', restarts: 1 })
    expect(reinicios).toEqual([1])
    // A janela de 5 min recomeça em t=120s, então fecha em t=420s.
    expect(clock.nowMs() - inicio).toBe(7 * MIN)
  })

  it('a segunda falha compensa', async () => {
    const { monitor } = montar([true, false, true, false])
    expect(await monitor.run()).toEqual({ state: 'compensate', restarts: 1 })
  })

  it('sem reinício permitido, a primeira falha compensa', async () => {
    const { monitor } = montar([true, false], { maxRestarts: 0 })
    expect(await monitor.run()).toEqual({ state: 'compensate', restarts: 0 })
  })

  it('health que lança erro conta como falha, não derruba o monitor', async () => {
    const clock = new FakeClock()
    let chamadas = 0
    const monitor = new StabilizationMonitor({
      config: { ...ESTABILIZACAO_PADRAO, maxRestarts: 0 },
      health: async () => {
        chamadas += 1
        throw new Error('provedor fora do ar')
      },
      smoke: async () => true,
      renew: () => undefined,
      nowMs: clock.nowMs,
      sleep: clock.sleep
    })
    expect(await monitor.run()).toEqual({ state: 'compensate', restarts: 0 })
    expect(chamadas).toBe(1)
  })

  it('o smoke essencial roda ao fechar a janela, não a cada observação', async () => {
    let smokes = 0
    const { monitor } = montar([], {
      smoke: async () => {
        smokes += 1
        return true
      }
    })
    await monitor.run()
    expect(smokes).toBe(1)
  })

  it('smoke que falha ao fechar a janela segue a mesma regra de falha: reinicia e depois compensa', async () => {
    let smokes = 0
    const { monitor, reinicios } = montar([], {
      smoke: async () => {
        smokes += 1
        return false
      }
    })
    expect(await monitor.run()).toEqual({ state: 'compensate', restarts: 1 })
    expect(reinicios).toEqual([1])
    expect(smokes).toBe(2)
  })

  it('posse perdida durante a janela interrompe sem compensar nem estabilizar', async () => {
    const clock = new FakeClock()
    const monitor = new StabilizationMonitor({
      config: ESTABILIZACAO_PADRAO,
      health: async () => true,
      smoke: async () => true,
      renew: () => {
        throw new Error('lease perdido')
      },
      nowMs: clock.nowMs,
      sleep: clock.sleep
    })
    await expect(monitor.run()).rejects.toThrow('lease perdido')
  })
})
