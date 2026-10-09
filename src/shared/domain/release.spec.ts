import { describe, expect, it } from 'vitest'
import { chaveIdempotenciaRelease, transicionarRelease, validarPayloadSemSegredos } from './release'

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

  it('deriva chave idempotente de projeto, ambiente, release e passo', () => {
    expect(chaveIdempotenciaRelease('p1', 'staging', 'r1', 'build')).toBe('p1:staging:r1:build')
    expect(chaveIdempotenciaRelease('p1', 'production', 'r1', 'build')).not.toBe(
      chaveIdempotenciaRelease('p1', 'staging', 'r1', 'build')
    )
  })

  it('rejeita nomes de campo de segredo recursivamente', () => {
    expect(validarPayloadSemSegredos({ digest: 'sha256:a' })).toBe(true)
    expect(validarPayloadSemSegredos({ options: [{ apiKey: 'do-not-persist' }] })).toBe(false)
  })
})
