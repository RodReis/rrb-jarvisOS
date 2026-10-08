import { describe, expect, it } from 'vitest'
import {
  projetarProximoGate,
  projetarEstadoDaFatia,
  type CandidatoAoGate,
  type InventarioParaProjecao,
  type NoDoDAG
} from './projecoes-execucao'

const sha = (letra: string): string => letra.repeat(64)

function no(id: string, patch: Partial<NoDoDAG> = {}): NoDoDAG {
  return {
    id,
    tipo: 'fatia',
    numero: 1,
    titulo: id,
    dependeDe: [],
    estadoTecnico: 'pendente',
    gateAprovado: false,
    ...patch
  }
}

function dag(
  nos: readonly NoDoDAG[],
  diagnosticos: InventarioParaProjecao['diagnosticos'] = []
): InventarioParaProjecao {
  return { nos, ordem: nos.map((item) => item.id), diagnosticos, fingerprint: sha('f') }
}

function candidato(patch: Partial<CandidatoAoGate> = {}): CandidatoAoGate {
  return {
    noId: 'MVP13-F04',
    gate: 'SLICE_ENTRY',
    revisoesAtuais: [{ artefato: 'docs/spec/f04.md', hash: sha('b') }],
    revisoesAprovadas: [{ artefato: 'docs/spec/f04.md', hash: sha('a') }],
    questoes: [],
    ...patch
  }
}

describe('projeção do próximo gate', () => {
  it('prepara o primeiro gate pendente com revisão exata e mudança determinística', () => {
    const inventario = dag([
      no('MVP13-F03', { gateAprovado: true, estadoTecnico: 'mergeado' }),
      no('MVP13-F04', { dependeDe: ['MVP13-F03'] })
    ])

    const pacote = projetarProximoGate(inventario, [candidato()])

    expect(pacote).toMatchObject({
      estado: 'pronto-para-revisao',
      fingerprint: inventario.fingerprint,
      no: { id: 'MVP13-F04' },
      gate: 'SLICE_ENTRY',
      mudancas: [{ artefato: 'docs/spec/f04.md', hashAnterior: sha('a'), hashAtual: sha('b') }]
    })
  })

  it('não recomenda decisão quando a dependência ainda não tem merge confirmado', () => {
    const inventario = dag([
      no('MVP13-F03', { estadoTecnico: 'em-andamento' }),
      no('MVP13-F04', { dependeDe: ['MVP13-F03'] })
    ])

    expect(projetarProximoGate(inventario, [candidato()]).estado).toBe('aguardando-dependencias')
  })

  it('bloqueia a decisão enquanto houver pergunta sem resposta ou hash inválido', () => {
    const comPergunta = candidato({
      questoes: [{ id: 'Q1', texto: 'Qual é a decisão?', respondida: false }]
    })
    expect(projetarProximoGate(dag([no('MVP13-F04')]), [comPergunta]).estado).toBe('bloqueado')
    expect(
      projetarProximoGate(dag([no('MVP13-F04')]), [
        candidato({ revisoesAtuais: [{ artefato: 'spec', hash: 'inválido' }] })
      ]).estado
    ).toBe('bloqueado')
  })

  it('não entrega pacote acionável enquanto as fontes estiverem divergentes', () => {
    const inventario = dag(
      [no('MVP13-F04')],
      [
        {
          codigo: 'conflito-projecao',
          envolvidos: ['MVP13-F04'],
          mensagem: 'STATUS e GitHub divergem.'
        }
      ]
    )

    expect(projetarProximoGate(inventario, [candidato()])).toMatchObject({
      estado: 'reconciliacao-necessaria',
      revisoes: [],
      mudancas: [],
      diagnosticos: inventario.diagnosticos
    })
  })

  it('mantém o resultado estável quando a ordem de fontes muda e não grava aprovação', () => {
    const inventario = dag([no('MVP13-F04')])
    const a = candidato({
      revisoesAtuais: [
        { artefato: 'b.md', hash: sha('b') },
        { artefato: 'a.md', hash: sha('a') }
      ]
    })
    const b = candidato({ revisoesAtuais: [...a.revisoesAtuais].reverse() })

    expect(projetarProximoGate(inventario, [a])).toEqual(projetarProximoGate(inventario, [b]))
    expect(projetarProximoGate(inventario, [a])).not.toHaveProperty('aprovacao')
  })

  it('falha fechado quando existe gate sem revisão detalhada correspondente', () => {
    const inventario = dag([no('MVP13-F04')])
    expect(projetarProximoGate(inventario, [])).toMatchObject({
      estado: 'bloqueado',
      no: { id: 'MVP13-F04' },
      revisoes: []
    })
  })

  it('inclui o contexto local da fatia quando o snapshot remoto não contém o link', () => {
    const noLocal = no('MVP13-F04', {
      issue: {
        numero: 137,
        aberta: true,
        url: 'https://github.com/RodReis/rrb-jarvisOS/issues/137'
      }
    })
    expect(
      projetarProximoGate(
        { ...dag([no('MVP13-F04')]), noLocalPorId: new Map([[noLocal.id, noLocal]]) },
        [candidato()]
      ).no?.issue
    ).toEqual(noLocal.issue)
  })
})

describe('projeção da execução da fatia', () => {
  it('associa branch e PR pela referência persistida do run e conserva SHA/checks', () => {
    const fatia = {
      ...no('MVP13-F04'),
      pullRequests: [
        {
          numero: 417,
          estado: 'open' as const,
          merged: false,
          headBranch: 'feat/m13-f04-projecoes',
          headSha: sha('c'),
          checks: 'pending' as const
        }
      ]
    }
    const estado = projetarEstadoDaFatia(
      fatia,
      { id: 'run-1', estado: 'PR_CI' },
      { pullRequest: 417, owner: 'RodReis', repo: 'rrb-jarvisOS', branch: 'feat/m13-f04-projecoes' }
    )

    expect(estado).toMatchObject({
      estadoTecnico: 'pendente',
      run: { id: 'run-1', estado: 'PR_CI' },
      branch: { nome: 'feat/m13-f04-projecoes', estadoRemoto: 'confirmada', headSha: sha('c') },
      pullRequest: { numero: 417, estado: 'open', checks: 'pending', headSha: sha('c') },
      divergencias: []
    })
  })

  it('não oculta branch divergente, merge não confirmado nem run cancelado com PR mergeado', () => {
    const estado = projetarEstadoDaFatia(
      {
        ...no('MVP13-F04'),
        pullRequests: [
          {
            numero: 417,
            estado: 'closed',
            merged: true,
            headBranch: 'feat/outro-branch',
            headSha: sha('c'),
            mergeSha: sha('d'),
            checks: 'success'
          }
        ]
      },
      { id: 'run-1', estado: 'CANCELLED' },
      { pullRequest: 417, owner: 'RodReis', repo: 'rrb-jarvisOS', branch: 'feat/m13-f04-projecoes' }
    )

    expect(estado.estadoTecnico).toBe('desconhecido')
    expect(estado.divergencias).toHaveLength(2)
    expect(estado.pullRequest?.mergeSha).toBe(sha('d'))
  })

  it('não conclui branch não observada sem um PR vinculado ao run', () => {
    const estado = projetarEstadoDaFatia(
      no('MVP13-F04'),
      { id: 'run-1', estado: 'RUNNING' },
      { pullRequest: 417, owner: 'RodReis', repo: 'rrb-jarvisOS', branch: 'feat/m13-f04-projecoes' }
    )

    expect(estado.branch?.estadoRemoto).toBe('nao-observada')
    expect(estado.pullRequest?.estado).toBeUndefined()
  })
})
