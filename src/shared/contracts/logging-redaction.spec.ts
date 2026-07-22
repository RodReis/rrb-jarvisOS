import { describe, expect, it } from 'vitest'
import { REDACTED_PLACEHOLDER } from './logging'
import { redact, redactContext } from './logging-redaction'

describe('redact', () => {
  it('remove o valor de chave sensível, preservando as vizinhas', () => {
    const saida = redact({ userId: 'u-1', token: 'ghp_segredo', ms: 842 }) as Record<
      string,
      unknown
    >

    expect(saida['token']).toBe(REDACTED_PLACEHOLDER)
    expect(saida['userId']).toBe('u-1')
    expect(saida['ms']).toBe(842)
  })

  it('reconhece a chave sensível independentemente da caixa', () => {
    const saida = redact({ Authorization: 'Bearer x', apiKey: 'k', REFRESHTOKEN: 'r' }) as Record<
      string,
      unknown
    >

    expect(Object.values(saida)).toEqual([
      REDACTED_PLACEHOLDER,
      REDACTED_PLACEHOLDER,
      REDACTED_PLACEHOLDER
    ])
  })

  it('alcança chave sensível aninhada em objeto e em array', () => {
    const saida = redact({
      sessao: { perfil: { nome: 'Rodrigo', accessToken: 'segredo' } },
      tentativas: [{ password: '123' }]
    }) as Record<string, Record<string, Record<string, unknown>>>

    expect(saida['sessao']?.['perfil']?.['accessToken']).toBe(REDACTED_PLACEHOLDER)
    expect(saida['sessao']?.['perfil']?.['nome']).toBe('Rodrigo')
    expect((saida['tentativas'] as unknown as Record<string, unknown>[])[0]?.['password']).toBe(
      REDACTED_PLACEHOLDER
    )
  })

  it('redige o objeto inteiro quando ele se declara sensível', () => {
    // Redigir só o rótulo `sensitivity` deixaria o valor rotulado passar — o oposto da regra.
    const saida = redact({
      cartao: { sensitivity: 'financial', numero: '4111111111111111' }
    }) as Record<string, unknown>

    expect(saida['cartao']).toBe(REDACTED_PLACEHOLDER)
    expect(JSON.stringify(saida)).not.toContain('4111111111111111')
  })

  it.each(['credential', 'secret', 'personal', 'financial', 'health'])(
    'redige payload marcado como %s',
    (sensitivity) => {
      const saida = redact({ dado: { sensitivity, valor: 'nao-pode-vazar' } }) as Record<
        string,
        unknown
      >

      expect(saida['dado']).toBe(REDACTED_PLACEHOLDER)
    }
  )

  it('preserva payload de sensibilidade permitida', () => {
    const saida = redact({ dado: { sensitivity: 'internal', valor: 'ok' } }) as Record<
      string,
      Record<string, unknown>
    >

    expect(saida['dado']?.['valor']).toBe('ok')
  })

  it('serializa Error preservando mensagem e stack', () => {
    // `{...err}` sai vazio: as propriedades de Error não são enumeráveis. Sem este ramo,
    // a causa da falha se perderia justamente no registro de erro.
    const erro = new Error('Falha ao gravar')
    const saida = redact({ error: erro }) as Record<string, Record<string, unknown>>

    expect(saida['error']?.['message']).toBe('Falha ao gravar')
    expect(saida['error']?.['stack']).toContain('Falha ao gravar')
  })

  it('não estoura a pilha com estrutura cíclica', () => {
    const ciclico: Record<string, unknown> = { nome: 'raiz' }
    ciclico['self'] = ciclico

    const saida = redact(ciclico) as Record<string, unknown>

    expect(saida['nome']).toBe('raiz')
    expect(saida['self']).toBe('[circular]')
  })

  it('devolve valores primitivos intactos', () => {
    expect(redact('texto')).toBe('texto')
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBeNull()
    expect(redact(undefined)).toBeUndefined()
  })

  it('não altera o objeto de origem', () => {
    const origem = { token: 'segredo' }
    redactContext(origem)

    expect(origem.token).toBe('segredo')
  })
})
