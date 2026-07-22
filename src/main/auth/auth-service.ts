/**
 * Autenticação Google local-first (SPEC-Fundacao-03).
 *
 * O serviço vive no main e é o **único** ponto do app que enxerga token. O renderer recebe
 * `AuthSnapshot` (estado + perfil) e nada mais — é o critério 4 expresso em código: não há
 * método aqui que devolva credencial, então não existe caminho tipado até ela.
 *
 * Local-first (ADR-001): o primeiro login exige internet; depois a sessão cacheada vale por
 * 30 dias sem revalidação online (decisão do PI, questão aberta 2 do ADR-001). Enquanto a
 * janela estiver aberta, relançar offline entra direto.
 *
 * Dependências entram por construtor — Supabase, cofre, auditoria, repositórios e o
 * "abrir navegador" —, o que mantém o fluxo inteiro testável sem rede e sem Electron.
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AUTH_MENSAGENS,
  DESLOGADO,
  OFFLINE_SESSION_MAX_DAYS,
  type AuthErro,
  type AuthSnapshot
} from '@shared/contracts/auth'
import type { Session, UserProfile } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { SessionRepository, UserProfileRepository } from '../storage/repositories'
import { startLoopbackServer } from './loopback-server'
import type { StoredTokens, TokenVault } from './token-vault'

const MS_POR_DIA = 24 * 60 * 60 * 1000

export interface AuthDependencies {
  readonly supabase: SupabaseClient
  readonly vault: TokenVault
  readonly audit: AuditRepository
  readonly profiles: UserProfileRepository
  readonly sessions: SessionRepository
  /** Abre a URL no navegador do sistema. Injetado para o teste não abrir browser real. */
  readonly openExternal: (url: string) => Promise<void>
  /** Avisa o renderer de cada transição. O main empurra; a UI não faz polling. */
  readonly onChange: (snapshot: AuthSnapshot) => void
  /** Injetável para o teste controlar o relógio sem esperar 30 dias. */
  readonly now?: () => Date
}

export class AuthService {
  private snapshot: AuthSnapshot = DESLOGADO

  constructor(private readonly deps: AuthDependencies) {}

  private get agora(): Date {
    return this.deps.now?.() ?? new Date()
  }

  atual(): AuthSnapshot {
    return this.snapshot
  }

  /** Usuário corrente, ou `undefined` quando deslogado. Quem audita precisa disto. */
  usuarioAtual(): UserProfile | undefined {
    return this.snapshot.profile
  }

  /**
   * Publica o novo estado e avisa o renderer. Toda transição passa por aqui — é o ponto
   * único que garante que a UI nunca fique dessincronizada do main.
   */
  private transicionar(snapshot: AuthSnapshot): AuthSnapshot {
    this.snapshot = snapshot
    this.deps.onChange(snapshot)
    return snapshot
  }

  /** Estado de erro com mensagem pronta para a tela (critério 6: sem stack na UI). */
  private falhar(motivo: AuthErro, error?: unknown): AuthSnapshot {
    // O detalhe técnico vai para o log; a UI recebe só a frase do contrato.
    log.auth.error('Falha no fluxo de autenticação', { motivo, error })

    return this.transicionar({
      state: motivo === 'sessao-expirada' ? 'sessao-expirada' : 'erro',
      mensagem: AUTH_MENSAGENS[motivo]
    })
  }

  /**
   * Retoma a sessão do cofre no boot, sem exigir rede (critério 2).
   *
   * A ordem importa: valida a janela offline **antes** de tentar qualquer coisa online.
   * Um app que precisa da rede para descobrir que pode operar offline não é local-first.
   */
  async restaurar(): Promise<AuthSnapshot> {
    const tokens = this.deps.vault.read()
    if (!tokens) return this.transicionar(DESLOGADO)

    const sessao = this.deps.sessions.findActive(this.userIdDeToken(tokens))
    if (!sessao) {
      // Cofre sem metadados = estado inconsistente; trata como deslogado em vez de
      // confiar num token cuja validade não dá para situar no tempo.
      this.deps.vault.clear()
      return this.transicionar(DESLOGADO)
    }

    if (this.janelaOfflineVencida(sessao)) {
      // Passou dos 30 dias: exige reautenticação, mesmo com token no disco.
      this.deps.vault.clear()
      this.deps.sessions.deleteForUser(sessao.user_id)
      return this.falhar('sessao-expirada')
    }

    const profile = this.deps.profiles.findById(sessao.user_id)
    if (!profile) {
      this.deps.vault.clear()
      return this.transicionar(DESLOGADO)
    }

    // Reuso de sessão é evento auditável (critério 5) — é a prova de que o app entrou
    // sem passar pelo provedor de identidade naquele boot.
    this.deps.audit.append({
      user_id: profile.id,
      type: 'login-offline-reuse',
      payload: { expiresAt: sessao.expires_at }
    })

    log.auth.info('Sessão restaurada do cofre local', { expiresAt: sessao.expires_at })

    return this.transicionar({
      state: 'ativo',
      profile,
      expiresAt: sessao.expires_at
    })
  }

  /**
   * Login Google completo: abre o navegador, espera o loopback, troca o código por sessão.
   *
   * O `code` só vira sessão através do `exchangeCodeForSession` do Supabase (PKCE): o
   * `code_verifier` fica no cliente e nunca sai daqui, então interceptar o redirect não
   * basta para forjar a sessão.
   */
  async login(): Promise<AuthSnapshot> {
    this.transicionar({ state: 'autenticando' })

    let handle: Awaited<ReturnType<typeof startLoopbackServer>> | undefined

    try {
      handle = await startLoopbackServer()

      const { data, error } = await this.deps.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: handle.redirectUri,
          // O app abre a URL no navegador do sistema; o supabase-js não redireciona
          // sozinho porque aqui não existe `window.location`.
          skipBrowserRedirect: true
        }
      })

      if (error || !data?.url) return this.falhar('falha-no-provedor', error)

      await this.deps.openExternal(data.url)
      log.auth.info('Fluxo de login aberto no navegador do sistema')

      const retorno = await handle.resultado

      if (retorno.error) return this.falhar('cancelado-pelo-usuario', retorno.error)
      if (!retorno.code) return this.falhar('falha-no-provedor')

      const troca = await this.deps.supabase.auth.exchangeCodeForSession(retorno.code)
      if (troca.error || !troca.data?.session) {
        return this.falhar('falha-no-provedor', troca.error)
      }

      return this.concluirLogin(troca.data.session)
    } catch (error) {
      // Sem rede o `signInWithOAuth` estoura antes de abrir o navegador; a mensagem
      // precisa dizer isso, e não "falha no provedor", que mandaria o usuário tentar
      // de novo contra a causa errada.
      return this.falhar(this.classificar(error), error)
    } finally {
      handle?.close()
    }
  }

  /**
   * Persiste sessão, perfil e tokens; audita e ativa.
   *
   * Grava perfil e metadados **antes** dos tokens: um cofre com token cujo perfil não
   * existe é o estado inconsistente que o `restaurar()` teria de limpar no boot seguinte.
   */
  private concluirLogin(sessao: {
    access_token: string
    refresh_token: string
    expires_at?: number
    user: { id: string; email?: string; user_metadata?: Record<string, unknown> }
  }): AuthSnapshot {
    const agora = this.agora
    const nome =
      typeof sessao.user.user_metadata?.full_name === 'string'
        ? sessao.user.user_metadata.full_name
        : (sessao.user.email ?? 'Usuário')

    // Preserva as preferências de quem já entrou antes: `save` só atualiza identidade
    // (ver `UserProfileRepository.save`), então idioma e tema escolhidos sobrevivem.
    const existente = this.deps.profiles.findById(sessao.user.id)
    const profile = this.deps.profiles.save({
      id: sessao.user.id,
      name: nome,
      email: sessao.user.email ?? '',
      locale: existente?.locale ?? 'pt-BR',
      theme: existente?.theme ?? 'sistema'
    })

    const expiresAt = new Date(agora.getTime() + OFFLINE_SESSION_MAX_DAYS * MS_POR_DIA)
    const metadados: Session = {
      id: randomUUID(),
      user_id: profile.id,
      expires_at: expiresAt.toISOString(),
      last_online_auth_at: agora.toISOString(),
      created_at: agora.toISOString()
    }

    this.deps.sessions.deleteForUser(profile.id)
    this.deps.sessions.save(metadados)

    this.deps.vault.write({
      accessToken: sessao.access_token,
      refreshToken: sessao.refresh_token,
      expiresAt: sessao.expires_at ?? Math.floor(expiresAt.getTime() / 1000)
    })

    this.deps.audit.append({
      user_id: profile.id,
      type: 'login',
      payload: { metodo: 'google', expiresAt: metadados.expires_at }
    })

    // `email` fica fora do ctx: é dado pessoal, e a redaction do ADR-005 mascara
    // `personal`. O que interessa ao diagnóstico é que houve login e até quando ele vale.
    log.auth.info('Login concluído', { expiresAt: metadados.expires_at })

    return this.transicionar({
      state: 'ativo',
      profile,
      expiresAt: metadados.expires_at
    })
  }

  /**
   * Logout: revoga no servidor quando dá, e **sempre** limpa o local (critério 3).
   *
   * A ordem é deliberada: a limpeza local não pode depender da rede. Se `signOut` falhar
   * offline e isso abortasse o logout, o usuário ficaria preso numa sessão que pediu para
   * encerrar — o pior resultado possível numa máquina compartilhada.
   */
  async logout(): Promise<AuthSnapshot> {
    const profile = this.snapshot.profile

    try {
      await this.deps.supabase.auth.signOut()
    } catch (error) {
      log.auth.warn('Falha ao revogar a sessão no servidor; seguindo com a limpeza local', {
        error
      })
    }

    this.deps.vault.clear()

    if (profile) {
      this.deps.sessions.deleteForUser(profile.id)
      this.deps.audit.append({ user_id: profile.id, type: 'logout', payload: {} })
    }

    log.auth.info('Logout concluído; estado local limpo')

    return this.transicionar(DESLOGADO)
  }

  /** Vencida quando passou a janela de 30 dias desde a última autenticação online. */
  private janelaOfflineVencida(sessao: Session): boolean {
    return this.agora.getTime() > new Date(sessao.expires_at).getTime()
  }

  /**
   * Descobre de quem é o token guardado sem decodificar o JWT.
   *
   * O cofre não guarda `user_id` e decodificar a claim aqui significaria confiar no
   * conteúdo do token — que é o que o Supabase valida, não o app. A sessão mais recente
   * do SQLite responde a pergunta: só existe uma por vez (o login apaga as anteriores).
   */
  private userIdDeToken(_tokens: StoredTokens): string {
    const linha = this.deps.sessions.findMostRecent()
    return linha?.user_id ?? ''
  }

  /** Traduz a exceção para o enum fechado do contrato (critério 6). */
  private classificar(error: unknown): AuthErro {
    const mensagem = error instanceof Error ? error.message.toLowerCase() : ''

    if (
      mensagem.includes('fetch failed') ||
      mensagem.includes('enotfound') ||
      mensagem.includes('econnrefused') ||
      mensagem.includes('network')
    ) {
      return 'sem-conexao'
    }

    if (mensagem.includes('tempo esgotado')) return 'cancelado-pelo-usuario'

    return 'falha-no-provedor'
  }
}
