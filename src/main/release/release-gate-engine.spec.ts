import { describe, expect, it } from 'vitest'
import type { GateResult } from '@shared/domain/release'
import { GATES_OBRIGATORIOS } from '@shared/domain/release-promotion'
import { ReleaseGateEngine, type GateStore } from './release-gate-engine'

const SCOPE = { userId: 'u', workspaceId: 'jarvis', projectId: 'p' } as const

class MemoriaDeGates implements GateStore {
  readonly gravados: GateResult[] = []
  recordGate(
    input: {
      releaseId: string
      environment: 'staging' | 'production'
      gate: string
      result: GateResult['result']
      reasonCode: string | null
    } & typeof SCOPE,
    now: string
  ): void {
    this.gravados.push({
      id: String(this.gravados.length),
      ...SCOPE,
      releaseId: input.releaseId,
      environment: input.environment,
      gate: input.gate,
      result: input.result,
      reason: input.reasonCode,
      createdAt: now
    })
  }
  gates(_scope: typeof SCOPE, releaseId: string): readonly GateResult[] {
    return this.gravados.filter((g) => g.releaseId === releaseId)
  }
}

function motor() {
  const store = new MemoriaDeGates()
  let tick = 0
  const engine = new ReleaseGateEngine(
    store,
    () => `2026-10-14T10:00:${String(tick++).padStart(2, '0')}.000Z`
  )
  return { store, engine }
}

describe('ReleaseGateEngine', () => {
  it('registra o resultado do gate com o código de motivo', () => {
    const { engine, store } = motor()
    engine.record(SCOPE, 'r1', 'staging', {
      gate: 'smoke',
      result: 'blocked',
      reason: 'smoke-failed'
    })
    expect(store.gravados).toEqual([
      expect.objectContaining({ gate: 'smoke', result: 'blocked', reason: 'smoke-failed' })
    ])
  })

  it('aprova o ambiente só quando todos os gates obrigatórios passaram', () => {
    const { engine } = motor()
    for (const gate of GATES_OBRIGATORIOS.staging.slice(0, -1))
      engine.record(SCOPE, 'r1', 'staging', { gate, result: 'passed' })
    expect(engine.approved(SCOPE, 'r1', 'staging')).toBe(false)
    engine.record(SCOPE, 'r1', 'staging', { gate: 'e2e_essential', result: 'passed' })
    expect(engine.approved(SCOPE, 'r1', 'staging')).toBe(true)
  })

  it('Staging aprovado não aprova Produção', () => {
    const { engine } = motor()
    for (const gate of GATES_OBRIGATORIOS.staging)
      engine.record(SCOPE, 'r1', 'staging', { gate, result: 'passed' })
    expect(engine.approved(SCOPE, 'r1', 'production')).toBe(false)
  })

  it('devolve o primeiro gate que impede a aprovação, com o motivo', () => {
    const { engine } = motor()
    engine.record(SCOPE, 'r1', 'staging', { gate: 'configuration', result: 'passed' })
    engine.record(SCOPE, 'r1', 'staging', {
      gate: 'migration',
      result: 'blocked',
      reason: 'migration-failed'
    })
    expect(engine.firstBlocker(SCOPE, 'r1', 'staging')).toEqual({
      gate: 'migration',
      reason: 'migration-failed'
    })
  })

  it('reparo posterior ao bloqueio libera o gate', () => {
    const { engine } = motor()
    engine.record(SCOPE, 'r1', 'staging', {
      gate: 'smoke',
      result: 'blocked',
      reason: 'smoke-failed'
    })
    engine.record(SCOPE, 'r1', 'staging', { gate: 'smoke', result: 'passed' })
    expect(engine.firstBlocker(SCOPE, 'r1', 'staging')?.gate).not.toBe('smoke')
  })

  it('só olha gates da release pedida', () => {
    const { engine } = motor()
    for (const gate of GATES_OBRIGATORIOS.staging)
      engine.record(SCOPE, 'outra', 'staging', { gate, result: 'passed' })
    expect(engine.approved(SCOPE, 'r1', 'staging')).toBe(false)
  })
})
