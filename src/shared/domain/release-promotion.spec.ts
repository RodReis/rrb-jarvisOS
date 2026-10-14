import { describe, expect, it } from 'vitest'
import type { GateResult } from './release'
import {
  ESTABILIZACAO_PADRAO,
  GATES_OBRIGATORIOS,
  ambienteAprovadoTecnicamente,
  avaliarEstabilizacao,
  validarJanelaDeEstabilizacao,
  type EstadoDeEstabilizacao
} from './release-promotion'

function gate(
  environment: 'staging' | 'production',
  nome: string,
  result: GateResult['result'],
  createdAt: string
): GateResult {
  return {
    id: `${environment}-${nome}-${createdAt}`,
    userId: 'u',
    workspaceId: 'jarvis',
    projectId: 'p',
    releaseId: 'r',
    environment,
    gate: nome,
    result,
    reason: result === 'passed' ? null : 'motivo',
    createdAt
  }
}

const todosPassados = (environment: 'staging' | 'production'): GateResult[] =>
  GATES_OBRIGATORIOS[environment].map((nome, i) =>
    gate(environment, nome, 'passed', `2026-10-14T10:00:0${i}.000Z`)
  )

describe('ambienteAprovadoTecnicamente', () => {
  it('aprova Staging só com todos os gates obrigatórios passados', () => {
    expect(ambienteAprovadoTecnicamente('staging', todosPassados('staging'))).toBe(true)
  })

  it('um gate ausente reprova o ambiente', () => {
    const gates = todosPassados('staging').filter((g) => g.gate !== 'smoke')
    expect(ambienteAprovadoTecnicamente('staging', gates)).toBe(false)
  })

  it('gate bloqueado ou desconhecido não aprova', () => {
    for (const result of ['blocked', 'unknown'] as const) {
      const gates = [
        ...todosPassados('staging'),
        gate('staging', 'smoke', result, '2026-10-14T11:00:00.000Z')
      ]
      expect(ambienteAprovadoTecnicamente('staging', gates)).toBe(false)
    }
  })

  it('vale o resultado mais recente de cada gate: reparo depois de bloqueio aprova', () => {
    const gates = [
      gate('staging', 'smoke', 'blocked', '2026-10-14T09:00:00.000Z'),
      ...todosPassados('staging')
    ]
    expect(ambienteAprovadoTecnicamente('staging', gates)).toBe(true)
  })

  it('gates de outro ambiente não contam: Staging aprovado não aprova Produção', () => {
    expect(ambienteAprovadoTecnicamente('production', todosPassados('staging'))).toBe(false)
  })

  it('Produção exige backup confirmado; Staging não tem o gate', () => {
    expect(GATES_OBRIGATORIOS.production).toContain('backup')
    expect(GATES_OBRIGATORIOS.staging).not.toContain('backup')
    const semBackup = todosPassados('production').filter((g) => g.gate !== 'backup')
    expect(ambienteAprovadoTecnicamente('production', semBackup)).toBe(false)
  })
})

describe('validarJanelaDeEstabilizacao', () => {
  it('o padrão é cinco minutos, health a cada trinta segundos e um reinício', () => {
    expect(ESTABILIZACAO_PADRAO).toEqual({ windowMs: 300_000, intervalMs: 30_000, maxRestarts: 1 })
  })

  it.each([
    { windowMs: 0, intervalMs: 30_000, maxRestarts: 1 },
    { windowMs: 300_000, intervalMs: 0, maxRestarts: 1 },
    { windowMs: 10_000, intervalMs: 30_000, maxRestarts: 1 },
    { windowMs: 300_000, intervalMs: 30_000, maxRestarts: -1 },
    { windowMs: 300_000.5, intervalMs: 30_000, maxRestarts: 1 }
  ])('recusa configuração inválida %j', (config) => {
    expect(() => validarJanelaDeEstabilizacao(config)).toThrow(TypeError)
  })
})

describe('avaliarEstabilizacao', () => {
  const config = ESTABILIZACAO_PADRAO
  const inicio: EstadoDeEstabilizacao = { startedAtMs: 0, restarts: 0 }

  it('saudável antes de fechar a janela continua observando', () => {
    expect(avaliarEstabilizacao(config, inicio, 150_000, true)).toEqual({
      decision: 'continue',
      state: inicio
    })
  })

  it('cinco minutos saudáveis estabilizam', () => {
    expect(avaliarEstabilizacao(config, inicio, 300_000, true).decision).toBe('stable')
  })

  it('uma falha isolada reinicia a contagem a partir do instante da falha', () => {
    const r = avaliarEstabilizacao(config, inicio, 120_000, false)
    expect(r).toEqual({ decision: 'restart', state: { startedAtMs: 120_000, restarts: 1 } })
  })

  it('depois do reinício, os cinco minutos contam da falha, não do início', () => {
    const reiniciado: EstadoDeEstabilizacao = { startedAtMs: 120_000, restarts: 1 }
    expect(avaliarEstabilizacao(config, reiniciado, 300_000, true).decision).toBe('continue')
    expect(avaliarEstabilizacao(config, reiniciado, 420_000, true).decision).toBe('stable')
  })

  it('a segunda falha compensa', () => {
    const reiniciado: EstadoDeEstabilizacao = { startedAtMs: 120_000, restarts: 1 }
    expect(avaliarEstabilizacao(config, reiniciado, 150_000, false).decision).toBe('compensate')
  })

  it('sem reinício permitido, a primeira falha já compensa', () => {
    const r = avaliarEstabilizacao({ ...config, maxRestarts: 0 }, inicio, 30_000, false)
    expect(r.decision).toBe('compensate')
  })

  it('não muta o estado recebido', () => {
    const entrada = Object.freeze({ startedAtMs: 0, restarts: 0 })
    expect(() => avaliarEstabilizacao(config, entrada, 30_000, false)).not.toThrow()
  })
})
