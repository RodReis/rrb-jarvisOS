import { afterEach, describe, expect, it } from 'vitest'
import {
  SCOPE,
  SHA_A,
  SHA_B,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'

/**
 * A promoção publica a identidade da release ao estabilizar (SPEC-Release-05, critérios 7 e 8):
 * o serviço só aciona o publicador depois de `completed`, e a falha do GitHub não muda o desfecho.
 */

let h: Harness

afterEach(() => h.fechar())

const INCLUSAO = { pullRequest: 432, specId: 'spec-release-05', sliceId: 'slice-9', issue: 154 }

describe('identidade ao estabilizar', () => {
  it('Produção estabilizada gera manifesto, tag no commit certo e GitHub Release', async () => {
    h = montarHarness()
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)

    expect(r.state).toBe('completed')
    const manifesto = h.recovery.manifest(SCOPE, r.releaseId)!
    expect(h.git.tags.get(manifesto.tag)).toMatchObject({
      commitSha: SHA_A,
      notes: manifesto.changelog
    })
    expect(await h.publisher.verify(SCOPE, r.releaseId)).toEqual({ ok: true, problems: [] })
  })

  it('a tag só é criada depois de completed: nenhuma chamada ao GitHub durante a estabilização', async () => {
    let chamadasNaJanela = -1
    h = montarHarness({
      sleep: async (ms) => {
        if (chamadasNaJanela < 0) chamadasNaJanela = h.git.calls.length
        await h.clock.sleep(ms)
      }
    })
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r.state).toBe('completed')
    expect(chamadasNaJanela).toBe(0)
    expect(h.git.calls.length).toBeGreaterThan(0)
  })

  it('release que falha em Staging não deixa nada no GitHub nem pendência de publicação', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('staging')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)

    expect(r.state).toBe('failed')
    expect(h.git.calls).toEqual([])
    expect(h.recovery.manifest(SCOPE, r.releaseId)).toBeNull()
    expect(h.recovery.pendingPublications(SCOPE)).toEqual([])
  })

  it('estabilização reprovada em Produção também não gera identidade', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r.state).toBe('failed')
    expect(h.git.tags.size).toBe(0)
  })
})

describe('GitHub com falha não muda o desfecho técnico (regra 8)', () => {
  it('a release conclui, a pendência fica registrada e a retomada publica', async () => {
    h = montarHarness()
    h.git.failOn('publish', 'timeout', 1)
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)

    expect(r.state).toBe('completed')
    expect(h.recovery.pendingPublications(SCOPE).map((p) => p.releaseId)).toEqual([r.releaseId])

    await h.service.resume(SCOPE, projeto())
    expect(h.recovery.pendingPublications(SCOPE)).toEqual([])
    expect(h.git.tags.size).toBe(1)
  })

  it('erro inesperado do publicador não derruba a promoção nem perde a pendência', async () => {
    h = montarHarness()
    const original = h.publisher.publish.bind(h.publisher)
    let primeira = true
    h.publisher.publish = async (...args) => {
      if (primeira) {
        primeira = false
        throw new Error('bug no publicador')
      }
      return original(...args)
    }
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)

    expect(r.state).toBe('completed')
    expect(h.recovery.publication(SCOPE, r.releaseId, 'github-release')).toMatchObject({
      state: 'pending'
    })
    await h.service.resume(SCOPE, projeto())
    expect(h.recovery.publication(SCOPE, r.releaseId, 'github-release')).toMatchObject({
      state: 'published'
    })
  })

  it('a segunda release não espera a publicação da primeira', async () => {
    h = montarHarness()
    h.git.failOn('publish', 'timeout', 1)
    const a = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    const b = await h.service.handleMerge(SCOPE, SHA_B, projeto(), { pullRequest: 433 })
    expect([a.state, b.state]).toEqual(['completed', 'completed'])
  })
})

describe('retomada do que ficou pendente', () => {
  it('correção pendente da V2 também é reaberta pela retomada', async () => {
    h = montarHarness()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('production')
    h.v2.falha = new Error('V2 indisponível')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(h.recovery.correction(SCOPE, r.releaseId)?.state).toBe('pending')

    h.v2.falha = null
    await h.service.resume(SCOPE, projeto())
    expect(h.recovery.correction(SCOPE, r.releaseId)?.state).toBe('opened')
  })
})
