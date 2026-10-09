import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { ComposeBlockedError, type ComposeProfile } from './adapters/local-compose-adapter'
import { ArtifactRegistryError } from './adapters/ghcr-artifact-adapter'
import type { SqlExecutor } from './database-migration-runner'
import { ReleaseLocalRepository } from './release-local-repository'
import { ReleaseRepository } from './release-repository'
import {
  ReleasePreparationService,
  type ComposeEnvironmentPort,
  type ComposePort,
  type PreparationProject,
  type RegistryPort
} from './release-preparation-service'

const NOW = '2026-10-09T12:00:00.000Z'
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const SENTINELA = 'SENTINELA-SECRETA-QWERTY-4471'
const DIGEST = `sha256:${'a'.repeat(64)}`
const URI = `ghcr.io/dono/projeto-backend@${DIGEST}`
const PROFILE: ComposeProfile = {
  postgresPreferredPort: 55_900,
  backend: { context: 'b', containerPort: 3000, healthPath: '/health', preferredPort: 55_910 },
  frontend: { context: 'f', containerPort: 3001, healthPath: '/', preferredPort: 55_920 }
}

let directory: string
let db: Database
let repo: ReleaseLocalRepository
let releaseId: string
let lease: { leaseId: string; ownerId: string; fencingToken: number }
let chamadas: string[]
let projeto: PreparationProject

function escrever(nome: string, texto: string): string {
  const caminho = join(directory, nome)
  writeFileSync(caminho, texto)
  return caminho
}

function sqlFalso(falhaEm?: string): SqlExecutor {
  return {
    async run(sql) {
      chamadas.push('sql')
      if (sql.includes('FROM schema_migrations')) return { ok: true, stdout: '', stderr: '' }
      if (falhaEm && sql.includes(falhaEm)) return { ok: false, stdout: '', stderr: 'ERROR: boom' }
      return { ok: true, stdout: '', stderr: '' }
    },
    async dump() {
      return 'CREATE TABLE itens (id int);'
    }
  }
}

function composeFalso(
  opcoes: {
    falhaAoAbrir?: ComposeBlockedError
    falhaMigration?: string
    falhaLimpeza?: boolean
  } = {}
): ComposePort {
  const env: ComposeEnvironmentPort = {
    ports: { postgres: 1, backend: 2, frontend: 3 },
    sql: sqlFalso(opcoes.falhaMigration),
    async upDatabase() {
      chamadas.push('upDatabase')
    },
    async upApplication(imagem) {
      chamadas.push(`upApplication:${imagem}`)
    },
    async verify() {
      chamadas.push('verify')
    }
  }
  return {
    async open() {
      chamadas.push('open')
      if (opcoes.falhaAoAbrir) throw opcoes.falhaAoAbrir
      return env
    },
    async cleanup() {
      chamadas.push('cleanup')
      if (opcoes.falhaLimpeza) throw new ComposeBlockedError('cleanup-failed', 'x')
      return { containers: 3, networks: 1, volumes: 1 }
    }
  }
}

function registryFalso(erro?: ArtifactRegistryError): RegistryPort {
  const artefato = {
    uri: URI,
    digest: DIGEST,
    provenance: {
      transport: 'docker-cli' as const,
      buildType: 'slsa',
      builderId: 'b',
      provenanceDigest: `sha256:${'b'.repeat(64)}`
    }
  }
  return {
    async publish() {
      chamadas.push('publish')
      if (erro) throw erro
      return artefato
    },
    async resolve() {
      chamadas.push('resolve')
      return artefato
    }
  }
}

function servico(compose: ComposePort, registry: RegistryPort): ReleasePreparationService {
  return new ReleasePreparationService(repo, compose, registry, 'chave-de-fingerprint', () => NOW)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'release-prep-'))
  db = openDatabase(join(directory, 'release.db'))
  const audit = new AuditRepository(db, 'chave-de-auditoria')
  repo = new ReleaseLocalRepository(db, audit)
  releaseId = new ReleaseRepository(db, audit).enqueue(SCOPE, 'c'.repeat(40), NOW).release.id
  lease = { leaseId: 'lease-0123456789', ownerId: 'dono', fencingToken: 1 }
  chamadas = []
  const migrations = join(directory, 'migrations')
  writeFileSync(join(directory, 'seed.sql'), 'INSERT INTO itens VALUES (1);')
  projeto = {
    profile: PROFILE,
    migrationsDir: migrations,
    seedFile: join(directory, 'seed.sql'),
    envExampleFile: escrever('.env.example', 'API_TOKEN=\n'),
    envLocalFile: escrever('.env.local', `API_TOKEN=${SENTINELA}\n`),
    repository: 'ghcr.io/dono/projeto-backend',
    contextDir: join(directory, 'backend'),
    sourceSha: 'c'.repeat(40)
  }
  mkdirSync(migrations)
  writeFileSync(join(migrations, '001_cria_itens.sql'), 'CREATE TABLE itens (id int);')
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

const preparar = (s: ReleasePreparationService) => s.prepare(SCOPE, releaseId, lease, projeto)

describe('caminho feliz', () => {
  it('valida, sobe o banco, migra, publica uma vez, roda o publicado, verifica e limpa — nessa ordem', async () => {
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'prepared', cleanup: 'done', reused: false })
    expect(chamadas.filter((c) => c !== 'sql')).toEqual([
      'open',
      'upDatabase',
      'publish',
      `upApplication:${URI}`,
      'verify',
      'cleanup'
    ])
    expect(chamadas.indexOf('sql')).toBeLessThan(chamadas.indexOf('publish'))
  })

  it('persiste o digest e a provenance, e a consulta posterior devolve os mesmos', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    expect(repo.getArtifact(SCOPE, releaseId, 'backend-image')).toMatchObject({
      digest: DIGEST,
      uri: URI,
      provenance: { builderId: 'b' }
    })
  })

  it('registra no diário intenção e resultado de cada efeito, com transporte', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    const efeitos = repo.listEffects(SCOPE, releaseId)
    for (const kind of ['configuration', 'compose', 'migration', 'artifact'] as const) {
      expect(efeitos.filter((e) => e.kind === kind).map((e) => e.phase)).toEqual(
        expect.arrayContaining(['intended', 'confirmed'])
      )
    }
    const artefato = efeitos.find((e) => e.kind === 'artifact' && e.phase === 'confirmed')
    expect(artefato).toMatchObject({ digest: DIGEST, transport: 'docker-cli' })
    expect(artefato?.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('guarda as referências de configuração com fingerprint', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    const refs = repo.listConfigurationReferences(SCOPE, releaseId)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ name: 'API_TOKEN', environment: 'local', state: 'configured' })
    expect(refs[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('bloqueios', () => {
  it('chave ausente bloqueia com nome e ambiente, antes de tocar o Docker', async () => {
    writeFileSync(projeto.envLocalFile, 'OUTRA=1\n')
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toEqual({
      state: 'blocked',
      reason: 'configuration-missing',
      missing: [{ name: 'API_TOKEN', environment: 'local' }]
    })
    expect(chamadas).toEqual([])
    expect(repo.getArtifact(SCOPE, releaseId, 'backend-image')).toBeNull()
  })

  it('Docker indisponível vira bloqueio com código e nada é publicado', async () => {
    const r = await preparar(
      servico(
        composeFalso({ falhaAoAbrir: new ComposeBlockedError('docker-unavailable', 'x') }),
        registryFalso()
      )
    )
    expect(r).toMatchObject({ state: 'blocked', reason: 'docker-unavailable' })
    expect(chamadas).not.toContain('publish')
  })

  it('migration quebrada interrompe antes de publicar candidato utilizável e ainda limpa', async () => {
    const r = await preparar(
      servico(composeFalso({ falhaMigration: 'CREATE TABLE itens' }), registryFalso())
    )
    expect(r).toMatchObject({ state: 'blocked', reason: 'migration-failed' })
    expect(chamadas).not.toContain('publish')
    expect(chamadas).toContain('cleanup')
    expect(repo.getArtifact(SCOPE, releaseId, 'backend-image')).toBeNull()
  })

  it('erro do registry vira bloqueio com o código, sem mensagem bruta', async () => {
    const r = await preparar(
      servico(composeFalso(), registryFalso(new ArtifactRegistryError('auth', 'token=segredo')))
    )
    expect(r).toMatchObject({ state: 'blocked', reason: 'auth' })
    expect(JSON.stringify(r)).not.toContain('segredo')
    expect(chamadas).toContain('cleanup')
  })
})

describe('build único e limpeza', () => {
  it('segunda preparação da mesma release reutiliza o artefato e não publica de novo', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    chamadas.length = 0
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'prepared', reused: true })
    expect(chamadas).not.toContain('publish')
    expect(chamadas).toContain('resolve')
  })

  it('limpeza que falha não é escondida: fica pendente e registrada', async () => {
    const r = await preparar(servico(composeFalso({ falhaLimpeza: true }), registryFalso()))
    expect(r).toMatchObject({ state: 'prepared', cleanup: 'pending' })
    const falhas = repo.listEffects(SCOPE, releaseId).filter((e) => e.phase === 'failed')
    expect(falhas.map((e) => e.reason)).toContain('cleanup-failed')
  })
})

describe('sentinela secreta (critério 6)', () => {
  it('o valor da chave não aparece no banco, no diário, na auditoria nem no resultado', async () => {
    const r = await preparar(servico(composeFalso(), registryFalso()))
    db.pragma('wal_checkpoint(TRUNCATE)')
    const bytes = readFileSync(join(directory, 'release.db')).toString('latin1')
    expect(bytes).not.toContain(SENTINELA)
    expect(JSON.stringify(r)).not.toContain(SENTINELA)
    expect(JSON.stringify(repo.listEffects(SCOPE, releaseId))).not.toContain(SENTINELA)
    expect(
      JSON.stringify(new AuditRepository(db, 'chave-de-auditoria').list(SCOPE.userId))
    ).not.toContain(SENTINELA)
  })
})
