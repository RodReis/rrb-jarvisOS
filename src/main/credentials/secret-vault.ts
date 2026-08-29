/**
 * A primitiva de cifra do vault de credenciais (SPEC-Providers-01, critério 2).
 *
 * Mesma primitiva do `token-vault.ts` e do `audit-key.ts` — `safeStorage`/DPAPI, chave do
 * usuário do SO — pelo mesmo motivo: é o único arquivo desta pasta que toca o Electron, e
 * isolá-lo aqui mantém o `CredentialService` testável sem subir o app.
 *
 * Diferença deliberada em relação ao `token-vault.ts`: aquele guarda **um** segredo num
 * arquivo próprio; este guarda **muitos**, endereçados por usuário + espaço + chave, e por
 * isso o valor cifrado mora numa coluna BLOB do SQLite em vez de num arquivo. O que não muda
 * é a garantia: os bytes gravados são o retorno de `encryptString`, nunca o texto da chave.
 *
 * Limite honesto, o mesmo do ADR-004 e do cofre de tokens: num host single-user, quem tem o
 * mesmo usuário do SO destrava o DPAPI. A proteção é contra leitura do banco por outro
 * usuário ou por cópia do disco — não contra o próprio dono da máquina.
 */

import { safeStorage } from 'electron'

/**
 * Contrato da cifra. Existe para o `CredentialService` depender de uma interface e não do
 * `safeStorage`, que exige o Electron rodando e a chave do usuário do SO.
 */
export interface SecretCipher {
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}

/** Cifra do SO. Falha alto em vez de gravar credencial em claro. */
export class SafeStorageCipher implements SecretCipher {
  constructor() {
    // Mesma regra do `token-vault.ts`: sem a cifra do SO, é preferível o app não guardar
    // credencial nenhuma a guardá-la legível. Uma chave de API em claro no disco é credencial
    // de longa duração exposta — e o critério 2 diz "nunca em claro", não "em claro quando
    // não der outro jeito".
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'safeStorage indisponível: as credenciais não podem ser protegidas neste sistema. ' +
          'Gravá-las em claro violaria o critério 2 da SPEC-Providers-01.'
      )
    }
  }

  encrypt(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext)
  }

  decrypt(ciphertext: Buffer): string {
    return safeStorage.decryptString(ciphertext)
  }
}
