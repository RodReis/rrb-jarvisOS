/**
 * Cofre de tokens (SPEC-Fundacao-03, critério 7).
 *
 * O critério é verificável de uma forma só: **ler os bytes do arquivo** e confirmar que o
 * token não está lá. Um teste que apenas chamasse `write` e `read` passaria mesmo se a
 * implementação gravasse JSON em claro — por isso aqui se inspeciona o disco.
 *
 * O `safeStorage` é dublado porque o real exige o Electron rodando e a chave do usuário do
 * SO. O dublê **cifra de verdade** (XOR + base64): fraco para produção, suficiente para o
 * teste, porque o que se prova é que a implementação passa o conteúdo pela cifra antes de
 * escrever — não a força do algoritmo do SO.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

/** Cifra simétrica de brinquedo — embaralha o suficiente para o texto não ficar legível. */
const CHAVE = 0x5a
let cifraDisponivel = true

function embaralhar(texto: string): Buffer {
  return Buffer.from(Array.from(Buffer.from(texto, 'utf8'), (b) => b ^ CHAVE))
}

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => cifraDisponivel,
    encryptString: (texto: string) => embaralhar(texto),
    decryptString: (buffer: Buffer) =>
      Buffer.from(Array.from(buffer, (b) => b ^ CHAVE)).toString('utf8')
  }
}))

const { SafeStorageTokenVault } = await import('./token-vault')

const TOKENS = {
  accessToken: 'access-token-secreto-abc123',
  refreshToken: 'refresh-token-secreto-xyz789',
  expiresAt: 1_800_000_000
}

let dir: string
let vaultPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-vault-'))
  vaultPath = join(dir, 'session.vault')
  cifraDisponivel = true
  logCat.warn.mockClear()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SafeStorageTokenVault (critério 7)', () => {
  it('o arquivo gravado não contém o token nem o refresh token em claro', () => {
    new SafeStorageTokenVault(vaultPath).write(TOKENS)

    // Lê os bytes crus: é a única forma de provar que o segredo não está no disco.
    const bytes = readFileSync(vaultPath)
    const comoTexto = bytes.toString('utf8')
    const comoLatin1 = bytes.toString('latin1')

    for (const conteudo of [comoTexto, comoLatin1]) {
      expect(conteudo).not.toContain(TOKENS.accessToken)
      expect(conteudo).not.toContain(TOKENS.refreshToken)
    }
  })

  it('devolve os tokens intactos na leitura', () => {
    const vault = new SafeStorageTokenVault(vaultPath)
    vault.write(TOKENS)

    expect(vault.read()).toEqual(TOKENS)
  })

  it('devolve undefined quando ainda não há cofre', () => {
    expect(new SafeStorageTokenVault(vaultPath).read()).toBeUndefined()
  })

  it('clear apaga o arquivo e é idempotente', () => {
    const vault = new SafeStorageTokenVault(vaultPath)
    vault.write(TOKENS)

    vault.clear()
    expect(existsSync(vaultPath)).toBe(false)

    // Chamar de novo não pode estourar: o logout roda mesmo sem cofre existente.
    expect(() => vault.clear()).not.toThrow()
  })

  it('trata cofre corrompido como ausência de sessão, sem derrubar o app', () => {
    const vault = new SafeStorageTokenVault(vaultPath)
    writeFileSync(vaultPath, Buffer.from('conteúdo que não é um cofre válido'))

    // Disco corrompido ou perfil do SO recriado: o usuário entra de novo, o app não cai.
    expect(vault.read()).toBeUndefined()
    expect(existsSync(vaultPath)).toBe(false)
  })

  it('recusa operar quando a cifra do SO não está disponível', () => {
    cifraDisponivel = false

    // Falhar alto é deliberado: gravar refresh token em claro seria pior que não ter cofre.
    expect(() => new SafeStorageTokenVault(vaultPath)).toThrow(/safeStorage/)
  })
})
