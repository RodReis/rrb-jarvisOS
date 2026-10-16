import { describe, expect, it } from 'vitest'
import { PromotionProviderError } from '../promotion-ports'
import { hashDasNotas } from '../release-publisher'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import { GithubReleaseAdapter } from './github-release-adapter'

const REPO = 'dono/projeto'
const TAG = 'release-20261016-1200-aaaaaaa'
const SHA = 'a'.repeat(40)
const NOTAS = '# release\n\n- PR #432\n'

interface Chamada {
  binary: string
  args: readonly string[]
  options?: CommandOptions
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const erro = (stderr: string): CommandResult => ({ code: 1, stdout: '', stderr, timedOut: false })
const tempo: CommandResult = { code: null, stdout: '', stderr: '', timedOut: true }

function montar(roteiro: (c: Chamada) => CommandResult) {
  const chamadas: Chamada[] = []
  const runner: CommandRunner = {
    async run(binary, args, options) {
      const chamada = { binary, args: [...args], options }
      chamadas.push(chamada)
      return roteiro(chamada)
    }
  }
  return { adapter: new GithubReleaseAdapter(runner, REPO), chamadas }
}

const ehRef = (c: Chamada): boolean => c.args.join(' ').includes('git/ref/tags/')
const ehView = (c: Chamada): boolean => c.args[0] === 'release' && c.args[1] === 'view'

describe('GithubReleaseAdapter.find', () => {
  it('devolve o commit da tag e o hash das notas da release', async () => {
    const { adapter } = montar((c) => {
      if (ehRef(c)) return ok(JSON.stringify({ object: { type: 'commit', sha: SHA } }))
      if (ehView(c)) return ok(JSON.stringify({ body: NOTAS }))
      return erro('inesperado')
    })
    expect(await adapter.find(TAG)).toEqual({ commitSha: SHA, notesSha256: hashDasNotas(NOTAS) })
  })

  it('tag inexistente é null, não erro', async () => {
    const { adapter } = montar(() => erro('gh: Not Found (HTTP 404)'))
    expect(await adapter.find(TAG)).toBeNull()
  })

  it('tag sem GitHub Release tem notas nulas', async () => {
    const { adapter } = montar((c) => {
      if (ehRef(c)) return ok(JSON.stringify({ object: { type: 'commit', sha: SHA } }))
      return erro('release not found')
    })
    expect(await adapter.find(TAG)).toEqual({ commitSha: SHA, notesSha256: null })
  })

  it('tag anotada é resolvida até o commit', async () => {
    const { adapter, chamadas } = montar((c) => {
      if (ehRef(c)) return ok(JSON.stringify({ object: { type: 'tag', sha: 'f'.repeat(40) } }))
      if (c.args.join(' ').includes('git/tags/'))
        return ok(JSON.stringify({ object: { type: 'commit', sha: SHA } }))
      return ok(JSON.stringify({ body: NOTAS }))
    })
    expect((await adapter.find(TAG))?.commitSha).toBe(SHA)
    expect(chamadas.some((c) => c.args.join(' ').includes('git/tags/'))).toBe(true)
  })

  it('o hash das notas ignora fim de linha e espaço final (o GitHub normaliza)', async () => {
    const comCrlf = NOTAS.replaceAll('\n', '\r\n') + '\r\n'
    const { adapter } = montar((c) =>
      ehRef(c)
        ? ok(JSON.stringify({ object: { type: 'commit', sha: SHA } }))
        : ok(JSON.stringify({ body: comCrlf }))
    )
    expect((await adapter.find(TAG))?.notesSha256).toBe(hashDasNotas(NOTAS))
  })

  it.each([
    ['timeout', tempo, 'timeout'],
    ['credencial recusada', erro('HTTP 401: Bad credentials'), 'auth'],
    ['cota', erro('API rate limit exceeded'), 'quota'],
    ['falha qualquer', erro('exploded'), 'failed']
  ])('%s vira erro de código fechado', async (_nome, resultado, codigo) => {
    const { adapter } = montar(() => resultado)
    const falha = await adapter.find(TAG).catch((e: unknown) => e)
    expect(falha).toBeInstanceOf(PromotionProviderError)
    expect((falha as PromotionProviderError).code).toBe(codigo)
  })
})

describe('GithubReleaseAdapter.publish', () => {
  it('cria a release no commit, com as notas por stdin e nenhum texto em argumento', async () => {
    const { adapter, chamadas } = montar(() => ok())
    await adapter.publish({ tag: TAG, sha: SHA, title: TAG, notes: NOTAS })

    expect(chamadas).toHaveLength(1)
    const c = chamadas[0]!
    expect(c.binary).toBe('gh')
    expect(c.args.slice(0, 3)).toEqual(['release', 'create', TAG])
    expect(c.args).toContain('--repo')
    expect(c.args[c.args.indexOf('--repo') + 1]).toBe(REPO)
    expect(c.args[c.args.indexOf('--target') + 1]).toBe(SHA)
    expect(c.args).toContain('--notes-file')
    expect(c.args[c.args.indexOf('--notes-file') + 1]).toBe('-')
    expect(c.options?.input).toBe(NOTAS)
    expect(c.args.join(' ')).not.toContain('PR #432')
  })

  it('não herda segredo: nenhum token no env nem nos argumentos', async () => {
    const { adapter, chamadas } = montar(() => ok())
    await adapter.publish({ tag: TAG, sha: SHA, title: TAG, notes: NOTAS })
    expect(chamadas[0]!.options?.env ?? {}).toEqual({})
  })

  it('erro de CLI vira código fechado, sem a saída do provedor', async () => {
    const { adapter } = montar(() => erro('HTTP 403: token ghp_SEGREDO sem permissão'))
    const falha = await adapter
      .publish({ tag: TAG, sha: SHA, title: TAG, notes: NOTAS })
      .catch((e: unknown) => e)
    expect((falha as PromotionProviderError).code).toBe('auth')
    expect(String((falha as Error).message)).not.toContain('ghp_SEGREDO')
  })

  it.each([
    ['tag fora do padrão', { tag: 'v1; rm -rf', sha: SHA }],
    ['sha que não é hexadecimal', { tag: TAG, sha: 'main' }]
  ])('recusa %s antes de chamar a CLI', async (_nome, parte) => {
    const { adapter, chamadas } = montar(() => ok())
    await expect(adapter.publish({ ...parte, title: TAG, notes: NOTAS })).rejects.toBeInstanceOf(
      TypeError
    )
    expect(chamadas).toEqual([])
  })

  it('recusa repositório fora do formato dono/nome', () => {
    expect(() => new GithubReleaseAdapter({ run: async () => ok() }, 'sem-barra')).toThrow(
      TypeError
    )
    expect(() => new GithubReleaseAdapter({ run: async () => ok() }, 'a/b; c')).toThrow(TypeError)
  })
})
