import { describe, it, expect } from 'vitest'
import { classificarFalha, proximaTentativaPermitida } from './attempt'

describe('classificarFalha', () => {
  it('timeout de rede é externo', () => {
    expect(classificarFalha({ stdout: '', stderr: 'ETIMEDOUT: connection timed out' })).toBe(
      'externo'
    )
  })

  it('erro de autenticação/quota é externo', () => {
    expect(classificarFalha({ stdout: '', stderr: '401 Unauthorized: invalid api key' })).toBe(
      'externo'
    )
    expect(classificarFalha({ stdout: '', stderr: 'rate limit exceeded' })).toBe('externo')
  })

  it('teste/lint/type/build falhando é corrigível por default', () => {
    expect(classificarFalha({ stdout: 'FAIL src/foo.spec.ts', stderr: '' })).toBe('corrigivel')
    expect(classificarFalha({ stdout: '', stderr: 'error TS2345: Argument of type' })).toBe(
      'corrigivel'
    )
  })

  it('saída vazia ou irreconhecível ainda é corrigível, nunca pi por default', () => {
    expect(classificarFalha({ stdout: '', stderr: '' })).toBe('corrigivel')
  })
})

describe('proximaTentativaPermitida', () => {
  it('tentativa 1 (inicial) sempre permite recuperação (chega até 2)', () => {
    expect(proximaTentativaPermitida(1)).toBe(true)
  })

  it('tentativa 2 (primeira recuperação) ainda permite a terceira', () => {
    expect(proximaTentativaPermitida(2)).toBe(true)
  })

  it('tentativa 3 (segunda recuperação) é a última — não permite mais', () => {
    expect(proximaTentativaPermitida(3)).toBe(false)
  })
})
