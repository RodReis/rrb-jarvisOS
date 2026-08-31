/**
 * Contrato do núcleo de conectores (SPEC-Conectores-01) — a parte que é regra pura.
 *
 * Dois tipos de asserção aqui, e vale distingui-los. As de **ausência** (nenhum tipo tem campo
 * onde segredo caiba) provam o critério 3 pela forma, como em `credentials.spec.ts`: a garantia
 * é não haver por onde. As de **ordem** (a validação recusa antes de qualquer I/O) provam os
 * critérios 1 e 2 — e só são afirmáveis porque `validarConnectorRequest` é pura: se ela
 * precisasse de rede ou disco para decidir, "falha antes de I/O" viraria promessa sobre a
 * implementação em vez de fato sobre a função.
 */

import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CONTRACT_VERSION,
  CONNECTOR_CREDENTIAL_KEYS,
  CONNECTOR_EFFECTS,
  CONNECTOR_ERROR_CODES,
  CONNECTOR_IDS,
  CONNECTOR_RECOVERY_ACTIONS,
  ROTULO_DO_CONECTOR,
  isConnectorCredentialKey,
  isConnectorId,
  validarConnectorRequest,
  type ConnectorCapability,
  type ConnectorCredentialRef,
  type ConnectorError,
  type ConnectorOutcome,
  type ConnectorRequest,
  type ConnectorResult
} from './connectors'

const LEITURA: ConnectorCapability = {
  connector: 'tavily',
  operation: 'search.query',
  effect: 'leitura',
  descricao: 'Busca na web'
}

const MUTACAO: ConnectorCapability = {
  connector: 'github',
  operation: 'issues.create',
  effect: 'mutacao',
  descricao: 'Abre uma issue'
}

function pedido(over: Partial<ConnectorRequest> = {}): ConnectorRequest {
  return {
    contractVersion: CONNECTOR_CONTRACT_VERSION,
    connector: 'tavily',
    operation: 'search.query',
    correlationId: 'corr-1',
    timeoutMs: 10_000,
    input: { q: 'jarvis' },
    ...over
  }
}

describe('taxonomias — dado, não lógica', () => {
  it('todo conector tem rótulo em pt-BR, e nenhum sobra', () => {
    // O `Record` completo já obriga o rótulo no compilador; o que este teste pega é o
    // contrário — um rótulo para um conector que não existe mais na lista.
    expect(Object.keys(ROTULO_DO_CONECTOR).sort()).toEqual([...CONNECTOR_IDS].sort())
  })

  it('os guardas de tipo recusam o que não está na lista', () => {
    expect(isConnectorId('github')).toBe(true)
    expect(isConnectorId('gitlab')).toBe(false)
    expect(isConnectorId(undefined)).toBe(false)
    expect(isConnectorCredentialKey('tavily')).toBe(true)
    expect(isConnectorCredentialKey('anthropic')).toBe(false)
  })

  it('as chaves de credencial de conector são separadas das chaves de IA (decisão do PI)', () => {
    // A asserção que importa é a **separação**, não os valores: `anthropic` é chave de IA e
    // não pode virar chave de conector por conveniência de quem escrever a F03. Se alguém
    // fundir as duas listas, isto quebra.
    expect(isConnectorCredentialKey('anthropic')).toBe(false)
    expect(isConnectorCredentialKey('openai')).toBe(false)
    expect(isConnectorCredentialKey('gemini')).toBe(false)
    expect([...CONNECTOR_CREDENTIAL_KEYS]).toEqual(['github', 'tavily'])
  })

  it('os efeitos distinguem o que pode ser repetido do que não pode', () => {
    expect([...CONNECTOR_EFFECTS]).toEqual(['leitura', 'mutacao'])
  })
})

describe('os tipos não têm onde um segredo caiba (critério 3)', () => {
  it('a referência de credencial é referência: escopo e chave, nunca valor', () => {
    const ref: ConnectorCredentialRef = {
      key: 'github',
      user_id: 'u-1',
      workspace_id: 'jarvis'
    }

    // Varre nomes de campo, como em `credentials.spec.ts`: um `value`/`token` acrescentado ao
    // tipo amanhã quebra aqui mesmo que ninguém o preencha.
    expect(
      Object.keys(ref).filter((k) => /value|secret|token|plaintext|api.?key|bearer/i.test(k))
    ).toEqual([])
  })

  it('o resultado carrega proveniência e uso — não o objeto nativo do SDK', () => {
    const result: ConnectorResult = {
      ok: true,
      data: { itens: [] },
      provenance: {
        connector: 'tavily',
        operation: 'search.query',
        obtidoEm: '2026-08-29T00:00:00.000Z'
      },
      usage: { creditos: 1, latenciaMs: 120 },
      externalRef: { id: 'ext-1', url: 'https://example.test/1' }
    }

    expect(
      Object.keys(result).filter((k) => /headers|request|response|raw|config|auth/i.test(k))
    ).toEqual([])
    expect(result.usage.creditos).toBe(1)
  })

  it('o erro separa mensagem de evidência, para a tela e a auditoria não concatenarem', () => {
    const erro: ConnectorError = {
      ok: false,
      code: 'indisponivel',
      mensagem: 'O GitHub não respondeu.',
      retryable: true,
      acao: 'retentar',
      provenance: {
        connector: 'github',
        operation: 'issues.create',
        obtidoEm: '2026-08-29T00:00:00.000Z'
      },
      evidencia: 'HTTP 503'
    }

    expect(erro.mensagem).not.toContain(erro.evidencia)
  })

  it('o desfecho é união discriminada: tratar o erro não é opcional', () => {
    const desfechos: readonly ConnectorOutcome[] = [
      {
        ok: true,
        data: null,
        provenance: { connector: 'tavily', operation: 'search.query', obtidoEm: 'x' },
        usage: { creditos: 0, latenciaMs: 1 }
      },
      {
        ok: false,
        code: 'timeout',
        mensagem: 'Tempo esgotado.',
        retryable: true,
        acao: 'retentar',
        provenance: { connector: 'tavily', operation: 'search.query', obtidoEm: 'x' }
      }
    ]

    // O `filter` por `ok` é o que o consumidor faz de verdade — e só compila porque o
    // discriminante existe. Com `{ data?, error? }` este teste passaria com os dois ausentes.
    expect(desfechos.filter((d) => d.ok)).toHaveLength(1)
    expect(desfechos.filter((d) => !d.ok)).toHaveLength(1)
  })
})

describe('validarConnectorRequest — recusa antes de qualquer I/O (critérios 1 e 2)', () => {
  it('aceita um pedido de leitura bem formado', () => {
    expect(validarConnectorRequest(pedido(), LEITURA)).toBeUndefined()
  })

  it('recusa capacidade que o adapter não declara — e o código é estável', () => {
    const erro = validarConnectorRequest(pedido({ operation: 'search.inventada' }), undefined)

    expect(erro?.code).toBe('capacidade-desconhecida')
    expect(erro?.retryable).toBe(false)
    expect(erro?.acao).toBe('reportar')
    // A mensagem nomeia a operação pedida: sem isso, "capacidade desconhecida" numa tela não
    // diz **qual**, e o usuário fica sem o que corrigir.
    expect(erro?.mensagem).toContain('search.inventada')
  })

  it('recusa versão de contrato incompatível antes de olhar o resto', () => {
    // O pedido também tem operação vazia. A versão vence porque um contrato de outra forma
    // torna qualquer leitura dos demais campos uma suposição.
    const erro = validarConnectorRequest(
      pedido({ contractVersion: 99 as never, operation: '' }),
      LEITURA
    )

    expect(erro?.code).toBe('contrato-incompativel')
  })

  it('recusa conector fora da lista fechada', () => {
    const erro = validarConnectorRequest(pedido({ connector: 'gitlab' as never }), LEITURA)

    expect(erro?.code).toBe('connector-nao-registrado')
  })

  it.each([
    ['operação vazia', { operation: '   ' }],
    ['correlação vazia', { correlationId: '' }],
    ['timeout zero', { timeoutMs: 0 }],
    ['timeout negativo', { timeoutMs: -1 }],
    ['timeout não finito', { timeoutMs: Number.NaN }]
  ])('recusa %s com validacao-invalida', (_nome, over) => {
    expect(validarConnectorRequest(pedido(over), LEITURA)?.code).toBe('validacao-invalida')
  })

  it('recusa mutação sem chave de idempotência — repetir não seria seguro', () => {
    const erro = validarConnectorRequest(
      pedido({ connector: 'github', operation: 'issues.create' }),
      MUTACAO
    )

    expect(erro?.code).toBe('validacao-invalida')
    expect(erro?.mensagem).toContain('idempotência')
  })

  it('aceita a mesma mutação quando a chave vem junto', () => {
    const ok = validarConnectorRequest(
      pedido({ connector: 'github', operation: 'issues.create', idempotencyKey: 'idem-1' }),
      MUTACAO
    )

    expect(ok).toBeUndefined()
  })

  it('não aceita chave de idempotência em branco como se fosse chave', () => {
    // `'  '` passaria num teste de presença (`!== undefined`) e o pedido seria retentável sem
    // ter chave nenhuma — o buraco exato que o critério 3 da F02 existe para não ter.
    const erro = validarConnectorRequest(
      pedido({ connector: 'github', operation: 'issues.create', idempotencyKey: '  ' }),
      MUTACAO
    )

    expect(erro?.code).toBe('validacao-invalida')
  })

  it('leitura não exige chave de idempotência: repetir já é seguro', () => {
    expect(validarConnectorRequest(pedido({ idempotencyKey: undefined }), LEITURA)).toBeUndefined()
  })

  it('todo erro devolvido traz proveniência e ação de retomada', () => {
    const erro = validarConnectorRequest(pedido({ correlationId: '' }), LEITURA)

    expect(erro?.provenance.connector).toBe('tavily')
    expect(erro?.provenance.operation).toBe('search.query')
    expect(CONNECTOR_RECOVERY_ACTIONS).toContain(erro?.acao)
    expect(CONNECTOR_ERROR_CODES).toContain(erro?.code)
  })

  it('a recusa não toca credencial: o pedido nem precisa trazer uma para ser recusado', () => {
    // A asserção de **ordem** que sustenta o critério 1. Um pedido sem credencial é recusado
    // pela forma; se a validação resolvesse o Vault antes de validar, este caso exigiria uma
    // credencial para chegar até a recusa — e a falha teria acontecido depois de tocar o cofre.
    const erro = validarConnectorRequest(
      pedido({ credential: undefined, operation: 'inexistente' }),
      undefined
    )

    expect(erro?.code).toBe('capacidade-desconhecida')
  })
})
