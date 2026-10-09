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
  type RegistryPort,
  type SourcePort
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

const publicacoes: Array<{ dockerfile?: string; contextDir: string }> = []

function registryFalso(
  erro?: ArtifactRegistryError,
  resolvido?: { digest?: string; provenanceDigest?: string }
): RegistryPort {
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
    async publish(input) {
      chamadas.push('publish')
      publicacoes.push({ dockerfile: input.dockerfile, contextDir: input.contextDir })
      if (erro) throw erro
      return artefato
    },
    async resolve() {
      chamadas.push('resolve')
      return {
        ...artefato,
        digest: resolvido?.digest ?? artefato.digest,
        provenance: {
          ...artefato.provenance,
          provenanceDigest: resolvido?.provenanceDigest ?? artefato.provenance.provenanceDigest
        }
      }
    }
  }
}

let origem: Awaited<ReturnType<SourcePort['verify']>> = 'ok'

function servico(compose: ComposePort, registry: RegistryPort): ReleasePreparationService {
  const fonte: SourcePort = {
    async verify() {
      chamadas.push('source')
      return origem
    }
  }
  return new ReleasePreparationService(
    repo,
    compose,
    registry,
    fonte,
    'chave-de-fingerprint',
    () => NOW
  )
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'release-prep-'))
  db = openDatabase(join(directory, 'release.db'))
  const audit = new AuditRepository(db, 'chave-de-auditoria')
  repo = new ReleaseLocalRepository(db, audit)
  releaseId = new ReleaseRepository(db, audit).enqueue(SCOPE, 'c'.repeat(40), NOW).release.id
  lease = { leaseId: 'lease-0123456789', ownerId: 'dono', fencingToken: 1 }
  chamadas = []
  origem = 'ok'
  publicacoes.length = 0
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
  mkdirSync(join(directory, 'backend'))
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
      'source',
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

describe('falha inesperada depois de subir o banco (H1)', () => {
  it('erro do Node com code em maiúsculas vira bloqueio e a limpeza ainda roda', async () => {
    writeFileSync(join(directory, 'seed.sql'), 'x')
    projeto = { ...projeto, migrationsDir: join(directory, 'nao-existe') }
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', reason: 'migration-failed', cleanup: 'done' })
    expect(chamadas).toContain('cleanup')
    expect(chamadas).not.toContain('publish')
  })

  it('o motivo gravado no diário é um código da lista, nunca o code cru do erro', async () => {
    projeto = { ...projeto, migrationsDir: join(directory, 'nao-existe') }
    await preparar(servico(composeFalso(), registryFalso()))
    const motivos = repo
      .listEffects(SCOPE, releaseId)
      .map((e) => e.reason)
      .filter(Boolean)
    expect(motivos).toContain('migration-failed')
    expect(motivos.join(' ')).not.toMatch(/ENOENT/i)
  })

  it('limpeza que falha junto com o bloqueio fica pendente e traz o lease para reconciliar', async () => {
    projeto = { ...projeto, migrationsDir: join(directory, 'nao-existe') }
    const r = await preparar(servico(composeFalso({ falhaLimpeza: true }), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', cleanup: 'pending', leaseId: lease.leaseId })
    const refs = repo.listEffects(SCOPE, releaseId).map((e) => e.externalRef)
    expect(refs).toContain(`lease:${lease.leaseId}`)
  })
})

describe('origem do build e segredo no contexto', () => {
  it('contexto que não é o commit da release bloqueia antes de abrir o Docker', async () => {
    origem = 'source-mismatch'
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', reason: 'source-mismatch' })
    expect(chamadas).not.toContain('open')
    expect(chamadas).not.toContain('publish')
  })

  it('árvore suja bloqueia', async () => {
    origem = 'source-dirty'
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', reason: 'source-dirty' })
  })

  it('.env.local dentro do contexto, sem .dockerignore, bloqueia: iria para a imagem publicada', async () => {
    writeFileSync(join(directory, 'backend', '.env.local'), 'X=1')
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', reason: 'secret-in-context' })
    expect(chamadas).not.toContain('open')
  })

  it('contexto inexistente bloqueia em vez de lançar', async () => {
    projeto = { ...projeto, contextDir: join(directory, 'nao-existe') }
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', reason: 'source-mismatch' })
  })

  it('com o artefato já gravado não há build, então nada disso é exigido', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    origem = 'source-dirty'
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'prepared', reused: true })
  })

  it('.env.example com valor bloqueia com código e não ecoa o conteúdo', async () => {
    writeFileSync(projeto.envExampleFile, 'API_TOKEN=valor-que-nao-pode-aparecer\n')
    const r = await preparar(servico(composeFalso(), registryFalso()))
    expect(r).toMatchObject({ state: 'blocked', reason: 'configuration-invalid' })
    expect(JSON.stringify(r)).not.toContain('valor-que-nao-pode-aparecer')
  })
})

describe('Dockerfile do perfil (M3)', () => {
  it('o Dockerfile informado no perfil chega ao build, relativo ao contexto', async () => {
    projeto = {
      ...projeto,
      profile: {
        ...PROFILE,
        backend: {
          ...PROFILE.backend,
          context: join(directory, 'backend'),
          dockerfile: 'docker/Dockerfile.prod'
        }
      }
    }
    await preparar(servico(composeFalso(), registryFalso()))
    expect(publicacoes[0]?.dockerfile).toBe(join(directory, 'backend', 'docker/Dockerfile.prod'))
  })

  it('sem Dockerfile no perfil o build usa o padrão do contexto', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    expect(publicacoes[0]?.dockerfile).toBeUndefined()
  })
})

describe('reuso do artefato (L1)', () => {
  it('digest que o registry devolve diferente do gravado bloqueia', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    const r = await preparar(
      servico(composeFalso(), registryFalso(undefined, { digest: `sha256:${'e'.repeat(64)}` }))
    )
    expect(r).toMatchObject({ state: 'blocked', reason: 'digest-mismatch' })
  })

  it('provenance diferente da gravada bloqueia: o critério 4 exige digest E provenance', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    const r = await preparar(
      servico(
        composeFalso(),
        registryFalso(undefined, { provenanceDigest: `sha256:${'9'.repeat(64)}` })
      )
    )
    expect(r).toMatchObject({ state: 'blocked', reason: 'digest-mismatch' })
  })

  it('reutilizar o artefato deixa rastro no diário', async () => {
    await preparar(servico(composeFalso(), registryFalso()))
    const antes = repo.listEffects(SCOPE, releaseId).filter((e) => e.kind === 'artifact').length
    await preparar(servico(composeFalso(), registryFalso()))
    const depois = repo.listEffects(SCOPE, releaseId).filter((e) => e.kind === 'artifact').length
    expect(depois).toBeGreaterThan(antes)
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
