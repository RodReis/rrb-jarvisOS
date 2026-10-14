import { describe, expect, it } from 'vitest'
import { PromotionProviderError } from '../promotion-ports'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import { BARRA_INVERTIDA } from './railway-database-adapter'
import {
  RailwayPromotionDatabaseAdapter,
  type RailwayPromotionDatabaseConfig
} from './railway-promotion-database-adapter'

const TOKEN = 'tok_SEGREDO_DO_PROVEDOR_123'
const SENHA = 'senha-do-banco-persistente'

const CONFIG: RailwayPromotionDatabaseConfig = {
  workdir: 'C:/trabalho/railway',
  token: TOKEN,
  environments: { staging: 'staging', production: 'production' },
  databaseService: 'postgres'
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const erro = (stderr: string, code = 1): CommandResult => ({
  code,
  stdout: '',
  stderr,
  timedOut: false
})
const tempo: CommandResult = { code: null, stdout: '', stderr: '', timedOut: true }

interface Chamada {
  binary: string
  args: readonly string[]
  options?: CommandOptions
}

const comecaCom = (c: Chamada, ...prefixo: string[]): boolean =>
  prefixo.every((p, i) => c.args[i] === p)

function runnerDe(roteiro: (chamada: Chamada) => CommandResult) {
  const chamadas: Chamada[] = []
  const runner: CommandRunner = {
    async run(binary, args, options) {
      const chamada = { binary, args: [...args], options }
      chamadas.push(chamada)
      return roteiro(chamada)
    }
  }
  return { runner, chamadas }
}

const VARIAVEIS = JSON.stringify({
  RAILWAY_TCP_PROXY_DOMAIN: 'proxy.rlwy.net',
  RAILWAY_TCP_PROXY_PORT: '12345',
  PGUSER: 'postgres',
  PGPASSWORD: SENHA,
  PGDATABASE: 'railway'
})

/** Railway + psql falsos: o `psql` é roteirizado pelo teste; o resto responde como um projeto sadio. */
function banco(psql: (c: Chamada) => CommandResult, proxyAberto = false) {
  return runnerDe((c) => {
    if (c.binary === 'railway' && comecaCom(c, 'tcp-proxy', 'list'))
      return ok(proxyAberto ? '[{"domain":"proxy.rlwy.net"}]' : '[]')
    if (c.binary === 'railway' && comecaCom(c, 'tcp-proxy', 'create')) return ok('{}')
    if (c.binary === 'railway' && comecaCom(c, 'variable', 'list')) return ok(VARIAVEIS)
    return psql(c)
  })
}

const entrada = {
  environment: 'production' as const,
  migrations: [{ id: '001_base', sql: 'CREATE TABLE t(id int);', checksum: 'c'.repeat(64) }]
}

const sqlDe = (c: Chamada): string => (c.options?.input ?? '').toString()
const rodar = <T>(p: Promise<T>) => p.catch((e: unknown) => e)

/** Banco vazio e saudável: nada aplicado, dump trivial. */
const psqlSaudavel = (c: Chamada): CommandResult =>
  c.binary === 'pg_dump' ? ok('-- dump\nCREATE TABLE t(id int);') : ok('')

describe('RailwayPromotionDatabaseAdapter.migrate', () => {
  it('aplica as migrations pela conexão do próprio ambiente, com a senha só no env', async () => {
    const { runner, chamadas } = banco(psqlSaudavel)

    const r = await new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)

    expect(r).toMatchObject({ state: 'confirmed', applied: ['001_base'], seedApplied: false })
    const doBanco = chamadas.filter((c) => c.binary === 'psql' || c.binary === 'pg_dump')
    expect(doBanco.length).toBeGreaterThan(0)
    for (const c of doBanco) {
      expect(c.args.join(' ')).not.toContain(SENHA)
      expect(c.options?.env).toMatchObject({
        PGPASSWORD: SENHA,
        PGHOST: 'proxy.rlwy.net',
        PGPORT: '12345',
        PGSSLMODE: 'require'
      })
      expect(c.options?.redact).toContain(SENHA)
    }
  })

  it('lê o banco do ambiente configurado e usa o token só no env da CLI', async () => {
    const { runner, chamadas } = banco(psqlSaudavel)

    await new RailwayPromotionDatabaseAdapter(runner, {
      ...CONFIG,
      environments: { staging: 'stg', production: 'prd' }
    }).migrate(entrada)

    const daCli = chamadas.filter((c) => c.binary === 'railway')
    expect(daCli.length).toBeGreaterThan(0)
    for (const c of daCli) {
      expect(c.args[c.args.indexOf('--environment') + 1]).toBe('prd')
      expect(c.args[c.args.indexOf('--service') + 1]).toBe('postgres')
      expect(c.args.join(' ')).not.toContain(TOKEN)
      expect(c.options?.env).toEqual({ RAILWAY_API_TOKEN: TOKEN })
      expect(c.options?.redact).toContain(TOKEN)
    }
  })

  it('nunca aplica seed em ambiente persistente', async () => {
    const { runner, chamadas } = banco(psqlSaudavel)

    await new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)

    expect(chamadas.some((c) => sqlDe(c).includes('__seed__'))).toBe(false)
  })

  it('migration que falha devolve o código e não a saída do banco', async () => {
    const { runner } = banco((c) => {
      if (sqlDe(c).includes('CREATE TABLE t')) return erro(`ERRO: relação "t" ${SENHA}`)
      return ok('')
    })

    const r = await new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)

    expect(r).toMatchObject({ state: 'failed', reason: 'migration-failed', failedAt: '001_base' })
    expect(JSON.stringify(r)).not.toContain(SENHA)
  })

  it('migration aplicada e depois editada bloqueia por checksum, sem reescrevê-la', async () => {
    const { runner, chamadas } = banco((c) =>
      sqlDe(c).startsWith('SELECT id') ? ok(`001_base|${'d'.repeat(64)}`) : ok('')
    )

    const r = await new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)

    expect(r).toMatchObject({ state: 'failed', reason: 'checksum-divergent', failedAt: '001_base' })
    expect(chamadas.some((c) => sqlDe(c).includes('CREATE TABLE t'))).toBe(false)
  })

  it('só abre o proxy do banco se ainda não houver um', async () => {
    const { runner, chamadas } = banco(psqlSaudavel, true)

    await new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)

    expect(chamadas.some((c) => comecaCom(c, 'tcp-proxy', 'create'))).toBe(false)
  })

  it('abre o proxy quando o ambiente ainda não tem nenhum', async () => {
    const { runner, chamadas } = banco(psqlSaudavel, false)

    await new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)

    expect(chamadas.some((c) => comecaCom(c, 'tcp-proxy', 'create'))).toBe(true)
  })

  it('banco sem a variável de conexão é estado incompatível, não conexão chutada', async () => {
    const { runner, chamadas } = runnerDe((c) =>
      comecaCom(c, 'variable', 'list') ? ok('{}') : ok('[]')
    )

    await expect(
      new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(chamadas.some((c) => c.binary === 'psql')).toBe(false)
  })

  it('variáveis em JSON ilegível são falha do provedor', async () => {
    const { runner } = runnerDe((c) => (comecaCom(c, 'variable', 'list') ? ok('nada') : ok('[]')))

    await expect(
      new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada)
    ).rejects.toMatchObject({ code: 'failed' })
  })

  it('SQL com barra invertida é recusado antes de qualquer chamada (meta-comando do psql)', async () => {
    const { runner, chamadas } = banco(psqlSaudavel)
    const perigosa = {
      ...entrada,
      migrations: [
        ...entrada.migrations,
        { id: '002_x', sql: `select 1 ${BARRA_INVERTIDA}! calc`, checksum: 'e'.repeat(64) }
      ]
    }

    await expect(
      new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(perigosa)
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(chamadas).toHaveLength(0)
  })

  it.each([
    ['preview', 'preview-template'],
    ['maiúsculas', 'Production'],
    ['apelido', 'prod'],
    ['vazio', '']
  ])('recusa ambiente fora da lista configurada (%s) sem tocar na CLI', async (_n, ambiente) => {
    const { runner, chamadas } = banco(psqlSaudavel)

    const falha = await rodar(
      new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate({
        ...entrada,
        environment: ambiente as 'production'
      })
    )

    expect(falha).toBeInstanceOf(PromotionProviderError)
    expect(falha).toMatchObject({ code: 'incompatible-state' })
    expect(chamadas).toHaveLength(0)
  })

  it.each([
    ['auth', erro('Error: Unauthorized'), 'auth'],
    ['quota', erro('Error: rate limit exceeded'), 'quota'],
    ['timeout', tempo, 'timeout'],
    ['falha genérica', erro('estranho'), 'failed']
  ])('falha da CLI (%s) vira código fechado, sem texto do provedor', async (_n, resposta, code) => {
    const { runner } = runnerDe(() => resposta)

    const falha = await rodar(new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada))

    expect(falha).toBeInstanceOf(PromotionProviderError)
    expect(falha).toMatchObject({ code })
    expect((falha as Error).message).not.toMatch(/Unauthorized|rate limit|estranho/)
  })

  it('o pg_dump que falha vira erro de provedor sem a saída do banco', async () => {
    const { runner } = banco((c) => (c.binary === 'pg_dump' ? erro(`falhou ${SENHA}`) : ok('')))

    const falha = await rodar(new RailwayPromotionDatabaseAdapter(runner, CONFIG).migrate(entrada))

    expect(falha).toMatchObject({ code: 'failed' })
    expect((falha as Error).message).not.toContain(SENHA)
  })
})

describe('RailwayPromotionDatabaseAdapter (configuração)', () => {
  it.each([
    ['ambientes iguais', { staging: 'x', production: 'x' }],
    ['staging vazio', { staging: '', production: 'production' }]
  ])('recusa configuração com %s', (_n, environments) => {
    const { runner } = banco(psqlSaudavel)
    expect(() => new RailwayPromotionDatabaseAdapter(runner, { ...CONFIG, environments })).toThrow(
      TypeError
    )
  })
})
