/**
 * Testes de `isPathAllowed` — a parte pura da allowlist (SPEC-Execucao-03, categoria Regras).
 *
 * Estes testes trabalham com paths **já canonizados** (é o contrato da função): a resolução
 * de symlink/`..` é responsabilidade do main e tem seu próprio teste de integração. Aqui se
 * prova a contenção por segmento, o matching recursivo e o anti-escape na comparação.
 */

import { describe, expect, it } from 'vitest'
import { isPathAllowed } from './allowlist'

const permitidos = ['/home/user/app-data']

describe('isPathAllowed — matching recursivo (critério 2)', () => {
  it('o próprio diretório permitido é permitido', () => {
    expect(isPathAllowed('/home/user/app-data', permitidos)).toBe(true)
  })

  it('subpasta de um diretório permitido é permitida (recursivo)', () => {
    expect(isPathAllowed('/home/user/app-data/sub/mais-fundo', permitidos)).toBe(true)
  })

  it('arquivo dentro do permitido é permitido', () => {
    expect(isPathAllowed('/home/user/app-data/config.json', permitidos)).toBe(true)
  })
})

describe('isPathAllowed — anti-escape e contenção por segmento (critério 2)', () => {
  it('path fora de todo permitido retorna false', () => {
    expect(isPathAllowed('/etc/passwd', permitidos)).toBe(false)
  })

  it('vizinho de nome parecido NÃO casa (segmento, não prefixo de string)', () => {
    // `/home/user/app-data-secreto` compartilha o prefixo textual, mas é outro diretório.
    expect(isPathAllowed('/home/user/app-data-secreto', permitidos)).toBe(false)
    expect(isPathAllowed('/home/user/app-data-secreto/x', permitidos)).toBe(false)
  })

  it('o pai de um diretório permitido NÃO é permitido', () => {
    expect(isPathAllowed('/home/user', permitidos)).toBe(false)
  })

  it('path que (já canonizado) resolveu para fora retorna false', () => {
    // Simula o resultado da canonicalização do main: `app-data/../fora` já virou `/home/user/fora`.
    expect(isPathAllowed('/home/user/fora', permitidos)).toBe(false)
  })
})

describe('isPathAllowed — allowlist vazia e postura conservadora (critério 1)', () => {
  it('allowlist vazia não permite nada', () => {
    expect(isPathAllowed('/home/user/app-data', [])).toBe(false)
  })

  it('com múltiplos permitidos, basta estar dentro de um', () => {
    const lista = ['/home/user/app-data', '/tmp/projeto']
    expect(isPathAllowed('/tmp/projeto/build', lista)).toBe(true)
    expect(isPathAllowed('/var/log', lista)).toBe(false)
  })
})

describe('isPathAllowed — normalização de barra (Windows/POSIX)', () => {
  it('trata `\\` do Windows como separador', () => {
    expect(isPathAllowed('C:\\Users\\rod\\app-data\\x', ['C:\\Users\\rod\\app-data'])).toBe(true)
    expect(isPathAllowed('C:\\Users\\rod\\outro', ['C:\\Users\\rod\\app-data'])).toBe(false)
  })

  it('barra final no permitido não muda o resultado', () => {
    expect(isPathAllowed('/home/user/app-data/x', ['/home/user/app-data/'])).toBe(true)
  })
})
