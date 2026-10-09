import { describe, expect, it } from 'vitest'
import { chaveIdempotenciaRelease, transicionarRelease, validarFingerprintPayload } from './release'

describe('domínio de release (SPEC-Release-01)', () => {
  it('aceita a progressão e congela o SHA ao entrar em Staging', () => {
    expect(transicionarRelease('queued', 'preparing', null, '2026-10-09T12:00:00.000Z')).toEqual({
      ok: true,
      status: 'preparing',
      stageStartedAt: null
    })
    expect(transicionarRelease('preparing', 'staging', null, '2026-10-09T12:00:00.000Z')).toEqual({
      ok: true,
      status: 'staging',
      stageStartedAt: '2026-10-09T12:00:00.000Z'
    })
    expect(
      transicionarRelease('staging', 'superseded', '2026-10-09T12:00:00.000Z', 'later')
    ).toEqual({
      ok: false,
      reason: 'staging-freezes-candidate'
    })
  })

  it('recusa transição fora da máquina de estados', () => {
    expect(transicionarRelease('queued', 'completed', null, 'now')).toEqual({
      ok: false,
      reason: 'invalid-transition'
    })
  })

  it('mantém failed e degraded como estados terminais', () => {
    expect(transicionarRelease('failed', 'preparing', null, 'now')).toMatchObject({ ok: false })
    expect(transicionarRelease('degraded', 'failed', null, 'now')).toMatchObject({ ok: false })
  })

  it('deriva chave idempotente de projeto, ambiente, release e passo', () => {
    expect(chaveIdempotenciaRelease('p1', 'staging', 'r1', 'build')).toBe('p1:staging:r1:build')
    expect(chaveIdempotenciaRelease('p1', 'production', 'r1', 'build')).not.toBe(
      chaveIdempotenciaRelease('p1', 'staging', 'r1', 'build')
    )
  })

  it('aceita apenas fingerprint SHA-256 no contrato de execução', () => {
    expect(validarFingerprintPayload('a'.repeat(64))).toBe(true)
    expect(validarFingerprintPayload('provider-secret-value')).toBe(false)
  })
})
