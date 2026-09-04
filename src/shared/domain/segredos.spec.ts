import { describe, expect, it } from 'vitest'
import {
  SEGREDO_REDIGIDO,
  conteudoTemSegredo,
  detectarSegredo,
  nomeProibido,
  redigirSegredos
} from './segredos'

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

/**
 * O redator nasceu com o console da geração (SPEC-Fases-03, critério 3), onde o texto **não pode
 * ser recusado**: o comando que a IA rodou é evidência que o PI precisa ver, e barrá-lo esconderia
 * a ferramenta inteira em vez de esconder o segredo dela.
 */
describe('redigirSegredos', () => {
  it.each([
    ['chave da Anthropic', 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnop" api'],
    ['token do GitHub', 'git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com'],
    ['chave do Google', 'GEMINI=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r'],
    ['access key da AWS', 'aws configure set key AKIAIOSFODNN7EXAMPLE'],
    ['atribuição explícita', 'DATABASE_PASSWORD=umaSenhaBemLonga123']
  ])('remove %s do texto', (_caso, texto) => {
    const redigido = redigirSegredos(texto)

    expect(conteudoTemSegredo(redigido)).toBe(false)
    expect(redigido).toContain(SEGREDO_REDIGIDO)
  })

  it('remove todas as ocorrências, não só a primeira', () => {
    const duas = 'k1=sk-ant-api03-primeiraprimeiraprimeira k2=sk-ant-api03-segundasegundasegunda'

    const redigido = redigirSegredos(duas)

    expect(redigido).not.toContain('primeira')
    expect(redigido).not.toContain('segunda')
  })

  it('preserva o que o comando diz fazer — o redator não pode cegar a evidência', () => {
    // O ponto do console é o PI ver **o quê** a IA rodou. Redigir a linha inteira entregaria um
    // painel que só diz "aconteceu algo".
    const redigido = redigirSegredos(
      'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijkl" https://api.exemplo.dev/v1/status'
    )

    expect(redigido).toContain('curl')
    expect(redigido).toContain('https://api.exemplo.dev/v1/status')
  })

  it('não mexe em texto limpo', () => {
    const limpo = 'npm run build && node scripts/gen-test-report.mjs'

    expect(redigirSegredos(limpo)).toBe(limpo)
  })

  it.each([
    ['hash de commit', 'commit f4045a8b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f'],
    ['UUID', 'id: 3eeec7f4-6233-423d-bb3c-624d6a01576a'],
    ['placeholder de documentação', 'ANTHROPIC_API_KEY=<sua-chave-aqui>']
  ])('não redige %s', (_caso, texto) => {
    expect(redigirSegredos(texto)).toBe(texto)
  })

  it('é idempotente — redigir o já redigido não muda nada', () => {
    const uma = redigirSegredos('k=sk-ant-api03-abcdefghijklmnopqrstuv')

    expect(redigirSegredos(uma)).toBe(uma)
  })
})
