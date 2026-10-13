import { PADRAO_DE_AMBIENTE_DE_PREVIEW } from '@shared/domain/release-preview'
import {
  PreviewProviderError,
  type PreviewBackendEnvironment,
  type PreviewBackendPort,
  type PreviewDatabasePort,
  type PreviewFrontendPort,
  type PreviewGateOutcome,
  type PreviewImagePort,
  type PreviewProjection,
  type PreviewProviderErrorCode,
  type PreviewPublicationPort,
  type PreviewVerifierPort
} from './preview-ports'
import type { MigrationOutcome } from './database-migration-runner'

/**
 * Nuvem falsa com estado de verdade: dois PRs compartilham o mesmo mundo, então um defeito de
 * isolamento (ambiente, banco ou URL cruzados) aparece como asserção quebrada, não como mock que
 * responde igual a tudo. Falha é injetada por operação (`image.ensure`, `backend.destroy`, ...).
 */

interface FakeEnvironment {
  readonly name: string
  readonly backendUrl: string
  readonly imageUri: string
  readonly sourceSha: string
  readonly previewRunId: string
  readonly database: { migrations: string[]; seed: boolean }
}

interface FakeDeployment {
  readonly id: string
  readonly url: string
  readonly previewRunId: string
  readonly sourceSha: string
  readonly backendUrl: string
}

interface Fault {
  readonly code: PreviewProviderErrorCode
  remaining: number
}

export class FakeCloud {
  readonly environments = new Map<string, FakeEnvironment>()
  readonly deployments = new Map<string, FakeDeployment>()
  readonly images = new Map<string, string>()
  readonly calls: string[] = []
  readonly published: PreviewProjection[] = []
  migrationOutcome: MigrationOutcome | null = null
  private readonly faults = new Map<string, Fault>()
  private sequence = 0

  /** Faz a operação falhar `times` vezes seguidas (padrão: uma). */
  failOn(operation: string, code: PreviewProviderErrorCode = 'failed', times = 1): void {
    this.faults.set(operation, { code, remaining: times })
  }

  clearFaults(): void {
    this.faults.clear()
  }

  private enter(operation: string): void {
    this.calls.push(operation)
    const fault = this.faults.get(operation)
    if (fault && fault.remaining > 0) {
      fault.remaining -= 1
      throw new PreviewProviderError(fault.code, `falha injetada em ${operation}`)
    }
  }

  readonly image: PreviewImagePort = {
    ensure: async ({ sourceSha }) => {
      this.enter('image.ensure')
      const digest = `sha256:${sourceSha.slice(0, 8).padEnd(64, '0')}`
      const uri = `ghcr.io/dono/app@${digest}`
      this.images.set(sourceSha, uri)
      return { uri, digest }
    }
  }

  readonly backend: PreviewBackendPort = {
    provision: async ({ name, imageUri, sourceSha, previewRunId }) => {
      this.enter('backend.provision')
      const existente = this.environments.get(name)
      const ambiente: FakeEnvironment = {
        name,
        backendUrl: existente?.backendUrl ?? `https://api-${name}.up.railway.app`,
        imageUri,
        sourceSha,
        previewRunId,
        database: existente?.database ?? { migrations: [], seed: false }
      }
      this.environments.set(name, ambiente)
      const resposta: PreviewBackendEnvironment = {
        externalId: `env-${name}`,
        backendUrl: ambiente.backendUrl,
        databaseExternalId: `db-${name}`
      }
      return resposta
    },
    destroy: async (name) => {
      this.enter('backend.destroy')
      if (!PADRAO_DE_AMBIENTE_DE_PREVIEW.test(name))
        throw new PreviewProviderError('incompatible-state', 'ambiente não pertence a um Preview')
      return this.environments.delete(name) ? 'destroyed' : 'absent'
    }
  }

  readonly database: PreviewDatabasePort = {
    migrateAndSeed: async ({ name, migrations }) => {
      this.enter('database.migrate')
      if (this.migrationOutcome) return this.migrationOutcome
      const ambiente = this.environments.get(name)
      if (!ambiente) throw new PreviewProviderError('not-found', 'ambiente inexistente')
      ambiente.database.migrations = migrations.map((m) => m.id)
      ambiente.database.seed = true
      return {
        state: 'confirmed',
        applied: ambiente.database.migrations,
        skipped: [],
        seedApplied: true,
        fingerprint: 'f'.repeat(64)
      }
    }
  }

  readonly frontend: PreviewFrontendPort = {
    deploy: async ({ previewRunId, sourceSha, backendUrl }) => {
      this.enter('frontend.deploy')
      const igual = [...this.deployments.values()].find(
        (d) =>
          d.previewRunId === previewRunId &&
          d.sourceSha === sourceSha &&
          d.backendUrl === backendUrl
      )
      if (igual) return { externalId: igual.id, url: igual.url }
      this.sequence += 1
      const id = `dpl_${this.sequence}`
      const url = `https://web-${this.sequence}.vercel.app`
      this.deployments.set(id, { id, url, previewRunId, sourceSha, backendUrl })
      return { externalId: id, url }
    },
    list: async (previewRunId) => {
      this.enter('frontend.list')
      return [...this.deployments.values()]
        .filter((d) => d.previewRunId === previewRunId)
        .map((d) => d.id)
    },
    destroy: async (id) => {
      this.enter('frontend.destroy')
      return this.deployments.delete(id) ? 'destroyed' : 'absent'
    }
  }

  /** Confere a fiação de verdade: o frontend entregue aponta para o backend deste mesmo run. */
  readonly verifier: PreviewVerifierPort = {
    verify: async ({ previewRunId, sourceSha, backendUrl, frontendUrl }) => {
      this.enter('verifier.verify')
      const ambiente = [...this.environments.values()].find((e) => e.backendUrl === backendUrl)
      const deployment = [...this.deployments.values()].find((d) => d.url === frontendUrl)
      const resultados: PreviewGateOutcome[] = [
        {
          gate: 'health',
          result: ambiente ? 'passed' : 'blocked',
          reason: ambiente ? undefined : 'health-down'
        },
        {
          gate: 'identidade',
          result:
            ambiente?.previewRunId === previewRunId && ambiente.sourceSha === sourceSha
              ? 'passed'
              : 'blocked',
          reason: 'identity-mismatch'
        },
        {
          gate: 'frontend',
          result:
            deployment?.backendUrl === backendUrl && deployment.previewRunId === previewRunId
              ? 'passed'
              : 'blocked',
          reason: 'frontend-wiring'
        }
      ]
      return resultados.map((r) => (r.result === 'passed' ? { gate: r.gate, result: r.result } : r))
    }
  }

  readonly publication: PreviewPublicationPort = {
    publish: async (projecao) => {
      this.enter('publication.publish')
      this.published.push(projecao)
    }
  }
}
