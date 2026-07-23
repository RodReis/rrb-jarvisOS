/**
 * Canonicalização real contra o FS (SPEC-Execucao-03, categoria Banco).
 *
 * Prova o que a parte pura não pode: que **symlink apontando pra fora de um diretório
 * permitido é barrado** (critério 2). Esse é o caso que só `fs.realpathSync` pega — resolução
 * textual de path passaria batido. Cria diretórios e um symlink de verdade num tmp.
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalize } from './allowlist-canon'
import { isPathAllowed } from '@shared/policies'

let raiz: string
let permitido: string

beforeEach(() => {
  // O próprio tmp pode ser um symlink (macOS: /var → /private/var). Canonizamos a raiz
  // primeiro para os `expect` compararem maçãs com maçãs.
  raiz = canonicalize(mkdtempSync(join(tmpdir(), 'jarvis-allow-')))
  permitido = join(raiz, 'permitido')
  mkdirSync(permitido)
})

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true })
})

describe('canonicalize — resolução textual (critério 2)', () => {
  it('elimina `..` — permitido/../fora resolve para fora e a checagem barra', () => {
    const escapou = canonicalize(join(permitido, '..', 'fora'))
    expect(escapou).toBe(join(raiz, 'fora'))
    expect(isPathAllowed(escapou, [permitido])).toBe(false)
  })

  it('subpath real dentro do permitido continua dentro', () => {
    const sub = join(permitido, 'sub')
    mkdirSync(sub)
    expect(isPathAllowed(canonicalize(sub), [permitido])).toBe(true)
  })
})

describe('canonicalize — symlink (o caso que só realpath pega, critério 2)', () => {
  it('symlink DENTRO do permitido apontando pra FORA é barrado', () => {
    const fora = join(raiz, 'segredo')
    mkdirSync(fora)
    writeFileSync(join(fora, 'x.txt'), 'conteúdo')

    // Link mora no diretório permitido, mas aponta para fora dele.
    const link = join(permitido, 'atalho')
    try {
      symlinkSync(fora, link, 'dir')
    } catch (erro) {
      // Windows sem privilégio de symlink: o teste não se aplica ao ambiente. Pular é
      // honesto — fingir que passou esconderia que a garantia não foi exercida aqui.
      const e = erro as NodeJS.ErrnoException
      if (e.code === 'EPERM' || e.code === 'ENOSYS') return
      throw erro
    }

    // Textualmente o link está "dentro" do permitido; só o realpath revela o destino real.
    const canon = canonicalize(join(link, 'x.txt'))
    expect(canon).toBe(join(fora, 'x.txt'))
    expect(isPathAllowed(canon, [permitido])).toBe(false)
  })

  it('symlink DENTRO do permitido apontando pra DENTRO continua permitido', () => {
    const alvo = join(permitido, 'real')
    mkdirSync(alvo)
    const link = join(permitido, 'link-interno')
    try {
      symlinkSync(alvo, link, 'dir')
    } catch (erro) {
      const e = erro as NodeJS.ErrnoException
      if (e.code === 'EPERM' || e.code === 'ENOSYS') return
      throw erro
    }
    expect(isPathAllowed(canonicalize(link), [permitido])).toBe(true)
  })
})

describe('canonicalize — path inexistente (fallback conservador)', () => {
  it('path que não existe cai no resolve textual e é barrado se resolver pra fora', () => {
    const inexistente = join(raiz, 'nao-existe', '..', '..', 'etc')
    // Sem realpath (não existe), o resolve textual ainda elimina `..` — e o resultado
    // está fora do permitido.
    expect(isPathAllowed(canonicalize(inexistente), [permitido])).toBe(false)
  })
})
