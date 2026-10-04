/**
 * A montagem de Git real que os testes de integração dos Squads compartilham: um repositório com a
 * base, o `SquadGit` sobre o `GitRunner` e o `TerminalEngine` de verdade.
 *
 * Só testes importam este arquivo. O chamador **tem de** ter feito `vi.mock('../logging/logger')`
 * antes de o importar, como os demais testes de integração desta pasta.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { ApprovalRepository } from '../execution/approval-repository'
import { ExecutionRepository } from '../execution/execution-repository'
import { TerminalEngine } from '../execution/terminal-engine'
import { AllowlistRepository } from '../policy/allowlist-repository'
import { CommandAllowlistRepository } from '../policy/command-allowlist-repository'
import { PolicyService } from '../policy/policy-service'
import { GitRunner } from '../projects/git-runner'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { SquadGit, type WorktreeDeEscritor } from './squad-git'

export const USUARIO_DE_TESTE = 'u-1'
export const WORKSPACE_DE_TESTE = 'jarvis'

export function temGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export interface AmbienteDeGit {
  readonly dir: string
  readonly appDir: string
  readonly repo: string
  readonly db: Db
  readonly audit: AuditRepository
  readonly runner: GitRunner
  readonly squadGit: SquadGit
  readonly baseSha: string
  /** `git` puro no repositório (ou em `cwd`): o que o teste faz como "fora do kernel". */
  readonly git: (args: string[], cwd?: string) => string
  /** Escreve arquivos (relativos ao `cwd`) criando as pastas. */
  readonly escrever: (cwd: string, arquivos: Readonly<Record<string, string>>) => void
  /** Cria o worktree de um escritor a partir de `base` e devolve o que o `SquadGit` devolveu. */
  readonly worktree: (nome: string, base?: string) => WorktreeDeEscritor
  /** Escreve e commita pelo kernel (`SquadGit.commitar`), devolvendo o SHA. */
  readonly commitarComo: (
    w: WorktreeDeEscritor,
    arquivos: Readonly<Record<string, string>>,
    mensagem?: string
  ) => string
  readonly limpar: () => void
}

/** O repositório-base: `src/a.ts`, `src/b.ts` e um README, numa só `main`. */
export function montarAmbienteDeGit(
  arquivosDaBase: Readonly<Record<string, string>> = {
    'src/a.ts': 'export const a = 1\n',
    'src/b.ts': 'export const b = 2\n',
    'README.md': '# projeto\n'
  }
): AmbienteDeGit {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-integracao-'))
  const appDir = join(dir, 'userData')
  const repo = join(appDir, 'projeto')
  mkdirSync(repo, { recursive: true })

  const git = (args: string[], cwd = repo): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const escrever = (cwd: string, arquivos: Readonly<Record<string, string>>): void => {
    for (const [caminho, texto] of Object.entries(arquivos)) {
      mkdirSync(dirname(join(cwd, caminho)), { recursive: true })
      writeFileSync(join(cwd, caminho), texto)
    }
  }

  const db = openDatabase(join(dir, 'app.db'))
  const audit = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(audit, () => USUARIO_DE_TESTE)
  const diretorios = new AllowlistRepository(db, audit, appDir)
  const comandos = new CommandAllowlistRepository(db, audit, policy)
  comandos.remove(USUARIO_DE_TESTE, WORKSPACE_DE_TESTE, 'git')
  comandos.add(USUARIO_DE_TESTE, WORKSPACE_DE_TESTE, 'git')
  const runner = new GitRunner(
    new TerminalEngine(
      policy,
      comandos,
      diretorios,
      new ExecutionRepository(db),
      new ApprovalRepository(db),
      audit,
      () => USUARIO_DE_TESTE
    )
  )
  const squadGit = new SquadGit({ git: runner, workspaceId: () => WORKSPACE_DE_TESTE })

  git(['init', '--initial-branch=main'])
  git(['config', 'user.email', 'teste@local'])
  git(['config', 'user.name', 'Teste'])
  git(['config', 'core.autocrlf', 'false'])
  escrever(repo, arquivosDaBase)
  git(['add', '-A'])
  git(['commit', '-m', 'base'])
  const baseSha = git(['rev-parse', 'HEAD'])

  const worktree = (nome: string, base: string = baseSha): WorktreeDeEscritor => {
    const r = squadGit.criarWorktree({
      repositorio: repo,
      worktree: join(appDir, `wt-${nome}`),
      branch: `feat/${nome}`,
      baseSha: base
    })
    if (!r.ok) throw new Error(`worktree de teste não nasceu: ${r.motivo}`)
    return r.valor
  }

  const commitarComo = (
    w: WorktreeDeEscritor,
    arquivos: Readonly<Record<string, string>>,
    mensagem = 'trabalho do escritor'
  ): string => {
    escrever(w.worktree, arquivos)
    const c = squadGit.commitar(w, mensagem, Object.keys(arquivos))
    if (!c.ok) throw new Error(`commit de teste falhou: ${c.motivo}`)
    return c.valor
  }

  return {
    dir,
    appDir,
    repo,
    db,
    audit,
    runner,
    squadGit,
    baseSha,
    git,
    escrever,
    worktree,
    commitarComo,
    limpar: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
