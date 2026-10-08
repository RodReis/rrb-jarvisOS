import { describe, expect, it } from 'vitest'
import { gatesInvalidados, type Approval } from '@shared/domain/aprovacoes'
import {
  comporInventario,
  dependenciasTecnicasSatisfeitas,
  elegivelParaExecucao,
  reconciliarInventario,
  type NoInventario
} from './inventario-global'

const mvp = (
  id: string,
  numero: number,
  dependeDe: readonly string[] = [],
  patch: Partial<NoInventario> = {}
): NoInventario => ({
  id,
  tipo: 'mvp',
  numero,
  titulo: id,
  dependeDe,
  estadoTecnico: 'pendente',
  spec: {
    estado: 'aprovada',
    revisaoAtual: 'a'.repeat(40),
    revisaoAprovada: 'a'.repeat(40)
  },
  gateAprovado: true,
  bloqueado: false,
  ...patch
})

describe('inventário global', () => {
  it('detecta dependência ausente, duplicidade e ciclo antes de devolver uma ordem', () => {
    const dag = comporInventario([
      mvp('m1', 1, ['m2', 'm2']),
      mvp('m2', 2, ['m1']),
      mvp('m3', 3, ['m404'])
    ])

    expect(dag.ordem).toEqual([])
    expect(dag.diagnosticos.map(({ codigo }) => codigo)).toEqual(
      expect.arrayContaining(['duplicidade', 'dependencia-ausente', 'ciclo'])
    )
  })

  it('propriedade: ordena DAGs sem ciclo respeitando toda dependência gerada', () => {
    let semente = 134
    const aleatorio = (): number => {
      semente = (semente * 48271) % 2_147_483_647
      return semente / 2_147_483_647
    }
    const nos = Array.from({ length: 80 }, (_, indice) => {
      const id = `m${indice}`
      const dependeDe = Array.from({ length: indice }, (_, anterior) => anterior)
        .filter(() => aleatorio() < 0.06)
        .map((anterior) => `m${anterior}`)
      return mvp(id, indice + 1, dependeDe)
    })
    const inventario = comporInventario(nos)
    const posicao = new Map(inventario.ordem.map((id, indice) => [id, indice]))

    expect(inventario.diagnosticos).toEqual([])
    expect(inventario.ordem).toHaveLength(nos.length)
    for (const no of nos) {
      for (const dependencia of no.dependeDe) {
        expect(posicao.get(dependencia)).toBeLessThan(posicao.get(no.id) ?? -1)
      }
    }
  })

  it('aceita dependência técnica por merge mesmo com issue aberta', () => {
    const anterior = mvp('m1', 1, [], {
      estadoTecnico: 'mergeado',
      issue: { numero: 101, aberta: true }
    })
    const seguinte = mvp('m2', 2, ['m1'])
    const inventario = comporInventario([seguinte, anterior])

    expect(dependenciasTecnicasSatisfeitas(seguinte, inventario)).toBe(true)
    expect(elegivelParaExecucao(seguinte, inventario)).toBe(true)
    expect(anterior.issue?.aberta).toBe(true)
  })

  it('mantém fora da execução SPEC em revisão ou sem revisão exata aprovada', () => {
    const emRevisao = mvp('m1', 1, [], { spec: { estado: 'em-revisao' } })
    const semRevisao = mvp('m2', 2, [], {
      spec: { estado: 'aprovada', revisaoAtual: 'b'.repeat(40), revisaoAprovada: 'a'.repeat(40) }
    })
    const inventario = comporInventario([emRevisao, semRevisao])

    expect(elegivelParaExecucao(emRevisao, inventario)).toBe(false)
    expect(elegivelParaExecucao(semRevisao, inventario)).toBe(false)
  })

  it('fingerprint ignora ordem de entrada e de dependências, mas muda com conteúdo material', () => {
    const a = mvp('m1', 1)
    const b = mvp('m2', 2, ['m1'])
    const c = mvp('m3', 3, ['m1', 'm2'])
    const cReordered = { ...c, dependeDe: ['m2', 'm1'] }
    expect(comporInventario([a, b, c]).fingerprint).toBe(
      comporInventario([cReordered, b, a]).fingerprint
    )
    expect(comporInventario([a, b, c]).fingerprint).not.toBe(
      comporInventario([a, { ...b, titulo: 'conteúdo diferente' }, c]).fingerprint
    )

    const remotoOrdenado = {
      ...a,
      issue: { numero: 10, aberta: true, labels: ['proplan:todo', 'spec:aprovada'] },
      pullRequests: [
        {
          numero: 20,
          estado: 'closed' as const,
          merged: true,
          headSha: 'b'.repeat(40),
          mergeSha: 'c'.repeat(40),
          checks: 'unknown' as const
        },
        {
          numero: 19,
          estado: 'open' as const,
          merged: false,
          headSha: 'a'.repeat(40),
          checks: 'pending' as const
        }
      ]
    }
    const remotoReordenado = {
      ...remotoOrdenado,
      issue: { ...remotoOrdenado.issue, labels: [...remotoOrdenado.issue.labels].reverse() },
      pullRequests: [...remotoOrdenado.pullRequests].reverse()
    }
    expect(comporInventario([remotoOrdenado]).fingerprint).toBe(
      comporInventario([remotoReordenado]).fingerprint
    )
  })

  it('a invalidação da revisão reaproveita o manifesto canônico e ignora mudança cosmética', () => {
    const aprovacao: Approval = {
      id: 'approval-1',
      user_id: 'user-1',
      workspace_id: 'jarvis' as Approval['workspace_id'],
      projectId: 'project-1',
      gate: 'SLICE_ENTRY',
      revisoes: [{ artefato: 'docs/spec/spec-01.md', hash: 'hash-antigo' }],
      identidade: 'pi-1',
      autor: 'pi',
      created_at: '2026-01-01T00:00:00.000Z'
    }

    expect(
      gatesInvalidados(
        [aprovacao],
        [{ artefato: 'docs/spec/spec-01.md', hashNovo: 'hash-novo', natureza: 'cosmetica' }]
      )
    ).toEqual([])
    expect(
      gatesInvalidados(
        [aprovacao],
        [{ artefato: 'docs/spec/spec-01.md', hashNovo: 'hash-novo', natureza: 'semantica' }]
      )
    ).toEqual(['SLICE_ENTRY'])
  })

  it('expõe conflito de projeção e item órfão sem escolher estado por silêncio', () => {
    const reconciliado = reconciliarInventario(
      [mvp('m1', 1, [], { estadoTecnico: 'pendente', issue: { numero: 7, aberta: true } })],
      [
        { id: 'm1', estadoTecnico: 'mergeado', issue: { numero: 7, aberta: true } },
        { id: 'm2', estadoTecnico: 'pendente' }
      ],
      { local: 'local-r1', github: 'remote-r1' }
    )

    expect(reconciliado.diagnosticos.map(({ codigo }) => codigo)).toEqual(
      expect.arrayContaining(['conflito-projecao', 'item-orfao'])
    )
    expect(reconciliado.nos[0]?.estadoTecnico).toBe('desconhecido')
    expect(reconciliado.ordem).toEqual([])
    expect(reconciliado.revisoesDasFontes).toEqual({ local: 'local-r1', github: 'remote-r1' })
  })
})
