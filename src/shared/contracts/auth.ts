/**
 * Contrato de autenticação (SPEC-Fundacao-03).
 *
 * Mora em `src/shared` pelo mesmo motivo dos demais contratos: renderer, main e testes
 * falam a mesma língua, e a regra precisa ser verificável sem carregar o Electron.
 *
 * A fronteira que este arquivo existe para manter (critério 4 da spec): **nenhum tipo
 * daqui carrega token**. O que o renderer enxerga é o `AuthSnapshot` — estado + perfil.
 * O segredo vive cifrado no `safeStorage`/DPAPI, alcançável só pelo main; não há tipo
 * aqui que o descreva, justamente para que não exista caminho tipado até ele.
 */

import type { UserProfile } from '../domain/entities'

/**
 * Estados explícitos de auth (SPEC-03 § Escopo).
 *
 * `sessao-expirada` é distinto de `deslogado` de propósito: o usuário tinha sessão e ela
 * venceu — a UI precisa dizer isso e oferecer reautenticar, em vez de tratar como quem
 * nunca entrou. `erro` guarda a falha do fluxo, que é recuperável por nova tentativa.
 */
export const AUTH_STATES = [
  'deslogado',
  'autenticando',
  'ativo',
  'erro',
  'sessao-expirada'
] as const

export type AuthState = (typeof AUTH_STATES)[number]

export function isAuthState(value: unknown): value is AuthState {
  return typeof value === 'string' && (AUTH_STATES as readonly string[]).includes(value)
}

/**
 * Janela de operação offline: 30 dias sem revalidação online (decisão do PI, questão
 * aberta 2 do ADR-001). Passado isso, o app exige reautenticação mesmo com token em disco.
 */
export const OFFLINE_SESSION_MAX_DAYS = 30

/**
 * O que o renderer vê sobre a autenticação. É o contrato completo do lado da UI.
 *
 * `profile` é o snapshot mínimo da spec (nome, e-mail, idioma) e vem do `UserProfile` da
 * F04 — sem token, sem id de provedor, sem claim do JWT. `mensagem` carrega texto pronto
 * para exibir: o critério 6 proíbe stack trace na UI, então quem formata é o main, e o
 * renderer só pinta o que recebe.
 */
export interface AuthSnapshot {
  readonly state: AuthState
  /** Presente apenas em `ativo` — nos demais estados não há usuário para mostrar. */
  readonly profile?: UserProfile
  /** Frase curta em pt-BR para a UI. Sem stack, sem detalhe técnico (critério 6). */
  readonly mensagem?: string
  /** ISO-8601 do vencimento da janela offline. Deixa a UI avisar antes de expirar. */
  readonly expiresAt?: string
}

/** Snapshot de quem ainda não entrou. Constante para os call sites não remontarem o objeto. */
export const DESLOGADO: AuthSnapshot = { state: 'deslogado' }

/**
 * Motivos de falha do fluxo, na forma que o main resolve para mensagem.
 *
 * Enum fechado em vez de string livre: a mensagem exibida precisa ser previsível e
 * traduzível, e um `error.message` cru vindo do Supabase ou da rede é exatamente o
 * vazamento de detalhe técnico que o critério 6 proíbe.
 */
export const AUTH_ERROS = [
  'sem-conexao',
  'cancelado-pelo-usuario',
  'credenciais-ausentes',
  'falha-no-provedor',
  'sessao-expirada'
] as const

export type AuthErro = (typeof AUTH_ERROS)[number]

/** Mensagens da UI por motivo. pt-BR, curtas, sem jargão e sem stack (critério 6). */
export const AUTH_MENSAGENS: Readonly<Record<AuthErro, string>> = {
  'sem-conexao': 'Sem conexão com a internet. Verifique a rede e tente entrar de novo.',
  'cancelado-pelo-usuario': 'Login cancelado.',
  'credenciais-ausentes':
    'O aplicativo não está configurado para login. Verifique as credenciais no arquivo .env.',
  'falha-no-provedor': 'Não foi possível concluir o login com o Google. Tente novamente.',
  'sessao-expirada': 'Sua sessão expirou. Entre novamente para continuar.'
}
