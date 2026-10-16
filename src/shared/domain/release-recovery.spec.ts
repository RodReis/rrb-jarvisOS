import { describe, expect, it } from 'vitest'
import {
  ESPERA_ENTRE_TENTATIVAS_MS,
  MAX_TENTATIVAS_POR_PASSO,
  acaoMinima,
  classificarAchados,
  classificarFalha,
  jsonCanonico,
  esperaAntesDaTentativa,
  nomeDaTag,
  podeTentarDeNovo,
  retornaParaV2
} from './release-recovery'

describe('classificarFalha (SPEC-Release-05, design §12)', () => {
  it.each([
    ['database_migrated-timeout', 'transient'],
    ['backend_healthy-quota', 'transient'],
    ['backup-timeout', 'transient'],
    ['config-missing', 'configuration'],
    ['config-shared-value', 'configuration'],
    ['config-unreadable', 'configuration'],
    ['backend_healthy-auth', 'configuration'],
    ['profile-invalid', 'configuration'],
    ['build-compose-failed', 'artifact'],
    ['prepared-failed', 'artifact'],
    ['backend_healthy-no-artifact', 'artifact'],
    ['migration-failed', 'migration'],
    ['checksum-divergent', 'migration'],
    ['database_migrated-failed', 'migration'],
    ['staging-migration', 'migration'],
    ['health-down', 'health_or_test'],
    ['frontend-wiring', 'health_or_test'],
    ['smoke-failed', 'health_or_test'],
    ['e2e_essential-failed', 'health_or_test'],
    ['backend_healthy-failed', 'health_or_test'],
    ['frontend_promoted-failed', 'health_or_test'],
    ['smoke_passed-failed', 'health_or_test'],
    ['stabilization-failed', 'health_or_test'],
    ['staging-smoke', 'health_or_test'],
    ['production-backend_health', 'health_or_test'],
    ['staging-configuration', 'configuration'],
    ['production-backup', 'configuration'],
    ['algo-que-ninguem-previu', 'unknown']
  ] as const)('%s → %s', (codigo, classe) => {
    expect(classificarFalha(codigo)).toBe(classe)
  })

  it('timeout vence o prefixo do passo: efeito incerto nunca é tratado como falha de código', () => {
    expect(classificarFalha('smoke_passed-timeout')).toBe('transient')
    expect(classificarFalha('database_migrated-timeout')).toBe('transient')
  })
})

describe('retornaParaV2', () => {
  it('só falha de código, teste, health, migration ou build devolve a correção à V2', () => {
    expect(retornaParaV2('health_or_test')).toBe(true)
    expect(retornaParaV2('migration')).toBe(true)
    expect(retornaParaV2('artifact')).toBe(true)
    expect(retornaParaV2('transient')).toBe(false)
    expect(retornaParaV2('configuration')).toBe(false)
    expect(retornaParaV2('unknown')).toBe(false)
  })
})

describe('política de tentativas', () => {
  it('são no máximo três tentativas totais por passo (regra 1)', () => {
    expect(MAX_TENTATIVAS_POR_PASSO).toBe(3)
    expect(podeTentarDeNovo(0)).toBe(true)
    expect(podeTentarDeNovo(1)).toBe(true)
    expect(podeTentarDeNovo(2)).toBe(true)
    expect(podeTentarDeNovo(3)).toBe(false)
    expect(podeTentarDeNovo(4)).toBe(false)
  })

  it('o backoff cresce e há uma espera para cada tentativa depois da primeira', () => {
    expect(ESPERA_ENTRE_TENTATIVAS_MS).toHaveLength(MAX_TENTATIVAS_POR_PASSO - 1)
    expect(esperaAntesDaTentativa(2)).toBe(ESPERA_ENTRE_TENTATIVAS_MS[0])
    expect(esperaAntesDaTentativa(3)).toBe(ESPERA_ENTRE_TENTATIVAS_MS[1])
    expect(esperaAntesDaTentativa(3)).toBeGreaterThan(esperaAntesDaTentativa(2))
  })

  it('a primeira tentativa não espera e uma tentativa fora do limite é recusada', () => {
    expect(esperaAntesDaTentativa(1)).toBe(0)
    expect(() => esperaAntesDaTentativa(4)).toThrow(RangeError)
    expect(() => esperaAntesDaTentativa(0)).toThrow(RangeError)
  })
})

describe('nomeDaTag (design §13)', () => {
  it('segue release-YYYYMMDD-HHMM-<shortsha> em UTC', () => {
    expect(nomeDaTag('2026-10-15T23:47:12.000Z', 'ABCDEF1234567890'.toLowerCase())).toBe(
      'release-20261015-2347-abcdef1'
    )
  })

  it('usa UTC mesmo quando o instante vem com deslocamento', () => {
    expect(nomeDaTag('2026-10-16T00:05:00.000-03:00', 'a'.repeat(40))).toBe(
      'release-20261016-0305-aaaaaaa'
    )
  })

  it('recusa SHA que não é hexadecimal ou instante inválido', () => {
    expect(() => nomeDaTag('2026-10-15T23:47:12.000Z', 'xyz')).toThrow(TypeError)
    expect(() => nomeDaTag('ontem', 'a'.repeat(40))).toThrow(TypeError)
  })
})

describe('acaoMinima: o que o operador faz quando a pipeline parou', () => {
  it('cada classe aponta uma ação curta e distinta, em código', () => {
    const acoes = (
      ['transient', 'configuration', 'artifact', 'migration', 'health_or_test', 'unknown'] as const
    ).map(acaoMinima)
    expect(new Set(acoes).size).toBe(acoes.length)
    for (const acao of acoes) expect(acao).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
    expect(acaoMinima('transient')).toBe('check-provider-status')
  })
})

describe('jsonCanonico', () => {
  it('é estável: a ordem das chaves não muda o texto nem o hash que dele sai', () => {
    expect(jsonCanonico({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'z' } })).toBe(
      jsonCanonico({ a: { c: 'z', d: [3, { x: 2, y: 1 }] }, b: 1 })
    )
    expect(jsonCanonico({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('omite undefined e recusa o que não é JSON (número não finito, função)', () => {
    expect(jsonCanonico({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(() => jsonCanonico({ a: Number.NaN })).toThrow(TypeError)
    expect(() => jsonCanonico({ a: () => 1 })).toThrow(TypeError)
  })
})

describe('classificarAchados: achado resolvido não reaparece como novo', () => {
  it('sem histórico, o achado da falha atual é novo', () => {
    expect(classificarAchados('smoke-failed', [])).toEqual([
      { code: 'smoke-failed', status: 'new', releases: [] }
    ])
  })

  it('o mesmo código de uma falha anterior é recorrente, aberta ou já resolvida', () => {
    for (const resolved of [false, true]) {
      expect(
        classificarAchados('smoke-failed', [{ code: 'smoke-failed', releaseId: 'r1', resolved }])
      ).toEqual([{ code: 'smoke-failed', status: 'recurring', releases: ['r1'] }])
    }
  })

  it('achados anteriores de outro código seguem no histórico como abertos ou resolvidos', () => {
    const lista = classificarAchados('smoke-failed', [
      { code: 'health-down', releaseId: 'r1', resolved: true },
      { code: 'migration-failed', releaseId: 'r2', resolved: false }
    ])
    expect(lista).toEqual([
      { code: 'smoke-failed', status: 'new', releases: [] },
      { code: 'health-down', status: 'resolved', releases: ['r1'] },
      { code: 'migration-failed', status: 'open', releases: ['r2'] }
    ])
  })

  it('um código só é resolvido quando todas as ocorrências anteriores foram resolvidas', () => {
    const lista = classificarAchados('x-failed', [
      { code: 'health-down', releaseId: 'r1', resolved: true },
      { code: 'health-down', releaseId: 'r3', resolved: false }
    ])
    expect(lista.find((a) => a.code === 'health-down')).toEqual({
      code: 'health-down',
      status: 'open',
      releases: ['r1', 'r3']
    })
  })
})
