import { describe, expect, it } from 'vitest'
import { UsoInvalido } from './preview-cli-args'
import { lerOpcoesDePromocao } from './promotion-cli-args'

const ENV = { RAILWAY_API_TOKEN: 'tok-railway', VERCEL_TOKEN: 'tok-vercel' }
const SHA = 'a'.repeat(40)

const base = [
  '--data-dir', 'C:/dados',
  '--user', 'user-1',
  '--workspace', 'jarvis',
  '--project', 'project-1',
  '--profile', 'C:/p/release-profile.json',
  '--promotion-profile', 'C:/p/promotion.json',
  '--compose-file', 'C:/p/compose.yml'
] // prettier-ignore

describe('lerOpcoesDePromocao', () => {
  it('merge exige o SHA e devolve o escopo e os caminhos', () => {
    const o = lerOpcoesDePromocao([...base, '--event', 'merge', '--sha', SHA], ENV)
    expect(o).toMatchObject({
      event: 'merge',
      sha: SHA,
      release: null,
      scope: { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' },
      promotionProfile: 'C:/p/promotion.json',
      registry: 'ghcr.io',
      autoStartDocker: false
    })
  })

  it('resume exige o id da release', () => {
    const o = lerOpcoesDePromocao(
      [...base, '--event', 'resume', '--release', '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa'],
      ENV
    )
    expect(o).toMatchObject({
      event: 'resume',
      release: '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa',
      sha: null
    })
  })

  it('o evento é obrigatório e restrito a merge ou resume', () => {
    expect(() => lerOpcoesDePromocao([...base, '--sha', SHA], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePromocao([...base, '--event', 'deploy', '--sha', SHA], ENV)).toThrow(
      UsoInvalido
    )
  })

  it('merge sem SHA e SHA que não é hexadecimal são recusados', () => {
    expect(() => lerOpcoesDePromocao([...base, '--event', 'merge'], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePromocao([...base, '--event', 'merge', '--sha', 'xyz'], ENV)).toThrow(
      UsoInvalido
    )
  })

  it('resume sem release é recusado', () => {
    expect(() => lerOpcoesDePromocao([...base, '--event', 'resume'], ENV)).toThrow(UsoInvalido)
  })

  it('os tokens vêm só do ambiente e a ausência de qualquer um é recusada', () => {
    const args = [...base, '--event', 'merge', '--sha', SHA]
    expect(() => lerOpcoesDePromocao(args, { VERCEL_TOKEN: 'x' })).toThrow(/RAILWAY_API_TOKEN/)
    expect(() => lerOpcoesDePromocao(args, { RAILWAY_API_TOKEN: 'x' })).toThrow(/VERCEL_TOKEN/)
    expect(lerOpcoesDePromocao(args, ENV).tokens).toEqual({
      railway: 'tok-railway',
      vercel: 'tok-vercel'
    })
  })

  it('token passado como argumento é recusado: segredo não entra em argv', () => {
    expect(() =>
      lerOpcoesDePromocao([...base, '--event', 'merge', '--sha', SHA, '--token', 'x'], ENV)
    ).toThrow(UsoInvalido)
  })

  it('argumento repetido, sem valor ou desconhecido é recusado', () => {
    const args = [...base, '--event', 'merge', '--sha', SHA]
    expect(() => lerOpcoesDePromocao([...args, '--user', 'outro'], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePromocao([...args, '--registry'], ENV)).toThrow(UsoInvalido)
    expect(() => lerOpcoesDePromocao([...args, '--zzz', '1'], ENV)).toThrow(UsoInvalido)
  })

  it('workspace precisa ser noa ou jarvis', () => {
    const args = base.map((a) => (a === 'jarvis' ? 'outro' : a))
    expect(() => lerOpcoesDePromocao([...args, '--event', 'merge', '--sha', SHA], ENV)).toThrow(
      UsoInvalido
    )
  })

  it('aceita registry, namespace, builder e a abertura automática do Docker', () => {
    const o = lerOpcoesDePromocao(
      [
        ...base,
        '--event', 'merge', '--sha', SHA,
        '--registry', 'localhost:5000', '--namespace', 'dono', '--builder', 'b1',
        '--auto-start-docker'
      ], // prettier-ignore
      ENV
    )
    expect(o).toMatchObject({
      registry: 'localhost:5000',
      namespace: 'dono',
      builder: 'b1',
      autoStartDocker: true
    })
  })
})
