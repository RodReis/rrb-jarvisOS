import { describe, expect, it } from 'vitest'
import { UsoInvalido, lerOpcoesDePreview } from './preview-cli-args'

const BASE = [
  '--data-dir', 'C:/dados',
  '--user', 'user-1',
  '--workspace', 'jarvis',
  '--project', 'project-1',
  '--pr', '12',
  '--spec', 'SPEC-Release-03',
  '--spec-revision', '2026-08-29',
  '--repo', 'dono/repo',
  '--profile', 'release-profile.json',
  '--railway-workdir', 'C:/railway',
  '--railway-template', 'preview-base',
  '--railway-backend-service', 'backend',
  '--railway-database-service', 'postgres',
  '--vercel-workdir', 'C:/vercel',
  '--vercel-api-env', 'VITE_API_URL'
] // prettier-ignore
const ENV = { RAILWAY_API_TOKEN: 'tok-r', VERCEL_TOKEN: 'tok-v' }

describe('argumentos do release:preview', () => {
  it('lê o mínimo, assume sync e tira os tokens só do ambiente', () => {
    const o = lerOpcoesDePreview(BASE, ENV)
    expect(o).toMatchObject({
      event: 'sync',
      pullRequest: 12,
      headSha: null,
      registry: 'ghcr.io',
      scope: { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' },
      tokens: { railway: 'tok-r', vercel: 'tok-v' }
    })
  })

  it('token nunca é aceito como argumento', () => {
    expect(() => lerOpcoesDePreview([...BASE, '--token', 'x'], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePreview([...BASE, '--railway-token', 'x'], ENV)).toThrow(UsoInvalido)
  })

  it('sem token no ambiente é erro de uso', () => {
    expect(() => lerOpcoesDePreview(BASE, { VERCEL_TOKEN: 'v' })).toThrow(/RAILWAY_API_TOKEN/)
    expect(() => lerOpcoesDePreview(BASE, { RAILWAY_API_TOKEN: 'r' })).toThrow(/VERCEL_TOKEN/)
  })

  it('open exige o SHA (conferido contra o PR); sync e close dispensam', () => {
    expect(() => lerOpcoesDePreview([...BASE, '--event', 'open'], ENV)).toThrow(/exige --sha/)
    expect(lerOpcoesDePreview([...BASE, '--event', 'close'], ENV).headSha).toBeNull()
    expect(
      lerOpcoesDePreview([...BASE, '--event', 'open', '--sha', 'a'.repeat(40)], ENV).headSha
    ).toBe('a'.repeat(40))
  })

  it.each([
    ['PR zero', ['--pr', '0']],
    ['PR com texto', ['--pr', '12abc']],
    ['workspace desconhecido', ['--workspace', 'producao']],
    ['evento desconhecido', ['--event', 'deploy']],
    ['repositório fora do formato', ['--repo', 'dono/repo;x']],
    ['SPEC com instrução', ['--spec', 'x; rm -rf /']],
    ['SHA que não é hexadecimal', ['--event', 'open', '--sha', 'main']]
  ])('recusa %s como erro de uso', (_nome, trocas) => {
    const argv = [...BASE]
    for (let i = 0; i < trocas.length; i += 2) {
      const indice = argv.indexOf(trocas[i]!)
      if (indice >= 0) argv[indice + 1] = trocas[i + 1]!
      else argv.push(trocas[i]!, trocas[i + 1]!)
    }
    expect(() => lerOpcoesDePreview(argv, ENV)).toThrow(UsoInvalido)
  })

  it('recusa argumento repetido, desconhecido ou sem valor', () => {
    expect(() => lerOpcoesDePreview([...BASE, '--pr', '13'], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePreview([...BASE, '--qualquer', 'x'], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePreview([...BASE, '--builder'], ENV)).toThrow(UsoInvalido)
  })

  it('falta de argumento obrigatório diz qual', () => {
    const sem = BASE.filter((_, i) => i < BASE.indexOf('--spec') || i > BASE.indexOf('--spec') + 1)
    expect(() => lerOpcoesDePreview(sem, ENV)).toThrow(/--spec/)
  })
})
