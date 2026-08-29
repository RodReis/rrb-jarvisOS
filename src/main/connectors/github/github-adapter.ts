/**
 * O adapter do GitHub — o primeiro adapter concreto do MVP-006 (SPEC-Conectores-03).
 *
 * Escopo desta fatia: **autenticação**, e só. A capacidade que ele declara é `auth.identify`, que
 * fecha o passo 6 do fluxo da spec — "confirmar usuário, instalação e permissões efetivas". As
 * operações de repositório, issue e PR são da M6-F04; declará-las agora criaria capacidades que a
 * UI lista e ninguém atende, que é a mesma promessa vazia que a F01 evitou nas chaves de
 * credencial.
 *
 * O que a existência deste arquivo prova, e nenhum contract fixture provava: que `ConnectorAdapter`
 * não exige nada que só um adapter falso tem. A F01 registrou esse limite explicitamente ("nenhum
 * adapter concreto existe"), e ele fecha aqui.
 *
 * `custoEstimado` está ausente de propósito: o GitHub não cobra créditos, e a F01 já decidiu que
 * ausência **é** zero — declarar o método para devolver `0` seria cerimônia.
 */

import type {
  ConnectorCapability,
  ConnectorError,
  ConnectorId,
  ConnectorResult
} from '@shared/domain/connectors'
import { erroDeInstalacaoAusente } from '@shared/domain/github-auth'
import type { ConnectorAdapter, ConnectorExecution } from '../adapter'

/**
 * O slug público da GitHub App, usado só para montar a URL de instalação.
 *
 * Acompanha o `client_id` embutido: enquanto a App do projeto não existe (decisão do PI de
 * 2026-08-29), o slug é o nome pretendido. Não é segredo nem identificador de autenticação — é o
 * pedaço de URL que leva o usuário à página de instalação.
 */
export const GITHUB_APP_SLUG = 'jarvis-os'

/** O endpoint que responde "quem sou eu" para um user access token. */
const GITHUB_API_USER_URL = 'https://api.github.com/user'
const GITHUB_API_VERSION = '2022-11-28'

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
    private readonly buscar: (url: string, init: RequestInit) => Promise<Response> = (url, init) =>
      fetch(url, init),
    private readonly agora: () => number = () => Date.now()
  ) {}

  capacidades(): readonly ConnectorCapability[] {
    return [
      {
        connector: 'github',
        operation: 'auth.identify',
        effect: 'leitura',
        descricao: 'Confirma quem está autenticado e se a GitHub App tem acesso à conta.'
      }
    ]
  }

  /**
   * `auth.identify` não tem input — o que ela precisa é a credencial, e essa chega por parâmetro.
   *
   * A validação que sobra é a da credencial, e ela é real: sem token, a chamada iria à rede para
   * receber um 401 previsível. Recusar antes é o critério 1 da F01 valendo para este adapter.
   */
  validar(execution: ConnectorExecution): ConnectorError | undefined {
    if (execution.secret === undefined || execution.secret === '') {
      return {
        ok: false,
        code: 'credencial-ausente',
        mensagem: 'Conecte a conta do GitHub antes de usar este conector.',
        retryable: false,
        acao: 'reautenticar',
        provenance: this.provenance(execution)
      }
    }

    return undefined
  }

  async executar(execution: ConnectorExecution): Promise<ConnectorResult | ConnectorError> {
    const inicio = this.agora()

    const resposta = await this.buscar(GITHUB_API_USER_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${execution.secret ?? ''}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION
      },
      ...(execution.signal === undefined ? {} : { signal: execution.signal })
    })

    if (!resposta.ok) {
      return this.traduzirFalha(resposta, execution)
    }

    const dados = (await resposta.json()) as Record<string, unknown>
    const login = typeof dados.login === 'string' ? dados.login : undefined

    if (login === undefined) {
      return {
        ok: false,
        code: 'resposta-invalida',
        mensagem: 'O GitHub respondeu sem identificar a conta.',
        retryable: false,
        acao: 'reportar',
        provenance: this.provenance(execution)
      }
    }

    const identidade: GithubIdentity = {
      login,
      id: typeof dados.id === 'number' ? dados.id : 0,
      tipo: typeof dados.type === 'string' ? dados.type : 'User'
    }

    return {
      ok: true,
      // Campos escolhidos um a um, e não `...dados`: o corpo do GitHub traz dezenas de URLs e
      // metadados da conta, e espalhá-los publicaria no IPC coisas que ninguém pediu.
      data: identidade,
      provenance: this.provenance(execution),
      usage: { creditos: 0, latenciaMs: this.agora() - inicio }
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
      const resposta = await this.buscar('https://api.github.com/zen', { method: 'GET' })
      return resposta.ok
    } catch {
      return false
    }
  }

  /**
   * Traduz o status HTTP no vocabulário comum (critério 4 da F01).
   *
   * O 403 do GitHub é o caso que a F01 já antecipava: ele é **rate limit secundário** quando vem
   * com `retry-after` ou `x-ratelimit-remaining: 0`, e permissão negada no resto. Uma tabela fixa
   * por status erraria exatamente aqui, que é por que a `acao` mora no erro e não numa tabela.
   */
  private traduzirFalha(resposta: Response, execution: ConnectorExecution): ConnectorError {
    const provenance = this.provenance(execution)
    const retryAfter = Number(resposta.headers.get('retry-after'))
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
    const semCota = resposta.headers.get('x-ratelimit-remaining') === '0'

    if (resposta.status === 401) {
      return {
        ok: false,
        code: 'credencial-recusada',
        mensagem: 'O GitHub recusou o token. Conecte a conta novamente.',
        retryable: false,
        acao: 'reautenticar',
        provenance
      }
    }

    if (resposta.status === 403 || resposta.status === 429) {
      if (retryAfterMs !== undefined || semCota) {
        return {
          ok: false,
          code: 'limite-excedido',
          mensagem: 'O GitHub pediu para esperar antes da próxima chamada.',
          retryable: true,
          acao: 'retentar',
          provenance,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs })
        }
      }

      // 403 sem sinal de cota é falta de acesso — e a ação concreta é a URL de instalação da
      // App, não uma mensagem genérica (spec § decisões cravadas).
      return erroDeInstalacaoAusente(
        GITHUB_APP_SLUG,
        provenance.obtidoEm,
        execution.request.operation
      )
    }

    if (resposta.status >= 500) {
      return {
        ok: false,
        code: 'indisponivel',
        mensagem: 'O GitHub está indisponível no momento.',
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
      evidencia: `HTTP ${resposta.status}`
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
