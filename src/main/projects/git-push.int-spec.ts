/**
 * O push da publicação (SPEC-Entrega-01, critérios 2, 5 e 6).
 *
 * **Git de verdade contra um repositório bare local**, pelo mesmo terminal controlado da M8-F01.
 * Um dublê de Git provaria a nossa imitação; o que precisa ser provado aqui é o acoplamento real —
 * que o `git` do sistema aceita a URL que montamos, que o push chega, e que a credencial não
 * sobrevive na saída nem no `.git/config`.
 *
 * O bare local substitui o GitHub sem substituir o Git: a mecânica de push é a mesma, e a rede não
 * entra num teste de integração. O que ele **não** cobre é a autenticação HTTPS de verdade — isso é
 * smoke real, contra repositório descartável.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
const { GitRunner } = await import('./git-runner')

const USER = 'u-1'

/**
 * O `git` existe nesta máquina? Sem ele a fatia inteira é `BLOCKED_EXTERNAL` por desenho, e um
 * teste vermelho aqui apontaria para o ambiente, não para o código.
 */
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
let bare: string
let db: Db
let git: InstanceType<typeof GitRunner>

/**
 * Monta o runner com o terminal real. `permitirGit` é o interruptor da 1ª barreira: desligado, o
 * `git` está instalado mas não permitido — o cenário do critério 5, em que o caminho único precisa
 * recusar em vez de contornar.
 */
function montar(permitirGit: boolean): InstanceType<typeof GitRunner> {
  const audit = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(audit, () => USER)
  const diretorios = new AllowlistRepository(db, audit, appDir)
  const comandos = new CommandAllowlistRepository(db, audit, policy)
  comandos.remove(USER, 'jarvis', 'git')
  if (permitirGit) comandos.add(USER, 'jarvis', 'git')

  return new GitRunner(
    new TerminalEngine(
      policy,
      comandos,
      diretorios,
      new ExecutionRepository(db),
      new ApprovalRepository(db),
      audit,
      () => USER
    )
  )
}

/** O que o bare recebeu, lido do disco — evidência, não o que o runner relatou. */
function shaNaOrigem(ref = 'main'): string {
  return execFileSync('git', ['rev-parse', ref], { cwd: bare, encoding: 'utf8' }).trim()
}

function commitLocal(mensagem: string, arquivo: string, cwd = repo): void {
  writeFileSync(join(cwd, arquivo), `${mensagem}\n`)
  execFileSync('git', ['add', '-A'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', mensagem], { cwd, stdio: 'ignore' })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-push-'))
  appDir = join(dir, 'userData')
  repo = join(appDir, 'projeto')
  bare = join(dir, 'origem.git')
  mkdirSync(repo, { recursive: true })

  db = openDatabase(join(dir, 'app.db'))
  git = montar(true)

  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'teste@local'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: repo, stdio: 'ignore' })
  commitLocal('inicial', 'README.md')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

comGit('push da publicação', () => {
  it('publica os commits locais na origem (critério 2)', () => {
    const local = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()

    const r = git.push(bare, 'main', repo, 'jarvis')

    expect(r.ok).toBe(true)
    // A prova é o que chegou no bare, não o que o runner disse ter mandado.
    expect(shaNaOrigem()).toBe(local)
  })

  it('repetir o push do mesmo commit não falha — publicar de novo é seguro (critério 6)', () => {
    git.push(bare, 'main', repo, 'jarvis')
    const primeiro = shaNaOrigem()

    const r = git.push(bare, 'main', repo, 'jarvis')

    expect(r.ok).toBe(true)
    expect(shaNaOrigem()).toBe(primeiro)
  })

  it('divergência preserva os dois lados: o push é recusado em vez de sobrescrever', () => {
    // O cenário da regra da spec. A origem andou por fora; o local não sabe. Sem `--force`, o Git
    // recusa — e é isso que faz "preserva ambos os lados" ser garantia e não intenção.
    git.push(bare, 'main', repo, 'jarvis')

    const outro = join(dir, 'outro')
    execFileSync('git', ['clone', bare, outro], { stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'outro@local'], { cwd: outro, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Outro'], { cwd: outro, stdio: 'ignore' })
    commitLocal('commit alheio', 'OUTRO.md', outro)
    execFileSync('git', ['push'], { cwd: outro, stdio: 'ignore' })
    const naOrigem = shaNaOrigem()

    commitLocal('commit local', 'LOCAL.md')

    const r = git.push(bare, 'main', repo, 'jarvis')

    expect(r.ok).toBe(false)
    // O commit alheio continua lá: nada foi perdido.
    expect(shaNaOrigem()).toBe(naOrigem)
  })

  it('a credencial não fica no .git/config — a URL é argumento, não remote', () => {
    git.push(bare, 'main', repo, 'jarvis')

    const config = execFileSync('git', ['config', '--local', '--list'], {
      cwd: repo,
      encoding: 'utf8'
    })
    // Gravada como remote, a credencial sobreviveria ao run, ao processo e ao backup do diretório.
    // É a razão de o push receber a URL em vez de `git remote add`.
    expect(config).not.toContain('x-access-token')
    expect(config).not.toMatch(/remote\.origin\.url/)
  })

  it('git não permitido bloqueia com ação concreta em vez de contornar (critério 5)', () => {
    git = montar(false)

    const r = git.push(bare, 'main', repo, 'jarvis')

    expect(r.ok).toBe(false)
    expect(r.execucao.reason).toBe('binario-fora-da-allowlist')
    // O bloqueio é retomável: permitir o git e repetir publica, e nada ficou pela metade — a
    // origem continua sem a branch.
    expect(() => shaNaOrigem()).toThrow()
  })

  it('o token não entra na auditoria — o payload é gravado cru no banco', () => {
    // O vazamento que o teste da saída **não** pegava, e que é o pior dos dois: o
    // `AuditRepository` grava o payload sem redigir, encadeado no hash. Um token que entra ali
    // fica, e removê-lo depois quebraria a cadeia. A prova é ler o banco, não o que o runner
    // devolveu — a cópia devolvida podia estar limpa com o banco sujo, e estava.
    git.pushComToken('https://127.0.0.1:1/nada.git', 'segredo-do-teste', 'main', repo, 'jarvis')

    const linhas = db
      .prepare("SELECT payload FROM audit_event WHERE type = 'terminal-command'")
      .all() as { payload: string }[]

    expect(linhas.length).toBeGreaterThan(0)
    for (const linha of linhas) {
      expect(linha.payload).not.toContain('segredo-do-teste')
    }
    // O destino sobrevive à redação: sem ele, a auditoria não diz para onde o push foi.
    expect(linhas.some((l) => l.payload.includes('127.0.0.1'))).toBe(true)
  })

  it('a saída nunca carrega o token, mesmo quando o git ecoa a URL no erro', () => {
    // O git ecoa a URL em `fatal: unable to access '...'`, e é essa saída que vira evidência.
    const r = git.pushComToken(
      'https://127.0.0.1:1/nada.git',
      'segredo-do-teste',
      'main',
      repo,
      'jarvis'
    )

    expect(r.ok).toBe(false)
    const tudo = `${r.saida}\n${r.execucao.stderr}\n${JSON.stringify(r.execucao)}`
    expect(tudo).not.toContain('segredo-do-teste')
  })
})
