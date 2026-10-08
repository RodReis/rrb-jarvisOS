import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { Roadmap } from '@shared/domain/roadmap'
import type { RoadmapRegistrado } from '@shared/domain/roadmap-gerado'
import type { RoadmapService } from '../projects/roadmap-service'
import type { RoadmapGeradoService } from '../projects/roadmap-gerado-service'
import { InventarioLocalFonte } from './inventario-local-source'

const noOrigin = { tipo: 'decisao' as const, decisaoId: 'd1', perguntaId: 'p1' }
const revisoes: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'a'.repeat(64) }]
const hashRevisoes = createHash('sha256').update(JSON.stringify(revisoes)).digest('hex')
const roadmap: Roadmap = {
  mvps: [
    {
      id: 'mvp-1',
      numero: 1,
      titulo: 'Base',
      tese: 'Base',
      estado: 'concluido',
      dependeDe: [],
      origem: noOrigin
    },
    {
      id: 'mvp-2',
      numero: 2,
      titulo: 'Contínuo',
      tese: 'Contínuo',
      estado: 'na-fila',
      dependeDe: ['mvp-1'],
      origem: noOrigin
    }
  ],
  slices: [
    {
      id: 'f-1',
      mvpId: 'mvp-2',
      numero: 1,
      titulo: 'Inventário',
      specSlug: 'spec-f1',
      detalhada: true,
      origem: noOrigin
    },
    {
      id: 'f-2',
      mvpId: 'mvp-2',
      numero: 2,
      titulo: 'Dispatcher',
      specSlug: 'spec-f2',
      detalhada: false,
      origem: noOrigin
    }
  ]
}
const approval: Approval = {
  id: 'approval-1',
  user_id: 'user-1',
  workspace_id: 'jarvis',
  projectId: 'project-1',
  gate: 'SLICE_ENTRY',
  revisoes,
  identidade: 'user-1',
  autor: 'pi',
  created_at: '2026-10-08T12:00:00.000Z'
}
const approvalMvp: Approval = {
  ...approval,
  id: 'approval-mvp-1',
  gate: 'MVP_ENTRY'
}
const gerado: RoadmapRegistrado = {
  id: 'generated-1',
  user_id: 'user-1',
  workspace_id: 'jarvis',
  projectId: 'project-1',
  pacoteEstruturalId: 'package-1',
  arquiteturaId: 'architecture-1',
  mvps: [],
  spec: {
    fatiaId: 'f-1',
    titulo: 'Inventário',
    objetivo: 'Inventariar',
    fluxo: ['Ler fontes'],
    regras: ['Fail closed'],
    criteriosDeAceite: ['Não executar sem gate'],
    testes: ['DAG válido'],
    perguntas: [
      {
        id: 'q1',
        enunciado: 'Confirma?',
        opcoes: [{ id: 'sim', rotulo: 'Sim', impacto: 'Aceita' }],
        recomendada: 'sim',
        justificativa: 'Aprovado',
        resposta: 'sim'
      }
    ]
  },
  mvpEscolhido: 'mvp-2',
  hash: 'b'.repeat(64),
  commitHash: 'c'.repeat(40),
  contextPackId: null,
  created_at: '2026-10-08T11:00:00.000Z'
}

function criarFonte(
  opcoes: {
    readonly aprovacoes?: readonly Approval[]
    readonly revisoesDoGate?: (gate: string) => readonly RevisaoAprovada[]
    readonly spec?: RoadmapRegistrado['spec']
  } = {}
) {
  const servico = {
    carregar: vi.fn(() => roadmap),
    aprovacoes: vi.fn(() => opcoes.aprovacoes ?? [approval]),
    revisoesDoGate: vi.fn(
      (_projectId: string, gate: string) =>
        opcoes.revisoesDoGate?.(gate) ?? (gate === 'SLICE_ENTRY' ? revisoes : [])
    )
  } as unknown as RoadmapService
  const roadmapRegistrado = {
    ...gerado,
    ...(opcoes.spec === undefined ? {} : { spec: opcoes.spec })
  }
  const geradoService = {
    carregar: vi.fn(() => roadmapRegistrado)
  } as unknown as RoadmapGeradoService
  return new InventarioLocalFonte(servico, geradoService)
}

describe('InventarioLocalFonte', () => {
  it('projeta MVPs e fatias com dependências, gate exato e apenas SPEC detalhada executável', async () => {
    const inventario = await criarFonte().lerLocal({
      userId: 'user-1',
      workspaceId: 'jarvis',
      projectId: 'project-1'
    })

    expect(inventario.revisao).toMatch(/^[a-f0-9]{64}$/)
    expect(inventario.nos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'MVP1', tipo: 'mvp', quantidadeDeFatias: 0 }),
        expect.objectContaining({
          id: 'MVP2',
          tipo: 'mvp',
          dependeDe: ['MVP1'],
          quantidadeDeFatias: 2
        }),
        expect.objectContaining({
          id: 'MVP2-F01',
          tipo: 'fatia',
          mvpId: 'MVP2',
          dependeDe: ['MVP1'],
          spec: { estado: 'aprovada', revisaoAtual: hashRevisoes, revisaoAprovada: hashRevisoes },
          gateAprovado: true
        }),
        expect.objectContaining({
          id: 'MVP2-F02',
          tipo: 'fatia',
          dependeDe: ['MVP2-F01'],
          spec: { estado: 'ausente' },
          gateAprovado: false
        })
      ])
    )
  })

  it('revisão material diferente e falta de aprovação atual deixam a fatia inelegível', async () => {
    const inventario = await criarFonte({
      revisoesDoGate: (gate) =>
        gate === 'SLICE_ENTRY' ? [{ artefato: 'spec-f1', hash: 'd'.repeat(64) }] : []
    }).lerLocal({ userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' })

    expect(inventario.nos.find((no) => no.id === 'MVP2-F01')).toMatchObject({
      spec: { estado: 'em-revisao' },
      gateAprovado: false
    })
  })

  it('só o MVP escolhido recebe o gate de entrada vigente', async () => {
    const fonte = criarFonte({
      aprovacoes: [approval, approvalMvp],
      revisoesDoGate: () => revisoes
    })
    const inventario = await fonte.lerLocal({
      userId: 'user-1',
      workspaceId: 'jarvis',
      projectId: 'project-1'
    })

    expect(inventario.nos.find((no) => no.id === 'MVP1')?.gateAprovado).toBe(false)
    expect(inventario.nos.find((no) => no.id === 'MVP2')?.gateAprovado).toBe(true)
  })

  it('perguntas sem resposta e ausência da SPEC não são promovidas a aprovadas', async () => {
    const semResposta = {
      ...gerado.spec!,
      perguntas: [{ ...gerado.spec!.perguntas[0]!, resposta: undefined }]
    }
    const fonte = criarFonte({ spec: semResposta })
    const inventario = await fonte.lerLocal({
      userId: 'user-1',
      workspaceId: 'jarvis',
      projectId: 'project-1'
    })

    expect(inventario.nos.find((no) => no.id === 'MVP2-F01')).toMatchObject({
      spec: { estado: 'em-revisao' },
      gateAprovado: false
    })
    expect(inventario.nos.find((no) => no.id === 'MVP2-F02')).toMatchObject({
      spec: { estado: 'ausente' },
      gateAprovado: false
    })
  })
})
