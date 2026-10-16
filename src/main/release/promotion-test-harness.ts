import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import {
  fingerprintDeConfiguracao,
  type ConfigurationProbe
} from './configuration-reference-validator'
import type { MigrationFile } from './database-migration-runner'
import { FakeClock, FakePromotionCloud } from './promotion-test-doubles'
import type { PromotionProject } from './release-promotion-effects'
import { ReleaseLocalRepository } from './release-local-repository'
import { ReleasePromotionRepository } from './release-promotion-repository'
import { PromotionService } from './release-promotion-service'
import { ReleaseCorrectionDispatcher, type CorrectionRequest } from './correction/dispatcher'
import { ReleaseRecoveryRepository } from './release-recovery-repository'
import { ReleaseRepository } from './release-repository'

/**
 * Montagem dos testes de integração da promoção: SQLite real, relógio injetado e a nuvem falsa
 * com estado. Cada teste ganha um mundo novo; projetos diferentes compartilham a mesma nuvem
 * (como na produção), então um vazamento entre projetos aparece como asserção quebrada.
 */

export const SCOPE: ReleaseScope = {
  userId: 'user-1',
  workspaceId: 'jarvis',
  projectId: 'project-1'
}
export const OUTRO_PROJETO: ReleaseScope = { ...SCOPE, projectId: 'project-2' }
export const SHA_A = 'a'.repeat(40)
export const SHA_B = 'b'.repeat(40)
export const SHA_C = 'c'.repeat(40)

const CHAVE_DE_FINGERPRINT = 'chave-de-fingerprint-da-promocao'
const MIGRATIONS: readonly MigrationFile[] = [
  { id: '001_init', sql: 'select 1', checksum: '1'.repeat(64) },
  { id: '002_users', sql: 'select 2', checksum: '2'.repeat(64) }
]

/** Valores por ambiente; a sonda devolve só "existe?" e o fingerprint, nunca o valor. */
export type ValoresDeConfig = Record<'staging' | 'production', Record<string, string>>

export const CONFIG_VALIDA: ValoresDeConfig = {
  staging: { DATABASE_URL: 'postgres://staging', API_TOKEN: 'token-staging' },
  production: { DATABASE_URL: 'postgres://producao', API_TOKEN: 'token-producao' }
}

export function sonda(valores: ValoresDeConfig): ConfigurationProbe {
  return (ambiente, nome) => {
    const valor = (valores as Record<string, Record<string, string>>)[ambiente]?.[nome]
    return valor === undefined
      ? { present: false }
      : { present: true, fingerprint: fingerprintDeConfiguracao(CHAVE_DE_FINGERPRINT, nome, valor) }
  }
}

export function projeto(
  valores: ValoresDeConfig = CONFIG_VALIDA,
  extra: Partial<PromotionProject> = {}
): PromotionProject {
  return {
    migrations: MIGRATIONS,
    configuration: {
      names: ['DATABASE_URL', 'API_TOKEN'],
      isolated: ['DATABASE_URL'],
      load: async () => sonda(valores)
    },
    ...extra
  }
}

/** O processo morreu: nada do que vier depois acontece. */
export class SimulatedCrash extends Error {
  constructor() {
    super('processo encerrado (morte simulada)')
    this.name = 'SimulatedCrash'
  }
}

const LEITURA =
  /^(get|list|last|open|assert|find|read|queue$|detail$|timeline$|inclusions$|evidence$|active|cancellation$|manifest$|publication$|pending|correction|rollbacks$|spec|has|is)/

/**
 * Mata o processo na `at`-ésima gravação (antes ou depois de ela chegar ao banco). Embrulha os
 * repositórios e as portas de nuvem: depois da morte, qualquer chamada lança — inclusive a
 * limpeza do `finally`, que num processo morto não rodaria. Leituras não contam.
 */
export class ProcessKiller {
  calls = 0
  dead = false

  constructor(
    private readonly at: number,
    private readonly when: 'before' | 'after'
  ) {}

  wrap<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (alvo, prop, recebedor) => {
        const valor: unknown = Reflect.get(alvo, prop, recebedor)
        if (typeof valor !== 'function' || typeof prop !== 'string') return valor
        const metodo = valor.bind(alvo) as (...args: unknown[]) => unknown
        const leitura = LEITURA.test(prop)
        return (...args: unknown[]) => {
          if (this.dead) throw new SimulatedCrash()
          if (leitura) return metodo(...args)
          this.calls += 1
          const aqui = this.calls === this.at
          if (aqui && this.when === 'before') {
            this.dead = true
            throw new SimulatedCrash()
          }
          const resultado = metodo(...args)
          if (aqui && this.when === 'after') {
            this.dead = true
            throw new SimulatedCrash()
          }
          return resultado
        }
      }
    })
  }

  /** Porta de nuvem: não grava nada no contador, mas um processo morto não a chama. */
  guard<T extends object>(porta: T): T {
    return new Proxy(porta, {
      get: (alvo, prop, recebedor) => {
        const valor: unknown = Reflect.get(alvo, prop, recebedor)
        if (typeof valor !== 'function') return valor
        const metodo = valor.bind(alvo) as (...args: unknown[]) => unknown
        return (...args: unknown[]) => {
          if (this.dead) throw new SimulatedCrash()
          return metodo(...args)
        }
      }
    })
  }
}

export interface Harness {
  readonly db: Database
  readonly audit: AuditRepository
  readonly repository: ReleaseRepository
  readonly promotion: ReleasePromotionRepository
  readonly local: ReleaseLocalRepository
  readonly recovery: ReleaseRecoveryRepository
  /** A V2 falsa: guarda cada pedido de correção e pode ser derrubada com `falha`. */
  readonly v2: { readonly pedidos: CorrectionRequest[]; falha: Error | null }
  readonly dispatcher: ReleaseCorrectionDispatcher
  readonly clock: FakeClock
  readonly cloud: FakePromotionCloud
  readonly service: PromotionService
  /** Serviço novo sobre o mesmo banco e a mesma nuvem: simula o app reaberto depois de um crash. */
  novoServico(opcoes?: {
    sleep?: (ms: number) => Promise<void>
    ownerId?: string
  }): PromotionService
  /**
   * Serviço de OUTRO projeto: mesmo banco local, nuvem própria. Na produção cada projeto tem seu
   * Railway/Vercel (os adapters são instanciados por projeto), então a nuvem não é compartilhada.
   */
  outroProjeto(): { readonly service: PromotionService; readonly cloud: FakePromotionCloud }
  fechar(): void
}

export function montarHarness(
  opcoes: {
    sleep?: (ms: number) => Promise<void>
    leaseMs?: number
    /** O serviço principal morre quando o `ProcessKiller` mandar; `novoServico` é o processo seguinte. */
    morte?: ProcessKiller
  } = {}
): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'release-promotion-svc-'))
  const db = openDatabase(join(directory, 'release.db'))
  const audit = new AuditRepository(db, 'chave-de-auditoria-da-promocao')
  const repository = new ReleaseRepository(db, audit)
  const promotion = new ReleasePromotionRepository(db, audit)
  const local = new ReleaseLocalRepository(db, audit)
  const recovery = new ReleaseRecoveryRepository(db, audit)
  const clock = new FakeClock()
  const cloud = new FakePromotionCloud()
  const v2: Harness['v2'] = { pedidos: [], falha: null }
  const dispatcher = new ReleaseCorrectionDispatcher({
    repository,
    recovery,
    now: clock.now,
    v2: {
      open: async (pedido) => {
        if (v2.falha) throw v2.falha
        v2.pedidos.push(pedido)
        return { runId: `run-${v2.pedidos.length}` }
      }
    }
  })
  const criar = (
    o: { sleep?: (ms: number) => Promise<void>; ownerId?: string } = {},
    nuvem: FakePromotionCloud = cloud,
    morte?: ProcessKiller
  ) => {
    const m = morte
    return new PromotionService({
      repository: m ? m.wrap(repository) : repository,
      promotion: m ? m.wrap(promotion) : promotion,
      local: m ? m.wrap(local) : local,
      recovery: m ? m.wrap(recovery) : recovery,
      correction: dispatcher,
      build: m ? m.guard(nuvem.buildPort(local)) : nuvem.buildPort(local),
      backend: m ? m.guard(nuvem.backend) : nuvem.backend,
      database: m ? m.guard(nuvem.database) : nuvem.database,
      frontend: m ? m.guard(nuvem.frontend) : nuvem.frontend,
      verifier: m ? m.guard(nuvem.verifier) : nuvem.verifier,
      now: clock.now,
      nowMs: clock.nowMs,
      sleep: o.sleep ?? opcoes.sleep ?? clock.sleep,
      ownerId: o.ownerId ?? 'executor-1',
      ...(opcoes.leaseMs ? { leaseMs: opcoes.leaseMs } : {})
    })
  }
  return {
    db,
    audit,
    repository,
    promotion,
    local,
    recovery,
    v2,
    dispatcher,
    clock,
    cloud,
    service: criar({}, cloud, opcoes.morte),
    novoServico: (o) => criar(o),
    outroProjeto: () => {
      const nuvem = new FakePromotionCloud()
      // O sleep do teste pode estar travado para o projeto 1; o outro projeto anda por conta própria.
      return { cloud: nuvem, service: criar({ sleep: clock.sleep, ownerId: 'executor-2' }, nuvem) }
    },
    fechar: () => {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

/**
 * Deixa uma release anterior **concluída** com deployments nos dois ambientes e a nuvem servindo
 * exatamente isso — o "estado conhecido" para onde a compensação volta.
 */
export function semearReleaseConcluida(h: Harness, scope: ReleaseScope = SCOPE): void {
  const sha = 'f'.repeat(40)
  const id = h.repository.enqueue(scope, sha, h.clock.now()).release.id
  const digest = `sha256:${'9'.repeat(64)}`
  for (const environment of ['staging', 'production'] as const) {
    h.promotion.recordDeployment(
      scope,
      id,
      {
        environment,
        kind: 'backend',
        artifactDigest: digest,
        externalId: `rw-${environment}-antigo`,
        replacesExternalId: null
      },
      h.clock.now()
    )
    h.promotion.recordDeployment(
      scope,
      id,
      {
        environment,
        kind: 'frontend',
        artifactDigest: `sha256:${'8'.repeat(64)}`,
        externalId: 'dpl_antigo',
        replacesExternalId: null
      },
      h.clock.now()
    )
    h.cloud.backends.set(environment, { deploymentId: `rw-${environment}-antigo`, digest })
    h.cloud.backendHistory.push({ environment, deploymentId: `rw-${environment}-antigo`, digest })
    h.cloud.frontendAssigned.set(environment, 'dpl_antigo')
    h.cloud.databases.set(environment, ['001_init'])
  }
  const insert = h.db.prepare(
    `INSERT INTO release_step
       (user_id,workspace_id,project_id,release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'confirmed', 1, ?)`
  )
  for (const environment of ['staging', 'production'])
    for (const passo of [
      'prepared',
      'database_migrated',
      'backend_healthy',
      'frontend_promoted',
      'smoke_passed'
    ])
      insert.run(
        scope.userId, scope.workspaceId, scope.projectId, id, environment, passo,
        `${environment}:${passo}`, 'e'.repeat(64), h.clock.now()
      ) // prettier-ignore
  for (const status of ['preparing', 'staging', 'production', 'stabilizing', 'completed'])
    h.db.prepare(`UPDATE release_run SET status=? WHERE id=?`).run(status, id)
}
