import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERFIL_PADRAO } from '@shared/domain/squad-perfil'
import { criarSnapshotDoSquad } from './squad-snapshot'
import type { PedidoDeExecucao } from '../pipeline/encadeador-de-runs'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { PipelineRepository } = await import('../pipeline/pipeline-repository')
const { SquadOrquestradorDeExecucao } = await import('./squad-orquestrador-de-execucao')

const ESCOPO = { userId: 'u-1', workspaceId: 'jarvis', projectId: 'p-1' } as const
const AGORA = new Date('2026-10-07T12:00:00.000Z')
const SNAPSHOT = criarSnapshotDoSquad(
  PERFIL_PADRAO,
  { skills: [], ferramentas: [], ollama: { disponivel: false, modelos: [] }, optInApiPaga: false },
  { provider: 'claude-code', modelo: 'claude-fable-5-1' }
)
const APROVADO = 'a'.repeat(40)

function criarRunPronto(): { id: string } {
  const run = runs.criar(ESCOPO, { sliceId: 's-1', estado: 'PLANNED' }, AGORA)
  expect(runs.registrarSnapshotDoSquad(ESCOPO, run.id, SNAPSHOT, AGORA)).toBe(true)
  expect(runs.transicionar(run.id, 'PLANNED', 'AWAITING_PI', AGORA)).toBe(true)
  expect(runs.transicionar(run.id, 'AWAITING_PI', 'READY', AGORA)).toBe(true)
  return run
}

let dir: string
let db: Db
let runs: InstanceType<typeof PipelineRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-play-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  runs = new PipelineRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function criarPedido(runId: string): PedidoDeExecucao {
  return {
    runId,
    projectId: ESCOPO.projectId,
    workspaceId: ESCOPO.workspaceId,
    sliceId: 's-1',
    raizOperacional: '/pipeline',
    repositorio: '/repositorio',
    base: 'main',
    pathsDaSpec: { origem: 'spec', paths: ['src'], justificativa: 'escopo aprovado' },
    specPath: 'docs/spec/f01.md',
    specText: 'SPEC aprovada',
    alvo: { owner: 'org', repo: 'repo', branchBase: 'main' },
    issue: 370,
    titulo: 'F01',
    promptInicial: 'implementar a fatia',
    contextPackId: 'pack-1',
    comandosDeValidacao: { test: [], lint: [], typecheck: [], build: [] },
    perfilDeCi: {} as never
  }
}

function preparar() {
  return {
    snapshot: SNAPSHOT,
    baseSha: 'b'.repeat(40),
    paths: { origem: 'spec' as const, paths: ['src'], justificativa: 'escopo aprovado' },
    plano: {} as never,
    perfilCi: {} as never,
    git: {} as never
  }
}

describe('Play → ciclo do Squad → publicação', () => {
  it('publica somente o SHA devolvido como aprovado e persiste o resumo seguro', async () => {
    const run = criarRunPronto()
    const executar = new SquadOrquestradorDeExecucao({
      runs,
      fila: { transicionar: vi.fn() } as never,
      userId: () => ESCOPO.userId,
      preparar: async () => preparar(),
      ciclo: (_pedido, _preparacao, produzir) => ({
        revisao: {} as never,
        ciclo: {
          executar: async () => {
            const produzido = await produzir({
              runId: run.id,
              tentativa: 1,
              correcoes: []
            })
            expect(produzido.estado).toBe('pronto')
            return {
              estado: 'aprovado',
              commitSha: APROVADO,
              tentativas: 1
            }
          }
        } as never
      }),
      produzir: async () => ({
        producao: { estado: 'pronto', commitSha: APROVADO, manifesto: '' },
        resultado: {
          estado: 'concluido',
          tarefas: [
            {
              tarefaId: 'dev-1',
              papel: 'desenvolvedor',
              estado: 'concluida',
              execucao: { estado: 'concluida', commitSha: APROVADO }
            }
          ]
        } as never
      }),
      prepararSandboxDePublicacao: vi.fn(() => ({ sandbox: { runId: run.id } as never })),
      publicar: vi.fn(
        async (_pedido, _preparacao, sha) =>
          ({
            estadoFinal: 'AWAITING_MERGE',
            headSha: sha
          }) as never
      )
    })

    const resultado = await executar.executar(criarPedido(run.id))
    const persistido = runs.buscar(run.id)

    expect(resultado).toMatchObject({ estadoFinal: 'AWAITING_MERGE', headSha: APROVADO })
    expect(persistido?.squadProgress).toEqual([
      { tarefaId: 'dev-1', papel: 'desenvolvedor', estado: 'concluida', commitSha: APROVADO }
    ])
  })

  it('bloqueia revisão reprovada e não chama a publicação', async () => {
    const run = criarRunPronto()
    const transicionar = vi.fn(() => ({ reason: 'transicionado', mensagem: 'ok' }))
    const publicar = vi.fn()
    const executar = new SquadOrquestradorDeExecucao({
      runs,
      fila: { transicionar } as never,
      userId: () => ESCOPO.userId,
      preparar: async () => preparar(),
      ciclo: () => ({
        revisao: {} as never,
        ciclo: {
          executar: async () => ({
            estado: 'parado',
            motivo: 'tentativas-esgotadas',
            detalhe: 'revisão reprovada',
            tentativas: 3
          })
        } as never
      }),
      produzir: vi.fn(),
      prepararSandboxDePublicacao: vi.fn(),
      publicar
    })

    const resultado = await executar.executar(criarPedido(run.id))

    expect(resultado).toMatchObject({ estado: 'parado', motivo: 'tentativas-esgotadas' })
    expect(publicar).not.toHaveBeenCalled()
    expect(transicionar).toHaveBeenCalledWith(
      'p-1',
      'jarvis',
      run.id,
      'BLOCKED',
      expect.objectContaining({ causa: 'tentativas-esgotadas', tentativas: 0 })
    )
  })

  it('não persiste mensagens brutas de exceções no ledger ou no resultado', async () => {
    const run = criarRunPronto()
    const transicionar = vi.fn(() => ({ reason: 'transicionado', mensagem: 'ok' }))
    const executar = new SquadOrquestradorDeExecucao({
      runs,
      fila: { transicionar } as never,
      userId: () => ESCOPO.userId,
      preparar: async () => {
        throw new Error('secret=ghp_nao_persistir')
      },
      ciclo: vi.fn(),
      produzir: vi.fn(),
      prepararSandboxDePublicacao: vi.fn(),
      publicar: vi.fn()
    })

    const resultado = await executar.executar(criarPedido(run.id))
    const evidencia = JSON.stringify(transicionar.mock.calls)

    expect(resultado).toMatchObject({ estado: 'parado', motivo: 'erro-interno' })
    expect(JSON.stringify(resultado)).not.toContain('secret=')
    expect(evidencia).not.toContain('secret=')
    expect(evidencia).toContain('Falha interna (Error)')
  })
})
