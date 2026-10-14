import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GATES_OBRIGATORIOS } from '@shared/domain/release-promotion'
import {
  CONFIG_VALIDA,
  SCOPE,
  SHA_A,
  montarHarness,
  projeto,
  type Harness
} from './promotion-test-harness'

let h: Harness

beforeEach(() => {
  h = montarHarness()
})

afterEach(() => h.fechar())

const passos = (releaseId: string, environment: 'staging' | 'production') =>
  h.repository
    .detail({ ...SCOPE, releaseId })!
    .steps.filter((s) => s.environment === environment)
    .map((s) => `${s.step}:${s.state}`)

describe('caminho feliz: merge → Staging → Produção → estabilização', () => {
  it('um merge elegível chega a completed sem nenhuma intervenção adicional (critérios 1 e 9)', async () => {
    const resultado = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(resultado).toMatchObject({ state: 'completed', status: 'completed', reason: null })
    const diario = [
      'prepared:confirmed',
      'database_migrated:confirmed',
      'backend_healthy:confirmed',
      'frontend_promoted:confirmed',
      'smoke_passed:confirmed'
    ]
    expect(passos(resultado.releaseId, 'staging')).toEqual(diario)
    expect(passos(resultado.releaseId, 'production')).toEqual(diario)
  })

  it('Staging e Produção registram o mesmo backend_digest e o mesmo frontend_deployment_id (critério 2)', async () => {
    const { releaseId } = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const lista = h.promotion.listDeployments(SCOPE, releaseId)
    const por = (environment: string, kind: string) =>
      lista.find((d) => d.environment === environment && d.kind === kind)!

    expect(por('staging', 'backend').artifactDigest).toBe(
      por('production', 'backend').artifactDigest
    )
    expect(por('staging', 'frontend').externalId).toBe(por('production', 'frontend').externalId)
    // O digest registrado é o que está de fato servindo nos dois ambientes.
    expect(h.cloud.backends.get('staging')!.digest).toBe(por('staging', 'backend').artifactDigest)
    expect(h.cloud.backends.get('production')!.digest).toBe(
      por('staging', 'backend').artifactDigest
    )
    expect(h.cloud.frontendAssigned.get('production')).toBe(h.cloud.frontendAssigned.get('staging'))
  })

  it('contrafactual: não há rebuild entre ambientes — uma imagem e um frontend construídos', async () => {
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(h.cloud.builds).toBe(1)
    expect(h.cloud.calls.filter((c) => c === 'build.backend')).toHaveLength(1)
    expect(h.cloud.calls.filter((c) => c === 'frontend.build')).toHaveLength(1)
  })

  it('Staging termina antes de qualquer efeito em Produção (regra 1)', async () => {
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const ultimoStaging = Math.max(
      ...h.cloud.calls.flatMap((c, i) => (c.endsWith(':staging') ? [i] : []))
    )
    const primeiroProducao = h.cloud.calls.findIndex((c) => c.endsWith(':production'))
    expect(primeiroProducao).toBeGreaterThan(ultimoStaging)
  })

  it('todos os gates obrigatórios dos dois ambientes passam', async () => {
    const { releaseId } = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const gates = h.repository.detail({ ...SCOPE, releaseId })!.gates
    for (const environment of ['staging', 'production'] as const)
      for (const nome of GATES_OBRIGATORIOS[environment])
        expect(
          gates.filter((g) => g.environment === environment && g.gate === nome).at(-1)?.result
        ).toBe('passed')
  })

  it('chamar de novo uma release concluída não repete nenhum efeito', async () => {
    const { releaseId } = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const chamadas = h.cloud.calls.length
    const outra = await h.service.promote(SCOPE, releaseId, projeto())
    expect(outra).toMatchObject({ state: 'completed', releaseId })
    expect(h.cloud.calls).toHaveLength(chamadas)
  })

  it('a estabilização observa a saúde por cinco minutos antes de concluir', async () => {
    const inicio = h.clock.nowMs()
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    expect(h.clock.nowMs() - inicio).toBe(5 * 60_000)
  })

  it('nenhuma etapa depende de aprovação humana: a auditoria só tem transições técnicas (critério 9)', async () => {
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const tipos = h.audit.list(SCOPE.userId).map((e) => e.type)
    expect(tipos.length).toBeGreaterThan(0)
    for (const tipo of tipos) expect(['release-transition', 'release-local-effect']).toContain(tipo)
  })

  it('não cria tag, release nem tocou em nada além das portas de infraestrutura (critério 10)', async () => {
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const operacoes = new Set(h.cloud.calls.map((c) => c.split(':')[0]))
    expect(operacoes).toEqual(
      new Set([
        'build.backend',
        'frontend.build',
        'database.backup',
        'database.migrate',
        'backend.deploy',
        'frontend.assign',
        'verifier.verify'
      ])
    )
  })
})

describe('configuração (critério 3)', () => {
  const semEfeito = () => {
    const efeitos = h.cloud.calls.filter((c) => !c.startsWith('verifier'))
    expect(efeitos).toEqual([])
  }

  it('chave ausente em Produção bloqueia a release antes de qualquer efeito', async () => {
    const valores = {
      ...CONFIG_VALIDA,
      production: { DATABASE_URL: 'postgres://producao' } // falta API_TOKEN
    }
    const resultado = await h.service.handleMerge(SCOPE, SHA_A, projeto(valores))

    expect(resultado).toMatchObject({ state: 'failed', reason: 'config-missing', status: 'failed' })
    semEfeito()
    const gates = h.repository.detail({ ...SCOPE, releaseId: resultado.releaseId })!.gates
    expect(gates.find((g) => g.gate === 'configuration')).toMatchObject({
      result: 'blocked',
      reason: 'config-missing'
    })
  })

  it('banco compartilhado entre Staging e Produção (chave de isolamento igual) bloqueia antes do efeito', async () => {
    const valores = {
      staging: { DATABASE_URL: 'postgres://mesmo', API_TOKEN: 'a' },
      production: { DATABASE_URL: 'postgres://mesmo', API_TOKEN: 'b' }
    }
    const resultado = await h.service.handleMerge(SCOPE, SHA_A, projeto(valores))

    expect(resultado).toMatchObject({ state: 'failed', reason: 'config-shared-value' })
    semEfeito()
  })

  it('valor diferente em chave que não é de isolamento não bloqueia', async () => {
    const resultado = await h.service.handleMerge(SCOPE, SHA_A, projeto(CONFIG_VALIDA))
    expect(resultado.state).toBe('completed')
  })

  it('grava só nome e fingerprint das referências, nunca o valor', async () => {
    const { releaseId } = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const referencias = h.local.listConfigurationReferences(SCOPE, releaseId)
    expect(referencias.length).toBe(4)
    const banco = JSON.stringify(
      h.db.prepare('SELECT * FROM release_configuration_reference').all()
    )
    for (const valor of [
      'postgres://staging',
      'postgres://producao',
      'token-staging',
      'token-producao'
    ])
      expect(banco).not.toContain(valor)
  })
})

describe('backup e migration de Produção (critério 4)', () => {
  it('o backup confirmado precede a migration de Produção, e Staging não tem backup', async () => {
    await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const calls = h.cloud.calls
    expect(calls.indexOf('database.backup:production')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('database.backup:production')).toBeLessThan(
      calls.indexOf('database.migrate:production')
    )
    expect(calls).not.toContain('database.backup:staging')
  })

  it('a referência do backup fica gravada nas migrations de Produção, e só nelas', async () => {
    const { releaseId } = await h.service.handleMerge(SCOPE, SHA_A, projeto())
    const migrations = h.promotion.listMigrations(SCOPE, releaseId)
    expect(
      migrations.filter((m) => m.environment === 'production').map((m) => m.backupRef)
    ).toEqual(['bkp-production-1', 'bkp-production-1'])
    expect(
      migrations.filter((m) => m.environment === 'staging').every((m) => m.backupRef === null)
    ).toBe(true)
    expect(migrations.every((m) => m.state === 'confirmed')).toBe(true)
  })

  it('contrafactual: backup que falha impede a migration e a release não conclui', async () => {
    h.cloud.failOn('database.backup:production', 'failed', 5)
    const resultado = await h.service.handleMerge(SCOPE, SHA_A, projeto())

    expect(resultado.state).toBe('failed')
    expect(resultado.reason).toBe('database_migrated-failed')
    expect(h.cloud.calls).not.toContain('database.migrate:production')
    expect(h.cloud.databases.get('production') ?? []).toEqual([])
    const gate = h.repository
      .detail({ ...SCOPE, releaseId: resultado.releaseId })!
      .gates.find((g) => g.gate === 'backup')
    expect(gate).toMatchObject({ environment: 'production', result: 'blocked' })
  })
})
