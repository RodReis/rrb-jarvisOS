/**
 * Cliente Supabase do main (ADR-002).
 *
 * Duas adaptações que o ambiente exige, ambas por não haver navegador aqui:
 *
 * 1. **Storage adapter sobre o cofre.** O supabase-js persiste sessão em `localStorage`
 *    por padrão; no main isso não existe, e mesmo que existisse gravaria token em claro.
 *    O adapter redireciona a persistência para o `safeStorage`/DPAPI (critério 7).
 * 2. **`detectSessionInUrl: false`.** Não há `window.location` para inspecionar — quem
 *    captura o código é o servidor loopback, e a troca é explícita no `AuthService`.
 *
 * A chave usada é a **publicável**. A `service_role` ignora RLS e nunca entra num app
 * distribuído ao usuário final — está dito no `.env.example` e vale como regra.
 */

import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js'
import type { TokenVault } from './token-vault'

/** Credenciais lidas do ambiente. Ausentes = login indisponível, app segue funcionando. */
export interface SupabaseConfig {
  readonly url: string
  readonly publishableKey: string
}

/**
 * Lê as credenciais do ambiente. Devolve `undefined` quando faltam, em vez de lançar:
 * sem elas o app roda normalmente e só o login fica indisponível (`.env.example`), que é
 * o comportamento esperado por quem clona o repo sem projeto Supabase.
 */
export function readSupabaseConfig(
  env: NodeJS.ProcessEnv = process.env
): SupabaseConfig | undefined {
  const url = env.SUPABASE_URL?.trim()
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) return undefined

  return { url, publishableKey }
}

/**
 * Adapter que faz o supabase-js persistir no cofre cifrado.
 *
 * O supabase-js guarda um JSON de sessão inteiro sob uma chave própria; aqui ele é mapeado
 * para os três campos que o cofre conhece. Só a chave de sessão é atendida — qualquer
 * outra (o `code_verifier` do PKCE, efêmero) fica em memória, que é onde deve ficar.
 */
export function createVaultStorage(vault: TokenVault): SupportedStorage {
  const efemeros = new Map<string, string>()

  const ehChaveDeSessao = (key: string): boolean => key.endsWith('-auth-token')

  return {
    getItem: (key) => {
      if (!ehChaveDeSessao(key)) return efemeros.get(key) ?? null

      const tokens = vault.read()
      if (!tokens) return null

      return JSON.stringify({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt
      })
    },
    setItem: (key, value) => {
      if (!ehChaveDeSessao(key)) {
        efemeros.set(key, value)
        return
      }

      try {
        const parsed = JSON.parse(value) as {
          access_token?: string
          refresh_token?: string
          expires_at?: number
        }

        if (!parsed.access_token || !parsed.refresh_token) return

        vault.write({
          accessToken: parsed.access_token,
          refreshToken: parsed.refresh_token,
          expiresAt: parsed.expires_at ?? 0
        })
      } catch {
        // Valor fora do formato esperado não vira gravação silenciosa de lixo no cofre.
      }
    },
    removeItem: (key) => {
      if (ehChaveDeSessao(key)) vault.clear()
      else efemeros.delete(key)
    }
  }
}

export function createSupabaseClient(config: SupabaseConfig, vault: TokenVault): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // Não há URL de navegador para inspecionar; o loopback entrega o código.
      detectSessionInUrl: false,
      storage: createVaultStorage(vault)
    }
  })
}
