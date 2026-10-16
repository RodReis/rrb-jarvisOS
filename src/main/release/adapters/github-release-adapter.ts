import { PromotionProviderError } from '../promotion-ports'
import { hashDasNotas, type ReleaseGitPort } from '../release-publisher'
import type { CommandRunner } from './command-runner'
import { exigirSucesso, lerJson } from './preview-cli-errors'

/**
 * Tag e GitHub Release da Produção estabilizada (SPEC-Release-05). Transporte declarado: CLI `gh`
 * — `gh api` para ler a tag e `gh release create` para publicar. As notas vão por stdin, nunca em
 * argumento; a credencial é a do `gh auth login` da máquina e nenhum token passa por aqui. Só
 * cria: não edita, não apaga e não move tag (apagar release confirmada é proibido).
 */

/** `dono/nome`, sem segmento `.` nem `..`: o valor entra no caminho de `gh api`. */
const REPOSITORIO = /^(?!\.{1,2}\/)(?!.*\/\.{1,2}$)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const TAG = /^release-\d{8}-\d{4}-[a-f0-9]{7}$/
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const TIMEOUT_MS = 60_000

interface ObjetoDeRef {
  readonly object?: { readonly type?: unknown; readonly sha?: unknown }
}

export class GithubReleaseAdapter implements ReleaseGitPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly repository: string
  ) {
    if (!REPOSITORIO.test(repository))
      throw new TypeError('O repositório do GitHub deve estar no formato dono/nome.')
  }

  private gh(args: readonly string[], etapa: string, input?: string) {
    return this.runner
      .run('gh', args, { input, timeoutMs: TIMEOUT_MS })
      .then((resultado) => exigirSucesso(resultado, etapa))
  }

  async find(tag: string): Promise<{ commitSha: string; notesSha256: string | null } | null> {
    if (!TAG.test(tag)) throw new TypeError('Tag fora do padrão release-YYYYMMDD-HHMM-<shortsha>.')
    let commitSha: string
    try {
      commitSha = await this.commitDaTag(tag)
    } catch (erro) {
      if (erro instanceof PromotionProviderError && erro.code === 'not-found') return null
      throw erro
    }
    try {
      const view = await this.gh(
        ['release', 'view', tag, '--repo', this.repository, '--json', 'body'],
        'ler release'
      )
      const corpo = (lerJson(view, 'ler release') as { body?: unknown } | null)?.body
      return { commitSha, notesSha256: typeof corpo === 'string' ? hashDasNotas(corpo) : null }
    } catch (erro) {
      // Tag sem GitHub Release: o commit existe e as notas não.
      if (erro instanceof PromotionProviderError && erro.code === 'not-found')
        return { commitSha, notesSha256: null }
      throw erro
    }
  }

  async publish(input: { tag: string; sha: string; title: string; notes: string }): Promise<void> {
    if (!TAG.test(input.tag))
      throw new TypeError('Tag fora do padrão release-YYYYMMDD-HHMM-<shortsha>.')
    if (!SHA.test(input.sha)) throw new TypeError('O SHA da release deve ter 40 hexadecimais.')
    await this.gh(
      [
        'release',
        'create',
        input.tag,
        '--repo',
        this.repository,
        '--target',
        input.sha,
        '--title',
        input.title,
        '--notes-file',
        '-'
      ],
      'criar release',
      input.notes
    )
  }

  /** O commit para o qual a tag aponta; tag anotada é desreferenciada até o commit. */
  private async commitDaTag(tag: string): Promise<string> {
    const ref = lerJson(
      await this.gh(['api', `repos/${this.repository}/git/ref/tags/${tag}`], 'ler tag'),
      'ler tag'
    ) as ObjetoDeRef | null
    let tipo = ref?.object?.type
    let sha = ref?.object?.sha
    if (tipo === 'tag' && typeof sha === 'string' && SHA.test(sha)) {
      const anotada = lerJson(
        await this.gh(['api', `repos/${this.repository}/git/tags/${sha}`], 'ler tag anotada'),
        'ler tag anotada'
      ) as ObjetoDeRef | null
      tipo = anotada?.object?.type
      sha = anotada?.object?.sha
    }
    if (tipo !== 'commit' || typeof sha !== 'string' || !SHA.test(sha))
      throw new PromotionProviderError('failed', 'A tag não aponta para um commit legível.')
    return sha
  }
}
