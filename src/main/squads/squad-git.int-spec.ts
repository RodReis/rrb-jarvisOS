/**
 * O Git do kernel sobre os worktrees dos escritores (SPEC-Squads-03, critérios 1 e 2).
 *
 * **Git de verdade, pelo `TerminalEngine` de verdade.** Um dublê provaria a nossa imitação; o que
 * precisa ser provado é o acoplamento real: que o worktree nasce isolado, que o diff por worktree
 * enxerga o que cada escritor fez, que o `.git` que o agente controla não manda no kernel, e que
 * a remoção sem `--force` passa pelo gate — enquanto o `--force` não passa.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { AllowlistRepository } = await import('../policy/allowlist-repository')
const { CommandAllowlistRepository } = await import('../policy/command-allowlist-repository')
const { ExecutionRepository } = await import('../execution/execution-repository')
const { ApprovalRepository } = await import('../execution/approval-repository')
const { TerminalEngine } = await import('../execution/terminal-engine')
const { GitRunner } = await import('../projects/git-runner')
const { SquadGit, IDENTIDADE_DO_KERNEL } = await import('./squad-git')

const USER = 'u-1'

function temGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const comGit = temGit() ? describe : describe.skip

let dir: string
let appDir: string
let repo: string
let db: Db
let runner: InstanceType<typeof GitRunner>
let squadGit: InstanceType<typeof SquadGit>
let baseSha: string
let auditoria: InstanceType<typeof AuditRepository>

const git = (args: string[], cwd = repo): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const paraGit = (caminho: string): string => caminho.replace(/\\/g, '/')

function montar(): void {
  auditoria = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(auditoria, () => USER)
  const diretorios = new AllowlistRepository(db, auditoria, appDir)
  const comandos = new CommandAllowlistRepository(db, auditoria, policy)
  comandos.remove(USER, 'jarvis', 'git')
  comandos.add(USER, 'jarvis', 'git')
  runner = new GitRunner(
    new TerminalEngine(
      policy,
      comandos,
      diretorios,
      new ExecutionRepository(db),
      new ApprovalRepository(db),
      auditoria,
      () => USER
    )
  )
  squadGit = new SquadGit({ git: runner, workspaceId: () => 'jarvis' })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-git-'))
  appDir = join(dir, 'userData')
  repo = join(appDir, 'projeto')
  mkdirSync(join(repo, 'src'), { recursive: true })
  db = openDatabase(join(dir, 'app.db'))
  montar()

  git(['init', '--initial-branch=main'])
  git(['config', 'user.email', 'teste@local'])
  git(['config', 'user.name', 'Teste'])
  git(['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, '.gitignore'), 'dist/\n')
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(repo, 'README.md'), '# projeto\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])
  baseSha = git(['rev-parse', 'HEAD'])
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function criar(nome: string, branch = `feat/${nome}`) {
  const r = squadGit.criarWorktree({
    repositorio: repo,
    worktree: join(appDir, `wt-${nome}`),
    branch,
    baseSha
  })
  if (!r.ok) throw new Error(`worktree de teste não nasceu: ${r.motivo}`)
  return r.valor
}

comGit('criar o worktree', () => {
  it('nasce da base, numa branch própria e com o gitdir do host', () => {
    const w = criar('a')

    expect(existsSync(join(w.worktree, 'src', 'a.ts'))).toBe(true)
    expect(git(['rev-parse', 'HEAD'], w.worktree)).toBe(baseSha)
    expect(git(['branch', '--show-current'], w.worktree)).toBe('feat/a')
    expect(w.gitDir.replace(/\\/g, '/')).toContain('/.git/worktrees/')
    expect(w.baseSha).toBe(baseSha)
  })

  it('o checkout sai com LF mesmo quando a máquina converte para CRLF', () => {
    // Premissa: com `autocrlf=true` o Git puro grava CRLF — é o que quebraria o gate de escopo.
    git(['config', 'core.autocrlf', 'true'])
    try {
      const puro = join(appDir, 'wt-puro')
      git(['worktree', 'add', '-b', 'feat/puro', puro, baseSha])
      expect(readFileSync(join(puro, 'src', 'a.ts'), 'utf8')).toContain('\r\n')

      const w = criar('a')

      expect(readFileSync(join(w.worktree, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1\n')
      expect(squadGit.alteracoes(w)).toEqual({
        ok: true,
        valor: { caminhos: [], simbolicos: [] }
      })
    } finally {
      git(['config', 'core.autocrlf', 'false'])
    }
  })

  it('recusa entrada malformada antes de rodar qualquer Git', () => {
    const antes = db.prepare('SELECT COUNT(*) AS n FROM execution_run').get() as { n: number }
    const base = { repositorio: repo, worktree: join(appDir, 'wt-x'), branch: 'feat/x', baseSha }

    for (const ruim of [
      { ...base, baseSha: 'HEAD' },
      { ...base, baseSha: baseSha.slice(0, 39) },
      { ...base, branch: '-D' },
      { ...base, branch: 'feat/..x' },
      { ...base, branch: 'feat/x/' },
      { ...base, branch: 'a b' },
      { ...base, worktree: 'relativo/wt' },
      { ...base, repositorio: 'relativo' }
    ]) {
      expect(squadGit.criarWorktree(ruim).ok).toBe(false)
    }

    const depois = db.prepare('SELECT COUNT(*) AS n FROM execution_run').get() as { n: number }
    expect(depois.n).toBe(antes.n)
  })

  it('uma branch que já existe é recusa, não reuso silencioso', () => {
    criar('a', 'feat/mesma')
    const segundo = squadGit.criarWorktree({
      repositorio: repo,
      worktree: join(appDir, 'wt-b'),
      branch: 'feat/mesma',
      baseSha
    })

    expect(segundo.ok).toBe(false)
  })

  it('sem o git na allowlist, a criação falha com a explicação — não contorna o terminal', () => {
    const comandos = new CommandAllowlistRepository(
      db,
      auditoria,
      new PolicyService(auditoria, () => USER)
    )
    comandos.remove(USER, 'jarvis', 'git')

    const r = squadGit.criarWorktree({
      repositorio: repo,
      worktree: join(appDir, 'wt-z'),
      branch: 'feat/z',
      baseSha
    })

    expect(r.ok).toBe(false)
    expect(existsSync(join(appDir, 'wt-z'))).toBe(false)
  })
})

comGit('diff por worktree — a prova de escopo (critério 2)', () => {
  it('cada escritor só vê o que fez no seu worktree', () => {
    const a = criar('a')
    const b = criar('b')

    writeFileSync(join(a.worktree, 'src', 'a.ts'), 'export const a = 100\n')
    writeFileSync(join(b.worktree, 'src', 'novo.ts'), 'export const n = 1\n')

    const deA = squadGit.alteracoes(a)
    const deB = squadGit.alteracoes(b)

    expect(deA).toEqual({ ok: true, valor: { caminhos: ['src/a.ts'], simbolicos: [] } })
    expect(deB).toEqual({ ok: true, valor: { caminhos: ['src/novo.ts'], simbolicos: [] } })
    expect(existsSync(join(a.worktree, 'src', 'novo.ts'))).toBe(false)
    expect(existsSync(join(repo, 'src', 'novo.ts'))).toBe(false)
  })

  it('lista o modificado, o criado e o removido; ignora o que o .gitignore cobre', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    writeFileSync(join(w.worktree, 'src', 'novo.ts'), 'novo\n')
    rmSync(join(w.worktree, 'src', 'b.ts'))
    mkdirSync(join(w.worktree, 'dist'))
    writeFileSync(join(w.worktree, 'dist', 'saida.js'), 'x\n')

    const r = squadGit.alteracoes(w)

    expect(r).toEqual({
      ok: true,
      valor: { caminhos: ['src/a.ts', 'src/b.ts', 'src/novo.ts'], simbolicos: [] }
    })
  })

  it('espaço, acento e maiúscula chegam inteiros, sem aspas', () => {
    const w = criar('a')
    mkdirSync(join(w.worktree, 'docs'))
    writeFileSync(join(w.worktree, 'docs', 'Relatório final.md'), 'x\n')
    writeFileSync(join(w.worktree, ' espaco-na-frente.txt'), 'x\n')

    const r = squadGit.alteracoes(w)

    expect(r).toMatchObject({ ok: true })
    if (r.ok) {
      expect(r.valor.caminhos).toEqual([' espaco-na-frente.txt', 'docs/Relatório final.md'])
    }
  })

  it('o diff é sempre contra a base: o que já foi commitado continua na lista', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    expect(squadGit.commitar(w, 'tarefa t1', ['src/a.ts']).ok).toBe(true)

    const r = squadGit.alteracoes(w)

    expect(r).toEqual({ ok: true, valor: { caminhos: ['src/a.ts'], simbolicos: [] } })
  })

  it('sem mudança, a lista é vazia', () => {
    const w = criar('a')

    expect(squadGit.alteracoes(w)).toEqual({ ok: true, valor: { caminhos: [], simbolicos: [] } })
  })

  it('aponta o link simbólico, que pode apontar para fora do worktree', () => {
    const w = criar('a')
    try {
      symlinkSync(join(dir, 'fora'), join(w.worktree, 'src', 'atalho'))
    } catch {
      // Sem privilégio de symlink (Windows sem modo desenvolvedor): nada a provar aqui.
      return
    }

    const r = squadGit.alteracoes(w)

    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.valor.simbolicos).toEqual(['src/atalho'])
  })

  it('a listagem não vai para a auditoria: o nome do arquivo é conteúdo do projeto', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'nome-sensivel-xyz.ts'), 'x\n')

    squadGit.alteracoes(w)

    const linhas = db
      .prepare("SELECT payload FROM audit_event WHERE type = 'terminal-command'")
      .all() as { payload: string }[]
    expect(linhas.length).toBeGreaterThan(0)
    expect(linhas.some((l) => l.payload.includes('nome-sensivel-xyz'))).toBe(false)
  })
})

comGit('commitar — só o kernel versiona (critério 1)', () => {
  it('commita exatamente os caminhos dados, com a identidade do kernel', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    writeFileSync(join(w.worktree, 'src', 'sobra.ts'), 'sobra\n')

    const r = squadGit.commitar(w, 'tarefa t1', ['src/a.ts'])

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toBe(git(['rev-parse', 'HEAD'], w.worktree))
    expect(r.valor).not.toBe(baseSha)
    expect(git(['show', '--name-only', '--format=%an|%ae|%s', 'HEAD'], w.worktree)).toBe(
      `${IDENTIDADE_DO_KERNEL.nome}|${IDENTIDADE_DO_KERNEL.email}|tarefa t1\n\nsrc/a.ts`
    )
    // O que ficou fora da lista continua sem commit: o kernel não commita o que não provou.
    expect(squadGit.alteracoes(w)).toMatchObject({
      ok: true,
      valor: { caminhos: ['src/a.ts', 'src/sobra.ts'] }
    })
    expect(git(['status', '--porcelain'], w.worktree)).toBe('?? src/sobra.ts')
  })

  it('registra a remoção de um arquivo', () => {
    const w = criar('a')
    rmSync(join(w.worktree, 'src', 'b.ts'))

    expect(squadGit.commitar(w, 'remove b', ['src/b.ts']).ok).toBe(true)
    expect(git(['ls-tree', '-r', '--name-only', 'HEAD'], w.worktree)).not.toContain('src/b.ts')
  })

  it('não executa hook do repositório, nem o de commit nem o de pós-commit', () => {
    const marca = join(dir, 'hook-rodou.txt')
    for (const hook of ['pre-commit', 'commit-msg', 'post-commit']) {
      writeFileSync(
        join(repo, '.git', 'hooks', hook),
        `#!/bin/sh\necho ${hook} >> "${paraGit(marca)}"\n`,
        { mode: 0o755 }
      )
    }
    // Premissa: com o Git puro o hook roda — senão a prova abaixo seria vazia.
    writeFileSync(join(repo, 'premissa.txt'), 'x\n')
    git(['add', 'premissa.txt'])
    git(['commit', '-m', 'premissa'])
    expect(existsSync(marca)).toBe(true)
    rmSync(marca)

    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    expect(squadGit.commitar(w, 'tarefa t1', ['src/a.ts']).ok).toBe(true)

    expect(existsSync(marca)).toBe(false)
  })

  it('sem nada a commitar é recusa explícita', () => {
    const w = criar('a')

    expect(squadGit.commitar(w, 'vazio', ['src/a.ts'])).toEqual({
      ok: false,
      motivo: 'sem-alteracoes'
    })
  })

  it('recusa mensagem, lista e caminhos inválidos antes de tocar o índice', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')

    for (const [mensagem, caminhos] of [
      ['', ['src/a.ts']],
      ['  ', ['src/a.ts']],
      ['a\nb', ['src/a.ts']],
      ['x'.repeat(201), ['src/a.ts']],
      ['ok', []],
      ['ok', ['../fora.ts']],
      ['ok', ['src/../../fora.ts']],
      ['ok', ['/abs.ts']],
      ['ok', ['-f']],
      ['ok', ['']]
    ] as const) {
      expect(squadGit.commitar(w, mensagem, caminhos).ok).toBe(false)
    }
    expect(git(['status', '--porcelain'], w.worktree)).toBe('M src/a.ts')
  })

  it('o caminho inválido é recusado pelo kernel, sem chegar a rodar Git', () => {
    const w = criar('a')
    const contar = (): number =>
      (db.prepare('SELECT COUNT(*) AS n FROM execution_run').get() as { n: number }).n
    const antes = contar()

    for (const caminho of ['../fora.ts', '/abs.ts', '-f', 'src/../../x.ts', '']) {
      expect(squadGit.commitar(w, 'ok', [caminho]).ok).toBe(false)
    }

    expect(contar()).toBe(antes)
  })

  it('o caminho é literal: um nome com magia de pathspec não casa outros arquivos', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    writeFileSync(join(w.worktree, 'src', 'b.ts'), 'mudou\n')

    const r = squadGit.commitar(w, 'glob', ['src/*.ts'])

    // O Git recusa o pathspec que não casa nenhum arquivo literal, e nada entra no índice.
    expect(r.ok).toBe(false)
    expect(git(['diff', '--cached', '--name-only'], w.worktree)).toBe('')
    expect(git(['rev-parse', 'HEAD'], w.worktree)).toBe(baseSha)
  })
})

comGit('o .git do worktree é território do agente — o kernel não o segue', () => {
  /**
   * Um gitdir hostil dentro do worktree: um hook de pré-commit e um `fsmonitor`, ambos apontando
   * para um comando que deixa uma marca. É o que um agente com escrita no worktree conseguiria
   * montar sem nenhum acesso ao Git.
   */
  function adulterar(w: { worktree: string }, marca: string): void {
    const falso = join(w.worktree, '.falso')
    execFileSync('git', ['init', '--bare', '--initial-branch=main', falso], { stdio: 'ignore' })
    writeFileSync(
      join(falso, 'config'),
      `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = echo fsmonitor >> "${paraGit(marca)}"\n[user]\n\tname = Atacante\n\temail = a@x\n`
    )
    mkdirSync(join(falso, 'hooks'), { recursive: true })
    writeFileSync(
      join(falso, 'hooks', 'pre-commit'),
      `#!/bin/sh\necho pre-commit >> "${paraGit(marca)}"\n`,
      { mode: 0o755 }
    )
    // Apaga e recria: no Windows o `.git` do worktree é oculto e recusa regravação direta.
    rmSync(join(w.worktree, '.git'), { force: true })
    writeFileSync(join(w.worktree, '.git'), `gitdir: ${paraGit(falso)}\n`)
  }

  it('um .git reescrito não faz o kernel rodar o que o gitdir falso manda', () => {
    const marca = join(dir, 'atacou.txt')
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    adulterar(w, marca)

    // Premissa: o Git puro, descobrindo o repositório pelo `.git` do worktree, executa o hook do
    // gitdir falso. Sem isto a prova abaixo seria vazia — passaria mesmo sem a defesa.
    try {
      git(['add', 'src/a.ts'], w.worktree)
      git(['commit', '-m', 'pelo git puro'], w.worktree)
    } catch {
      // O commit pode falhar por outro motivo; o que importa é se o hook chegou a rodar.
    }
    expect(existsSync(marca)).toBe(true)
    rmSync(marca)
    // O commit do Git puro foi para o repositório do atacante: o branch do escritor não se moveu.
    expect(git(['rev-parse', 'feat/a'])).toBe(baseSha)

    const r = squadGit.alteracoes(w)
    expect(r).toMatchObject({ ok: true })
    // O que o agente criou fora do escopo (o gitdir falso) aparece na prova, não some.
    if (r.ok) expect(r.valor.caminhos.some((c) => c.startsWith('.falso/'))).toBe(true)
    expect(squadGit.commitar(w, 'tarefa t1', ['src/a.ts']).ok).toBe(true)
    expect(existsSync(marca)).toBe(false)
    // E o commit foi para a branch certa, no repositório certo.
    expect(git(['log', '-1', '--format=%s', 'feat/a'])).toBe('tarefa t1')
  })
})

comGit('remover — sem --force', () => {
  it('remove o worktree limpo, e ele some do repositório', () => {
    const w = criar('a')

    expect(squadGit.remover(w)).toEqual({ ok: true, valor: undefined })
    expect(existsSync(w.worktree)).toBe(false)
    expect(git(['worktree', 'list', '--porcelain'])).not.toContain('wt-a')
  })

  it('o que foi commitado não impede a remoção, e a branch continua com o trabalho', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'a.ts'), 'mudou\n')
    expect(squadGit.commitar(w, 'tarefa t1', ['src/a.ts']).ok).toBe(true)

    expect(squadGit.remover(w).ok).toBe(true)
    expect(git(['log', '-1', '--format=%s', 'feat/a'])).toBe('tarefa t1')
  })

  it('recusa o worktree com arquivo não commitado: a limpeza não destrói o que não registrou', () => {
    const w = criar('a')
    writeFileSync(join(w.worktree, 'src', 'novo.ts'), 'x\n')

    expect(squadGit.remover(w)).toEqual({ ok: false, motivo: 'worktree-sujo' })
    expect(existsSync(join(w.worktree, 'src', 'novo.ts'))).toBe(true)
  })

  it('o arquivo ignorado não segura a remoção', () => {
    const w = criar('a')
    mkdirSync(join(w.worktree, 'dist'))
    writeFileSync(join(w.worktree, 'dist', 'saida.js'), 'x\n')

    expect(squadGit.remover(w).ok).toBe(true)
  })

  it('o --force cai no gate destrutivo do terminal — é por isso que o kernel não o usa', () => {
    const w = criar('a')

    const r = runner.run(['worktree', 'remove', '--force', w.worktree], repo, 'jarvis')

    expect(r.ok).toBe(false)
    expect(r.execucao.state).not.toBe('concluido')
    expect(existsSync(w.worktree)).toBe(true)
  })
})

describe('o gitdir lido na criação tem de estar sob o .git do repositório', () => {
  it('recusa o gitdir que aponta para outro lugar, mesmo que o Git o devolva', () => {
    const saidas = ['', join(dir, 'outro-lugar', '.git')]
    const git = {
      run: () => {
        const saida = saidas.shift() ?? ''
        return {
          ok: true,
          saida,
          execucao: { state: 'concluido', stdout: saida, stderr: '' } as never
        }
      }
    }
    const isolado = new SquadGit({ git, workspaceId: () => 'jarvis' })

    const r = isolado.criarWorktree({
      repositorio: repo,
      worktree: join(appDir, 'wt-desvio'),
      branch: 'feat/desvio',
      baseSha
    })

    expect(r).toEqual({
      ok: false,
      motivo: 'o gitdir do worktree não está sob o .git do repositório'
    })
  })
})

describe('contrato do módulo', () => {
  it('lê a identidade do commit do kernel, que não é a de uma pessoa', () => {
    expect(IDENTIDADE_DO_KERNEL.nome).toBe('JARVIS OS')
    expect(IDENTIDADE_DO_KERNEL.email).toBe('kernel@jarvisos.local')
  })
})
