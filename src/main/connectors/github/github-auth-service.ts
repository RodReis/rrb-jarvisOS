/**
 * O Device Flow do GitHub App, rodando (SPEC-Conectores-03).
 *
 * As decisões puras moram em `@shared/domain/github-auth`; aqui ficam os **efeitos** — a
 * requisição, a espera, o cofre, a auditoria. A separação é a mesma de `connector-service.ts`
 * sobre `connector-governance.ts`, e é o que permite provar `slow_down` sem rede e provar
 * "o token não vaza" sem relógio.
 *
 * Três garantias que este arquivo carrega e nenhum outro:
 *
 * 1. **Nenhum segredo de servidor sai daqui** (critério 1). O Device Flow do GitHub App não usa
 *    client secret nem private key — nem para o token inicial, nem para o refresh (a doc é
 *    explícita: "required unless the token was generated using the device flow"). Não há campo
 *    onde um segredo caberia, o que é mais forte que a disciplina de não preenchê-lo.
 * 2. **Token e refresh token nunca chegam ao renderer** (critério 2). O que este serviço devolve
 *    para fora é `GithubAuthSnapshot`, e ele não tem campo onde um token caiba — mesma forma do
 *    `CredentialStatusView` da M5-F01.
 * 3. **O polling termina** (critério 3). O laço é governado por `interpretarRespostaDeToken`, que
 *    é união fechada, mais duas saídas próprias: o prazo do grant e o `AbortSignal`.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { ConnectorError, ConnectorErrorCode } from '@shared/domain/connectors'
import {
  GITHUB_ACCESS_TOKEN_PATH,
  GITHUB_DEVICE_CODE_PATH,
  grantExpirou,
  interpretarRespostaDeToken,
  lerGrantDeDeviceCode,
  lerPayloadDeToken,
  origemDoOAuth,
  precisaRenovar,
  resolverClientId,
  type DeviceCodeGrant,
  type GithubAuthSnapshot,
  type GithubDeviceFlowView,
  type GithubOAuthPayload
} from '@shared/domain/github-auth'
import { log } from '../../logging/logger'
import type { AuditRepository } from '../../storage/audit-repository'
import type { CredentialRepository } from '../../credentials/credential-repository'

/** A chave do cofre onde o payload OAuth do GitHub mora. */
export const GITHUB_VAULT_KEY = 'github' as const

/** Quem está autenticando: o mesmo par de escopo do vault e do `ConnectorCallContext`. */
export interface GithubAuthContext {
  readonly userId: string
  readonly workspace: WorkspaceId
}

/** Um Device Flow em andamento, do lado de cá. */
interface FluxoEmAndamento {
  readonly grant: DeviceCodeGrant
  readonly controller: AbortController
  readonly view: GithubDeviceFlowView
}

/** A resposta HTTP reduzida ao que este serviço precisa — o que permite dublar `fetch`. */
export type BuscadorHttp = (url: string, init: RequestInit) => Promise<Response>

export class GithubAuthService {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly audit: AuditRepository,
    /**
     * Como o `client_id` override é lido. Função e não valor, porque o usuário pode editá-lo no
     * Settings entre dois fluxos e o serviço vive o processo inteiro.
     */
    private readonly clientIdOverride: (ctx: GithubAuthContext) => string | undefined,
    /** Injetável para o teste não tocar a rede. O default é o `fetch` do runtime. */
    private readonly buscar: BuscadorHttp = (url, init) => fetch(url, init),
    /**
     * Espera entre pollings. Injetável pelo mesmo motivo do `esperar` do `ConnectorService`: o
     * teste precisa afirmar **quanto** se esperou, não gastar o relógio esperando.
     */
    private readonly esperar: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly agora: () => number = () => Date.now(),
    /**
     * A origem do OAuth. Lida do **ambiente do main** e não de configuração da UI: existe para
     * o E2E poder apontar o fluxo a um servidor local que conta requisições, e nenhum canal
     * IPC a alcança (ver `origemDoOAuth`).
     */
    private readonly origem: string = origemDoOAuth(process.env.GITHUB_OAUTH_ORIGIN)
  ) {}

  /**
   * Os fluxos abertos, por escopo.
   *
   * Em memória e não no banco, pela mesma razão do circuito da F02: é estado **desta sessão**.
   * Um device code sobrevivente de um boot anterior já expirou (15 minutos), e persisti-lo faria
   * o app reabrir apontando para um código que o GitHub esqueceu.
   */
  private readonly fluxos = new Map<string, FluxoEmAndamento>()

  private chave(ctx: GithubAuthContext): string {
    return `${ctx.userId}:${ctx.workspace}`
  }

  /**
   * O estado da credencial, sem decifrar nada quando não precisa.
   *
   * O caminho que a tela chama a cada render: pergunta ao cofre se a linha existe e quando ela
   * vence — as duas coisas legíveis sem DPAPI. Só quando precisa saber se **é renovável** é que
   * o payload é lido, e mesmo aí nada dele sai deste método.
   */
  snapshot(ctx: GithubAuthContext): GithubAuthSnapshot {
    const clientIdConfigurado = resolverClientId(this.clientIdOverride(ctx)) !== undefined
    const linha = this.credentials.find(ctx.userId, ctx.workspace, GITHUB_VAULT_KEY)

    if (linha === undefined) {
      return { estado: 'missing', renovavel: false, clientIdConfigurado }
    }

    const expiraEm = this.credentials.expiresAt(ctx.userId, ctx.workspace, GITHUB_VAULT_KEY)
    const payload = this.lerPayload(ctx)

    // Payload ilegível (cofre de outra máquina) é o mesmo desfecho de "não autenticado": não há
    // token utilizável, e dizer `present` faria a tela oferecer um botão que sempre falha.
    if (payload === undefined) {
      return { estado: 'missing', renovavel: false, clientIdConfigurado }
    }

    const vencido = expiraEm !== undefined && Date.parse(expiraEm) <= this.agora()

    return {
      estado: vencido ? 'expirado' : 'present',
      ...(expiraEm === undefined ? {} : { expiraEm }),
      renovavel: payload.refreshToken !== undefined,
      clientIdConfigurado
    }
  }

  /**
   * Abre o Device Flow: pede os códigos ao GitHub e devolve o que a tela mostra.
   *
   * **Não** faz o polling — quem o faz é `aguardarAutorizacao`, chamado logo depois. Separados
   * porque a tela precisa mostrar o código **antes** de a espera começar: um método único só
   * devolveria algo quando o usuário já tivesse autorizado, e ele nunca saberia o que digitar.
   */
  async iniciar(ctx: GithubAuthContext): Promise<GithubDeviceFlowView | ConnectorError> {
    const clientId = resolverClientId(this.clientIdOverride(ctx))
    if (clientId === undefined) {
      return this.erro(
        'credencial-ausente',
        'Nenhum client ID de GitHub App configurado. Informe um em Configurações.',
        'auth.device-flow',
        'reautenticar'
      )
    }

    // Um fluxo por escopo: abrir o segundo aborta o primeiro. Deixar os dois vivos faria dois
    // laços perguntarem por códigos diferentes, e o token do perdedor sobrescreveria o do
    // vencedor conforme a ordem de chegada.
    this.cancelar(ctx)

    let resposta: Response
    try {
      resposta = await this.buscar(`${this.origem}${GITHUB_DEVICE_CODE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ client_id: clientId }).toString()
      })
    } catch (error) {
      return this.erro(
        'indisponivel',
        'Não foi possível falar com o GitHub para iniciar a autenticação.',
        'auth.device-flow',
        'retentar',
        true,
        error
      )
    }

    const corpo = await this.lerJson(resposta)
    if (corpo === undefined) {
      return this.erro(
        'resposta-invalida',
        'O GitHub respondeu de forma inesperada ao iniciar a autenticação.',
        'auth.device-flow',
        'reportar'
      )
    }

    const grant = lerGrantDeDeviceCode(corpo, this.agora())
    if (grant === undefined) {
      // Erro nomeado do GitHub no lugar do grant (client_id inválido, por exemplo) passa pelo
      // mesmo interpretador do polling: um só lugar traduz erro do GitHub em código nosso.
      const decisao = interpretarRespostaDeToken(corpo, 0, this.agora())
      const code = decisao.tipo === 'falhou' ? decisao.code : 'resposta-invalida'
      const mensagem =
        decisao.tipo === 'falhou'
          ? decisao.mensagem
          : 'O GitHub não devolveu um código de dispositivo.'
      return this.erro(code, mensagem, 'auth.device-flow', 'reautenticar')
    }

    const view: GithubDeviceFlowView = {
      userCode: grant.userCode,
      verificationUri: grant.verificationUri,
      expiraEm: grant.expiraEm
    }

    this.fluxos.set(this.chave(ctx), { grant, controller: new AbortController(), view })

    this.auditar(ctx, 'inicio')
    // Sem `userCode` no log: ele é efêmero por desenho, e o log é o que sobrevive à sessão.
    log.integracao.info('Device Flow do GitHub aberto', { connector: 'github' })

    return view
  }

  /**
   * Faz o polling até um desfecho e, no sucesso, grava o payload no cofre.
   *
   * As quatro saídas do critério 3, todas presentes: sucesso (grava e devolve o snapshot),
   * cancelamento (`AbortSignal`, por `cancelar`), expiração (prazo do grant **e** `expired_token`
   * do GitHub) e erro normalizado. Não há caminho que volte ao topo do laço sem passar por uma
   * decisão que possa terminá-lo.
   */
  async aguardarAutorizacao(ctx: GithubAuthContext): Promise<GithubAuthSnapshot | ConnectorError> {
    const fluxo = this.fluxos.get(this.chave(ctx))
    if (fluxo === undefined) {
      return this.erro(
        'validacao-invalida',
        'Nenhuma autenticação em andamento. Inicie o fluxo antes de aguardar.',
        'auth.device-flow',
        'corrigir-entrada'
      )
    }

    const clientId = resolverClientId(this.clientIdOverride(ctx))
    if (clientId === undefined) {
      return this.erro(
        'credencial-ausente',
        'Nenhum client ID de GitHub App configurado. Informe um em Configurações.',
        'auth.device-flow',
        'reautenticar'
      )
    }

    let intervaloMs = fluxo.grant.intervaloMs

    for (;;) {
      if (fluxo.controller.signal.aborted) {
        this.fluxos.delete(this.chave(ctx))
        this.auditar(ctx, 'cancelado')
        return this.erro(
          'cancelado',
          'A autenticação foi cancelada.',
          'auth.device-flow',
          'reportar'
        )
      }

      // A expiração é conferida **antes** de perguntar, não depois: um grant vencido só renderia
      // um `expired_token` do GitHub, e gastar uma requisição para descobrir o que o relógio já
      // sabe é a chamada que não precisava sair.
      if (grantExpirou(fluxo.grant, this.agora())) {
        this.fluxos.delete(this.chave(ctx))
        this.auditar(ctx, 'falhou', 'credencial-ausente')
        return this.erro(
          'credencial-ausente',
          'O código expirou antes de ser autorizado. Recomece a autenticação.',
          'auth.device-flow',
          'reautenticar'
        )
      }

      await this.esperar(intervaloMs)

      let corpo: Record<string, unknown> | undefined
      try {
        const resposta = await this.buscar(`${this.origem}${GITHUB_ACCESS_TOKEN_PATH}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: clientId,
            device_code: fluxo.grant.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          }).toString(),
          signal: fluxo.controller.signal
        })
        corpo = await this.lerJson(resposta)
      } catch (error) {
        // Abortar durante a requisição cai aqui; o topo do laço decide, para que "cancelado"
        // tenha um caminho só.
        if (fluxo.controller.signal.aborted) continue

        this.fluxos.delete(this.chave(ctx))
        this.auditar(ctx, 'falhou', 'indisponivel')
        return this.erro(
          'indisponivel',
          'A conexão com o GitHub falhou durante a autenticação.',
          'auth.device-flow',
          'retentar',
          true,
          error
        )
      }

      if (corpo === undefined) {
        this.fluxos.delete(this.chave(ctx))
        this.auditar(ctx, 'falhou', 'resposta-invalida')
        return this.erro(
          'resposta-invalida',
          'O GitHub respondeu de forma inesperada durante a autenticação.',
          'auth.device-flow',
          'reportar'
        )
      }

      const decisao = interpretarRespostaDeToken(corpo, intervaloMs, this.agora())

      if (decisao.tipo === 'esperar') {
        intervaloMs = decisao.intervaloMs
        continue
      }

      this.fluxos.delete(this.chave(ctx))

      if (decisao.tipo === 'falhou') {
        this.auditar(ctx, decisao.code === 'cancelado' ? 'cancelado' : 'falhou', decisao.code)
        return this.erro(
          decisao.code,
          decisao.mensagem,
          'auth.device-flow',
          decisao.code === 'cancelado' ? 'reportar' : 'reautenticar'
        )
      }

      this.gravar(ctx, decisao.payload)
      this.auditar(ctx, 'autorizado')
      log.integracao.info('GitHub autenticado pelo Device Flow', { connector: 'github' })

      return this.snapshot(ctx)
    }
  }

  /** Cancela o fluxo em andamento daquele escopo. No-op quando não há nenhum. */
  cancelar(ctx: GithubAuthContext): void {
    const fluxo = this.fluxos.get(this.chave(ctx))
    if (fluxo === undefined) return

    fluxo.controller.abort()
    // A entrada não é removida aqui: quem a remove é o laço, ao observar o `aborted` e auditar.
    // Removê-la dos dois lados faria o laço achar que o fluxo nunca existiu e devolver
    // "nenhuma autenticação em andamento" no lugar de "cancelado".
  }

  /**
   * O token pronto para uso — **renovado antes do uso quando preciso** (critério 5).
   *
   * É o método que os adapters da F04 chamarão. Devolve o valor cru porque roda dentro do main,
   * como o `resolve` do `CredentialService`; `undefined` significa "não autenticado", que é o
   * desfecho que o `ConnectorService` já traduz em `credencial-ausente`.
   */
  async tokenParaUso(ctx: GithubAuthContext): Promise<string | undefined> {
    const payload = this.lerPayload(ctx)
    if (payload === undefined) return undefined

    if (!precisaRenovar(payload, this.agora())) return payload.accessToken

    const renovado = await this.renovar(ctx, payload)
    // Renovação falhada com token ainda válido (dentro da margem) devolve o que há: barrar uma
    // chamada que ainda funcionaria transformaria um problema temporário do refresh em uma
    // indisponibilidade que o usuário não causou.
    if (renovado === undefined) {
      return Date.parse(payload.expiraEm ?? '') > this.agora() ? payload.accessToken : undefined
    }

    return renovado.accessToken
  }

  /**
   * Troca o refresh token por um par novo e o grava **atomicamente** (critério 4).
   *
   * A atomicidade não está aqui: está no `upsertPayload`, que é uma escrita só. O que este
   * método garante é que a escrita **só acontece com o par completo em mãos** — em nenhum ponto
   * o cofre recebe o access token novo antes de o refresh novo existir. Falha de refresh
   * devolve `undefined` e não toca o cofre: a credencial antiga continua inteira.
   */
  private async renovar(
    ctx: GithubAuthContext,
    atual: GithubOAuthPayload
  ): Promise<GithubOAuthPayload | undefined> {
    if (atual.refreshToken === undefined) return undefined

    const clientId = resolverClientId(this.clientIdOverride(ctx))
    if (clientId === undefined) return undefined

    try {
      const resposta = await this.buscar(`${this.origem}${GITHUB_ACCESS_TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        // Sem `client_secret`: o refresh de um token nascido do Device Flow não o exige, e é por
        // isso que o critério 1 ("nenhum segredo de servidor é distribuído") se sustenta no
        // desktop. Não há campo aqui onde um segredo caberia.
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: atual.refreshToken
        }).toString()
      })

      const corpo = await this.lerJson(resposta)
      const novo = corpo === undefined ? undefined : lerPayloadDeToken(corpo, this.agora())

      if (novo === undefined) {
        this.auditar(ctx, 'falhou', 'credencial-recusada')
        log.integracao.warn('Renovação do token do GitHub recusada', { connector: 'github' })
        return undefined
      }

      this.gravar(ctx, novo)
      this.auditar(ctx, 'renovado')
      return novo
    } catch (error) {
      this.auditar(ctx, 'falhou', 'indisponivel')
      log.integracao.warn('Renovação do token do GitHub falhou por rede', {
        connector: 'github',
        error
      })
      return undefined
    }
  }

  /**
   * Desconecta: apaga a credencial e o fluxo em andamento (critério 6).
   *
   * O GitHub **não expõe endpoint para uma App revogar seu próprio user token sem client secret**
   * — o `DELETE /applications/{client_id}/token` exige autenticação básica com o secret, que este
   * desktop não tem e não deve ter. Então "revoga ou remove conforme a capacidade disponível" se
   * resolve pela remoção local, e a tela diz onde revogar de fato (as autorizações da conta).
   * Fingir uma revogação que não aconteceu seria pior que não a oferecer.
   */
  logout(ctx: GithubAuthContext): GithubAuthSnapshot {
    this.cancelar(ctx)
    this.fluxos.delete(this.chave(ctx))

    const removeu = this.credentials.remove(ctx.userId, ctx.workspace, GITHUB_VAULT_KEY)
    if (removeu) {
      this.auditar(ctx, 'logout')
      log.integracao.info('Credencial do GitHub removida no logout', { connector: 'github' })
    }

    return this.snapshot(ctx)
  }

  private lerPayload(ctx: GithubAuthContext): GithubOAuthPayload | undefined {
    return this.credentials.readPayload<GithubOAuthPayload>(
      ctx.userId,
      ctx.workspace,
      GITHUB_VAULT_KEY
    )
  }

  private gravar(ctx: GithubAuthContext, payload: GithubOAuthPayload): void {
    this.credentials.upsertPayload(
      ctx.userId,
      ctx.workspace,
      GITHUB_VAULT_KEY,
      payload,
      payload.expiraEm
    )
  }

  /**
   * Lê o corpo como JSON. `undefined` quando não é JSON — o que acontece quando o GitHub devolve
   * HTML de erro (502 de proxy, manutenção). Sem `try`, um `JSON.parse` sobre HTML lançaria uma
   * exceção cuja mensagem cita o corpo, e o corpo pode conter o que não deve ir para o log.
   */
  private async lerJson(resposta: Response): Promise<Record<string, unknown> | undefined> {
    try {
      const dados: unknown = await resposta.json()
      return typeof dados === 'object' && dados !== null
        ? (dados as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }

  private erro(
    code: ConnectorErrorCode,
    mensagem: string,
    operation: string,
    acao: ConnectorError['acao'],
    retryable = false,
    causa?: unknown
  ): ConnectorError {
    return {
      ok: false,
      code,
      mensagem,
      retryable,
      acao,
      provenance: {
        connector: 'github',
        operation,
        obtidoEm: new Date(this.agora()).toISOString()
      },
      // Só a classe do erro, nunca a mensagem: a de rede pode citar URL com query, e a do
      // `JSON.parse` cita o corpo. O nome do construtor diz o que houve sem carregar conteúdo.
      ...(causa instanceof Error ? { evidencia: causa.name } : {})
    }
  }

  /**
   * Registra a fase na cadeia. **Nunca** o device code, o user code, o token ou o refresh token
   * (ADR-004) — o payload tem só fase, conector e o código de erro normalizado.
   */
  private auditar(
    ctx: GithubAuthContext,
    fase: 'inicio' | 'autorizado' | 'renovado' | 'cancelado' | 'logout' | 'falhou',
    code?: ConnectorErrorCode
  ): void {
    this.audit.append({
      user_id: ctx.userId,
      workspace_id: ctx.workspace,
      type: 'connector-auth',
      payload: { connector: 'github', fase, ...(code === undefined ? {} : { code }) }
    })
  }
}
