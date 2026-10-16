import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { nomeDaTag } from '@shared/domain/release-recovery'
import { FakeGitHubReleases } from './promotion-test-doubles'
import {
  SCOPE,
  SHA_A,
  SHA_B,
  montarHarness,
  projeto,
  semearReleaseConcluida,
  type Harness
} from './promotion-test-harness'
import { ReleasePublisher } from './release-publisher'

/**
 * Identidade da release estabilizada (SPEC-Release-05, critérios 7 e 8; regras 7 e 8): manifesto
 * imutável, tag, GitHub Release e changelog verificáveis — e só para Produção estabilizada. Falha
 * de documentação gera pendência de evidência; nunca reverte uma aplicação saudável.
 */

let h: Harness
let git: FakeGitHubReleases
let publisher: ReleasePublisher

function montar(opcoes: { semGit?: boolean } = {}): void {
  h = montarHarness({ semPublicacao: true })
  git = new FakeGitHubReleases()
  publisher = new ReleasePublisher({
    repository: h.repository,
    promotion: h.promotion,
    local: h.local,
    recovery: h.recovery,
    ...(opcoes.semGit ? {} : { git: git.port }),
    now: h.clock.now
  })
}

afterEach(() => h.fechar())

const INCLUSAO = { pullRequest: 432, specId: 'spec-release-05', sliceId: 'slice-9', issue: 154 }
const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex')

async function concluir(sha = SHA_A, inclusao: object = INCLUSAO): Promise<string> {
  const r = await h.service.handleMerge(SCOPE, sha, projeto(), inclusao)
  expect(r.state).toBe('completed')
  return r.releaseId
}

describe('Produção estabilizada gera identidade verificável (critério 7)', () => {
  it('salva o manifesto, cria a tag no commit da release e publica o changelog', async () => {
    montar()
    const id = await concluir()

    const r = await publisher.publish(SCOPE, id)

    const manifesto = h.recovery.manifest(SCOPE, id)!
    const concluidaEm = h.repository.get({ ...SCOPE, releaseId: id })!.updatedAt
    expect(manifesto.tag).toBe(nomeDaTag(concluidaEm, SHA_A))
    expect(r).toMatchObject({ state: 'published', tag: manifesto.tag })
    expect(manifesto.manifestSha256).toBe(sha256(manifesto.manifestJson))
    const doGithub = git.tags.get(manifesto.tag)!
    expect(doGithub.commitSha).toBe(SHA_A)
    expect(doGithub.notes).toBe(manifesto.changelog)
    expect(manifesto.changelog).toContain(`Manifest-SHA256: ${manifesto.manifestSha256}`)
    expect(manifesto.changelog).toContain('PR #432')
    expect(manifesto.changelog).toContain('SPEC spec-release-05')
    expect(h.recovery.publication(SCOPE, id, 'github-release')).toMatchObject({
      state: 'published',
      externalRef: manifesto.tag
    })
    expect(h.recovery.pendingPublications(SCOPE)).toEqual([])
  })

  it('o manifesto registra SHA, artefato, deployments, migrations, gates, SPEC e issue', async () => {
    montar()
    const id = await concluir()
    await publisher.publish(SCOPE, id)
    const m = JSON.parse(h.recovery.manifest(SCOPE, id)!.manifestJson) as Record<string, unknown[]>
    expect(m).toMatchObject({ releaseId: id, sha: SHA_A, previousRelease: null })
    expect(m.artifacts).toHaveLength(1)
    expect(m.deployments).toHaveLength(4)
    expect(m.migrations).toHaveLength(4)
    expect(m.gates.length).toBeGreaterThanOrEqual(11)
    expect(m.inclusions).toEqual([
      expect.objectContaining({ pullRequest: 432, specId: 'spec-release-05', issue: 154 })
    ])
  })

  it('a segunda release aponta a primeira como anterior, com a tag dela', async () => {
    montar()
    const primeira = await concluir(SHA_A)
    await publisher.publish(SCOPE, primeira)
    h.clock.sleep(60_000)
    const segunda = await concluir(SHA_B, { pullRequest: 433 })
    await publisher.publish(SCOPE, segunda)

    const m = JSON.parse(h.recovery.manifest(SCOPE, segunda)!.manifestJson) as {
      previousRelease: { releaseId: string; tag: string }
    }
    expect(m.previousRelease).toEqual({
      releaseId: primeira,
      tag: h.recovery.manifest(SCOPE, primeira)!.tag
    })
  })

  it('publicar de novo é idempotente: nada é criado duas vezes', async () => {
    montar()
    const id = await concluir()
    await publisher.publish(SCOPE, id)
    const segunda = await publisher.publish(SCOPE, id)
    expect(segunda.state).toBe('published')
    expect(git.calls.filter((c) => c.startsWith('publish:'))).toHaveLength(1)
  })

  it('é verificável: o manifesto recalculado, a tag e as notas batem', async () => {
    montar()
    const id = await concluir()
    await publisher.publish(SCOPE, id)
    expect(await publisher.verify(SCOPE, id)).toEqual({ ok: true, problems: [] })
  })

  it.each([
    ['tag apagada', (tag: string) => git.tags.delete(tag), 'tag-missing'],
    [
      'tag em outro commit',
      (tag: string) => git.tags.set(tag, { ...git.tags.get(tag)!, commitSha: SHA_B }),
      'tag-wrong-commit'
    ],
    [
      'notas editadas',
      (tag: string) => git.tags.set(tag, { ...git.tags.get(tag)!, notes: 'outra coisa' }),
      'notes-diverged'
    ]
  ])('a verificação acusa %s', async (_nome, adulterar, problema) => {
    montar()
    const id = await concluir()
    await publisher.publish(SCOPE, id)
    adulterar(h.recovery.manifest(SCOPE, id)!.tag)
    expect(await publisher.verify(SCOPE, id)).toEqual({ ok: false, problems: [problema] })
  })
})

describe('release que não estabilizou não tem identidade (critério 8; contrafactual)', () => {
  it('release falha não recebe manifesto, tag nem GitHub Release', async () => {
    montar()
    semearReleaseConcluida(h)
    h.cloud.smokeFails.add('staging')
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(r.state).toBe('failed')

    expect(await publisher.publish(SCOPE, r.releaseId)).toEqual({
      state: 'rejected',
      reason: 'release-not-stable'
    })
    expect(git.calls).toEqual([])
    expect(h.recovery.manifest(SCOPE, r.releaseId)).toBeNull()
  })

  it('tag antes da estabilização falha: release em estabilização é recusada, sem tocar o GitHub', async () => {
    montar()
    let recusada: unknown = null
    // Durante a janela de estabilização alguém tenta publicar.
    const liberada = montarHarness({
      semPublicacao: true,
      sleep: async (ms) => {
        if (!recusada)
          recusada = await publisher.publish(SCOPE, h.repository.queue(SCOPE).candidate!.id)
        await h.clock.sleep(ms)
      }
    })
    // Reaproveita o publisher do primeiro harness só para checar a guarda; o mundo é o `liberada`.
    h.fechar()
    h = liberada
    git = new FakeGitHubReleases()
    publisher = new ReleasePublisher({
      repository: h.repository,
      promotion: h.promotion,
      local: h.local,
      recovery: h.recovery,
      git: git.port,
      now: h.clock.now
    })
    const r = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(r.state).toBe('completed')
    expect(recusada).toEqual({ state: 'rejected', reason: 'release-not-stable' })
    expect(git.calls).toEqual([])
  })

  it('release degradada ou cancelada também não recebe tag', async () => {
    montar()
    h.cloud.smokeFails.add('production')
    const degradada = await h.service.handleMerge(SCOPE, SHA_A, projeto(), INCLUSAO)
    expect(degradada.state).toBe('degraded')
    expect((await publisher.publish(SCOPE, degradada.releaseId)).state).toBe('rejected')
    expect(git.tags.size).toBe(0)
  })

  it('release inexistente é recusada', async () => {
    montar()
    expect(await publisher.publish(SCOPE, 'nao-existe')).toEqual({
      state: 'rejected',
      reason: 'release-not-found'
    })
  })
})

describe('documento com falha não reverte aplicação saudável (regra 8)', () => {
  it('GitHub fora do ar: a release segue concluída, a pendência fica registrada e a retomada publica', async () => {
    montar()
    const id = await concluir()
    git.failOn('publish', 'timeout', 1)

    const r = await publisher.publish(SCOPE, id)

    expect(r).toMatchObject({ state: 'pending', reason: 'github-timeout' })
    expect(h.repository.get({ ...SCOPE, releaseId: id })!.status).toBe('completed')
    expect(h.recovery.pendingPublications(SCOPE).map((p) => p.releaseId)).toEqual([id])
    expect(h.recovery.evidence(SCOPE, id)).toContainEqual(
      expect.objectContaining({
        kind: 'publication',
        state: 'pending',
        reason: 'github-timeout',
        action: 'retry-publication'
      })
    )
    // O manifesto já existe: a identidade não depende do GitHub.
    expect(h.recovery.manifest(SCOPE, id)).not.toBeNull()

    const retomadas = await publisher.retryPending(SCOPE)
    expect(retomadas.map((x) => x.state)).toEqual(['published'])
    expect(h.recovery.pendingPublications(SCOPE)).toEqual([])
  })

  it('resposta perdida depois de criar a release: a repetição reconhece o que existe, sem duplicar', async () => {
    montar()
    const id = await concluir()
    git.failAfter('publish', 'timeout', 1)
    const primeira = await publisher.publish(SCOPE, id)
    expect(primeira.state).toBe('pending')

    const segunda = await publisher.publish(SCOPE, id)
    expect(segunda.state).toBe('published')
    expect(git.calls.filter((c) => c.startsWith('publish:'))).toHaveLength(1)
  })

  it('acesso recusado exige ação do operador, mas também não reverte nada', async () => {
    montar()
    const id = await concluir()
    git.failOn('publish', 'auth', 1)
    const r = await publisher.publish(SCOPE, id)
    expect(r).toMatchObject({ state: 'failed', reason: 'github-auth' })
    expect(h.repository.get({ ...SCOPE, releaseId: id })!.status).toBe('completed')
    expect(h.recovery.evidence(SCOPE, id)).toContainEqual(
      expect.objectContaining({ kind: 'publication', action: 'fix-github-access' })
    )
  })

  it('sem GitHub configurado: o manifesto existe e a publicação fica pendente com a ação mínima', async () => {
    montar({ semGit: true })
    const id = await concluir()
    const r = await publisher.publish(SCOPE, id)
    expect(r).toMatchObject({ state: 'pending', reason: 'github-not-configured' })
    expect(h.recovery.manifest(SCOPE, id)).not.toBeNull()
    expect(h.recovery.evidence(SCOPE, id)).toContainEqual(
      expect.objectContaining({ kind: 'publication', action: 'configure-github' })
    )
  })

  it('tag que já existe em outro commit nunca é sobrescrita', async () => {
    montar()
    const id = await concluir()
    const tag = nomeDaTag(h.repository.get({ ...SCOPE, releaseId: id })!.updatedAt, SHA_A)
    git.tags.set(tag, { commitSha: SHA_B, notes: 'alheia', title: 'alheia' })

    const r = await publisher.publish(SCOPE, id)

    expect(r).toMatchObject({ state: 'failed', reason: 'tag-conflict' })
    expect(git.calls.filter((c) => c.startsWith('publish:'))).toEqual([])
    expect(git.tags.get(tag)).toMatchObject({ commitSha: SHA_B, notes: 'alheia' })
  })

  it('tag no commit certo sem release: só a release é criada', async () => {
    montar()
    const id = await concluir()
    const tag = nomeDaTag(h.repository.get({ ...SCOPE, releaseId: id })!.updatedAt, SHA_A)
    git.tags.set(tag, { commitSha: SHA_A, notes: null, title: '' })

    const r = await publisher.publish(SCOPE, id)

    expect(r.state).toBe('published')
    expect(git.tags.get(tag)!.notes).toBe(h.recovery.manifest(SCOPE, id)!.changelog)
  })
})
