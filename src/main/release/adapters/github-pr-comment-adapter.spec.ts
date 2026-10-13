import { describe, expect, it } from 'vitest'
import type { PreviewRun } from '@shared/domain/release'
import type { PreviewProjection } from '../preview-ports'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import { GithubPrCommentAdapter } from './github-pr-comment-adapter'

const RUN: PreviewRun = {
  id: '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa',
  userId: 'u',
  workspaceId: 'jarvis',
  projectId: 'p',
  pullRequest: 12,
  specId: 'SPEC-Release-03',
  specRevision: '2026-08-29',
  headSha: 'a'.repeat(40),
  generation: 1,
  status: 'ready',
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:05:00.000Z'
}
const PROJECAO: PreviewProjection = { run: RUN, resources: [], gates: [] }

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })

function runner(existente: string) {
  const chamadas: { args: readonly string[]; options?: CommandOptions }[] = []
  const r: CommandRunner = {
    async run(binary, args, options) {
      expect(binary).toBe('gh')
      chamadas.push({ args: [...args], options })
      if (args[1] === 'user') return ok('operador\n')
      return args.includes('--paginate') ? ok(existente) : ok('{}')
    }
  }
  return { r, chamadas }
}

describe('GithubPrCommentAdapter', () => {
  it('cria o comentário quando o PR ainda não tem o marcador', async () => {
    const { r, chamadas } = runner('')
    await new GithubPrCommentAdapter(r, 'dono/repo').publish(PROJECAO)

    const escrita = chamadas.at(-1)!
    expect(escrita.args).toEqual([
      'api',
      '-X',
      'POST',
      'repos/dono/repo/issues/12/comments',
      '--input',
      '-'
    ])
    expect(JSON.parse(escrita.options!.input!).body).toContain('jarvis-preview:SPEC-Release-03')
  })

  it('atualiza no lugar o comentário que já existe, sem criar outro', async () => {
    const { r, chamadas } = runner('987654\n')
    await new GithubPrCommentAdapter(r, 'dono/repo').publish(PROJECAO)

    expect(chamadas.filter((c) => c.args.includes('POST'))).toHaveLength(0)
    expect(chamadas.at(-1)!.args).toEqual([
      'api',
      '-X',
      'PATCH',
      'repos/dono/repo/issues/comments/987654',
      '--input',
      '-'
    ])
  })

  it('só considera comentário escrito pelo próprio usuário autenticado', async () => {
    const { r, chamadas } = runner('')
    await new GithubPrCommentAdapter(r, 'dono/repo').publish(PROJECAO)
    const busca = chamadas.find((c) => c.args.includes('--paginate'))!
    expect(busca.args.join(' ')).toContain('.user.login == "operador"')
  })

  it('usuário ilegível interrompe a publicação', async () => {
    const r: CommandRunner = {
      async run() {
        return ok('Quem? ; rm -rf')
      }
    }
    await expect(
      new GithubPrCommentAdapter(r, 'dono/repo').publish(PROJECAO)
    ).rejects.toMatchObject({
      code: 'failed'
    })
  })

  it('o corpo nunca vai em argumento da linha de comando', async () => {
    const { r, chamadas } = runner('')
    await new GithubPrCommentAdapter(r, 'dono/repo').publish(PROJECAO)
    for (const c of chamadas) expect(c.args.join(' ')).not.toContain('Preview isolado')
  })

  it('ignora saída que não é id numérico ao procurar o comentário', async () => {
    const { r, chamadas } = runner('texto estranho\n')
    await new GithubPrCommentAdapter(r, 'dono/repo').publish(PROJECAO)
    expect(chamadas.at(-1)!.args).toContain('POST')
  })

  it('falha da CLI vira erro de provedor com código, sem a saída', async () => {
    const falho: CommandRunner = {
      async run() {
        return { code: 1, stdout: '', stderr: 'HTTP 403: token ghp_SEGREDO', timedOut: false }
      }
    }
    const erro = await new GithubPrCommentAdapter(falho, 'dono/repo')
      .publish(PROJECAO)
      .catch((e: unknown) => e)
    expect(erro).toMatchObject({ code: 'auth' })
    expect((erro as Error).message).not.toContain('ghp_SEGREDO')
  })

  it('recusa repositório fora do formato dono/nome', () => {
    expect(() => new GithubPrCommentAdapter(runner('').r, 'dono/repo; rm')).toThrow(TypeError)
    expect(() => new GithubPrCommentAdapter(runner('').r, 'so-nome')).toThrow(TypeError)
  })
})
