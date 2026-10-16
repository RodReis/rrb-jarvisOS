import type { ReleaseEnvironment } from './release'

/**
 * Identidade de uma release estabilizada (SPEC-Release-05, critério 7; design §13). O manifesto é
 * montado só de campos estruturados — ids, digests, hashes e códigos — e fica em ordem canônica:
 * o mesmo conteúdo produz sempre o mesmo texto e, portanto, o mesmo hash, que qualquer um pode
 * recalcular. O changelog é derivado do manifesto, nunca de texto de PR ou de saída de provedor
 * (instrução de conteúdo externo não atravessa o boundary).
 */

export interface DadosDoManifesto {
  readonly releaseId: string
  readonly projectId: string
  readonly sha: string
  readonly tag: string
  readonly createdAt: string
  readonly stageStartedAt: string | null
  readonly completedAt: string
  readonly previous: { readonly releaseId: string; readonly tag: string | null } | null
  readonly artifacts: readonly {
    readonly kind: string
    readonly digest: string
    readonly uri: string | null
  }[]
  readonly deployments: readonly {
    readonly environment: ReleaseEnvironment
    readonly kind: string
    readonly externalId: string
    readonly artifactDigest: string
    readonly replacesExternalId: string | null
  }[]
  readonly migrations: readonly {
    readonly environment: ReleaseEnvironment
    readonly migrationId: string
    readonly checksum: string
    readonly state: string
    readonly backupRef: string | null
  }[]
  /** O último resultado de cada gate por ambiente. */
  readonly gates: readonly {
    readonly environment: ReleaseEnvironment
    readonly gate: string
    readonly result: 'passed' | 'blocked' | 'unknown'
    readonly reason: string | null
  }[]
  readonly inclusions: readonly {
    readonly sha: string
    readonly pullRequest: number | null
    readonly specId: string | null
    readonly sliceId: string | null
    readonly issue: number | null
  }[]
}

export interface ManifestoDeRelease {
  readonly schema: 1
  readonly releaseId: string
  readonly projectId: string
  readonly sha: string
  readonly tag: string
  readonly previousRelease: { readonly releaseId: string; readonly tag: string | null } | null
  readonly timestamps: {
    readonly createdAt: string
    readonly stageStartedAt: string | null
    readonly completedAt: string
  }
  readonly artifacts: DadosDoManifesto['artifacts']
  readonly deployments: DadosDoManifesto['deployments']
  readonly migrations: DadosDoManifesto['migrations']
  readonly gates: readonly {
    readonly environment: ReleaseEnvironment
    readonly gate: string
    readonly result: 'passed'
  }[]
  readonly inclusions: DadosDoManifesto['inclusions']
}

const comparar = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0)

export function construirManifesto(dados: DadosDoManifesto): ManifestoDeRelease {
  if (!dados.completedAt)
    throw new TypeError('Sem estabilização não há identidade: falta o instante de conclusão.')
  const reprovado = dados.gates.find((g) => g.result !== 'passed')
  if (reprovado)
    throw new TypeError(`O gate ${reprovado.environment}:${reprovado.gate} não está aprovado.`)
  return {
    schema: 1,
    releaseId: dados.releaseId,
    projectId: dados.projectId,
    sha: dados.sha,
    tag: dados.tag,
    previousRelease: dados.previous,
    timestamps: {
      createdAt: dados.createdAt,
      stageStartedAt: dados.stageStartedAt,
      completedAt: dados.completedAt
    },
    artifacts: [...dados.artifacts].sort((a, b) => comparar(a.kind, b.kind)),
    deployments: [...dados.deployments].sort(
      (a, b) => comparar(a.environment, b.environment) || comparar(a.kind, b.kind)
    ),
    migrations: [...dados.migrations].sort(
      (a, b) => comparar(a.environment, b.environment) || comparar(a.migrationId, b.migrationId)
    ),
    gates: dados.gates
      .map((g) => ({ environment: g.environment, gate: g.gate, result: 'passed' as const }))
      .sort((a, b) => comparar(a.environment, b.environment) || comparar(a.gate, b.gate)),
    inclusions: [...dados.inclusions].sort(
      (a, b) => comparar(a.pullRequest ?? 0, b.pullRequest ?? 0) || comparar(a.sha, b.sha)
    )
  }
}

/** Markdown determinístico, só de campos do manifesto. O hash vem de fora: ele cobre o manifesto. */
export function gerarChangelog(manifesto: ManifestoDeRelease, manifestSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(manifestSha256))
    throw new TypeError('O hash do manifesto deve ser um SHA-256 hexadecimal.')
  const anterior = manifesto.previousRelease
    ? (manifesto.previousRelease.tag ?? manifesto.previousRelease.releaseId)
    : 'nenhuma'
  const linhas: string[] = [
    `# ${manifesto.tag}`,
    '',
    `- Release: ${manifesto.releaseId}`,
    `- Commit: ${manifesto.sha}`,
    `- Concluída em: ${manifesto.timestamps.completedAt}`,
    `- Release anterior: ${anterior}`,
    '',
    '## Mudanças',
    ...manifesto.inclusions.map((i) =>
      [
        i.pullRequest ? `PR #${i.pullRequest}` : 'sem PR',
        i.specId ? `SPEC ${i.specId}` : null,
        i.issue ? `issue #${i.issue}` : null,
        i.sha.slice(0, 7)
      ]
        .filter((parte): parte is string => parte !== null)
        .map((parte, indice) => (indice === 0 ? `- ${parte}` : parte))
        .join(' · ')
    ),
    '',
    '## Evidência'
  ]
  for (const a of manifesto.artifacts) linhas.push(`- Artefato ${a.kind}: ${a.digest}`)
  for (const d of manifesto.deployments.filter((x) => x.environment === 'production'))
    linhas.push(`- Deployment ${d.kind} em Produção: ${d.externalId}`)
  const migrations = [
    ...new Set(
      manifesto.migrations.filter((m) => m.environment === 'production').map((m) => m.migrationId)
    )
  ]
  linhas.push(`- Migrations aplicadas: ${migrations.length ? migrations.join(', ') : 'nenhuma'}`)
  linhas.push(`- Gates aprovados: ${manifesto.gates.length}`)
  linhas.push('', `Manifest-SHA256: ${manifestSha256}`, '')
  return linhas.join('\n')
}
