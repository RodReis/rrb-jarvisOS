/**
 * Cofre dos tokens da sessão — selado no `safeStorage`/DPAPI (SPEC-03, critério 7).
 *
 * Mesma forma do `audit-key.ts`, e pelo mesmo motivo: é o único arquivo desta pasta que
 * toca o Electron. O `AuthService` recebe o cofre por parâmetro e por isso continua
 * testável sem subir o app.
 *
 * O que este arquivo garante: o refresh token **nunca** encosta no disco em claro. O que
 * ele não garante (limite honesto, igual ao do ADR-004): num host single-user, quem tem o
 * mesmo usuário do SO destrava o DPAPI. A proteção é contra leitura do arquivo por outro
 * usuário ou por cópia do disco — não contra o próprio dono da máquina.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { log } from '../logging/logger'

/**
 * O segredo guardado. Espelha o que o Supabase devolve na sessão, reduzido ao necessário
 * para retomar: nada de claim decodificada, nada de perfil — perfil mora no SQLite.
 */
export interface StoredTokens {
  readonly accessToken: string
  readonly refreshToken: string
  /** Epoch em segundos, como o Supabase entrega. */
  readonly expiresAt: number
}

/**
 * Contrato do cofre. Existe para o `AuthService` depender de uma interface e não do
 * `safeStorage` — é o que permite testá-lo com um cofre em memória.
 */
export interface TokenVault {
  read(): StoredTokens | undefined
  write(tokens: StoredTokens): void
  clear(): void
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) return false
  const candidato = value as Record<string, unknown>
  return (
    typeof candidato.accessToken === 'string' &&
    typeof candidato.refreshToken === 'string' &&
    typeof candidato.expiresAt === 'number'
  )
}

/** Cofre em disco, cifrado pelo SO. `vaultPath` fica em `userData`, fora do repo. */
export class SafeStorageTokenVault implements TokenVault {
  constructor(private readonly vaultPath: string) {
    // Falha alto em vez de gravar token em claro — a mesma regra do `audit-key.ts`.
    // Um refresh token legível no disco é credencial de longa duração exposta; sem a
    // cifra do SO, é preferível o app não guardar sessão nenhuma.
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'safeStorage indisponível: os tokens da sessão não podem ser protegidos neste ' +
          'sistema. Gravá-los em claro violaria o critério 7 da SPEC-Fundacao-03.'
      )
    }
  }

  read(): StoredTokens | undefined {
    if (!existsSync(this.vaultPath)) return undefined

    try {
      const conteudo = safeStorage.decryptString(readFileSync(this.vaultPath))
      const parsed: unknown = JSON.parse(conteudo)

      if (!isStoredTokens(parsed)) {
        // Formato inesperado = cofre inútil. Some com ele e trata como deslogado: manter
        // um arquivo ilegível só faria a próxima leitura falhar de novo.
        log.auth.warn('Cofre de tokens com formato inesperado; sessão descartada')
        this.clear()
        return undefined
      }

      return parsed
    } catch (error) {
      // Cofre ilegível (troca de usuário do SO, perfil recriado, disco corrompido) não é
      // motivo para derrubar o app: o usuário simplesmente entra de novo.
      log.auth.warn('Falha ao decifrar o cofre de tokens; exigindo novo login', { error })
      this.clear()
      return undefined
    }
  }

  write(tokens: StoredTokens): void {
    try {
      mkdirSync(dirname(this.vaultPath), { recursive: true })
      writeFileSync(this.vaultPath, safeStorage.encryptString(JSON.stringify(tokens)))
      // Sem `ctx`: nem o tamanho do token entra no log. O que se registra é o fato.
      log.auth.info('Tokens da sessão gravados cifrados no cofre')
    } catch (error) {
      log.auth.error('Falha ao gravar o cofre de tokens', { error })
      throw error
    }
  }

  /** Idempotente: chamar sem cofre existente é no-op, o que simplifica o logout. */
  clear(): void {
    rmSync(this.vaultPath, { force: true })
    log.auth.info('Cofre de tokens apagado')
  }
}
