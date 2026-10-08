import { describe, expect, it } from 'vitest'
import type { RepositoryInventoryNormalizado } from '@shared/domain/github-automation'
import {
  comporInventario,
  elegivelParaExecucao,
  reconciliarInventario,
  type NoInventario
} from './inventario-global'
import { projetarEstadoGithub } from './inventario-github-projector'

const local: NoInventario = {
  id: 'M13-F01',
  tipo: 'fatia',
  mvpId: 'MVP-013',
  numero: 1,
  titulo: 'Inventário e DAG global',
  dependeDe: [],
  estadoTecnico: 'mergeado',
  spec: { estado: 'aprovada', revisaoAtual: 'sha-aprovado', revisaoAprovada: 'sha-aprovado' },
  gateAprovado: true,
  bloqueado: false,
  issue: { numero: 134, aberta: true }
}

const pai: NoInventario = {
  id: 'MVP-013',
  tipo: 'mvp',
  numero: 13,
  quantidadeDeFatias: 1,
  titulo: 'Execução contínua',
  dependeDe: [],
  estadoTecnico: 'pendente',
  spec: { estado: 'aprovada', revisaoAtual: 'sha-pai', revisaoAprovada: 'sha-pai' },
  gateAprovado: true,
  bloqueado: false,
  issue: { numero: 133, aberta: true }
}

const inventario = (
  patch: Partial<RepositoryInventoryNormalizado> = {}
): RepositoryInventoryNormalizado => ({
  issues: [
    {
      numero: 133,
      titulo: '[MVP13] Execução contínua do roadmap',
      estado: 'open',
      labels: ['proplan:backlog']
    },
    {
      numero: 134,
      titulo: '[MVP13][F01] Inventário e DAG global',
      estado: 'open',
      labels: ['proplan:done']
    }
  ],
  pullRequests: [
    {
      numero: 500,
      estado: 'closed',
      merged: true,
      headBranch: 'feat/m13-f01',
      headSha: 'a'.repeat(40),
      baseBranch: 'main',
      mergeSha: 'b'.repeat(40),
      issuesReferenciadas: [134],
      checks: 'unknown'
    }
  ],
  branches: [{ nome: 'main', sha: 'c'.repeat(40) }],
  ...patch
})

describe('projeção do inventário GitHub', () => {
  it('merge confirmado satisfaz dependência técnica mesmo com issue aberta', () => {
    const remoto = projetarEstadoGithub([pai, local], inventario())
    const dag = reconciliarInventario([{ ...pai, estadoTecnico: 'mergeado' }, local], remoto, {
      local: 'a'.repeat(64),
      github: 'b'.repeat(64)
    })

    expect(remoto[0]).toMatchObject({ estadoTecnico: 'mergeado', issue: { aberta: true } })
    expect(dag.diagnosticos).toEqual([])
    expect(dag.nos[0]?.issue?.aberta).toBe(true)
  })

  it('PR aberto com check falho fica bloqueado e inelegível', () => {
    const remoto = projetarEstadoGithub(
      [local],
      inventario({
        issues: [
          {
            numero: 134,
            titulo: '[MVP13][F01] Inventário e DAG global',
            estado: 'open',
            labels: ['proplan:doing']
          }
        ],
        pullRequests: [
          {
            numero: 501,
            estado: 'open',
            merged: false,
            headBranch: 'feat/m13-f01',
            headSha: 'a'.repeat(40),
            baseBranch: 'main',
            issuesReferenciadas: [134],
            checks: 'failure'
          }
        ]
      })
    )
    const dag = comporInventario([pai, ...remoto.map((no) => ({ ...local, ...no }))])

    const fatia = dag.nos.find((no) => no.id === 'M13-F01')
    expect(fatia?.estadoTecnico).toBe('bloqueado')
    expect(fatia && elegivelParaExecucao(fatia, dag)).toBe(false)
    expect(dag.diagnosticos).toEqual([])
    expect(dag.ordem).toHaveLength(2)
  })

  it('issue de roadmap fora do índice local aparece como órfã', () => {
    const remoto = projetarEstadoGithub(
      [],
      inventario({
        issues: [
          {
            numero: 199,
            titulo: '[MVP13][SPEC-Continuo-99][F99] Sem índice',
            estado: 'open',
            labels: ['proplan:backlog']
          }
        ],
        pullRequests: []
      })
    )
    const dag = reconciliarInventario([], remoto, { local: 'a'.repeat(64), github: 'b'.repeat(64) })

    expect(dag.diagnosticos).toContainEqual(
      expect.objectContaining({ codigo: 'item-orfao', envolvidos: ['MVP13-F99'] })
    )
  })
})
