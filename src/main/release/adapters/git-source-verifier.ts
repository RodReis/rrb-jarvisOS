import type { CommandRunner } from './command-runner'

/**
 * A imagem sai com `org.opencontainers.image.revision=<sha da release>` e é registrada como o
 * candidato daquele commit. Só vale se o contexto de build é exatamente aquele commit: HEAD igual
 * ao SHA e nenhuma alteração (rastreada ou não) dentro do contexto. Qualquer dúvida bloqueia.
 */

export type SourceCheck = 'ok' | 'source-mismatch' | 'source-dirty'

const SHA_VALIDO = /^[0-9a-f]{7,64}$/i

export class GitSourceVerifier {
  constructor(private readonly runner: CommandRunner) {}

  async verify(contextDir: string, sha: string): Promise<SourceCheck> {
    if (!SHA_VALIDO.test(sha)) return 'source-mismatch'
    const head = await this.runner.run('git', ['-C', contextDir, 'rev-parse', 'HEAD'], {
      timeoutMs: 30_000
    })
    if (head.code !== 0 || !head.stdout.trim().toLowerCase().startsWith(sha.toLowerCase()))
      return 'source-mismatch'
    const status = await this.runner.run(
      'git',
      ['-C', contextDir, 'status', '--porcelain', '--untracked-files=all', '--', '.'],
      { timeoutMs: 30_000 }
    )
    return status.code === 0 && status.stdout.trim() === '' ? 'ok' : 'source-dirty'
  }
}
