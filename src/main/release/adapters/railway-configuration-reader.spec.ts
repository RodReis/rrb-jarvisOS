import { describe, expect, it } from 'vitest'
import { PromotionProviderError } from '../promotion-ports'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import { RailwayConfigurationReader } from './railway-configuration-reader'

const TOKEN = 'tok_SEGREDO_DO_PROVEDOR_123'
const KEY = 'chave-de-fingerprint-do-teste'

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })

interface Chamada {
  binary: string
  args: readonly string[]
  options?: CommandOptions
}

type Resposta = { readonly vars: Record<string, string> } | { readonly cru: CommandResult }

function runnerDe(
  respostas: Record<string, Resposta | Record<string, string> | CommandResult>
): CommandRunner & {
  chamadas: Chamada[]
} {
  const chamadas: Chamada[] = []
  return {
    chamadas,
    async run(binary, args, options): Promise<CommandResult> {
      chamadas.push({ binary, args: [...args], options })
      const ambiente = args[args.indexOf('--environment') + 1]!
      const resposta = respostas[ambiente]!
      if ('stdout' in resposta && 'code' in resposta) return resposta as CommandResult
      return ok(JSON.stringify(resposta))
    }
  }
}

const config = {
  workdir: 'C:/trabalho/railway',
  token: TOKEN,
  backendService: 'backend',
  environments: { staging: 'staging', production: 'production' } as const,
  fingerprintKey: KEY
}

describe('RailwayConfigurationReader', () => {
  it('lê as variáveis do serviço de backend em cada ambiente persistente', async () => {
    const runner = runnerDe({
      staging: { DATABASE_URL: 'postgres://staging' },
      production: { DATABASE_URL: 'postgres://producao' }
    })
    await new RailwayConfigurationReader(runner, config).load()

    expect(runner.chamadas.map((c) => c.args)).toEqual([
      ['variable', 'list', '--service', 'backend', '--environment', 'staging', '--json'],
      ['variable', 'list', '--service', 'backend', '--environment', 'production', '--json']
    ])
  })

  it('devolve existe/fingerprint por ambiente e nunca o valor', async () => {
    const runner = runnerDe({
      staging: { DATABASE_URL: 'postgres://SENTINELA-STG', EXTRA: 'x' },
      production: { DATABASE_URL: 'postgres://SENTINELA-PRD' }
    })
    const probe = await new RailwayConfigurationReader(runner, config).load()

    const stg = probe('staging', 'DATABASE_URL')
    expect(stg.present).toBe(true)
    expect(stg.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify([stg, probe('production', 'DATABASE_URL')])).not.toContain('SENTINELA')
    expect(probe('staging', 'DATABASE_URL').fingerprint).not.toBe(
      probe('production', 'DATABASE_URL').fingerprint
    )
    expect(probe('production', 'API_TOKEN')).toEqual({ present: false })
  })

  it('o mesmo valor nos dois ambientes gera o mesmo fingerprint: é o que o isolamento compara', async () => {
    const runner = runnerDe({
      staging: { DATABASE_URL: 'postgres://mesmo' },
      production: { DATABASE_URL: 'postgres://mesmo' }
    })
    const probe = await new RailwayConfigurationReader(runner, config).load()
    expect(probe('staging', 'DATABASE_URL').fingerprint).toBe(
      probe('production', 'DATABASE_URL').fingerprint
    )
  })

  it('variável vazia conta como ausente', async () => {
    const runner = runnerDe({ staging: { API_TOKEN: '' }, production: { API_TOKEN: 'ok' } })
    const probe = await new RailwayConfigurationReader(runner, config).load()
    expect(probe('staging', 'API_TOKEN')).toEqual({ present: false })
  })

  it('o token vai só no ambiente do processo filho, redigido, nunca em argumento', async () => {
    const runner = runnerDe({ staging: {}, production: {} })
    await new RailwayConfigurationReader(runner, config).load()
    for (const c of runner.chamadas) {
      expect(c.args.join(' ')).not.toContain(TOKEN)
      expect(c.options?.env).toEqual({ RAILWAY_API_TOKEN: TOKEN })
      expect(c.options?.redact).toContain(TOKEN)
    }
  })

  it('falha de autenticação vira erro de código fechado, sem eco da saída', async () => {
    const runner = runnerDe({
      staging: { code: 1, stdout: '', stderr: 'Unauthorized: token SEGREDO', timedOut: false },
      production: {}
    })
    const erro = await new RailwayConfigurationReader(runner, config).load().catch((e) => e)
    expect(erro).toBeInstanceOf(PromotionProviderError)
    expect((erro as PromotionProviderError).code).toBe('auth')
    expect(String(erro)).not.toContain('SEGREDO')
  })

  it('JSON que não é objeto é falha do provedor, não ambiente vazio', async () => {
    const runner = runnerDe({ staging: ok('[1,2]'), production: {} })
    const erro = await new RailwayConfigurationReader(runner, config).load().catch((e) => e)
    expect((erro as PromotionProviderError).code).toBe('failed')
  })

  it('valor que não é texto é ignorado como ausente', async () => {
    const runner = runnerDe({
      staging: { PORT: 8080 as unknown as string },
      production: {}
    })
    const probe = await new RailwayConfigurationReader(runner, config).load()
    expect(probe('staging', 'PORT')).toEqual({ present: false })
  })
})
