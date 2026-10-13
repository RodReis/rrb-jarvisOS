import { marcadorDoPreview, renderizarComentarioDePreview } from '../preview-comment'
import {
  PreviewProviderError,
  type PreviewProjection,
  type PreviewPublicationPort
} from '../preview-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso } from './preview-cli-errors'

/**
 * Publica o estado do Preview no PR (SPEC-Release-03) como **um** comentário por PR + SPEC:
 * achado pelo marcador, atualizado no lugar. Transporte declarado: CLI `gh api`. O corpo vai por
 * stdin (JSON), nunca em argumento; a credencial é a do `gh auth login` da máquina.
 */

const REPOSITORIO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const ID_DE_COMENTARIO = /^\d{1,20}$/
const LOGIN_VALIDO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/

export class GithubPrCommentAdapter implements PreviewPublicationPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly repository: string
  ) {
    if (!REPOSITORIO.test(repository))
      throw new TypeError('O repositório do PR deve estar no formato dono/nome.')
  }

  private gh(args: readonly string[], etapa: string, input?: string) {
    return this.runner
      .run('gh', args, { input, timeoutMs: 60_000 })
      .then((resultado) => exigirSucesso(resultado, etapa))
  }

  async publish(projecao: PreviewProjection): Promise<void> {
    const corpo = renderizarComentarioDePreview(projecao)
    const marcador = marcadorDoPreview(projecao.run.specId)
    // O marcador é público: só vale o comentário que **este** usuário escreveu, senão qualquer
    // pessoa poderia plantar um comentário com o marcador e fazer a pipeline editá-lo.
    const login = (
      await this.gh(['api', 'user', '--jq', '.login'], 'identificar usuário')
    ).stdout.trim()
    if (!LOGIN_VALIDO.test(login))
      throw new PreviewProviderError('failed', 'O GitHub devolveu um usuário ilegível.')
    const existente = await this.gh(
      [
        'api',
        '--paginate',
        `repos/${this.repository}/issues/${projecao.run.pullRequest}/comments`,
        '--jq',
        `.[] | select(.user.login == "${login}" and (.body | startswith("${marcador}"))) | .id`
      ],
      'procurar comentário'
    )
    const id = existente.stdout.split(/\r?\n/).find((linha) => ID_DE_COMENTARIO.test(linha.trim()))
    const payload = JSON.stringify({ body: corpo })
    if (id) {
      await this.gh(
        [
          'api',
          '-X',
          'PATCH',
          `repos/${this.repository}/issues/comments/${id.trim()}`,
          '--input',
          '-'
        ],
        'atualizar comentário',
        payload
      )
      return
    }
    await this.gh(
      [
        'api',
        '-X',
        'POST',
        `repos/${this.repository}/issues/${projecao.run.pullRequest}/comments`,
        '--input',
        '-'
      ],
      'criar comentário',
      payload
    )
  }
}
