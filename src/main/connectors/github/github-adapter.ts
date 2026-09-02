/**
 * O adapter do GitHub (SPEC-Conectores-03 e 04).
 *
 * A F03 o abriu com `auth.identify` — a operação que confirma usuário e instalação. A F04
 * acrescenta as nove capacidades de automação, e o desenho é o que a F01 previu: **acrescentar
 * capacidade é escrever a operação e declará-la**, não tocar o ponto de chamada. O
 * `ConnectorService` não mudou por causa desta fatia, e é isso que o critério 1 da F01 afirmava.
 *
 * Três camadas, e a separação é o que mantém cada uma testável sozinha:
 * - `@shared/domain/github-automation` decide sem rede (validação, gate de checks, sentido do 404);
 * - `github-operations.ts` fala com a API (procura antes de criar, normaliza o que volta);
 * - este arquivo despacha e **traduz falha** no vocabulário comum da F01.
 *
 * `custoEstimado` continua ausente de propósito: o GitHub não cobra créditos, e a F01 já decidiu
 * que ausência **é** zero.
 */

import type {
  ConnectorCapability,
  ConnectorError,
  ConnectorId,
  ConnectorResult
} from '@shared/domain/connectors'
import { erroDeInstalacaoAusente } from '@shared/domain/github-auth'
import {
  GITHUB_API_VERSION,
  GITHUB_CAPABILITIES,
  GITHUB_OPERATIONS,
  erroDeHeadDivergente,
  origemDaApi,
  significadoDo404,
  validarEntrada,
  type CommitShaInput,
  type EnsureBranchProtectionInput,
  type EnsureLabelInput,
  type EnsureBranchRefInput,
  type EnsureIssueDependencyInput,
  type EnsureIssueInput,
  type EnsurePullRequestInput,
  type EnsureRepositoryInput,
  type HeadShaInput,
  type PullRequestInput,
  type RequiredChecksInput,
  type SetDefaultBranchInput,
  type SquashMergeInput
} from '@shared/domain/github-automation'
import type { ConnectorAdapter, ConnectorExecution } from '../adapter'
import {
  ensureBranchProtection,
  ensureBranchRef,
  ensureIssue,
  ensureLabel,
  ensureIssueDependency,
  ensurePullRequest,
  ensureRepository,
  getChecksForHead,
  getCommitSha,
  getMergeState,
  getRequiredChecksForBranch,
  getWorkflowRunsForHead,
  setDefaultBranch,
  squashMerge,
  FalhaRest,
  type ResultadoDeOperacao
} from './github-operations'
import { GithubRest, type BuscadorHttp } from './github-rest'

/**
 * O slug público da GitHub App, usado só para montar a URL de instalação.
 *
 * Acompanha o `client_id` embutido: enquanto a App do projeto não existe (decisão do PI de
 * 2026-08-29), o slug é o nome pretendido. Não é segredo nem identificador de autenticação — é o
 * pedaço de URL que leva o usuário à página de instalação.
 */
export const GITHUB_APP_SLUG = 'jarvis-os'

/** O que `auth.identify` devolve — **dado normalizado, nunca o objeto do SDK** (crit. 3 da F01). */
export interface GithubIdentity {
  readonly login: string
  readonly id: number
  readonly tipo: string
}

export class GithubAdapter implements ConnectorAdapter {
  readonly id: ConnectorId = 'github'

  constructor(
    /** Injetável para o teste não tocar a rede, como no `GithubAuthService`. */
    private readonly buscar: BuscadorHttp = (url, init) => fetch(url, init),
    private readonly agora: () => number = () => Date.now(),
    /**
     * A origem da REST API. Lida do **ambiente do main**, como a do OAuth na F03: existe para o
     * teste de integração e o E2E apontarem a um servidor local que conta requisições, e nenhum
     * canal IPC a alcança.
     */
    private readonly origem: string = origemDaApi(process.env.GITHUB_API_ORIGIN)
  ) {}

  capacidades(): readonly ConnectorCapability[] {
    return GITHUB_CAPABILITIES
  }

  /**
   * Valida o **input** da operação, antes de qualquer I/O (critério 2 da F01).
   *
   * A validação mora no domínio, que é puro; aqui ela só ganha proveniência e vira
   * `ConnectorError`.
   *
   * **Credencial não se confere aqui**, e a razão é a ordem do `ConnectorService`: ele chama
   * `validar` no passo 3 e só resolve o cofre no passo 6 — de propósito, para recusar pedido
   * malformado sem tocar o segredo. Então `execution.secret` está sempre ausente neste ponto, e
   * uma guarda de credencial recusaria **toda** chamada. Quem cobra a credencial é o serviço, um
   * lugar só, com a mensagem dele. (Foi o E2E que mostrou: a guarda que a F03 pôs aqui só tinha
   * teste unitário, onde o `secret` é passado à mão.)
   */
  validar(execution: ConnectorExecution): ConnectorError | undefined {
    // `auth.identify` não tem input a validar: o que ela precisa é a credencial, que o serviço
    // resolve depois desta etapa.
    if (execution.request.operation === 'auth.identify') return undefined

    const problema = validarEntrada(execution.request.operation, execution.request.input)
    if (problema === undefined) return undefined

    return {
      ok: false,
      code: 'validacao-invalida',
      mensagem: problema,
      retryable: false,
      acao: 'corrigir-entrada',
      provenance: this.provenance(execution)
    }
  }

  async executar(execution: ConnectorExecution): Promise<ConnectorResult | ConnectorError> {
    const inicio = this.agora()

    try {
      const desfecho = await this.despachar(execution)
      return {
        ok: true,
        data: desfecho.data,
        provenance: this.provenance(execution),
        usage: { creditos: 0, latenciaMs: this.agora() - inicio },
        ...(desfecho.externalRef === undefined ? {} : { externalRef: desfecho.externalRef })
      }
    } catch (erro) {
      // `FalhaRest` é a falha esperada — status do GitHub, traduzido no vocabulário comum. Outra
      // exceção qualquer sobe: quem a converte em `ConnectorError` é o serviço, num lugar só, para
      // todo adapter (é o desenho da F01).
      if (erro instanceof FalhaRest) return this.traduzirFalha(erro, execution)

      // 200 com corpo que não identifica a conta: não é falha de status, é contrato quebrado.
      // Vira `resposta-invalida` em vez de subir — reportar sucesso com dado vazio seria pior.
      if (erro instanceof RespostaSemIdentidade) {
        return {
          ok: false,
          code: 'resposta-invalida',
          mensagem: erro.message,
          retryable: false,
          acao: 'reportar',
          provenance: erro.provenance
        }
      }

      throw erro
    }
  }

  /**
   * Roteia a operação. Cada `case` é uma capacidade declarada; nenhuma outra chega aqui, porque o
   * `ConnectorRegistry` recusa operação fora da lista antes de qualquer I/O.
   *
   * `input as` sem re-checar: a validação já rodou em `validar`, que é chamado pelo serviço antes
   * de `executar`. Re-validar aqui seria a mesma conferência em dois lugares, e as duas versões
   * divergiriam com o tempo.
   */
  private async despachar(
    execution: ConnectorExecution
  ): Promise<ResultadoDeOperacao<unknown> & { externalRef?: ConnectorResult['externalRef'] }> {
    const rest = new GithubRest(this.origem, execution.secret ?? '', this.buscar, execution.signal)
    const input = execution.request.input

    switch (execution.request.operation) {
      case 'auth.identify':
        return await this.identificar(rest, execution)

      case GITHUB_OPERATIONS.ensureRepository:
        return await ensureRepository(rest, input as EnsureRepositoryInput)

      case GITHUB_OPERATIONS.ensureIssue:
        return await ensureIssue(rest, input as EnsureIssueInput)

      case GITHUB_OPERATIONS.ensureIssueDependency:
        return await ensureIssueDependency(rest, input as EnsureIssueDependencyInput)

      case GITHUB_OPERATIONS.ensureBranchRef:
        return await ensureBranchRef(rest, input as EnsureBranchRefInput)

      case GITHUB_OPERATIONS.ensurePullRequest:
        return await ensurePullRequest(rest, input as EnsurePullRequestInput)

      case GITHUB_OPERATIONS.getChecksForHead:
        return await getChecksForHead(rest, input as HeadShaInput)

      case GITHUB_OPERATIONS.getWorkflowRunsForHead:
        return await getWorkflowRunsForHead(rest, input as HeadShaInput)

      case GITHUB_OPERATIONS.squashMerge:
        return await squashMerge(rest, input as SquashMergeInput)

      case GITHUB_OPERATIONS.getMergeState:
        return await getMergeState(rest, input as PullRequestInput)

      case GITHUB_OPERATIONS.setDefaultBranch:
        return await setDefaultBranch(rest, input as SetDefaultBranchInput)

      case GITHUB_OPERATIONS.ensureBranchProtection:
        return await ensureBranchProtection(rest, input as EnsureBranchProtectionInput)

      case GITHUB_OPERATIONS.getCommitSha:
        return await getCommitSha(rest, input as CommitShaInput)

      case GITHUB_OPERATIONS.ensureLabel:
        return await ensureLabel(rest, input as EnsureLabelInput)

      case GITHUB_OPERATIONS.getRequiredChecks:
        return await getRequiredChecksForBranch(rest, input as RequiredChecksInput)

      default:
        // Inalcançável pelo caminho normal (o registro filtra antes), mas o `default` mantém a
        // função total: uma capacidade nova declarada e não roteada falha aqui, alto e claro, em
        // vez de devolver `undefined` para o chamador.
        throw new Error(`Operação não roteada: ${execution.request.operation}`)
    }
  }

  /** `auth.identify` — quem está autenticado (SPEC-Conectores-03, passo 6 do fluxo). */
  private async identificar(
    rest: GithubRest,
    execution: ConnectorExecution
  ): Promise<ResultadoDeOperacao<GithubIdentity>> {
    const resposta = await rest.request('GET', '/user')
    if (!resposta.ok) throw new FalhaRest(resposta)

    const dados = resposta.corpo as Record<string, unknown> | undefined
    const login = typeof dados?.login === 'string' ? dados.login : undefined

    if (login === undefined) {
      throw new RespostaSemIdentidade(this.provenance(execution))
    }

    return {
      // Campos escolhidos um a um, e não `...dados`: o corpo do GitHub traz dezenas de URLs e
      // metadados da conta, e espalhá-los publicaria no IPC coisas que ninguém pediu.
      data: {
        login,
        id: typeof dados?.id === 'number' ? dados.id : 0,
        tipo: typeof dados?.type === 'string' ? dados.type : 'User'
      },
      externalRef: { id: login },
      criado: false
    }
  }

  /**
   * O status do GitHub, **sem credencial nenhuma** (critério 5 da F02).
   *
   * A assinatura já garante isso — `health()` não recebe parâmetro —, e o endpoint escolhido
   * respeita: `/zen` é público e não pede autenticação. Sondar `/user` aqui exigiria um token e
   * transformaria a sonda num vazamento.
   */
  async health(): Promise<boolean> {
    try {
      const resposta = await this.buscar(`${this.origem}/zen`, {
        method: 'GET',
        headers: { 'X-GitHub-Api-Version': GITHUB_API_VERSION }
      })
      return resposta.ok
    } catch {
      return false
    }
  }

  /**
   * Traduz o status HTTP no vocabulário comum (critério 4 da F01).
   *
   * Os casos que a F04 acrescentou, e por quê:
   *
   * - **404** é ambíguo em operação autenticada (critério 6): o GitHub responde igual para "não
   *   existe" e "existe, mas você não vê" — decisão de segurança dele. Quem decide o que dizer é
   *   `significadoDo404`, no domínio, e a mensagem nomeia as duas possibilidades em vez de
   *   escolher a errada com confiança.
   * - **409** no merge é o head divergente (critério 5): o SHA esperado não é mais o head, então
   *   os checks que aprovaram são de outro commit.
   * - **422** é validação do GitHub — recurso que já existe, branch inválido, PR sem diferença.
   *   `corrigir-entrada` e não `retentar`: repetir igual erra igual.
   *
   * O 403 continua sendo o caso ambíguo da F03: rate limit secundário quando traz `retry-after` ou
   * cota zerada, falta de instalação no resto.
   */
  private traduzirFalha(falha: FalhaRest, execution: ConnectorExecution): ConnectorError {
    const provenance = this.provenance(execution)
    const { status, headers } = falha.resposta
    const retryAfter = Number(headers.get('retry-after'))
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
    const semCota = headers.get('x-ratelimit-remaining') === '0'

    if (status === 401) {
      return {
        ok: false,
        code: 'credencial-recusada',
        mensagem: 'O GitHub recusou o token. Conecte a conta novamente.',
        retryable: false,
        acao: 'reautenticar',
        provenance
      }
    }

    if (status === 403 || status === 429) {
      if (retryAfterMs !== undefined || semCota) {
        return {
          ok: false,
          code: 'limite-excedido',
          mensagem: 'O GitHub pediu para esperar antes da próxima chamada.',
          // Rate limit **permanece retomável** (critério 7): quem espera consegue.
          retryable: true,
          acao: 'retentar',
          provenance,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs })
        }
      }

      // 403 sem sinal de cota é falta de acesso — e a ação concreta é a URL de instalação da
      // App, não uma mensagem genérica (SPEC-Conectores-03 § decisões cravadas).
      return erroDeInstalacaoAusente(
        GITHUB_APP_SLUG,
        provenance.obtidoEm,
        execution.request.operation
      )
    }

    if (status === 404) {
      const { code, mensagem } = significadoDo404(
        execution.secret !== undefined && execution.secret !== ''
      )
      return {
        ok: false,
        code,
        mensagem,
        retryable: false,
        acao: code === 'credencial-ausente' ? 'reautenticar' : 'reportar',
        provenance
      }
    }

    if (status === 409 && execution.request.operation === GITHUB_OPERATIONS.squashMerge) {
      const esperado = (execution.request.input as SquashMergeInput | undefined)?.expectedHeadSha
      return erroDeHeadDivergente(esperado ?? '', provenance.obtidoEm, execution.request.operation)
    }

    if (status === 409 || status === 422) {
      return {
        ok: false,
        code: 'validacao-invalida',
        mensagem: 'O GitHub recusou a operação: o estado do recurso não permite o que foi pedido.',
        retryable: false,
        acao: 'corrigir-entrada',
        provenance,
        evidencia: `HTTP ${status}`
      }
    }

    if (status >= 500) {
      return {
        ok: false,
        code: 'indisponivel',
        mensagem: 'O GitHub está indisponível no momento.',
        // Erro secundário **permanece retomável** (critério 7).
        retryable: true,
        acao: 'retentar',
        provenance
      }
    }

    return {
      ok: false,
      code: 'resposta-invalida',
      // O status entra como evidência (número, não corpo); a mensagem ao usuário fica normalizada.
      mensagem: 'O GitHub recusou a chamada por um motivo não previsto.',
      retryable: false,
      acao: 'reportar',
      provenance,
      evidencia: `HTTP ${status}`
    }
  }

  private provenance(execution: ConnectorExecution): ConnectorResult['provenance'] {
    return {
      connector: 'github',
      operation: execution.request.operation,
      obtidoEm: new Date(this.agora()).toISOString()
    }
  }
}

/**
 * Resposta 200 que não identifica a conta.
 *
 * Classe própria porque não é falha de status — é corpo inesperado, e o `catch` do `executar`
 * precisa distingui-la de uma exceção genuinamente inesperada.
 */
class RespostaSemIdentidade extends Error {
  constructor(readonly provenance: ConnectorResult['provenance']) {
    super('O GitHub respondeu sem identificar a conta.')
    this.name = 'RespostaSemIdentidade'
  }
}
