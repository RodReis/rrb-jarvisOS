/**
 * As recusas que acontecem **antes** de o CLI iniciar (SPEC-Multi-Executor-01, critério 4).
 *
 * Project `regras`: a decisão é pura — compara o que o request pede com o que o adapter
 * declara suportar. O ponto da fatia é que esta comparação aconteça **antes** do spawn, e
 * provar isso não exige spawn nenhum.
 */

import { describe, expect, it } from 'vitest'
import type { CodingExecutorAdapter, ExecutorRequest } from './executor'
import { validarRequest } from './validar-request'

/** Um adapter de mentira só com os campos declarativos que a validação lê. */
function adapterQueSuporta(
  parcial: Partial<
    Pick<CodingExecutorAdapter, 'modosSuportados' | 'revisoesSuportadas' | 'suportaSchemaDeSaida'>
  > = {}
): CodingExecutorAdapter {
  return {
    nome: 'fake',
    modosSuportados: parcial.modosSuportados ?? ['unmetered'],
    revisoesSuportadas: parcial.revisoesSuportadas ?? ['revisao-padrao'],
    suportaSchemaDeSaida: parcial.suportaSchemaDeSaida ?? true,
    disponivel: async () => true,
    // eslint-disable-next-line require-yield
    executar: async function* () {
      throw new Error('a validacao devia ter recusado antes de chegar aqui')
    }
  }
}

function requestValido(sobrescrever: Partial<ExecutorRequest> = {}): ExecutorRequest {
  return {
    runId: 'run-1',
    attemptId: 'att-1',
    chaveIdempotente: 'chave-1',
    executor: 'fake',
    modelo: 'modelo-x',
    modoDeCobranca: 'unmetered',
    revisoesAprovadas: ['revisao-padrao'],
    contextPackId: 'pack-1',
    worktree: '/tmp/wt',
    pathsPermitidos: ['src'],
    validacoes: [['npm', 'test']],
    limiteDeTempoMs: 1_000,
    autenticacao: { referencia: 'sessao-1' },
    ...sobrescrever
  }
}

describe('validarRequest', () => {
  it('aceita o request compativel', () => {
    expect(validarRequest(requestValido(), adapterQueSuporta())).toBeUndefined()
  })

  it('recusa modo de cobranca que o executor nao suporta', () => {
    const recusa = validarRequest(
      requestValido({ modoDeCobranca: 'metered' }),
      adapterQueSuporta({ modosSuportados: ['unmetered'] })
    )

    expect(recusa?.motivo).toBe('modo-de-cobranca')
    // A mensagem nomeia o que recusou e o que é aceito: sem isso, o operador
    // descobre "recusado" e não descobre o que mudar.
    expect(recusa?.mensagem).toContain('metered')
    expect(recusa?.mensagem).toContain('unmetered')
  })

  it('recusa revisao que o executor nao conhece', () => {
    const recusa = validarRequest(
      requestValido({ revisoesAprovadas: ['revisao-padrao', 'revisao-exotica'] }),
      adapterQueSuporta({ revisoesSuportadas: ['revisao-padrao'] })
    )

    expect(recusa?.motivo).toBe('revisao')
    expect(recusa?.mensagem).toContain('revisao-exotica')
  })

  it('recusa schema de saida quando o executor nao o impoe', () => {
    const recusa = validarRequest(
      requestValido({ schemaDeSaida: '{"type":"object"}' }),
      adapterQueSuporta({ suportaSchemaDeSaida: false })
    )

    expect(recusa?.motivo).toBe('schema')
  })

  it('aceita ausencia de schema mesmo quando o executor nao o suporta', () => {
    const recusa = validarRequest(
      requestValido(),
      adapterQueSuporta({ suportaSchemaDeSaida: false })
    )

    expect(recusa).toBeUndefined()
  })

  it('recusa executor diferente do que o adapter atende', () => {
    const recusa = validarRequest(requestValido({ executor: 'outro' }), adapterQueSuporta())

    expect(recusa?.motivo).toBe('executor')
  })

  it('a mensagem de recusa nao carrega a referencia de autenticacao', () => {
    const recusa = validarRequest(
      requestValido({
        modoDeCobranca: 'metered',
        autenticacao: { referencia: 'sessao-secreta-1' }
      }),
      adapterQueSuporta({ modosSuportados: ['unmetered'] })
    )

    // Afirma **ausência**: mensagem de erro é caminho clássico de vazamento, e a
    // referência não tem por que aparecer para explicar um modo incompatível.
    expect(recusa?.mensagem).not.toContain('sessao-secreta-1')
  })
})
