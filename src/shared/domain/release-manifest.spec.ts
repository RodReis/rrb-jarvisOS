import { describe, expect, it } from 'vitest'
import { jsonCanonico } from './release-recovery'
import { construirManifesto, gerarChangelog, type DadosDoManifesto } from './release-manifest'

const SHA = 'a'.repeat(40)
const DIGEST = `sha256:${'b'.repeat(64)}`

const dados: DadosDoManifesto = {
  releaseId: 'rel-2',
  projectId: 'project-1',
  sha: SHA,
  tag: 'release-20261016-1200-aaaaaaa',
  createdAt: '2026-10-16T11:50:00.000Z',
  stageStartedAt: '2026-10-16T11:51:00.000Z',
  completedAt: '2026-10-16T12:00:00.000Z',
  previous: { releaseId: 'rel-1', tag: 'release-20261015-1000-1111111' },
  artifacts: [{ kind: 'backend-image', digest: DIGEST, uri: `ghcr.io/dono/app@${DIGEST}` }],
  deployments: [
    {
      environment: 'production',
      kind: 'frontend',
      externalId: 'dpl_fe2',
      artifactDigest: DIGEST,
      replacesExternalId: 'dpl_fe1'
    },
    {
      environment: 'production',
      kind: 'backend',
      externalId: 'rw-production-2',
      artifactDigest: DIGEST,
      replacesExternalId: 'rw-production-1'
    },
    {
      environment: 'staging',
      kind: 'backend',
      externalId: 'rw-staging-2',
      artifactDigest: DIGEST,
      replacesExternalId: null
    }
  ],
  migrations: [
    {
      environment: 'production',
      migrationId: '002_users',
      checksum: '2'.repeat(64),
      state: 'confirmed',
      backupRef: 'bkp-1'
    },
    {
      environment: 'production',
      migrationId: '001_init',
      checksum: '1'.repeat(64),
      state: 'confirmed',
      backupRef: 'bkp-1'
    }
  ],
  gates: [
    { environment: 'production', gate: 'smoke', result: 'passed', reason: null },
    { environment: 'production', gate: 'backup', result: 'passed', reason: null },
    { environment: 'staging', gate: 'smoke', result: 'passed', reason: null }
  ],
  inclusions: [
    { sha: 'c'.repeat(40), pullRequest: 433, specId: 'spec-b', sliceId: 'slice-2', issue: 155 },
    { sha: SHA, pullRequest: 432, specId: 'spec-release-05', sliceId: 'slice-9', issue: 154 }
  ]
}

describe('construirManifesto', () => {
  it('registra SHA, artefatos, deployments, migrations, gates, SPECs, issues, instantes e release anterior', () => {
    const m = construirManifesto(dados)
    expect(m).toMatchObject({
      schema: 1,
      releaseId: 'rel-2',
      sha: SHA,
      tag: dados.tag,
      previousRelease: { releaseId: 'rel-1', tag: 'release-20261015-1000-1111111' },
      timestamps: {
        createdAt: dados.createdAt,
        stageStartedAt: dados.stageStartedAt,
        completedAt: dados.completedAt
      }
    })
    expect(m.artifacts).toEqual([
      { kind: 'backend-image', digest: DIGEST, uri: dados.artifacts[0]!.uri }
    ])
    expect(m.inclusions.map((i) => i.pullRequest)).toEqual([432, 433])
    expect(m.migrations.map((x) => x.migrationId)).toEqual(['001_init', '002_users'])
    expect(m.gates.map((g) => `${g.environment}:${g.gate}`)).toEqual([
      'production:backup',
      'production:smoke',
      'staging:smoke'
    ])
  })

  it('é canônico: a ordem de entrada não muda o texto, então o hash é verificável', () => {
    const invertido: DadosDoManifesto = {
      ...dados,
      deployments: [...dados.deployments].reverse(),
      migrations: [...dados.migrations].reverse(),
      gates: [...dados.gates].reverse(),
      inclusions: [...dados.inclusions].reverse()
    }
    expect(jsonCanonico(construirManifesto(invertido))).toBe(
      jsonCanonico(construirManifesto(dados))
    )
  })

  it('a release sem antecessora declara isso, em vez de omitir', () => {
    expect(construirManifesto({ ...dados, previous: null }).previousRelease).toBeNull()
  })

  it('não carrega URL, segredo nem texto livre: só ids, digests, hashes e códigos', () => {
    const texto = jsonCanonico(construirManifesto(dados))
    expect(texto).not.toMatch(/https?:\/\/|token|senha|secret/i)
  })

  it('só aceita release com todos os gates aprovados: bloqueado ou desconhecido não vira manifesto', () => {
    expect(() =>
      construirManifesto({
        ...dados,
        gates: [
          ...dados.gates,
          { environment: 'production', gate: 'x', result: 'blocked', reason: 'x' }
        ]
      })
    ).toThrow(/gate/i)
  })

  it('exige instante de conclusão: sem estabilização não há identidade', () => {
    expect(() => construirManifesto({ ...dados, completedAt: '' })).toThrow(TypeError)
  })
})

describe('gerarChangelog', () => {
  const hash = 'd'.repeat(64)

  it('lista o que a release trouxe e a evidência, só a partir de campos estruturados', () => {
    const texto = gerarChangelog(construirManifesto(dados), hash)
    expect(texto).toContain(`# ${dados.tag}`)
    expect(texto).toContain('PR #432')
    expect(texto).toContain('SPEC spec-release-05')
    expect(texto).toContain('issue #154')
    expect(texto).toContain('PR #433')
    expect(texto).toContain(`Release anterior: ${'release-20261015-1000-1111111'}`)
    expect(texto).toContain(DIGEST)
    expect(texto).toContain('dpl_fe2')
    expect(texto).toContain('001_init')
    expect(texto).toContain(`Manifest-SHA256: ${hash}`)
  })

  it('é determinístico', () => {
    const m = construirManifesto(dados)
    expect(gerarChangelog(m, hash)).toBe(gerarChangelog(m, hash))
  })

  it('sem release anterior, diz que é a primeira', () => {
    const texto = gerarChangelog(construirManifesto({ ...dados, previous: null }), hash)
    expect(texto).toContain('Release anterior: nenhuma')
  })

  it('release anterior sem tag (anterior à F05) cita o release_id', () => {
    const texto = gerarChangelog(
      construirManifesto({ ...dados, previous: { releaseId: 'rel-1', tag: null } }),
      hash
    )
    expect(texto).toContain('Release anterior: rel-1')
  })

  it('recusa hash que não é SHA-256', () => {
    expect(() => gerarChangelog(construirManifesto(dados), 'curto')).toThrow(TypeError)
  })
})
