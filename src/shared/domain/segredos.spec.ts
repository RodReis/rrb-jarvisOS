import { describe, expect, it } from 'vitest'
import { conteudoTemSegredo, detectarSegredo, nomeProibido } from './segredos'

describe('nomeProibido', () => {
  it.each([
    '.env',
    'projeto/.env.local',
    'config/.npmrc',
    'chaves/id_rsa',
    'certs/servidor.pem',
    'secrets.json',
    'credentials.yaml'
  ])('recusa %s pelo nome', (caminho) => {
    expect(nomeProibido(caminho)).toBe(true)
  })

  it.each([
    'docs/PRD.md',
    'src/main/env.ts',
    'docs/environment.md',
    'src/shared/domain/credentials.ts'
  ])('não confunde %s com arquivo de segredo', (caminho) => {
    expect(nomeProibido(caminho)).toBe(false)
  })
})

describe('conteudoTemSegredo', () => {
  it.each([
    ['chave da Anthropic', 'const k = "sk-ant-api03-abcdefghijklmnopqrstuvwx"'],
    ['token do GitHub', 'GH: ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['chave do Google', 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r'],
    ['access key da AWS', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE'],
    ['bloco de chave privada', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...'],
    ['atribuição explícita', 'DATABASE_PASSWORD=umaSenhaBemLonga123']
  ])('acusa %s', (_caso, texto) => {
    expect(conteudoTemSegredo(texto)).toBe(true)
  })

  /**
   * O contrafactual que importa: um detector que grita em tudo é um detector que se aprende a
   * ignorar. Estes são textos que **existem neste repositório** e não podem acusar.
   */
  it.each([
    ['hash de commit', 'commit f4045a8b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f'],
    ['UUID', 'id: 3eeec7f4-6233-423d-bb3c-624d6a01576a'],
    ['SHA-256 de evidência', 'hashConteudo: ' + 'a'.repeat(64)],
    ['placeholder de documentação', 'ANTHROPIC_API_KEY=<sua-chave-aqui>'],
    ['variável vazia no exemplo', 'API_KEY='],
    ['prosa sobre credencial', 'O Vault guarda a credencial cifrada; o token nunca vai ao log.']
  ])('não acusa %s', (_caso, texto) => {
    expect(conteudoTemSegredo(texto)).toBe(false)
  })
})

describe('detectarSegredo', () => {
  it('distingue o achado por nome do achado por conteúdo', () => {
    expect(detectarSegredo('.env', 'PORT=3000')).toEqual({ caminho: '.env', por: 'nome' })
    expect(detectarSegredo('src/a.ts', 'const k = "sk-ant-api03-abcdefghijklmnopqrst"')).toEqual({
      caminho: 'src/a.ts',
      por: 'conteudo'
    })
  })

  it('devolve undefined para conteúdo limpo', () => {
    expect(detectarSegredo('docs/PRD.md', '# PRD\n\nO produto faz X.')).toBeUndefined()
  })

  /**
   * O achado **não** carrega o trecho casado. Repeti-lo para explicar-se copiaria o segredo
   * para a mensagem de erro, o log e a tela — os três lugares em que ele não pode estar.
   */
  it('nunca devolve o trecho que casou', () => {
    const achado = detectarSegredo('src/a.ts', 'const k = "sk-ant-api03-abcdefghijklmnopqrst"')

    expect(JSON.stringify(achado)).not.toContain('sk-ant')
  })
})
