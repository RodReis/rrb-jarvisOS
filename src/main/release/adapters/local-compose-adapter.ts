import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { portaLivreNoHost } from '../../pipeline/isolamento-host'
import type { SqlExecutor, SqlResult } from '../database-migration-runner'
import type { CommandRunner } from './command-runner'

/**
 * `LocalComposeAdapter` (SPEC-Release-02): sobe, verifica e encerra o Docker Compose oficial.
 * Transporte declarado: `docker compose` + `docker` CLI. Sem fallback para o host: sem Docker, o
 * resultado é um bloqueio com código, nunca uma execução degradada.
 *
 * Posse: tudo que a run cria leva `jarvisos.release-lease=<lease>` e `jarvisos.temporary=true`. A
 * limpeza filtra pelas DUAS marcas; recurso sem a marca temporária (volume persistente) e recurso
 * de outro lease ou de outro projeto nunca são tocados.
 */

export type ComposeBlockCode =
  | 'docker-unavailable'
  | 'docker-not-started'
  | 'port-unavailable'
  | 'compose-failed'
  | 'verify-failed'
  | 'cleanup-failed'

export class ComposeBlockedError extends Error {
  constructor(
    readonly code: ComposeBlockCode,
    message: string
  ) {
    super(message)
    this.name = 'ComposeBlockedError'
  }
}

export interface ServiceProfile {
  readonly context: string
  readonly dockerfile?: string
  readonly containerPort: number
  readonly healthPath: string
  readonly preferredPort: number
}

/** O que o projeto informa ao template único. */
export interface ComposeProfile {
  readonly backend: ServiceProfile
  readonly frontend: ServiceProfile
  readonly postgresPreferredPort: number
}

export interface ComposePorts {
  readonly postgres: number
  readonly backend: number
  readonly frontend: number
}

export interface ComposeAdapterOptions {
  readonly composeFile: string
  /** Liga o Docker quando estiver desligado — só com autorização. */
  readonly autoStartDocker?: boolean
  readonly startDocker?: () => Promise<boolean>
  readonly portFree?: (port: number) => boolean
  readonly sleep?: (ms: number) => Promise<void>
  readonly dockerWaitMs?: number
  readonly healthWaitMs?: number
}

const DOCKER = 'docker'
const LEASE_VALIDO = /^[A-Za-z0-9._-]{8,80}$/
const BASE_DATABASE = /^[a-z_][a-z0-9_]{0,62}$/
const TENTATIVAS_DE_PORTA = 50
const ESPERA_DO_COMPOSE_S = 180
const LABEL_LEASE = 'jarvisos.release-lease'
const LABEL_TEMPORARIO = 'jarvisos.temporary=true'

const dormir = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function iniciarDockerDesktop(): Promise<boolean> {
  const executavel = join(process.env.ProgramFiles ?? '', 'Docker', 'Docker', 'Docker Desktop.exe')
  if (process.platform !== 'win32' || !existsSync(executavel)) return Promise.resolve(false)
  spawn(executavel, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  return Promise.resolve(true)
}

export class LocalComposeAdapter {
  private readonly portFree: (port: number) => boolean
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly runner: CommandRunner,
    private readonly options: ComposeAdapterOptions
  ) {
    this.portFree = options.portFree ?? portaLivreNoHost
    this.sleep = options.sleep ?? dormir
  }

  /** Docker no ar? Se estiver desligado e houver autorização, liga e espera. Senão, bloqueia. */
  async ensureDocker(): Promise<void> {
    if (await this.dockerResponde()) return
    if (!this.options.autoStartDocker || !this.options.startDocker)
      throw new ComposeBlockedError('docker-unavailable', 'O Docker não está disponível.')
    if (!(await this.options.startDocker()))
      throw new ComposeBlockedError('docker-not-started', 'O Docker não pôde ser iniciado.')
    const limite = Date.now() + (this.options.dockerWaitMs ?? 120_000)
    while (Date.now() < limite) {
      await this.sleep(2_000)
      if (await this.dockerResponde()) return
    }
    throw new ComposeBlockedError('docker-not-started', 'O Docker não respondeu após ser iniciado.')
  }

  /** Reserva portas livres (preferida ou a próxima livre). Nunca derruba quem já ocupa a porta. */
  async open(profile: ComposeProfile, leaseId: string): Promise<ComposeEnvironment> {
    if (!LEASE_VALIDO.test(leaseId)) throw new TypeError('Lease inválido para nomear recursos.')
    await this.ensureDocker()
    const publicadas = await this.portasPublicadas()
    const escolhidas = new Set<number>()
    const alocar = (preferida: number): number => {
      for (let i = 0; i < TENTATIVAS_DE_PORTA; i += 1) {
        const candidata = preferida + i
        if (candidata > 65_535) break
        if (publicadas.has(candidata) || escolhidas.has(candidata) || !this.portFree(candidata))
          continue
        escolhidas.add(candidata)
        return candidata
      }
      throw new ComposeBlockedError(
        'port-unavailable',
        `Nenhuma porta livre a partir de ${preferida}.`
      )
    }
    const ports: ComposePorts = {
      postgres: alocar(profile.postgresPreferredPort),
      backend: alocar(profile.backend.preferredPort),
      frontend: alocar(profile.frontend.preferredPort)
    }
    const project = `jarvisrel-${createHash('sha256').update(leaseId).digest('hex').slice(0, 12)}`
    return new ComposeEnvironment(
      this.runner,
      this.options,
      profile,
      leaseId,
      project,
      ports,
      this.sleep
    )
  }

  /** Remove só o que é temporário E pertence ao lease. Falha de remoção vira bloqueio explícito. */
  async cleanup(
    leaseId: string
  ): Promise<{ containers: number; networks: number; volumes: number }> {
    if (!LEASE_VALIDO.test(leaseId)) throw new TypeError('Lease inválido para limpeza.')
    const filtros = [
      '--filter',
      `label=${LABEL_LEASE}=${leaseId}`,
      '--filter',
      `label=${LABEL_TEMPORARIO}`
    ]
    const remover = async (
      listar: readonly string[],
      apagar: readonly string[]
    ): Promise<number> => {
      const ids = (await this.docker([...listar, ...filtros])).stdout.split(/\s+/).filter(Boolean)
      if (ids.length === 0) return 0
      const r = await this.docker([...apagar, ...ids])
      if (r.code !== 0)
        throw new ComposeBlockedError('cleanup-failed', 'A limpeza do lease não terminou.')
      return ids.length
    }
    // Ordem importa: o contêiner prende a rede e o volume.
    const containers = await remover(['ps', '-aq'], ['rm', '-f', '-v'])
    const networks = await remover(['network', 'ls', '-q'], ['network', 'rm'])
    const volumes = await remover(['volume', 'ls', '-q'], ['volume', 'rm'])
    return { containers, networks, volumes }
  }

  private async dockerResponde(): Promise<boolean> {
    try {
      return (await this.docker(['info', '--format', '{{.ServerVersion}}'])).code === 0
    } catch {
      return false
    }
  }

  private async portasPublicadas(): Promise<Set<number>> {
    const r = await this.docker(['ps', '--format', '{{.Ports}}'])
    const portas = new Set<number>()
    for (const [, porta] of r.stdout.matchAll(/:(\d+)->/g)) portas.add(Number(porta))
    return portas
  }

  private docker(args: readonly string[]) {
    return this.runner.run(DOCKER, args, { timeoutMs: 60_000 })
  }
}

export class ComposeEnvironment {
  private readonly senha = randomBytes(18).toString('hex')
  private postgresId: string | null = null

  constructor(
    private readonly runner: CommandRunner,
    private readonly options: ComposeAdapterOptions,
    private readonly profile: ComposeProfile,
    readonly leaseId: string,
    readonly project: string,
    readonly ports: ComposePorts,
    private readonly sleep: (ms: number) => Promise<void>
  ) {}

  /** Postgres primeiro: migrations rodam antes de qualquer candidato ser publicado. */
  async upDatabase(): Promise<void> {
    await this.compose([
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      String(ESPERA_DO_COMPOSE_S),
      'postgres'
    ])
    const r = await this.compose(['ps', '-q', 'postgres'])
    this.postgresId = r.stdout.trim().split(/\s+/)[0] ?? null
    if (!this.postgresId)
      throw new ComposeBlockedError('compose-failed', 'O contêiner do Postgres não foi encontrado.')
  }

  /** Backend pela imagem publicada (por digest) e frontend construído do contexto do projeto. */
  async upApplication(backendImage: string): Promise<void> {
    await this.compose(
      [
        'up',
        '-d',
        '--build',
        '--wait',
        '--wait-timeout',
        String(ESPERA_DO_COMPOSE_S),
        'backend',
        'frontend'
      ],
      { BACKEND_IMAGE: backendImage }
    )
  }

  /** Os três serviços de pé e saudáveis, e HTTP respondendo nas portas reservadas. */
  async verify(): Promise<void> {
    const ps = await this.compose(['ps', '--format', 'json'])
    const servicos = new Map<string, { State?: string; Health?: string }>()
    for (const linha of ps.stdout.split(/\r?\n/).filter(Boolean)) {
      const item = JSON.parse(linha) as { Service: string; State?: string; Health?: string }
      servicos.set(item.Service, item)
    }
    for (const nome of ['postgres', 'backend', 'frontend']) {
      const s = servicos.get(nome)
      if (!s || s.State !== 'running' || (s.Health && s.Health !== 'healthy'))
        throw new ComposeBlockedError('verify-failed', `O serviço ${nome} não está saudável.`)
    }
    await this.esperarHttp(
      `http://127.0.0.1:${this.ports.backend}${this.profile.backend.healthPath}`
    )
    await this.esperarHttp(
      `http://127.0.0.1:${this.ports.frontend}${this.profile.frontend.healthPath}`
    )
  }

  /** Banco do Postgres do run, via `psql` dentro do contêiner (sem senha em argumento). */
  readonly sql: SqlExecutor = {
    run: (sql, database) => this.psql(['--single-transaction', '-d', database], sql),
    dump: async (database, args) => {
      const r = await this.docker([
        'exec',
        this.postgres(),
        'pg_dump',
        '-U',
        'release',
        ...args,
        database
      ])
      if (r.code !== 0) throw new ComposeBlockedError('compose-failed', 'pg_dump falhou.')
      return r.stdout
    }
  }

  async createDatabase(nome: string): Promise<void> {
    if (!BASE_DATABASE.test(nome)) throw new TypeError(`Nome de banco inválido: ${nome}`)
    const r = await this.psql(['-d', 'postgres'], `CREATE DATABASE ${nome} TEMPLATE template0;`)
    if (!r.ok) throw new ComposeBlockedError('compose-failed', 'Não foi possível criar o banco.')
  }

  private postgres(): string {
    if (!this.postgresId)
      throw new ComposeBlockedError('compose-failed', 'O Postgres ainda não foi iniciado.')
    return this.postgresId
  }

  private async psql(extra: readonly string[], sql: string): Promise<SqlResult> {
    const r = await this.docker(
      [
        'exec',
        '-i',
        this.postgres(),
        'psql',
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'release',
        ...extra
      ],
      sql
    )
    return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr }
  }

  private async esperarHttp(url: string): Promise<void> {
    const limite = Date.now() + (this.options.healthWaitMs ?? 30_000)
    for (;;) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3_000) })
        if (r.status === 200) return
      } catch {
        // ainda subindo
      }
      if (Date.now() >= limite)
        throw new ComposeBlockedError(
          'verify-failed',
          `Sem resposta saudável em ${new URL(url).pathname}.`
        )
      await this.sleep(1_000)
    }
  }

  private docker(args: readonly string[], input?: string) {
    return this.runner.run(DOCKER, args, { input, timeoutMs: 120_000, redact: [this.senha] })
  }

  private async compose(args: readonly string[], extraEnv: Record<string, string> = {}) {
    const { backend, frontend } = this.profile
    const resultado = await this.runner.run(
      DOCKER,
      ['compose', '-f', this.options.composeFile, '-p', this.project, ...args],
      {
        timeoutMs: (ESPERA_DO_COMPOSE_S + 60) * 1_000,
        redact: [this.senha],
        env: {
          COMPOSE_PROJECT_NAME: this.project,
          RELEASE_LEASE: this.leaseId,
          POSTGRES_PASSWORD: this.senha,
          PORT_POSTGRES: String(this.ports.postgres),
          PORT_BACKEND: String(this.ports.backend),
          PORT_FRONTEND: String(this.ports.frontend),
          BACKEND_CONTAINER_PORT: String(backend.containerPort),
          FRONTEND_CONTAINER_PORT: String(frontend.containerPort),
          FRONTEND_CONTEXT: frontend.context.replace(/\\/g, '/'),
          FRONTEND_DOCKERFILE: frontend.dockerfile ?? 'Dockerfile',
          BACKEND_IMAGE: 'nao-definida',
          ...extraEnv
        }
      }
    )
    if (resultado.timedOut)
      throw new ComposeBlockedError('compose-failed', 'O compose excedeu o tempo limite.')
    if (resultado.code !== 0) throw new ComposeBlockedError('compose-failed', 'O compose falhou.')
    return resultado
  }
}
