import { describe, expect, it } from 'vitest'
import type { PipelineRun } from './pipeline'
import type { Mvp, Slice } from './roadmap'
import { colunaDoRun, projetarQuadro } from './quadro-execucao'

const mvp: Mvp = {
  id: 'mvp-1',
  numero: 28,
  titulo: 'Quadro',
  tese: 'Execução governada',
  estado: 'na-fila',
  dependeDe: [],
  origem: { tipo: 'decisao', decisaoId: 'decisao-1', perguntaId: 'escopo' }
}

const slice = (id: string, numero: number): Slice => ({
  id,
  mvpId: mvp.id,
  numero,
  titulo: `Fatia ${numero}`,
  specSlug: `spec-${numero}`,
  detalhada: true,
  origem: { tipo: 'decisao', decisaoId: `decisao-${numero}`, perguntaId: 'escopo' }
})

const run = (estado: PipelineRun['estado'], id = 'run-1'): PipelineRun => ({
  id,
  user_id: 'user-1',
  projectId: 'project-1',
  sliceId: 'slice-1',
  estado,
  created_at: '2026-10-06T12:00:00.000Z',
  updated_at: '2026-10-06T12:01:00.000Z'
})

describe('colunaDoRun', () => {
  it.each([
    ['PLANNED', 'a-fazer'],
    ['AWAITING_PI', 'a-fazer'],
    ['READY', 'a-fazer'],
    ['RUNNING', 'developer'],
    ['VALIDATING', 'teste'],
    ['REVIEWING', 'reviewer'],
    ['PR_CI', 'pr-merge'],
    ['AWAITING_MERGE', 'pr-merge'],
    ['MERGED', 'done'],
    ['BLOCKED', 'a-fazer'],
    ['CANCELLED', 'a-fazer']
  ] as const)('%s vai para %s', (estado, coluna) => {
    expect(colunaDoRun(estado)).toBe(coluna)
  })

  it('não infere progresso quando não há run', () => {
    expect(colunaDoRun(undefined)).toBe('a-fazer')
  })
})

describe('projetarQuadro', () => {
  it('reconstrói cartões do ledger, ordena colunas e conserva a causa da dependência', () => {
    const quadro = projetarQuadro({
      projectId: 'project-1',
      mvps: [mvp],
      slices: [slice('slice-1', 1), slice('slice-2', 2)],
      runs: [run('PR_CI'), run('RUNNING', 'run-old')],
      concluidas: [],
      bloqueadas: [
        {
          sliceId: 'slice-2',
          abertas: [
            { tipo: 'fatia-anterior', id: 'slice-1', mensagem: 'A Fatia 1 precisa terminar.' }
          ]
        }
      ],
      issues: new Map([['slice-1', { numero: 370, url: 'https://github.com/o/r/issues/370' }]]),
      consultas: new Map([
        [
          'run-1',
          {
            estado: 'desconhecido',
            desconhecidoDesde: '2026-10-06T12:00:00.000Z',
            checksPendentes: [],
            checks: []
          }
        ]
      ]),
      agora: '2026-10-06T12:02:00.000Z'
    })

    expect(quadro.geradoEm).toBe('2026-10-06T12:02:00.000Z')
    expect(quadro.colunas.find((coluna) => coluna.id === 'pr-merge')?.cartoes[0]).toMatchObject({
      sliceId: 'slice-1',
      issue: 370,
      consulta: { estado: 'desconhecido' }
    })
    expect(
      quadro.colunas.find((coluna) => coluna.id === 'a-fazer')?.cartoes[0]?.dependenciasAbertas
    ).toHaveLength(1)
  })

  it('esconde fatias de MVP ainda proposto e separa DONE de Finalizado (PI)', () => {
    const quadro = projetarQuadro({
      projectId: 'project-1',
      mvps: [mvp, { ...mvp, id: 'mvp-proposto', estado: 'proposto' }],
      slices: [slice('slice-1', 1), { ...slice('slice-2', 2), mvpId: 'mvp-proposto' }],
      runs: [run('MERGED')],
      concluidas: ['slice-1'],
      bloqueadas: [],
      finalizadas: new Set(['slice-1'])
    })

    expect(quadro.colunas.find((coluna) => coluna.id === 'done')?.cartoes).toHaveLength(0)
    expect(quadro.colunas.find((coluna) => coluna.id === 'finalizado')?.cartoes).toHaveLength(1)
    expect(quadro.colunas.flatMap((coluna) => coluna.cartoes)).toHaveLength(1)
  })
})
