import { describe, expect, it } from 'vitest'
import { codigoDeSaida } from './release-promote-saida'

const base = { releaseId: 'r', status: 'completed' as const }

describe('codigoDeSaida: 0 conclui, 3 falha ou exige o operador, 5 aguarda', () => {
  it.each([
    [{ evento: 'merge', resultado: { ...base, state: 'completed', reason: null } }, 0],
    [{ evento: 'merge', resultado: { ...base, state: 'waiting', reason: 'lane-busy' } }, 5],
    [{ evento: 'merge', resultado: { ...base, state: 'blocked', reason: 'project-paused' } }, 3],
    [{ evento: 'resume', resultado: { ...base, state: 'degraded', reason: null } }, 3],
    [{ evento: 'cancel', resultado: { ...base, state: 'cancelled', reason: null } }, 0],
    [{ evento: 'cancel', resultado: { ...base, state: 'requested', reason: 'lease-busy' } }, 5],
    [{ evento: 'cancel', resultado: { ...base, state: 'blocked', reason: 'x' } }, 3],
    [{ evento: 'cancel', resultado: { ...base, state: 'degraded', reason: null } }, 3],
    [
      { evento: 'cancel', resultado: { ...base, state: 'rejected', reason: 'already-terminal' } },
      3
    ],
    [{ evento: 'rollback', resultado: { state: 'rolled-back', reason: null } }, 0],
    [{ evento: 'rollback', resultado: { state: 'waiting', reason: 'lane-busy' } }, 5],
    [{ evento: 'rollback', resultado: { state: 'failed', reason: 'rollback-not-verified' } }, 3],
    [{ evento: 'rollback', resultado: { state: 'rejected', reason: 'target-not-found' } }, 3],
    [{ evento: 'recover', resultado: { state: 'resumed', reason: null } }, 0],
    [{ evento: 'recover', resultado: { state: 'none', reason: null } }, 0],
    [{ evento: 'recover', resultado: { state: 'waiting', reason: 'lane-busy' } }, 5],
    [{ evento: 'recover', resultado: { state: 'paused', reason: 'recovery-not-verified' } }, 3],
    [{ evento: 'publish', resultado: { state: 'published', tag: 't', manifestSha256: 'h' } }, 0],
    [{ evento: 'publish', resultado: { state: 'pending', tag: 't', reason: 'github-timeout' } }, 5],
    [{ evento: 'publish', resultado: { state: 'failed', tag: 't', reason: 'tag-conflict' } }, 3],
    [{ evento: 'publish', resultado: { state: 'rejected', reason: 'release-not-stable' } }, 3],
    [{ evento: 'verify', resultado: { ok: true, problems: [] } }, 0],
    [{ evento: 'verify', resultado: { ok: false, problems: ['tag-missing'] } }, 3]
  ] as const)('%j → %i', (desfecho, codigo) => {
    expect(codigoDeSaida(desfecho as never)).toBe(codigo)
  })
})
