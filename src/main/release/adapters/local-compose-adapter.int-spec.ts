import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest'
import { DatabaseMigrationRunner, lerMigrations } from '../database-migration-runner'
import { createCommandRunner } from './command-runner'
import { GhcrArtifactAdapter } from './ghcr-artifact-adapter'
import { LocalComposeAdapter, type ComposeProfile } from './local-compose-adapter'

/**
 * Docker, Compose e Postgres reais, com nomes e portas exclusivos por execução (SPEC-Release-02,
 * estratégia de testes). O registry é um `registry:2` local: exercita o mesmo caminho do GHCR
 * (build, push, digest, provenance) sem credencial nem efeito externo.
 */

const RAIZ = process.cwd()
const PROJETO = resolve(RAIZ, 'tests/fixtures/release-project')
const COMPOSE = resolve(RAIZ, 'docker/release/compose.yml')
const SUFIXO = randomBytes(4).toString('hex')
const LEASE = `int-lease-${SUFIXO}`
const runner = createCommandRunner({ allowed: ['docker'] })

const PERFIL: ComposeProfile = {
  postgresPreferredPort: 55_600,
  backend: {
    context: resolve(PROJETO, 'backend'),
    containerPort: 3000,
    healthPath: '/health',
    preferredPort: 55_620
  },
  frontend: {
    context: resolve(PROJETO, 'frontend'),
    containerPort: 3001,
    healthPath: '/',
    preferredPort: 55_640
  }
}

let dockerNoAr = false
/** Só existe quando o Docker local não gera provenance sozinho (sem containerd image store). */
let builder: string | undefined
const servidoresDeSonda: Server[] = []
const leasesUsados = new Set<string>([LEASE])

function skipSemDocker(ctx: TestContext): void {
  if (!dockerNoAr) ctx.skip()
}

async function docker(...args: string[]) {
  return runner.run('docker', args, { timeoutMs: 240_000 })
}

async function portaLivre(): Promise<number> {
  return new Promise((ok, erro) => {
    const s = createServer()
    s.once('error', erro)
    s.listen(0, '127.0.0.1', () => {
      const porta = (s.address() as { port: number }).port
      s.close(() => ok(porta))
    })
  })
}

function novoAdapter(): LocalComposeAdapter {
  return new LocalComposeAdapter(runner, { composeFile: COMPOSE })
}

beforeAll(async () => {
  dockerNoAr = (await docker('info', '--format', '{{.ServerVersion}}')).code === 0
  if (!dockerNoAr && process.env.CI)
    throw new Error('Docker não respondeu. No CI o daemon é obrigatório — verifique o runner.')
  if (!dockerNoAr) return
  // Provenance exige containerd image store ou um builder docker-container. Sem o primeiro,
  // cria o segundo (rede do host, para o push em localhost) e o remove no fim.
  const driver = await docker('info', '--format', '{{.DriverStatus}}')
  if (!driver.stdout.includes('io.containerd.snapshotter')) {
    const nome = `jarvisrel-builder-${SUFIXO}`
    const criado = await docker(
      'buildx',
      'create',
      '--name',
      nome,
      '--driver',
      'docker-container',
      '--driver-opt',
      'network=host',
      '--bootstrap'
    )
    if (criado.code !== 0) throw new Error('Não foi possível criar o builder docker-container.')
    builder = nome
  }
}, 240_000)

afterAll(async () => {
  for (const s of servidoresDeSonda) s.close()
  if (!dockerNoAr) return
  if (builder) await docker('buildx', 'rm', '--force', builder)
  for (const lease of leasesUsados) await novoAdapter().cleanup(lease)
}, 180_000)

describe('preparação local com Docker real', () => {
  it('sobe, migra, publica uma vez, roda o publicado e limpa só o que é do lease', async (ctx) => {
    skipSemDocker(ctx)
    const adapter = novoAdapter()
    const env = await adapter.open(PERFIL, LEASE)

    // Registry local para o candidato.
    const portaRegistry = await portaLivre()
    const registry = `localhost:${portaRegistry}`
    const subiu = await docker(
      'run',
      '-d',
      '--name',
      `jarvisrel-reg-${SUFIXO}`,
      '--label',
      `jarvisos.release-lease=${LEASE}`,
      '--label',
      'jarvisos.temporary=true',
      '-p',
      `127.0.0.1:${portaRegistry}:5000`,
      'registry:2'
    )
    expect(subiu.code).toBe(0)

    await env.upDatabase()
    const migrations = lerMigrations(resolve(PROJETO, 'migrations'))
    const seed = (await import('node:fs')).readFileSync(resolve(PROJETO, 'seed.sql'), 'utf8')
    const runnerDeMigration = new DatabaseMigrationRunner(env.sql)

    // Critério 2: duas execuções do zero produzem o mesmo banco.
    await env.createDatabase('prova_a')
    await env.createDatabase('prova_b')
    const a = await runnerDeMigration.apply({ database: 'prova_a', migrations, seed })
    const b = await runnerDeMigration.apply({ database: 'prova_b', migrations, seed })
    expect(a).toMatchObject({ state: 'confirmed', seedApplied: true })
    expect(b).toMatchObject({ state: 'confirmed' })
    expect(a.state === 'confirmed' && b.state === 'confirmed' && a.fingerprint).toBe(
      b.state === 'confirmed' ? b.fingerprint : null
    )
    // Reexecutar não reaplica nada.
    expect(await runnerDeMigration.apply({ database: 'prova_a', migrations, seed })).toMatchObject({
      state: 'confirmed',
      applied: [],
      seedApplied: false
    })
    const itens = await env.sql.run('SELECT count(*) FROM itens;', 'prova_a')
    expect(itens.stdout.trim()).toBe('3')

    // Critérios 3 e 4: build único, digest persistível, consulta posterior idêntica.
    const ghcr = new GhcrArtifactAdapter(runner, registry, builder)
    const publicado = await ghcr.publish({
      repository: `${registry}/prova/backend`,
      contextDir: PERFIL.backend.context,
      sourceSha: 'a'.repeat(40)
    })
    expect(publicado.uri).toBe(`${registry}/prova/backend@${publicado.digest}`)
    expect(await ghcr.resolve(publicado.uri)).toEqual(publicado)

    // O que sobe é o publicado, por digest; frontend e backend respondem (critério 1).
    await env.upApplication(publicado.uri)
    await env.verify()

    // Critério 8: a limpeza remove os recursos do lease e nada mais.
    const antes = await docker('ps', '-aq', '--filter', `label=jarvisos.release-lease=${LEASE}`)
    expect(antes.stdout.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4)
    const limpeza = await adapter.cleanup(LEASE)
    expect(limpeza.containers).toBeGreaterThanOrEqual(4)
    const depois = await docker('ps', '-aq', '--filter', `label=jarvisos.release-lease=${LEASE}`)
    expect(depois.stdout.trim()).toBe('')
    const redes = await docker(
      'network',
      'ls',
      '-q',
      '--filter',
      `label=jarvisos.release-lease=${LEASE}`
    )
    expect(redes.stdout.trim()).toBe('')
    const volumes = await docker(
      'volume',
      'ls',
      '-q',
      '--filter',
      `label=jarvisos.release-lease=${LEASE}`
    )
    expect(volumes.stdout.trim()).toBe('')
  }, 600_000)

  it('migration quebrada falha com código e não deixa o banco meio-migrado', async (ctx) => {
    skipSemDocker(ctx)
    const lease = `int-quebra-${SUFIXO}`
    leasesUsados.add(lease)
    const env = await novoAdapter().open(
      {
        ...PERFIL,
        postgresPreferredPort: 55_700,
        backend: { ...PERFIL.backend, preferredPort: 55_720 },
        frontend: { ...PERFIL.frontend, preferredPort: 55_740 }
      },
      lease
    )
    await env.upDatabase()
    await env.createDatabase('quebra')
    const r = await new DatabaseMigrationRunner(env.sql).apply({
      database: 'quebra',
      migrations: lerMigrations(resolve(PROJETO, 'migrations-quebradas'))
    })
    expect(r).toMatchObject({ state: 'failed', reason: 'migration-failed', failedAt: '002_quebra' })
    // A transação da migration quebrada voltou: `tabela_ok` não existe.
    const tabela = await env.sql.run(`SELECT to_regclass('public.tabela_ok');`, 'quebra')
    expect(tabela.stdout.trim()).toBe('')
    await novoAdapter().cleanup(lease)
  }, 300_000)
})

describe('isolamento de portas e posse', () => {
  it('porta ocupada gera outra porta; contêiner alheio e volume persistente sobrevivem à limpeza', async (ctx) => {
    skipSemDocker(ctx)
    const lease = `int-posse-${SUFIXO}`
    const alheio = `int-alheio-${SUFIXO}`
    leasesUsados.add(lease)
    leasesUsados.add(alheio)

    // 1) Ocupa a porta preferida do Postgres no host.
    const ocupada = await portaLivre()
    const sonda = createServer()
    await new Promise<void>((ok) => sonda.listen(ocupada, '127.0.0.1', ok))
    servidoresDeSonda.push(sonda)

    // 2) Contêiner alheio (outro lease, temporário) e volume persistente do MESMO lease.
    const estrangeiro = await docker(
      'run',
      '-d',
      '--name',
      `jarvisrel-alheio-${SUFIXO}`,
      '--label',
      `jarvisos.release-lease=${alheio}`,
      '--label',
      'jarvisos.temporary=true',
      'alpine:3.20',
      'sleep',
      '600'
    )
    expect(estrangeiro.code).toBe(0)
    const persistente = `jarvisrel-persistente-${SUFIXO}`
    expect(
      (await docker('volume', 'create', '--label', `jarvisos.release-lease=${lease}`, persistente))
        .code
    ).toBe(0)

    const env = await novoAdapter().open(
      {
        ...PERFIL,
        postgresPreferredPort: ocupada,
        backend: { ...PERFIL.backend, preferredPort: 55_820 },
        frontend: { ...PERFIL.frontend, preferredPort: 55_840 }
      },
      lease
    )
    expect(env.ports.postgres).not.toBe(ocupada)

    await env.upDatabase()
    await novoAdapter().cleanup(lease)

    const vivo = await docker('ps', '-q', '--filter', `name=jarvisrel-alheio-${SUFIXO}`)
    expect(vivo.stdout.trim()).not.toBe('')
    const volume = await docker('volume', 'ls', '-q', '--filter', `name=${persistente}`)
    expect(volume.stdout.trim()).toBe(persistente)
    const dele = await docker('ps', '-aq', '--filter', `label=jarvisos.release-lease=${lease}`)
    expect(dele.stdout.trim()).toBe('')

    await docker('rm', '-f', `jarvisrel-alheio-${SUFIXO}`)
    await docker('volume', 'rm', persistente)
  }, 300_000)
})
