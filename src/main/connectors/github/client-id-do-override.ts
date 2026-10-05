/**
 * A gravação do override do `client_id` da GitHub App (SPEC-Conectores-03, regra 7).
 *
 * Fica fora do handler de IPC para a **fronteira de confiança** ter teste próprio: o renderer valida
 * antes, mas o `main` não pode confiar nisso — a coluna é texto puro justamente porque o `client_id`
 * não é segredo, e um valor com forma de token ou de client secret não pode ir para ela.
 */

import { MENSAGEM_DO_CLIENT_ID, validarClientId } from '@shared/domain/github-auth'

export interface PerfilParaOClientId {
  readonly saveGithubClientId: (userId: string, clientId: string | undefined) => void
}

export interface PerfilComLeituraDoClientId extends PerfilParaOClientId {
  readonly findGithubClientId: (userId: string) => string | undefined
}

/**
 * Valida e grava. **Lança** com a mensagem de produto quando o valor não é um `client_id` — e a
 * mensagem nunca ecoa o valor recusado, que pode ser um segredo colado por engano.
 *
 * Qualquer coisa que não seja texto vira "limpar" (voltar ao client ID de fábrica): um objeto
 * gravado aqui viraria `[object Object]` na URL do Device Flow.
 */
export function gravarClientIdDoOverride(
  perfil: PerfilParaOClientId,
  userId: string,
  bruto: unknown
): void {
  const validado = validarClientId(typeof bruto === 'string' ? bruto : '')
  if (!validado.ok) throw new Error(MENSAGEM_DO_CLIENT_ID[validado.problema])
  perfil.saveGithubClientId(userId, validado.clientId)
}

/**
 * Apaga o override salvo que **não é um `client_id`** — um valor gravado antes de a validação
 * existir (um token colado no campo, por exemplo). `resolverClientId` já o ignora, então ele não vai
 * ao GitHub; aqui ele deixa o **disco**: a coluna é texto puro e, se o valor era um segredo, mantê-lo
 * é manter o segredo em claro (e em backup) sem nenhum uso. Devolve se apagou. Nunca lê o valor para
 * fora: só decide e apaga.
 */
export function limparOverrideInvalido(
  perfil: PerfilComLeituraDoClientId,
  userId: string
): boolean {
  const salvo = perfil.findGithubClientId(userId)
  if (salvo === undefined || validarClientId(salvo).ok) return false
  perfil.saveGithubClientId(userId, undefined)
  return true
}
