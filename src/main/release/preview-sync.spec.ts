import { describe, expect, it } from 'vitest'
import type { PreviewOutcome } from './preview-coordinator'
import { UsoInvalido } from './preview-cli-args'
import { convergirPreview, type PullRequestObservado } from './preview-sync'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const aberto = (headSha = A, deFork = false): PullRequestObservado => ({
  aberto: true,
  headSha,
  deFork
})
const fechado = (headSha = A): PullRequestObservado => ({ aberto: false, headSha, deFork: false })

const resultado = (state: PreviewOutcome['state']): PreviewOutcome => ({
  state,
  repeated: false,
  run: null,
  pending: [],
  reason: null,
  publication: 'published'
})

/** O PR "evolui" a cada observação, na ordem dada; a última se repete. */
function cenario(observacoes: PullRequestObservado[], respostas: PreviewOutcome['state'][] = []) {
  const aplicados: PullRequestObservado[] = []
  let o = 0
  let r = 0
  return {
    aplicados,
    deps: {
      observar: async () => observacoes[Math.min(o++, observacoes.length - 1)]!,
      aplicar: async (obs: PullRequestObservado) => {
        aplicados.push(obs)
        return resultado(respostas[Math.min(r++, respostas.length - 1)] ?? 'ready')
      }
    }
  }
}

describe('convergirPreview', () => {
  it('PR estável: aplica uma vez', async () => {
    const { deps, aplicados } = cenario([aberto()])
    expect((await convergirPreview(deps, 'sync', null)).state).toBe('ready')
    expect(aplicados).toHaveLength(1)
  })

  it('PR fechado durante o provisionamento: o dono reobserva e destrói (close não se perde)', async () => {
    const { deps, aplicados } = cenario([aberto(), fechado()], ['ready', 'removed'])
    const r = await convergirPreview(deps, 'sync', null)
    expect(aplicados.map((o) => o.aberto)).toEqual([true, false])
    expect(r.state).toBe('removed')
  })

  it('commit novo durante o provisionamento: aplica de novo com o head novo', async () => {
    const { deps, aplicados } = cenario([aberto(A), aberto(B)])
    await convergirPreview(deps, 'sync', null)
    expect(aplicados.map((o) => o.headSha)).toEqual([A, B])
  })

  it('busy encerra sem reaplicar: quem segura a posse é que reobserva', async () => {
    const { deps, aplicados } = cenario([aberto(), fechado()], ['busy'])
    expect((await convergirPreview(deps, 'sync', null)).state).toBe('busy')
    expect(aplicados).toHaveLength(1)
  })

  it('para depois do máximo de rodadas se o PR não para de mudar', async () => {
    const { deps, aplicados } = cenario([aberto(A), aberto(B), aberto(A), aberto(B), aberto(A)])
    await convergirPreview({ ...deps, maximoDeRodadas: 3 }, 'sync', null)
    expect(aplicados).toHaveLength(3)
  })

  describe('eventos explícitos obsoletos', () => {
    it('open com SHA que já não é o head é recusado', async () => {
      const { deps, aplicados } = cenario([aberto(B)])
      await expect(convergirPreview(deps, 'open', A)).rejects.toThrow(UsoInvalido)
      expect(aplicados).toHaveLength(0)
    })

    it('open depois do PR fechado é recusado (não ressuscita)', async () => {
      const { deps, aplicados } = cenario([fechado()])
      await expect(convergirPreview(deps, 'open', A)).rejects.toThrow(/obsoleto/)
      expect(aplicados).toHaveLength(0)
    })

    it('close com o PR ainda aberto é recusado', async () => {
      const { deps } = cenario([aberto()])
      await expect(convergirPreview(deps, 'close', A)).rejects.toThrow(/continua aberto/)
    })

    it('open com o head atual (abreviado) é aceito', async () => {
      const { deps, aplicados } = cenario([aberto(A)])
      await convergirPreview(deps, 'open', A.slice(0, 12))
      expect(aplicados).toHaveLength(1)
    })
  })

  it('PR de fork aberto não recebe Preview', async () => {
    const { deps, aplicados } = cenario([aberto(A, true)])
    await expect(convergirPreview(deps, 'sync', null)).rejects.toThrow(/fork/)
    expect(aplicados).toHaveLength(0)
  })

  it('PR de fork fechado ainda pode ser limpo', async () => {
    const { deps, aplicados } = cenario([{ aberto: false, headSha: A, deFork: true }])
    await convergirPreview(deps, 'sync', null)
    expect(aplicados).toHaveLength(1)
  })
})
