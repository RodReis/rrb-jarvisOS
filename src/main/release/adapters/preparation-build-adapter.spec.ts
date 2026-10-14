import { describe, expect, it } from 'vitest'
import type { Artifact, ReleaseScope } from '@shared/domain/release'
import type { PreparationOutcome, PreparationProject } from '../release-preparation-service'
import { PreparationBuildAdapter, type PreparationRunner } from './preparation-build-adapter'

const SCOPE: ReleaseScope = { userId: 'u', workspaceId: 'jarvis', projectId: 'p' }
const DIGEST = `sha256:${'a'.repeat(64)}`
const SHA = 'c'.repeat(40)

const artefato = (uri: string | null): Artifact => ({
  id: 'a1',
  ...SCOPE,
  releaseId: 'r1',
  kind: 'backend-image',
  digest: DIGEST,
  uri,
  provenance: null,
  createdAt: '2026-10-14T12:00:00.000Z'
})

const preparada = (uri: string | null): PreparationOutcome => ({
  state: 'prepared',
  artifact: artefato(uri),
  fingerprint: 'f'.repeat(64),
  ports: {} as never,
  reused: false,
  leaseId: 'lease-1',
  cleanup: 'done'
})

function montar(resultado: PreparationOutcome) {
  const chamadas: { releaseId: string; leaseId: string; sha: string }[] = []
  const preparation: PreparationRunner = {
    prepare: async (_scope, releaseId, lease, projeto) => {
      chamadas.push({ releaseId, leaseId: lease.leaseId, sha: projeto.sourceSha })
      return resultado
    }
  }
  const adapter = new PreparationBuildAdapter(
    preparation,
    (sha) => ({ sourceSha: sha }) as PreparationProject
  )
  return { adapter, chamadas }
}

describe('PreparationBuildAdapter', () => {
  it('devolve a imagem por digest quando a preparação conclui', async () => {
    const { adapter } = montar(preparada(`ghcr.io/dono/app@${DIGEST}`))
    expect(
      await adapter.build({ scope: SCOPE, releaseId: 'r1', sourceSha: SHA, leaseId: 'lease-1' })
    ).toEqual({ state: 'built', imageUri: `ghcr.io/dono/app@${DIGEST}`, digest: DIGEST })
  })

  it('monta o projeto para o SHA da release e repassa o lease do writer', async () => {
    const { adapter, chamadas } = montar(preparada(`ghcr.io/dono/app@${DIGEST}`))
    await adapter.build({ scope: SCOPE, releaseId: 'r1', sourceSha: SHA, leaseId: 'lease-1' })
    expect(chamadas).toEqual([{ releaseId: 'r1', leaseId: 'lease-1', sha: SHA }])
  })

  it('preparação bloqueada vira bloqueio com o código da razão', async () => {
    const { adapter } = montar({ state: 'blocked', reason: 'migration-failed' })
    expect(
      await adapter.build({ scope: SCOPE, releaseId: 'r1', sourceSha: SHA, leaseId: 'lease-1' })
    ).toEqual({ state: 'blocked', reason: 'migration-failed' })
  })

  it('artefato sem uri (linha anterior à F02) não é imagem utilizável: bloqueia', async () => {
    const { adapter } = montar(preparada(null))
    expect(
      await adapter.build({ scope: SCOPE, releaseId: 'r1', sourceSha: SHA, leaseId: 'lease-1' })
    ).toEqual({ state: 'blocked', reason: 'partial' })
  })

  it('limpeza do Docker pendente não invalida a imagem já publicada', async () => {
    const { adapter } = montar({
      ...preparada(`ghcr.io/dono/app@${DIGEST}`),
      cleanup: 'pending'
    } as PreparationOutcome)
    expect(
      (await adapter.build({ scope: SCOPE, releaseId: 'r1', sourceSha: SHA, leaseId: 'l' })).state
    ).toBe('built')
  })

  it('perfil que não monta para o SHA bloqueia em vez de lançar', async () => {
    const adapter = new PreparationBuildAdapter({ prepare: async () => preparada(null) }, () => {
      throw new TypeError('O perfil do projeto não é um JSON válido.')
    })
    expect(
      await adapter.build({ scope: SCOPE, releaseId: 'r1', sourceSha: SHA, leaseId: 'l' })
    ).toEqual({ state: 'blocked', reason: 'profile-invalid' })
  })
})
