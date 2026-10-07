import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { perfilNodeEmWindows } from '@shared/domain/ci-profile-perfis'
import { chaveDeFatia, chaveDeProjeto } from '@shared/domain/publicacao'
import { lerPerfilDeCiVersionado } from '../projects/ci-profile-revision'
import type { PedidoDeExecucao } from './encadeador-de-runs'

vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => ({ error: vi.fn() }) })
}))

const { QuadroExecucaoService } = await import('./quadro-execucao-service')
const WS = 'jarvis' as const
const projectId = 'p-1'
const mvp = {
  id: 'm-1',
  numero: 28,
  titulo: 'MVP',
  tese: 't',
  estado: 'na-fila',
  dependeDe: [],
  origem: { tipo: 'decisao', decisaoId: 'd', perguntaId: 'p' }
}
const slices = [1, 2, 3].map((numero) => ({
  id: `s-${numero}`,
  mvpId: mvp.id,
  numero,
  titulo: `Fatia ${numero}`,
  specSlug: `docs/spec/spec-${numero}.md`,
  detalhada: true,
  origem: mvp.origem
}))

let raiz: string | undefined
afterEach(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true })
  raiz = undefined
})

describe('play de três fatias do mesmo MVP', () => {
  it('recusa no app sem composição do Squad antes de criar qualquer run', async () => {
    const criarRun = vi.fn()
    const service = new QuadroExecucaoService({
      userId: () => 'u-1',
      projects: { findById: () => ({ workspace_id: WS }) } as never,
      fila: { criarRun } as never
    } as never)

    const resposta = await service.play({ projectId, sliceIds: ['s-1'] }, WS)

    expect(resposta).toEqual([
      {
        sliceId: 's-1',
        estado: 'recusado',
        mensagem: 'O Squad ainda não está ligado ao fluxo de execução do aplicativo.'
      }
    ])
    expect(criarRun).not.toHaveBeenCalled()
  })

  it('cria IDs separados e mantém a dependente bloqueada antes do executor', async () => {
    raiz = mkdtempSync(join(tmpdir(), 'jarvis-quadro-'))
    mkdirSync(join(raiz, 'docs', 'spec'), { recursive: true })
    writeFileSync(join(raiz, 'ci-profile.json'), JSON.stringify(perfilNodeEmWindows('node')))
    for (const slice of slices) {
      writeFileSync(join(raiz, slice.specSlug), '## Paths permitidos\n- `src`\n')
    }
    const perfil = lerPerfilDeCiVersionado(raiz)
    expect(perfil).toBeDefined()
    const revisoes = [
      { artefato: slices[0]!.specSlug, hash: 'a'.repeat(64) },
      { artefato: 'ci-profile.json', hash: perfil!.hash }
    ]
    const executar = vi.fn(async (_pedido: PedidoDeExecucao) => undefined)
    const runs = new Map<string, { id: string; bloqueio?: { evidencia: string } }>()
    const transicionar = vi.fn((_p: string, _w: string, id: string, para: string) => {
      if (id === 'run-s-2' && para === 'READY') {
        runs.get(id)!.bloqueio = { evidencia: 'A Fatia 1 precisa terminar.' }
        return { reason: 'dependencia-aberta', mensagem: 'A Fatia 1 precisa terminar.' }
      }
      return { reason: 'transicionado', mensagem: 'ok' }
    })
    const refs = [
      { alvo: 'repositorio', chaveExterna: chaveDeProjeto(projectId), refId: 'org/repo' },
      { alvo: 'branch', chaveExterna: chaveDeProjeto(projectId), refId: 'main' },
      ...slices.map((slice) => ({
        alvo: 'issue',
        chaveExterna: chaveDeFatia(projectId, 28, slice.numero),
        refId: String(370 + slice.numero)
      }))
    ]
    const service = new QuadroExecucaoService({
      userId: () => 'u-1',
      projects: { findById: () => ({ diretorio: raiz, workspace_id: WS }) } as never,
      roadmap: {
        carregar: () => ({ mvps: [mvp], slices }),
        listarAprovacoes: () => [{ gate: 'SLICE_ENTRY', revisoes }]
      } as never,
      roadmapService: { revisoesDoGate: () => revisoes } as never,
      refs: {
        listar: () => refs,
        buscar: (_e: unknown, alvo: string, chave: string) =>
          refs.find((ref) => ref.alvo === alvo && ref.chaveExterna === chave)
      } as never,
      contexts: { montarDaTarefa: () => ({ pack: { id: 'pack-1' } }) } as never,
      phaseModels: { resolver: () => ({ provider: 'claude-code' }) } as never,
      raizOperacional: () => join(raiz!, 'operacional'),
      runs: { buscar: (id: string) => runs.get(id) } as never,
      fila: {
        criarRun: (_p: string, _w: string, sliceId: string) => {
          const run = { id: `run-${sliceId}` }
          runs.set(run.id, run)
          return run
        },
        transicionar
      } as never,
      runPrs: {} as never,
      connectors: {} as never,
      executar
    })

    const resposta = await service.play(
      { projectId, sliceIds: slices.map((slice) => slice.id) },
      WS
    )

    expect(resposta.map((item) => item.estado)).toEqual(['iniciado', 'bloqueado', 'iniciado'])
    expect(new Set(resposta.map((item) => item.runId)).size).toBe(3)
    expect(executar).toHaveBeenCalledTimes(2)
    expect(executar.mock.calls.map(([pedido]) => pedido.runId)).toEqual(['run-s-1', 'run-s-3'])
    expect(resposta[1]?.mensagem).toContain('Fatia 1')
    expect(transicionar).toHaveBeenCalledWith(
      projectId,
      WS,
      'run-s-2',
      'BLOCKED',
      expect.anything()
    )
  })
})
