import { PreviewProviderError } from '../preview-ports'
import type { CommandResult } from './command-runner'

/**
 * Traduz a falha de uma CLI de provedor num código fechado. A saída bruta nunca entra na
 * mensagem: ela pode ecoar token, URL com credencial ou variável de ambiente.
 */

const PADRAO_AUTH =
  /unauthori[sz]ed|not logged in|invalid token|authentication|forbidden|\b40[13]\b|login required/i
const PADRAO_QUOTA =
  /quota|limit (?:reached|exceeded)|rate limit|too many|\b429\b|upgrade your plan/i
const PADRAO_NAO_ENCONTRADO = /not found|does not exist|no such|\b404\b|could not find/i
const PADRAO_CONFLITO = /already exists|conflict|\b409\b|in use|cannot be (?:deleted|removed)/i

export function falhaDeCli(resultado: CommandResult, etapa: string): PreviewProviderError {
  if (resultado.timedOut)
    return new PreviewProviderError('timeout', `A etapa ${etapa} excedeu o tempo limite.`)
  const texto = `${resultado.stderr}\n${resultado.stdout}`
  if (PADRAO_AUTH.test(texto))
    return new PreviewProviderError('auth', `Autenticação recusada na etapa ${etapa}.`)
  if (PADRAO_QUOTA.test(texto))
    return new PreviewProviderError('quota', `Cota do provedor esgotada na etapa ${etapa}.`)
  if (PADRAO_NAO_ENCONTRADO.test(texto))
    return new PreviewProviderError('not-found', `Recurso não encontrado na etapa ${etapa}.`)
  if (PADRAO_CONFLITO.test(texto))
    return new PreviewProviderError('incompatible-state', `Estado incompatível na etapa ${etapa}.`)
  return new PreviewProviderError('failed', `A etapa ${etapa} falhou (código ${resultado.code}).`)
}

export function exigirSucesso(resultado: CommandResult, etapa: string): CommandResult {
  if (resultado.code === 0 && !resultado.timedOut) return resultado
  throw falhaDeCli(resultado, etapa)
}

/** JSON da CLI; saída que não é JSON é falha do provedor, não objeto vazio. */
export function lerJson(resultado: CommandResult, etapa: string): unknown {
  try {
    return JSON.parse(resultado.stdout) as unknown
  } catch {
    throw new PreviewProviderError('failed', `A etapa ${etapa} não devolveu JSON legível.`)
  }
}
