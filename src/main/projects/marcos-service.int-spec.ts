/**
 * O painel de marcos e o gate da Construção, contra **Git de verdade** (SPEC-Fases-04).
 *
 * Por que Git real e não dublê: a decisão desta fatia — *"o blob commitado é a revisão aceita?"* —
 * depende de coisas que só um Git de verdade tem. Um dublê que devolve a string que eu escrevi
 * provaria que eu sei escrever a string; ele não pega o `trim()` que muda o hash de um arquivo
 * terminado em linha em branco, nem o formato real do `status --porcelain`, nem o que
 * `git show <sha>:<caminho>` faz quando o arquivo não existe naquele commit.
 *
 * O que estes testes cobrem, nesta ordem:
 *
 *  - **commitado**: o blob no commit recalcula para o mesmo SHA-256 da revisão aceita;
 *  - **blob divergente**: o arquivo mudou e foi commitado *depois* — o caso que "existe commit"
 *    mascararia (critério 1);
 *  - **revisão sem commit**: aceito, nunca commitado;
 *  - **worktree sujo** e **HEAD interrompido**: as outras duas condições do critério 4;
 *  - **a leitura aparece na auditoria** (critério 6).
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
const { GitRunner, GIT_FORA_DA_ALLOWLIST } = await import('./git-runner')
const { ProjectRepository } = await import('./project-repository')
const { MarcosService } = await import('./marcos-service')

const USER = 'u-1'
const WS = 'jarvis' as const
const PROJETO = 'p-1'
const PRD = 'docs/PRD.md'

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
let audit: InstanceType<typeof AuditRepository>
let service: InstanceType<typeof MarcosService>
let projects: InstanceType<typeof ProjectRepository>
/** Os documentos que o "PI aceitou", como os repositórios os devolveriam. */
let documentos: { caminho: string; hash: string }[]

/** O hash como a gravação o calcula: SHA-256 do texto, utf8 (`PacoteService`, `PrdService`). */
function hashDaRevisao(conteudo: string): string {
  return createHash('sha256').update(conteudo, 'utf8').digest('hex')
}

/** Grava um projeto apontando para `diretorio`. Slug próprio: `save` é insert, não upsert. */
function projetoNoDiretorio(diretorio: string, id = PROJETO, slug = 'projeto-alfa'): void {
  projects.save({
    id,
    user_id: USER,
    workspace_id: WS,
    nome: slug,
    slug,
    diretorio,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })
}

/** Escreve, commita e devolve o hash do conteúdo escrito. */
function commitar(caminho: string, conteudo: string, mensagem = 'docs'): string {
  const alvo = join(repo, caminho)
  mkdirSync(join(alvo, '..'), { recursive: true })
  writeFileSync(alvo, conteudo, 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', mensagem], { cwd: repo, stdio: 'ignore' })
  return hashDaRevisao(conteudo)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-marcos-'))
  appDir = join(dir, 'userData')
  repo = join(appDir, 'projeto')
  mkdirSync(repo, { recursive: true })

  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(audit, () => USER)
  const diretorios = new AllowlistRepository(db, audit, appDir)
  const comandos = new CommandAllowlistRepository(db, audit, policy)
  comandos.add(USER, WS, 'git')

  const git = new GitRunner(
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

  projects = new ProjectRepository(db)
  projetoNoDiretorio(repo)

  documentos = []
  service = new MarcosService({
    git,
    projects,
    // Os dois repositórios de documento entram como dublê porque o que eles guardam — um par
    // caminho+hash — é dado, não comportamento. O que precisa ser real é o Git, e ele é.
    pacotes: { listarPacotes: () => [{ documentos }] } as never,
    anexos: { listar: () => [], listarArquiteturas: () => [] } as never,
    audit,
    userId: () => USER
  })

  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repo, stdio: 'ignore' })
  // Identidade local: o runner de CI não tem `user.name` global, e sem isso todo `commit` falha
  // por um motivo que nada tem a ver com a fatia.
  execFileSync('git', ['config', 'user.email', 'teste@local'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: repo, stdio: 'ignore' })
  commitar('README.md', '# projeto\n', 'inicial')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

comGit('MarcosService — painel', () => {
  it('marca `commitado` quando o blob do commit recalcula para o hash da revisão', () => {
    documentos = [{ caminho: PRD, hash: commitar(PRD, '# PRD\n\nConteúdo aceito.\n') }]

    const vista = service.vista(PROJETO, WS)

    expect(vista.disponivel).toBe(true)
    expect(vista.linhas).toHaveLength(1)
    expect(vista.linhas[0]?.estado).toBe('commitado')
    expect(vista.linhas[0]?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(vista.linhas[0]?.data).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('preserva conteúdo terminado em linha em branco — o `trim()` mudaria o hash', () => {
    // O `GitOutcome.saida` vem com `trim()`. Usá-lo aqui daria hash diferente do que a gravação
    // calculou sobre o texto inteiro, e o marco apareceria como divergente sem nada ter mudado.
    documentos = [{ caminho: PRD, hash: commitar(PRD, '# PRD\n\n\n') }]

    expect(service.vista(PROJETO, WS).linhas[0]?.estado).toBe('commitado')
  })

  it('marca `blob-divergente` quando o commit guarda uma revisão anterior à aceita', () => {
    // O caso do critério 1: PRD commitado, PI aceitou uma revisão posterior. "Existe commit"
    // diria versionado; a comparação de conteúdo diz a verdade.
    commitar(PRD, '# PRD v1\n')
    documentos = [{ caminho: PRD, hash: hashDaRevisao('# PRD v2\n') }]

    const linha = service.vista(PROJETO, WS).linhas[0]

    expect(linha?.estado).toBe('blob-divergente')
    expect(linha?.commit).toBeDefined()
  })

  it('marca `revisao-sem-commit` quando o documento aceito nunca foi commitado', () => {
    documentos = [{ caminho: PRD, hash: hashDaRevisao('# PRD\n') }]

    const linha = service.vista(PROJETO, WS).linhas[0]

    expect(linha?.estado).toBe('revisao-sem-commit')
    expect(linha?.commit).toBeUndefined()
  })

  it('lista os arquivos sujos pelo caminho, sem conteúdo', () => {
    documentos = [{ caminho: PRD, hash: commitar(PRD, '# PRD\n') }]
    writeFileSync(join(repo, 'rascunho.md'), 'texto secreto do usuário\n', 'utf8')

    const vista = service.vista(PROJETO, WS)

    expect(vista.repositorio.sujos).toEqual(['rascunho.md'])
    expect(JSON.stringify(vista)).not.toContain('texto secreto')
  })

  it('vê o HEAD interrompido de um merge em conflito', () => {
    commitar(PRD, '# base\n')
    execFileSync('git', ['checkout', '-b', 'outra'], { cwd: repo, stdio: 'ignore' })
    commitar(PRD, '# lado B\n')
    execFileSync('git', ['checkout', 'main'], { cwd: repo, stdio: 'ignore' })
    commitar(PRD, '# lado A\n')
    try {
      execFileSync('git', ['merge', 'outra'], { cwd: repo, stdio: 'ignore' })
    } catch {
      // O conflito é o ponto do teste: o merge falha e deixa `MERGE_HEAD` para trás.
    }

    expect(service.vista(PROJETO, WS).repositorio.headInterrompido).toBe(true)
  })

  it('trata repositório sem commit nenhum como estado normal, não como Git indisponível', () => {
    // O estado de um projeto recém-criado: `git init` rodou, e o primeiro commit só vem com o
    // marco `estrutura-inicial`. Achado pelo E2E contra o app real — com dublê, `HEAD` sempre
    // respondia, e "Git indisponível" apareceria no caminho mais comum que existe.
    // Dentro do `appDir`, como o repo principal: fora dele o cwd cairia na allowlist de
    // diretórios e o teste passaria por outro motivo.
    const vazio = join(appDir, 'projeto-vazio')
    mkdirSync(vazio, { recursive: true })
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: vazio, stdio: 'ignore' })
    projetoNoDiretorio(vazio, 'p-vazio', 'projeto-vazio')

    const vista = service.vista('p-vazio', WS)

    expect(vista.mensagem ?? '(sem mensagem)').toBe('(sem mensagem)')
    expect(vista.disponivel).toBe(true)
    expect(vista.repositorio.head).toBe('')
  })

  it('explica em vez de listar vazio quando o `git` não está permitido', () => {
    // A allowlist é do banco, não da instância: remover aqui atinge o mesmo `TerminalEngine` que
    // o serviço já montou. A asserção é a mensagem **exata** do `GitRunner` — "contém git"
    // passaria também com "repositório sem commit", e o teste diria verde para o motivo errado.
    const policy = new PolicyService(audit, () => USER)
    new CommandAllowlistRepository(db, audit, policy).remove(USER, WS, 'git')

    const vista = service.vista(PROJETO, WS)

    // Lista vazia seria lida como "nenhum documento" — o oposto do que aconteceu.
    expect(vista.disponivel).toBe(false)
    expect(vista.linhas).toEqual([])
    expect(vista.mensagem).toBe(GIT_FORA_DA_ALLOWLIST)
  })
})

comGit('MarcosService — verificação do gate', () => {
  it('libera quando tudo está commitado e a árvore está limpa', () => {
    documentos = [{ caminho: PRD, hash: commitar(PRD, '# PRD\n') }]

    const resultado = service.verificar(PROJETO, WS)

    expect(resultado.ok).toBe(true)
    expect(resultado.pendencias).toEqual([])
    expect(resultado.head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('bloqueia com ação concreta quando o marco não está commitado', () => {
    documentos = [{ caminho: PRD, hash: hashDaRevisao('# PRD\n') }]

    const resultado = service.verificar(PROJETO, WS)

    expect(resultado.ok).toBe(false)
    expect(resultado.pendencias[0]?.acao).toBe(`Commitar marco ${PRD}`)
  })

  it('bloqueia — nunca libera — quando o Git não pôde ser lido', () => {
    // Falha de leitura não é ausência de problema: uma verificação que não rodou não é uma
    // verificação que passou, e liberar aqui abriria a Construção por falha de infraestrutura.
    const semProjeto = service.verificar('projeto-inexistente', WS)

    expect(semProjeto.ok).toBe(false)
    expect(semProjeto.pendencias).not.toHaveLength(0)
  })

  it('audita a verificação com o veredito, sem conteúdo de arquivo (critério 5)', () => {
    documentos = [{ caminho: PRD, hash: commitar(PRD, '# PRD\n') }]

    service.verificar(PROJETO, WS)

    const eventos = audit
      .list(USER, WS)
      .filter((e) => e.type === 'project-milestone')
      .map((e) => e.payload as Record<string, unknown>)
      .filter((p) => p.fase === 'verificacao-de-marcos')

    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.ok).toBe(true)
    expect(eventos[0]?.projectId).toBe(PROJETO)
  })

  it('a leitura do Git deixa rastro na auditoria de comandos (critério 6)', () => {
    documentos = [{ caminho: PRD, hash: commitar(PRD, '# PRD\n') }]

    service.vista(PROJETO, WS)

    const comandos = audit
      .list(USER, WS)
      .filter((e) => e.type === 'terminal-command')
      .map((e) => e.payload as Record<string, unknown>)

    // O `status` e o `log` da leitura aparecem — não há caminho de Git que escape do terminal
    // controlado, e é isso que o critério 6 pede.
    expect(comandos.length).toBeGreaterThan(0)
    expect(JSON.stringify(comandos)).toContain('status')
  })

  /**
   * **O conteúdo do documento não pode chegar à auditoria** (ADR-004, critério 2).
   *
   * `git show <sha>:<caminho>` existe para devolver o arquivo inteiro no `stdout`, e o
   * `TerminalEngine` persiste `stdout` em todo `AuditEvent` de `terminal-command`. Era o único
   * comando desta fatia cujo propósito é despejar conteúdo — e o teste do critério 6 acima não
   * pegava, porque afirmava só a **presença** do rastro, nunca a ausência do texto.
   */
  it('não grava o conteúdo do documento na auditoria de comandos (ADR-004)', () => {
    const segredo = '# PRD\n\nCHAVE-DO-CLIENTE-NAO-PUBLICADA-42\n'
    documentos = [{ caminho: PRD, hash: commitar(PRD, segredo) }]

    service.vista(PROJETO, WS)

    const auditoria = JSON.stringify(audit.list(USER, WS))

    expect(auditoria).not.toContain('CHAVE-DO-CLIENTE-NAO-PUBLICADA-42')
  })
})
