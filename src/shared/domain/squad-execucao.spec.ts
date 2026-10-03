import { describe, expect, it } from 'vitest'
import {
  avaliarResultado,
  EVIDENCIA_EXIGIDA,
  escritoresColidemPorNome,
  ehEstadoTerminal,
  ehItemDeEscritor,
  idDoEscritor,
  lerIdDoEscritor,
  textoDaAssinatura,
  transicaoDaTarefaPermitida,
  type EstadoDaTarefa
} from './squad-execucao'

const FONTES = new Set(['src/a.ts', 'src/b.ts'])

const valido = () => ({
  schema: 'achados@1',
  conclusao: 'O parser perde o último item quando a lista termina em vírgula.',
  evidencia: [{ tipo: 'arquivo', referencia: 'src/a.ts', detalhe: 'linhas 10-14' }],
  confianca: 'alta',
  lacunas: []
})

const ctx = { schemaEsperado: 'achados@1', fontesDoPack: FONTES }

describe('id do escritor no pool', () => {
  it('compõe e lê de volta o run e o escritor', () => {
    const id = idDoEscritor('run-1', 'a')

    expect(id).toBe('run-1:a')
    expect(lerIdDoEscritor(id)).toEqual({ runId: 'run-1', escritor: 'a' })
  })

  it('lê pelo último separador: o escritor nunca tem ":", o run pode ter', () => {
    expect(lerIdDoEscritor('x:y:esc')).toEqual({ runId: 'x:y', escritor: 'esc' })
  })

  it('recusa o que não é id de escritor', () => {
    expect(lerIdDoEscritor('run-1')).toBeUndefined()
    expect(lerIdDoEscritor(':a')).toBeUndefined()
    expect(lerIdDoEscritor('run-1:')).toBeUndefined()
    expect(lerIdDoEscritor('run-1:a b')).toBeUndefined()
    expect(lerIdDoEscritor('run-1:a/b')).toBeUndefined()
    expect(lerIdDoEscritor(`run-1:${'x'.repeat(33)}`)).toBeUndefined()
  })

  it('distingue o item de escritor do item de run', () => {
    expect(ehItemDeEscritor('run-1:a')).toBe(true)
    expect(ehItemDeEscritor('run-1')).toBe(false)
  })
})

describe('nomes de escritor que a sanitização funde', () => {
  it('apontam `a_b` e `a-b`, que dariam o mesmo container e a mesma branch', () => {
    expect(escritoresColidemPorNome(['a_b', 'a-b'])).toEqual([['a_b', 'a-b']])
  })

  it('apontam a diferença só de caixa', () => {
    expect(escritoresColidemPorNome(['Dev', 'dev'])).toEqual([['Dev', 'dev']])
  })

  it('apontam o nome que a sanitização esvazia', () => {
    expect(escritoresColidemPorNome(['___'])).toEqual([['___', '___']])
  })

  it('aceitam nomes distintos depois de sanitizados', () => {
    expect(escritoresColidemPorNome(['api', 'ui'])).toEqual([])
    expect(escritoresColidemPorNome([])).toEqual([])
  })
})

describe('estados da tarefa', () => {
  const TERMINAIS: readonly EstadoDaTarefa[] = [
    'concluida',
    'incompleta',
    'invalida',
    'timeout',
    'cancelada',
    'falhou',
    'recusada'
  ]

  it('só os sete finais são terminais', () => {
    for (const e of TERMINAIS) expect(ehEstadoTerminal(e)).toBe(true)
    expect(ehEstadoTerminal('pendente')).toBe(false)
    expect(ehEstadoTerminal('em-execucao')).toBe(false)
  })

  it('pendente vai a em-execucao, e a recusada ou cancelada sem nunca ter rodado', () => {
    expect(transicaoDaTarefaPermitida('pendente', 'em-execucao')).toBe(true)
    expect(transicaoDaTarefaPermitida('pendente', 'recusada')).toBe(true)
    expect(transicaoDaTarefaPermitida('pendente', 'cancelada')).toBe(true)
  })

  it('pendente não conclui, não esgota tempo e não falha sem ter rodado', () => {
    for (const e of ['concluida', 'incompleta', 'invalida', 'timeout', 'falhou'] as const) {
      expect(transicaoDaTarefaPermitida('pendente', e)).toBe(false)
    }
  })

  it('em-execucao chega a qualquer final, menos a recusada (essa é antes de rodar)', () => {
    for (const e of TERMINAIS.filter((t) => t !== 'recusada')) {
      expect(transicaoDaTarefaPermitida('em-execucao', e)).toBe(true)
    }
    expect(transicaoDaTarefaPermitida('em-execucao', 'recusada')).toBe(false)
    expect(transicaoDaTarefaPermitida('em-execucao', 'pendente')).toBe(false)
  })

  it('estado final não muda: nem repetir, nem ressuscitar', () => {
    for (const de of TERMINAIS) {
      for (const para of [...TERMINAIS, 'pendente', 'em-execucao'] as const) {
        expect(transicaoDaTarefaPermitida(de, para)).toBe(false)
      }
    }
  })
})

describe('resultado da tarefa — conteúdo do agente é dado não confiável', () => {
  it('aceita o resultado completo com evidência do pacote', () => {
    const r = avaliarResultado(valido(), ctx)

    expect(r.estado).toBe('concluida')
    if (r.estado !== 'invalida') {
      expect(r.resultado.confianca).toBe('alta')
      expect(r.resultado.evidencia).toEqual([
        { tipo: 'arquivo', referencia: 'src/a.ts', detalhe: 'linhas 10-14' }
      ])
      expect(r.descartadas).toEqual([])
    }
  })

  it('recusa o que não é objeto', () => {
    for (const bruto of [null, undefined, 'texto', 3, [], [valido()]]) {
      expect(avaliarResultado(bruto, ctx).estado).toBe('invalida')
    }
  })

  it('recusa chave que o esquema não tem — inclusive a assinatura que o agente tente mandar', () => {
    const r = avaliarResultado({ ...valido(), assinatura: 'forjada' }, ctx)

    expect(r).toMatchObject({ estado: 'invalida' })
    expect((r as { motivo: string }).motivo).toContain('assinatura')
  })

  it('recusa o schema que não é o da tarefa', () => {
    const r = avaliarResultado({ ...valido(), schema: 'parecer@1' }, ctx)

    expect(r.estado).toBe('invalida')
    expect((r as { motivo: string }).motivo).toContain('schema')
  })

  it('recusa campo faltando ou do tipo errado', () => {
    for (const campo of ['schema', 'conclusao', 'evidencia', 'confianca', 'lacunas']) {
      const semOCampo = Object.fromEntries(Object.entries(valido()).filter(([k]) => k !== campo))
      expect(avaliarResultado(semOCampo, ctx).estado).toBe('invalida')
    }
    expect(avaliarResultado({ ...valido(), conclusao: '   ' }, ctx).estado).toBe('invalida')
    expect(avaliarResultado({ ...valido(), conclusao: 7 }, ctx).estado).toBe('invalida')
    expect(avaliarResultado({ ...valido(), evidencia: 'x' }, ctx).estado).toBe('invalida')
    expect(avaliarResultado({ ...valido(), lacunas: 'x' }, ctx).estado).toBe('invalida')
    expect(avaliarResultado({ ...valido(), confianca: 'certa' }, ctx).estado).toBe('invalida')
  })

  it('recusa evidência malformada', () => {
    const base = valido()
    for (const ev of [
      [{ tipo: 'arquivo' }],
      [{ referencia: 'src/a.ts' }],
      [{ tipo: 'palpite', referencia: 'src/a.ts' }],
      [{ tipo: 'arquivo', referencia: 'src/a.ts', extra: 1 }],
      [{ tipo: 'arquivo', referencia: '' }],
      ['src/a.ts']
    ]) {
      expect(avaliarResultado({ ...base, evidencia: ev }, ctx).estado).toBe('invalida')
    }
  })

  it('recusa controle e override de direção no texto', () => {
    const nul = String.fromCharCode(0)
    const rlo = String.fromCharCode(0x202e)
    expect(avaliarResultado({ ...valido(), conclusao: `a${nul}b` }, ctx).estado).toBe('invalida')
    expect(avaliarResultado({ ...valido(), conclusao: `a${rlo}b` }, ctx).estado).toBe('invalida')
    expect(avaliarResultado({ ...valido(), lacunas: [`x${nul}`] }, ctx).estado).toBe('invalida')
  })

  it('a referência é uma linha só: quebra ali é recusa, mesmo onde o texto livre a aceita', () => {
    const r = avaliarResultado(
      { ...valido(), evidencia: [{ tipo: 'arquivo', referencia: 'src/a.ts\nsrc/b.ts' }] },
      ctx
    )

    expect(r.estado).toBe('invalida')
  })

  it('recusa detalhe de evidência vazio ou com controle', () => {
    const nul = String.fromCharCode(0)
    for (const detalhe of ['', '   ', `x${nul}`, 7]) {
      const r = avaliarResultado(
        { ...valido(), evidencia: [{ tipo: 'arquivo', referencia: 'src/a.ts', detalhe }] },
        ctx
      )
      expect(r.estado).toBe('invalida')
    }
  })

  it('trecho também cita caminho: fora do pacote é descartado como o arquivo', () => {
    const r = avaliarResultado(
      { ...valido(), evidencia: [{ tipo: 'trecho', referencia: 'src/inventado.ts' }] },
      ctx
    )

    expect(r.estado).toBe('incompleta')
  })

  it('aceita quebra de linha e tabulação, que texto legítimo tem', () => {
    const r = avaliarResultado({ ...valido(), conclusao: 'linha 1\n\tlinha 2' }, ctx)

    expect(r.estado).toBe('concluida')
  })

  it('recusa o que passa do teto de tamanho', () => {
    expect(avaliarResultado({ ...valido(), conclusao: 'x'.repeat(4001) }, ctx).estado).toBe(
      'invalida'
    )
    const muitas = Array.from({ length: 51 }, () => ({ tipo: 'arquivo', referencia: 'src/a.ts' }))
    expect(avaliarResultado({ ...valido(), evidencia: muitas }, ctx).estado).toBe('invalida')
    expect(
      avaliarResultado({ ...valido(), lacunas: Array.from({ length: 21 }, () => 'l') }, ctx).estado
    ).toBe('invalida')
    expect(avaliarResultado({ ...valido(), lacunas: ['x'.repeat(501)] }, ctx).estado).toBe(
      'invalida'
    )
  })

  it('aceita exatamente o teto', () => {
    const r = avaliarResultado({ ...valido(), conclusao: 'x'.repeat(4000) }, ctx)

    expect(r.estado).toBe('concluida')
  })

  it('sem evidência é incompleto, não sucesso presumido (regra 2)', () => {
    const r = avaliarResultado({ ...valido(), evidencia: [] }, ctx)

    expect(r.estado).toBe('incompleta')
    expect((r as { motivo: string }).motivo).toMatch(/evid/i)
  })

  it('evidência de arquivo fora do pacote é descartada e não conta', () => {
    const r = avaliarResultado(
      { ...valido(), evidencia: [{ tipo: 'arquivo', referencia: 'src/inventado.ts' }] },
      ctx
    )

    expect(r.estado).toBe('incompleta')
    if (r.estado === 'incompleta') expect(r.descartadas).toEqual(['src/inventado.ts'])
  })

  it('basta uma evidência válida entre as inventadas', () => {
    const r = avaliarResultado(
      {
        ...valido(),
        evidencia: [
          { tipo: 'arquivo', referencia: 'src/inventado.ts' },
          { tipo: 'trecho', referencia: 'src/b.ts' }
        ]
      },
      ctx
    )

    expect(r.estado).toBe('concluida')
    if (r.estado === 'concluida') {
      expect(r.descartadas).toEqual(['src/inventado.ts'])
      expect(r.resultado.evidencia).toEqual([{ tipo: 'trecho', referencia: 'src/b.ts' }])
    }
  })

  it('evidência de um tipo que o schema não aceita também não conta', () => {
    const r = avaliarResultado(
      { ...valido(), evidencia: [{ tipo: 'documento', referencia: 'https://x' }] },
      ctx
    )

    expect(r.estado).toBe('incompleta')
  })

  it('cada schema exige o seu tipo de evidência', () => {
    expect(EVIDENCIA_EXIGIDA['achados@1']).toEqual(['arquivo', 'trecho'])
    expect(EVIDENCIA_EXIGIDA['parecer@1']).toEqual(['arquivo', 'trecho', 'documento'])
    expect(EVIDENCIA_EXIGIDA['resultado-de-testes@1']).toEqual(['teste', 'arquivo', 'trecho'])

    const parecer = avaliarResultado(
      {
        ...valido(),
        schema: 'parecer@1',
        evidencia: [{ tipo: 'documento', referencia: 'https://doc/x' }]
      },
      { schemaEsperado: 'parecer@1', fontesDoPack: FONTES }
    )
    expect(parecer.estado).toBe('concluida')

    const testes = avaliarResultado(
      {
        ...valido(),
        schema: 'resultado-de-testes@1',
        evidencia: [{ tipo: 'teste', referencia: 'a.spec.ts > faz x' }]
      },
      { schemaEsperado: 'resultado-de-testes@1', fontesDoPack: FONTES }
    )
    expect(testes.estado).toBe('concluida')
  })

  it('o schema esperado que o kernel não conhece é recusa, não passe livre', () => {
    const r = avaliarResultado(
      { ...valido(), schema: 'qualquer@9' },
      { schemaEsperado: 'qualquer@9', fontesDoPack: FONTES }
    )

    expect(r.estado).toBe('invalida')
  })

  it('não confia em chave herdada do protótipo', () => {
    const r = avaliarResultado(JSON.parse('{"__proto__": {"x": 1}, "schema": "achados@1"}'), ctx)

    expect(r.estado).toBe('invalida')
  })
})

describe('assinatura do resultado', () => {
  const base = () => {
    const r = avaliarResultado(valido(), ctx)
    if (r.estado !== 'concluida') throw new Error('resultado do teste deveria ser válido')
    return r.resultado
  }

  it('não muda com espaço, caixa, ordem ou repetição da evidência', () => {
    const a = textoDaAssinatura({
      ...base(),
      conclusao: 'O Parser  perde\no último item.',
      evidencia: [
        { tipo: 'arquivo', referencia: 'src/b.ts' },
        { tipo: 'arquivo', referencia: 'src/a.ts' },
        { tipo: 'arquivo', referencia: 'src/a.ts', detalhe: 'outra linha' }
      ]
    })
    const b = textoDaAssinatura({
      ...base(),
      conclusao: 'o parser perde o último item.',
      evidencia: [
        { tipo: 'arquivo', referencia: 'src/a.ts' },
        { tipo: 'arquivo', referencia: 'src/b.ts' }
      ]
    })

    expect(a).toBe(b)
  })

  it('muda com a conclusão, o schema ou a evidência', () => {
    const r = base()
    const original = textoDaAssinatura(r)

    expect(textoDaAssinatura({ ...r, conclusao: 'outra coisa' })).not.toBe(original)
    expect(textoDaAssinatura({ ...r, schema: 'parecer@1' })).not.toBe(original)
    expect(
      textoDaAssinatura({ ...r, evidencia: [{ tipo: 'arquivo', referencia: 'src/b.ts' }] })
    ).not.toBe(original)
  })

  it('não depende da confiança nem das lacunas: o mesmo achado dito com outra certeza é o mesmo', () => {
    const r = base()

    expect(textoDaAssinatura({ ...r, confianca: 'baixa', lacunas: ['talvez'] })).toBe(
      textoDaAssinatura(r)
    )
  })
})
