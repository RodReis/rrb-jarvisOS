/**
 * A limpeza contra leases reais no SQLite (SPEC-Entrega-06, critérios 5 e 8).
 *
 * Banco real e dublês só na fronteira externa (Docker e Git): o que se prova aqui é a **decisão**
 * — quem pode ser removido, o que vira pendência, o que cada fase de cancelamento preserva. Um
 * repositório de leases dublado concordaria com qualquer verificação de posse, inclusive uma que
 * removesse o worktree de outro run vivo, que é exatamente o defeito que estes testes existem
 * para pegar.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { FaseDeCancelamento } from '@shared/domain/limpeza'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import { recursoDaPorta, recursoDoContainer, recursoDoWorktree } from '@shared/domain/preflight'
import type { SandboxPreparado } from '@shared/domain/preflight'
import { openDatabase } from '../storage/database'
import { ExecutionLedgerRepository } from './execution-ledger-repository'
import { LeaseRepository } from './lease-repository'
import { LimpezaService } from './limpeza-service'

const USER = 'user-1'
const RUN = 'run-1'
const CONTAINER = 'jarvisos-run-1'

let dir: string
let db: Db
let leases: LeaseRepository
let ledger: ExecutionLedgerRepository
let worktree: string
let agora: number

function sandbox(): SandboxPreparado {
  return {
    runId: RUN,
    containerNome: CONTAINER,
    cwd: '/work',
    baseSha: 'a'.repeat(40),
    branch: 'feat/x',
    worktreeNoHost: worktree,
    pathsPermitidos: {
      origem: 'spec',
      paths: ['src/**'],
      justificativa: 'Escopo declarado na SPEC da fatia.'
    },
    proxyUrl: 'http://sidecar:8080'
  }
}

type PararFalso = Mock<(nome: string, cwd: string) => boolean>
type MatarFalso = Mock<(container: string, cwd: string) => void>
type GitFalso = Mock<(args: readonly string[], cwd: string, ws: WorkspaceId) => { ok: boolean }>

function montar(over: { parar?: PararFalso; matarProcesso?: MatarFalso; git?: GitFalso }): {
  servico: LimpezaService
  parar: PararFalso
  matarProcesso: MatarFalso
  git: GitFalso
} {
  const parar: PararFalso = over.parar ?? vi.fn(() => true)
  const matarProcesso: MatarFalso = over.matarProcesso ?? vi.fn()
  const git: GitFalso = over.git ?? vi.fn(() => ({ ok: true }))

  const servico = new LimpezaService({
    docker: { parar, matarProcesso },
    git: { run: git },
    leases,
    ledger,
    workspaceId: () => 'jarvis',
    agora: () => agora
  })

  return { servico, parar, matarProcesso, git }
}

function pedido(
  fase: FaseDeCancelamento,
  estadoFinal: EstadoDoRun
): Parameters<LimpezaService['limpar']>[0] {
  return {
    runId: RUN,
    userId: USER,
    projectId: 'proj-1',
    repositorio: dir,
    sandbox: sandbox(),
    fase,
    estadoFinal
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-limpeza-'))
  worktree = join(dir, 'wt')
  mkdirSync(worktree, { recursive: true })
  db = openDatabase(join(dir, 'jarvis.db'))
  leases = new LeaseRepository(db)
  ledger = new ExecutionLedgerRepository(db)
  agora = Date.parse('2026-09-02T00:00:00.000Z')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('LimpezaService', () => {
  it('remove worktree e container quando os leases são do run', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoWorktree(RUN) }, agora)
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoContainer(RUN) }, agora)

    const { servico, parar, git } = montar({})
    const resultado = servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(resultado.removidos).toContain('worktree')
    expect(resultado.removidos).toContain('container')
    expect(resultado.pendencias).toEqual([])
    expect(parar).toHaveBeenCalledWith(CONTAINER, dir)
    expect(git).toHaveBeenCalledWith(
      ['worktree', 'remove', '--force', worktree],
      dir,
      'jarvis'
    )
  })

  it('libera os leases dos recursos que removeu', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoWorktree(RUN) }, agora)
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoContainer(RUN) }, agora)

    const { servico } = montar({})
    servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(leases.buscar(USER, recursoDoWorktree(RUN))).toBeUndefined()
    expect(leases.buscar(USER, recursoDoContainer(RUN))).toBeUndefined()
  })

  it('libera também os leases de porta do run — sidecar e egress saem com o container', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDaPorta(18080) }, agora)

    const { servico } = montar({})
    const resultado = servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(resultado.removidos).toContain('porta')
    expect(leases.buscar(USER, recursoDaPorta(18080))).toBeUndefined()
  })

  it('não remove worktree cujo lease é de outro run — remover apagaria trabalho vivo', () => {
    leases.adquirir(
      USER,
      { proprietario: 'run-OUTRO', recurso: recursoDoWorktree(RUN) },
      agora
    )

    const { servico, git } = montar({})
    const resultado = servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(git).not.toHaveBeenCalled()
    expect(resultado.removidos).not.toContain('worktree')
    expect(resultado.pendencias.map((p) => p.recurso)).toContain('worktree')
    expect(leases.buscar(USER, recursoDoWorktree(RUN))).toBeDefined()
  })

  it('falha de remoção do container vira pendência reconciliável, não exceção', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoContainer(RUN) }, agora)

    const { servico } = montar({ parar: vi.fn(() => false) })
    const resultado = servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(resultado.removidos).not.toContain('container')
    expect(resultado.pendencias.map((p) => p.recurso)).toContain('container')
    expect(ledger.listarPendencias(USER)).toHaveLength(1)
  })

  it('lease de container preservado quando a remoção falha — a reconciliação ainda o encontra', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoContainer(RUN) }, agora)

    const { servico } = montar({ parar: vi.fn(() => false) })
    servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(leases.buscar(USER, recursoDoContainer(RUN))).toBeDefined()
  })

  it('cancelar durante a execução mata processos e preserva o worktree', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoWorktree(RUN) }, agora)

    const { servico, matarProcesso, git } = montar({})
    const resultado = servico.limpar(pedido('durante-execucao', 'CANCELLED'))

    expect(matarProcesso).toHaveBeenCalledWith(CONTAINER, dir)
    expect(git).not.toHaveBeenCalled()
    expect(resultado.removidos).toEqual([])
    expect(leases.buscar(USER, recursoDoWorktree(RUN))).toBeDefined()
  })

  it('cancelar depois do push preserva o worktree, e nada aqui apaga branch ou PR', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoWorktree(RUN) }, agora)

    const { servico, git } = montar({})
    servico.limpar(pedido('depois-do-push', 'CANCELLED'))

    // Nenhuma chamada ao Git: nem remoção de worktree, nem `push --delete`, nem `revert`.
    expect(git).not.toHaveBeenCalled()
  })

  it('cancelar depois do merge não desfaz nada e ainda assim libera os recursos', () => {
    leases.adquirir(USER, { proprietario: RUN, recurso: recursoDoWorktree(RUN) }, agora)

    const { servico, git, matarProcesso } = montar({})
    const resultado = servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(matarProcesso).not.toHaveBeenCalled()
    expect(resultado.removidos).toContain('worktree')
    const argumentos = git.mock.calls.map((chamada) => (chamada[0] as readonly string[]).join(' '))
    expect(argumentos.some((cmd) => cmd.includes('revert'))).toBe(false)
    expect(argumentos.some((cmd) => cmd.includes('--delete'))).toBe(false)
  })

  it('sem lease algum não há o que remover nem o que reclamar', () => {
    const { servico } = montar({})
    const resultado = servico.limpar(pedido('depois-do-merge', 'MERGED'))

    expect(resultado.removidos).toEqual([])
    expect(resultado.pendencias).toEqual([])
  })
})
