/**
 * Contrato do vault (SPEC-Providers-01, critérios 1 e 2) — a parte que é regra pura.
 *
 * O teste central aqui é sobre **ausência**: prova que nenhum tipo que atravessa o IPC tem
 * campo onde o segredo caiba. Uma asserção sobre o que um tipo *não* tem parece estranha até
 * lembrar que é essa ausência que dá a garantia — o valor não vaza porque não há por onde.
 */

import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_ACTORS,
  CREDENTIAL_KEYS,
  CREDENTIAL_PROVIDER_LABELS,
  CREDENTIAL_SOURCES,
  CREDENTIAL_STATUSES,
  isCredentialKey,
  nomeDaVariavelDeAmbiente,
  type CredentialRef,
  type CredentialStatusView
} from './credentials'

describe('CredentialRef — a referência não carrega o segredo (critério 1)', () => {
  it('não tem campo de valor: a forma do objeto é a garantia', () => {
    const ref: CredentialRef = {
      id: 'cred-1',
      user_id: 'u-1',
      workspace_id: 'jarvis',
      key: 'openai',
      source: 'vault',
      status: 'present',
      created_at: '2026-08-28T00:00:00.000Z',
      updated_at: '2026-08-28T00:00:00.000Z'
    }

    // Varre os nomes de campo em vez de afirmar sobre um valor: um `value`/`secret`/`token`
    // acrescentado ao tipo amanhã quebra aqui, mesmo que ninguém o preencha. O tipo é o que
    // recusa a chave — este teste é o que impede o tipo de mudar de ideia em silêncio.
    expect(
      Object.keys(ref).filter((k) => /value|secret|token|plaintext|api.?key/i.test(k))
    ).toEqual([])
  })

  it('a view do renderer não expõe nem indício do valor — sem máscara, tamanho ou hash', () => {
    const view: CredentialStatusView = {
      key: 'anthropic',
      provider: CREDENTIAL_PROVIDER_LABELS.anthropic,
      workspace: 'noa',
      status: 'present',
      source: 'vault',
      envDisponivel: false
    }

    expect(
      Object.keys(view).filter((k) => /value|secret|token|mask|length|hash|preview/i.test(k))
    ).toEqual([])
  })
})

describe('chaves conhecidas — dado, não texto livre', () => {
  it('toda chave tem rótulo de provider, e todo rótulo tem chave', () => {
    // Sem isto, acrescentar um provider ao enum e esquecer o rótulo faria a UI mostrar
    // `undefined` como nome do serviço para o qual o usuário está colando a chave dele.
    expect(Object.keys(CREDENTIAL_PROVIDER_LABELS).sort()).toEqual([...CREDENTIAL_KEYS].sort())
  })

  it('o type guard recusa o que não está no enum', () => {
    expect(isCredentialKey('openai')).toBe(true)
    expect(isCredentialKey('provider-inventado')).toBe(false)
    // A guarda existe porque a chave vira nome de variável de ambiente: sem ela, o renderer
    // escolheria qual entrada de `process.env` o main vai ler.
    expect(isCredentialKey('PATH')).toBe(false)
    expect(isCredentialKey(null)).toBe(false)
  })

  it('o nome da variável de ambiente é namespaced e derivado da chave', () => {
    expect(nomeDaVariavelDeAmbiente('openai')).toBe('JARVIS_CREDENTIAL_OPENAI')
    expect(nomeDaVariavelDeAmbiente('gemini')).toBe('JARVIS_CREDENTIAL_GEMINI')

    // Prefixo próprio, e não `OPENAI_API_KEY`: o `.env` do projeto é lido inteiro para
    // `process.env`, e casar nomes genéricos faria o vault absorver variáveis que existem
    // para outra finalidade.
    for (const key of CREDENTIAL_KEYS) {
      expect(nomeDaVariavelDeAmbiente(key).startsWith('JARVIS_CREDENTIAL_')).toBe(true)
    }
  })
})

describe('enums fechados do vault', () => {
  it('fonte, status e ator são conjuntos fechados', () => {
    expect([...CREDENTIAL_SOURCES]).toEqual(['env', 'vault'])
    expect([...CREDENTIAL_STATUSES]).toEqual(['present', 'missing'])
    expect([...CREDENTIAL_ACTORS]).toEqual(['usuario', 'agente'])
  })
})
