import { describe, expect, it } from 'vitest'
import {
  ExemploComValorError,
  fingerprintDeConfiguracao,
  lerNomesDoExemplo,
  validarReferencias,
  type ConfigurationProbe
} from './configuration-reference-validator'

const KEY = 'chave-de-fingerprint-do-teste'

function probe(valores: Record<string, Record<string, string>>): ConfigurationProbe {
  return (ambiente, nome) => {
    const valor = valores[ambiente]?.[nome]
    return valor === undefined
      ? { present: false }
      : { present: true, fingerprint: fingerprintDeConfiguracao(KEY, nome, valor) }
  }
}

describe('lerNomesDoExemplo', () => {
  it('extrai só nomes e ignora comentários e linhas vazias', () => {
    const texto = '# banco\nDATABASE_URL=\n\n  API_TOKEN=  \n# fim\n'
    expect(lerNomesDoExemplo(texto)).toEqual(['DATABASE_URL', 'API_TOKEN'])
  })

  it('recusa exemplo com valor: o arquivo versionado só guarda nomes', () => {
    expect(() => lerNomesDoExemplo('API_TOKEN=abc123\n')).toThrow(ExemploComValorError)
  })

  it('a mensagem do erro nomeia a chave e nunca repete o valor', () => {
    try {
      lerNomesDoExemplo('API_TOKEN=valor-secreto-xyz\n')
      throw new Error('deveria falhar')
    } catch (erro) {
      expect(String(erro)).toContain('API_TOKEN')
      expect(String(erro)).not.toContain('valor-secreto-xyz')
    }
  })
})

describe('validarReferencias', () => {
  it('chave ausente bloqueia e informa nome e ambiente', () => {
    const resultado = validarReferencias({
      nomes: ['DATABASE_URL', 'API_TOKEN'],
      ambientes: ['local', 'staging'],
      probe: probe({ local: { DATABASE_URL: 'a', API_TOKEN: 'b' }, staging: { DATABASE_URL: 'c' } })
    })
    expect(resultado.ok).toBe(false)
    expect(resultado.bloqueios).toEqual([{ name: 'API_TOKEN', environment: 'staging' }])
  })

  it('valor diferente entre ambientes é permitido e não bloqueia', () => {
    const resultado = validarReferencias({
      nomes: ['DATABASE_URL'],
      ambientes: ['local', 'preview', 'staging', 'production'],
      probe: probe({
        local: { DATABASE_URL: 'local' },
        preview: { DATABASE_URL: 'preview' },
        staging: { DATABASE_URL: 'staging' },
        production: { DATABASE_URL: 'producao' }
      })
    })
    expect(resultado.ok).toBe(true)
    expect(resultado.bloqueios).toEqual([])
    expect(resultado.referencias.map((r) => r.state)).toEqual([
      'configured',
      'divergent',
      'divergent',
      'divergent'
    ])
  })

  it('valor igual entre ambientes fica configured', () => {
    const resultado = validarReferencias({
      nomes: ['REGIAO'],
      ambientes: ['local', 'staging'],
      probe: probe({ local: { REGIAO: 'sa-east-1' }, staging: { REGIAO: 'sa-east-1' } })
    })
    expect(resultado.referencias.map((r) => r.state)).toEqual(['configured', 'configured'])
  })

  it('a referência carrega fingerprint e nunca o valor', () => {
    const resultado = validarReferencias({
      nomes: ['API_TOKEN'],
      ambientes: ['local'],
      probe: probe({ local: { API_TOKEN: 'SENTINELA-SECRETA-123' } })
    })
    const serializado = JSON.stringify(resultado)
    expect(serializado).not.toContain('SENTINELA-SECRETA-123')
    expect(resultado.referencias[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rotação do valor muda o fingerprint', () => {
    expect(fingerprintDeConfiguracao(KEY, 'API_TOKEN', 'antigo')).not.toBe(
      fingerprintDeConfiguracao(KEY, 'API_TOKEN', 'novo')
    )
  })

  it('o mesmo valor com chave de fingerprint diferente não é comparável', () => {
    expect(fingerprintDeConfiguracao('chave-a', 'X', 'v')).not.toBe(
      fingerprintDeConfiguracao('chave-b', 'X', 'v')
    )
  })
})
