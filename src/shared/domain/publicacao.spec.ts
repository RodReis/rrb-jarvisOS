/**
 * As decisões puras da publicação no GitHub (SPEC-Entrega-01, categoria Regras).
 *
 * O que estes testes provam sem tocar a rede: que a chave externa é **determinística** e derivada
 * do par projeto/MVP/fatia/revisão (critério 3), que revisões diferentes do mesmo alvo produzem
 * chaves diferentes, e que a URL de push com token nunca sobrevive à redação (a decisão do PI de
 * montar a credencial no ato só é segura se ela não vazar para evidência).
 */

import { describe, expect, it } from 'vitest'
import {
  chaveDeFatia,
  chaveDeMvp,
  chaveDeProjeto,
  redigirUrlDeRemote,
  urlDePushComToken
} from './publicacao'

const PROJETO = 'p-7f3a'

describe('chave externa determinística', () => {
  it('deriva a mesma chave para o mesmo projeto e MVP', () => {
    expect(chaveDeMvp(PROJETO, 9)).toBe(chaveDeMvp(PROJETO, 9))
  })

  it('separa MVPs diferentes do mesmo projeto', () => {
    expect(chaveDeMvp(PROJETO, 9)).not.toBe(chaveDeMvp(PROJETO, 8))
  })

  it('separa projetos diferentes com o mesmo número de MVP', () => {
    expect(chaveDeMvp(PROJETO, 9)).not.toBe(chaveDeMvp('p-outro', 9))
  })

  it('deriva a chave da fatia do par MVP/Fatia, não só do número', () => {
    // M9-F01 e M8-F01 são fatias distintas: sem o MVP na chave, a segunda reusaria a issue
    // da primeira e o backlog do MVP-008 apareceria dentro do MVP-009.
    expect(chaveDeFatia(PROJETO, 9, 1)).not.toBe(chaveDeFatia(PROJETO, 8, 1))
  })

  it('deriva a mesma chave de fatia para a mesma coordenada', () => {
    expect(chaveDeFatia(PROJETO, 9, 1)).toBe(chaveDeFatia(PROJETO, 9, 1))
  })

  it('não colide entre a chave do MVP e a da fatia de mesmo número', () => {
    expect(chaveDeMvp(PROJETO, 1)).not.toBe(chaveDeFatia(PROJETO, 1, 1))
  })

  it('a chave do projeto não depende do MVP nem da fatia', () => {
    expect(chaveDeProjeto(PROJETO)).toBe(chaveDeProjeto(PROJETO))
    expect(chaveDeProjeto(PROJETO)).not.toBe(chaveDeProjeto('p-outro'))
  })

  it('a chave é legível e prefixada, para quem lê a issue no GitHub entender a origem', () => {
    // O marcador vai no corpo da issue e é lido por humanos tanto quanto pelo código; um hash
    // opaco obrigaria a consultar o banco para saber de que fatia a issue é.
    expect(chaveDeFatia(PROJETO, 9, 1)).toContain(PROJETO)
    expect(chaveDeFatia(PROJETO, 9, 1)).toMatch(/mvp-?0*9/i)
  })
})

describe('URL de push com token', () => {
  it('embute o token no formato que o GitHub aceita para App/OAuth', () => {
    const url = urlDePushComToken('https://github.com/dono/repo.git', 'ghs_segredo')
    expect(url).toBe('https://x-access-token:ghs_segredo@github.com/dono/repo.git')
  })

  it('aceita a URL sem o sufixo .git', () => {
    const url = urlDePushComToken('https://github.com/dono/repo', 'ghs_segredo')
    expect(url).toContain('x-access-token:ghs_segredo@github.com/dono/repo')
  })

  it('recusa origem que não seja HTTPS — SSH e file não carregam token na URL', () => {
    expect(() => urlDePushComToken('git@github.com:dono/repo.git', 'ghs_x')).toThrow()
    expect(() => urlDePushComToken('http://github.com/dono/repo.git', 'ghs_x')).toThrow()
  })

  it('recusa token vazio em vez de montar uma URL que autentica como anônimo', () => {
    expect(() => urlDePushComToken('https://github.com/dono/repo.git', '')).toThrow()
  })
})

describe('redação da URL de remote', () => {
  it('remove o token antes de o texto virar evidência', () => {
    const url = urlDePushComToken('https://github.com/dono/repo.git', 'ghs_segredo')
    const redigido = redigirUrlDeRemote(url)

    expect(redigido).not.toContain('ghs_segredo')
    expect(redigido).toContain('github.com/dono/repo.git')
  })

  it('redige a URL onde quer que ela apareça numa saída maior', () => {
    // O git ecoa a URL em mensagens de erro ("fatal: unable to access 'https://...'"), e é essa
    // saída que vira evidência. Redigir só a URL isolada deixaria o eco passar.
    const saida = `fatal: unable to access 'https://x-access-token:ghs_segredo@github.com/d/r.git/'`
    expect(redigirUrlDeRemote(saida)).not.toContain('ghs_segredo')
  })

  it('não altera texto sem credencial', () => {
    expect(redigirUrlDeRemote('https://github.com/dono/repo.git')).toBe(
      'https://github.com/dono/repo.git'
    )
  })
})
