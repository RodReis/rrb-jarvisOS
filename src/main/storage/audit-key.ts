/**
 * Chave HMAC da cadeia de auditoria, selada no `safeStorage`/DPAPI (ADR-004).
 *
 * Este é o único arquivo do storage que toca o Electron — de propósito. A cadeia e o
 * repositório recebem a chave por parâmetro, o que os mantém testáveis sem subir o app;
 * a lógica de *onde a chave mora* fica isolada aqui.
 *
 * Limite honesto, já registrado no ADR-004: isto é tamper-**evident**, não tamper-proof.
 * Num host single-user, quem tem o mesmo usuário do SO consegue destravar o DPAPI e
 * recomputar a cadeia. A âncora externa fica para a fase de sync (Corte 3+).
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { log } from '../logging/logger'

/** 32 bytes = o tamanho de bloco do SHA-256; chave menor não agrega força ao HMAC. */
const TAMANHO_CHAVE = 32

/**
 * Lê a chave do disco ou cria uma nova, sempre cifrada pelo `safeStorage`.
 *
 * Falha alto quando a cifra do SO não está disponível em vez de gravar a chave em claro:
 * uma chave HMAC em texto no disco tornaria a cadeia recomputável por qualquer um, o que é
 * pior do que não ter cadeia — daria uma garantia que não existe.
 */
export function loadOrCreateAuditKey(keyPath: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'safeStorage indisponível: a chave de auditoria não pode ser protegida neste sistema. ' +
        'Gravá-la em claro anularia a garantia do ADR-004.'
    )
  }

  if (existsSync(keyPath)) {
    try {
      return Buffer.from(safeStorage.decryptString(readFileSync(keyPath)), 'utf8')
    } catch (error) {
      // Chave ilegível = cadeia inverificável. Gerar outra em silêncio faria toda a
      // auditoria existente parecer forjada; falhar alto deixa o operador decidir.
      log.db.error('Falha ao decifrar a chave de auditoria', { op: 'read', error })
      throw error
    }
  }

  const chave = randomBytes(TAMANHO_CHAVE).toString('hex')
  mkdirSync(dirname(keyPath), { recursive: true })
  writeFileSync(keyPath, safeStorage.encryptString(chave))
  log.db.info('Chave de auditoria criada e selada no safeStorage', { op: 'create' })

  return Buffer.from(chave, 'utf8')
}
