/**
 * Publicação do repositório e do backlog aprovado (SPEC-Entrega-01, categoria Banco).
 *
 * **O conector entra por um dublê do `ConnectorService`, não pelo `GithubAdapter`.** O que esta
 * fatia precisa provar é a *orquestração* — a ordem do fluxo, o que ela pede, o que ela recusa a
 * pedir e como retoma. As nove capacidades já foram provadas contra um GitHub falso na M6-F04, e
 * repetir aquilo aqui testaria o adapter de novo em vez de testar a publicação.
 *
 * O dublê registra **toda** chamada. É sobre esse registro que a idempotência é afirmada: "repetir
 * não duplica" só é verificável pelo que **não** foi pedido na segunda vez.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'

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
const { ProjectRepository } = await import('./project-repository')
const { RoadmapRepository } = await import('./roadmap-repository')
const { ExternalRefRepository } = await import('./external-ref-repository')
const { GitRunner } = await import('./git-runner')
const { PublicacaoService } = await import('./publicacao-service')
const { GITHUB_OPERATIONS } = await import('@shared/domain/github-automation')
const { chaveDeFatia, chaveDeMvp, chaveDeProjeto } = await import('@shared/domain/publicacao')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const PROJETO = 'p-1'
const OWNER = 'RodReis'
const REPO = 'projeto-alfa'
const TOKEN = 'ghs_token_do_teste'

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
let raiz: string
let bare: string
let db: Db
let service: InstanceType<typeof PublicacaoService>
let repository: InstanceType<typeof RoadmapRepository>
let refs: InstanceType<typeof ExternalRefRepository>
/** Toda chamada ao conector — operação e input. É sobre ela que a idempotência é afirmada. */
let chamadas: { operation: string; input: Record<string, unknown> }[]
/** Respostas forçadas por operação, para exercitar falha sem inventar estado. */
let falhas: Map<string, ConnectorOutcome>
/** Issues que o GitHub falso já tem, por chave externa — o estado que sobrevive ao "crash". */
let issuesPorChave: Map<string, number>
let repoExiste: boolean

/**
 * O dublê do `ConnectorService`.
 *
 * Responde como as operações reais respondem — inclusive `criado: false` quando o recurso já
 * existe, que é o sinal pelo qual a publicação sabe que não precisou criar nada.
 */
function connectorFalso(): { call: (r: ConnectorRequest) => Promise<ConnectorOutcome> } {
  return {
    call: async (request: ConnectorRequest): Promise<ConnectorOutcome> => {
      const input = (request.input ?? {}) as Record<string, unknown>
      chamadas.push({ operation: request.operation, input })

      const forcada = falhas.get(request.operation)
      if (forcada !== undefined) return forcada

      const ok = (data: unknown, criado = false): ConnectorOutcome =>
        ({
          ok: true,
          data,
          criado,
          provenance: { connector: 'github', operation: request.operation, obtidoEm: 'agora' },
          usage: { creditos: 0, latenciaMs: 1 }
        }) as unknown as ConnectorOutcome

      switch (request.operation) {
        case GITHUB_OPERATIONS.ensureRepository: {
          const criado = !repoExiste
          repoExiste = true
          return ok({ fullName: `${OWNER}/${REPO}`, defaultBranch: 'main' }, criado)
        }
        case GITHUB_OPERATIONS.ensureIssue: {
          const chave = String(input.externalKey)
          const jaTem = issuesPorChave.get(chave)
          if (jaTem !== undefined) return ok({ numero: jaTem, id: 1000 + jaTem, titulo: '' })
          const numero = issuesPorChave.size + 1
          issuesPorChave.set(chave, numero)
          return ok({ numero, id: 1000 + numero, titulo: String(input.title) }, true)
        }
        case GITHUB_OPERATIONS.ensureIssueDependency:
          return ok({ parentIssue: input.parentIssue, childIssue: input.childIssue })
        case GITHUB_OPERATIONS.setDefaultBranch:
          return ok({ defaultBranch: input.branch, alterado: false })
        case GITHUB_OPERATIONS.ensureBranchProtection:
          return ok({ branch: input.branch, revisoesExigidas: input.revisoesExigidas })
        case GITHUB_OPERATIONS.getCommitSha:
          return ok({ ref: input.ref, sha: shaLocal() })
        default:
          return ok({})
      }
    }
  }
}

function shaLocal(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
}

function operacoes(op: string): { operation: string; input: Record<string, unknown> }[] {
  return chamadas.filter((c) => c.operation === op)
}

/** Grava um roadmap com um MVP na fila e duas fatias, e a aprovação vigente dos dois gates. */
function comRoadmapAprovado(): void {
  const escopo = { userId: USER, workspaceId: WS, projectId: PROJETO }
  repository.salvarRoadmap(escopo, {
    mvps: [
      {
        id: 'mvp-1',
        numero: 1,
        titulo: 'Fundação',
        tese: 'A base do produto.',
        estado: 'proposto',
        dependeDe: [],
        origem: { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'escopo' }
      }
    ],
    slices: [
      {
        id: 'slice-1',
        mvpId: 'mvp-1',
        numero: 1,
        titulo: 'Primeira fatia',
        specSlug: 'docs/spec/spec-fundacao-01.md',
        detalhada: true,
        origem: { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'escopo' }
      },
      {
        id: 'slice-2',
        mvpId: 'mvp-1',
        numero: 2,
        titulo: 'Segunda fatia',
        specSlug: 'docs/spec/spec-fundacao-02.md',
        detalhada: false,
        origem: { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'escopo' }
      }
    ]
  })
  repository.promover(escopo, 'mvp-1')

  // O gate `SLICE_ENTRY` da **primeira** fatia (emenda 3 de 2026-08-30). Só ela vira issue; a
  // segunda fica como checklist no corpo do épico, porque a spec dela ainda não foi aprovada —
  // é a regra `card = fatia` do CONVENTION, em que a issue nasce quando a spec é aprovada.
  repository.registrarAprovacao({
    id: 'ap-1',
    user_id: USER,
    workspace_id: WS,
    projectId: PROJETO,
    gate: 'SLICE_ENTRY',
    revisoes: [{ artefato: 'docs/spec/spec-fundacao-01.md', hash: 'h1' }],
    identidade: 'pi-1',
    autor: 'pi',
    created_at: new Date().toISOString()
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-publicacao-'))
  appDir = join(dir, 'userData')
  raiz = join(appDir, 'projeto-alfa')
  bare = join(dir, 'origem.git')
  mkdirSync(raiz, { recursive: true })

  db = openDatabase(join(dir, 'app.db'))
  chamadas = []
  falhas = new Map()
  issuesPorChave = new Map()
  repoExiste = false

  const audit = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(audit, () => USER)
  const diretorios = new AllowlistRepository(db, audit, appDir)
  const comandos = new CommandAllowlistRepository(db, audit, policy)
  comandos.add(USER, WS, 'git')

  const projects = new ProjectRepository(db)
  projects.save({
    id: PROJETO,
    user_id: USER,
    workspace_id: WS,
    nome: 'Projeto Alfa',
    slug: 'projeto-alfa',
    diretorio: raiz,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })
  repository = new RoadmapRepository(db)
  refs = new ExternalRefRepository(db)

  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: raiz, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'teste@local'], { cwd: raiz, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: raiz, stdio: 'ignore' })
  writeFileSync(join(raiz, 'README.md'), '# projeto\n')
  execFileSync('git', ['add', '-A'], { cwd: raiz, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'inicial'], { cwd: raiz, stdio: 'ignore' })

  service = new PublicacaoService({
    projects,
    roadmap: repository,
    refs,
    git: new GitRunner(
      new TerminalEngine(
        policy,
        comandos,
        diretorios,
        new ExecutionRepository(db),
        new ApprovalRepository(db),
        audit,
        () => USER
      )
    ),
    connectors: connectorFalso() as never,
    audit,
    userId: () => USER,
    token: async () => TOKEN
  })
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

comGit('publicação do repositório e do backlog', () => {
  it('publica repositório, commits e issues do MVP e das fatias', async () => {
    comRoadmapAprovado()

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('publicado')
    expect(operacoes(GITHUB_OPERATIONS.ensureRepository)).toHaveLength(1)
    // Um MVP e **uma** fatia aprovada: duas issues. A segunda fatia não tem `SLICE_ENTRY` e por
    // isso não vira card (emenda 3) — publicar as duas criaria trabalho que ninguém liberou.
    expect(operacoes(GITHUB_OPERATIONS.ensureIssue)).toHaveLength(2)
    expect(operacoes(GITHUB_OPERATIONS.ensureIssueDependency)).toHaveLength(1)
  })

  it('as issues carregam a chave determinística do par MVP/Fatia (critério 3)', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    const chaves = operacoes(GITHUB_OPERATIONS.ensureIssue).map((c) => String(c.input.externalKey))
    expect(chaves).toContain(chaveDeMvp(PROJETO, 1))
    expect(chaves).toContain(chaveDeFatia(PROJETO, 1, 1))
    // A fatia 2 não tem `SLICE_ENTRY` aprovado (emenda 3): fica no checklist do épico.
    expect(chaves).not.toContain(chaveDeFatia(PROJETO, 1, 2))
  })

  it('o corpo da issue aponta a SPEC — o vínculo que o critério 3 pede', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    const daFatia = operacoes(GITHUB_OPERATIONS.ensureIssue).find(
      (c) => c.input.externalKey === chaveDeFatia(PROJETO, 1, 1)
    )
    expect(String(daFatia?.input.body)).toContain('docs/spec/spec-fundacao-01.md')
  })

  it('repetir NÃO duplica: a segunda publicação não cria nada (critério 1)', async () => {
    comRoadmapAprovado()
    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })
    chamadas = []

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('publicado')
    // As chamadas acontecem de novo — `ensure` é a forma de perguntar "já existe?" —, mas
    // nenhuma delas cria: o dublê responde `criado: false`, e é isso que a publicação relata.
    expect(r.criados).toBe(0)
    expect(issuesPorChave.size).toBe(2)
  })

  it('publica os commits locais na branch remota (critério 2)', async () => {
    comRoadmapAprovado()
    const local = shaLocal()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    const naOrigem = execFileSync('git', ['rev-parse', 'main'], { cwd: bare, encoding: 'utf8' })
    expect(naOrigem.trim()).toBe(local)
  })

  it('confirma na origem o commit publicado em vez de assumir o que mandou (critério 2)', async () => {
    comRoadmapAprovado()

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    // A leitura é o que separa "mandei" de "chegou". Sem ela, um push parcial passaria.
    expect(operacoes(GITHUB_OPERATIONS.getCommitSha)).toHaveLength(1)
    expect(r.commitPublicado).toBe(shaLocal())
  })

  it('sem MVP na fila, não publica issue nenhuma', async () => {
    // O roadmap existe, mas nada foi aprovado para a fila. Publicar aqui criaria issue de
    // trabalho que o PI não liberou — e "nenhuma issue futura equivale a autorização".
    repository.salvarRoadmap(
      { userId: USER, workspaceId: WS, projectId: PROJETO },
      {
        mvps: [
          {
            id: 'mvp-1',
            numero: 1,
            titulo: 'Fundação',
            tese: 'A base.',
            estado: 'proposto',
            dependeDe: [],
            origem: { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'escopo' }
          }
        ],
        slices: []
      }
    )

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('sem-backlog-aprovado')
    expect(operacoes(GITHUB_OPERATIONS.ensureIssue)).toHaveLength(0)
  })

  it('projeto inexistente falha fechado, sem tocar o GitHub', async () => {
    const r = await service.publicar('p-nao-existe', WS, {
      owner: OWNER,
      repo: REPO,
      origem: bare
    })

    expect(r.reason).toBe('projeto-inexistente')
    expect(chamadas).toHaveLength(0)
  })
})

comGit('bloqueio retomável (critério 5) e reconciliação (critério 6)', () => {
  it('falta de permissão vira bloqueio com ação concreta, não erro cru', async () => {
    comRoadmapAprovado()
    falhas.set(GITHUB_OPERATIONS.ensureRepository, {
      ok: false,
      code: 'credencial-ausente',
      mensagem: 'A GitHub App não tem acesso a esta conta.',
      retryable: false,
      acao: 'reautenticar',
      provenance: { connector: 'github', operation: 'repo.ensure', obtidoEm: 'agora' }
    } as unknown as ConnectorOutcome)

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('bloqueado')
    expect(r.bloqueio?.causa).toBe('credencial-ausente')
    // Sem `retomada`, o bloqueio é um beco: o PI sabe que falhou e não o que fazer.
    expect(r.bloqueio?.retomada.length).toBeGreaterThan(0)
    expect(r.bloqueio?.porQueNaoSeguir.length).toBeGreaterThan(0)
  })

  it('o bloqueio no meio não desfaz o que já foi publicado — nem repete na retomada', async () => {
    comRoadmapAprovado()
    // O repositório e a issue do MVP saem; a dependência falha. É o "crash" do critério 6.
    falhas.set(GITHUB_OPERATIONS.ensureIssueDependency, {
      ok: false,
      code: 'indisponivel',
      mensagem: 'A API de sub-issues não respondeu.',
      retryable: true,
      acao: 'repetir',
      provenance: { connector: 'github', operation: 'issue.ensure-dependency', obtidoEm: 'agora' }
    } as unknown as ConnectorOutcome)

    const primeira = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })
    expect(primeira.reason).toBe('bloqueado')
    // O que saiu antes do bloqueio continua lá: a issue do MVP e a da fatia aprovada.
    const antesDaRetomada = new Map(issuesPorChave)
    expect(antesDaRetomada.size).toBe(2)

    // A retomada: o obstáculo sumiu, e a publicação roda de novo do começo.
    falhas.clear()
    chamadas = []
    const segunda = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(segunda.reason).toBe('publicado')
    // O que o critério 6 exige é que a retomada **reconcilie antes de repetir** — não que ela não
    // faça nada. As duas issues que já existiam foram reencontradas pela chave externa, com o
    // mesmo número; a terceira nasce agora porque a primeira execução parou antes de chegar nela.
    // A reconciliação reencontrou as duas pela chave externa, com o mesmo número. Nada nasce de
    // novo: a única fatia aprovada já tinha issue, e é o `ensure` que descobre isso sem duplicar.
    for (const [chave, numero] of antesDaRetomada) {
      expect(issuesPorChave.get(chave)).toBe(numero)
    }
    expect(issuesPorChave.size).toBe(2)
    expect(segunda.criados).toBe(0)
  })

  it('git fora da allowlist bloqueia com o remédio do terminal, sem publicar pela metade', async () => {
    comRoadmapAprovado()
    // O cenário que o PI escolheu manter (sem seed de allowlist): o `git` não foi permitido.
    db.prepare('DELETE FROM allowed_command WHERE binary = ?').run('git')

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('bloqueado')
    expect(r.bloqueio?.causa).toBe('git-nao-permitido')
    expect(r.bloqueio?.retomada).toContain('Terminal Controlado')
  })

  it('push recusado por divergência bloqueia sem forçar (regra da spec)', async () => {
    comRoadmapAprovado()
    // A origem andou por fora. Sem `--force`, o Git recusa — e a publicação precisa reportar
    // isso como bloqueio, não como falha genérica.
    const outro = join(dir, 'outro')
    execFileSync('git', ['clone', bare, outro], { stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'o@local'], { cwd: outro, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Outro'], { cwd: outro, stdio: 'ignore' })
    writeFileSync(join(outro, 'A.md'), 'a\n')
    execFileSync('git', ['add', '-A'], { cwd: outro, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'alheio'], { cwd: outro, stdio: 'ignore' })
    execFileSync('git', ['push'], { cwd: outro, stdio: 'ignore' })
    const naOrigem = execFileSync('git', ['rev-parse', 'main'], { cwd: bare, encoding: 'utf8' })

    writeFileSync(join(raiz, 'B.md'), 'b\n')
    execFileSync('git', ['add', '-A'], { cwd: raiz, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'local'], { cwd: raiz, stdio: 'ignore' })

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('bloqueado')
    expect(r.bloqueio?.causa).toBe('push-recusado')
    // Os dois lados inteiros: o commit alheio continua lá.
    expect(execFileSync('git', ['rev-parse', 'main'], { cwd: bare, encoding: 'utf8' })).toBe(
      naOrigem
    )
  })
})

comGit('emendas de 2026-08-30', () => {
  it('proteção recusada NÃO bloqueia — vira limitação no ExternalRef (emenda 2)', async () => {
    comRoadmapAprovado()
    // Repositório privado em conta sem plano responde 403. Barrar aqui deixaria o projeto sem
    // board por uma configuração da conta, não da entrega.
    falhas.set(GITHUB_OPERATIONS.ensureBranchProtection, {
      ok: false,
      code: 'permissao-negada',
      mensagem: 'Upgrade to GitHub Pro to use branch protection.',
      retryable: false,
      acao: 'reportar',
      provenance: { connector: 'github', operation: 'branch.ensure-protection', obtidoEm: 'agora' }
    } as unknown as ConnectorOutcome)

    const r = await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    expect(r.reason).toBe('publicado')
    // As issues saíram: a publicação seguiu.
    expect(operacoes(GITHUB_OPERATIONS.ensureIssue)).toHaveLength(2)

    const branch = refs.buscar(
      { userId: USER, workspaceId: WS, projectId: PROJETO },
      'branch',
      chaveDeProjeto(PROJETO)
    )
    // O critério 4 pede "confirmadas **ou registradas como limitação explícita**". A M9-F05 lê
    // daqui que esta branch não tem proteção — sem confundir com "ainda não publicada".
    expect(branch?.limitacao).toContain('permissao-negada')
    expect(branch?.sha).toBe(shaLocal())
  })

  it('persiste o ExternalRef do repositório, da branch e da issue (emenda 6)', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    const escopo = { userId: USER, workspaceId: WS, projectId: PROJETO }
    const todas = refs.listar(escopo)

    // Sem isto, cada fatia seguinte redescobriria na origem o que esta acabou de publicar.
    expect(todas.map((r) => r.alvo).sort()).toEqual(['branch', 'issue', 'repositorio'])
    expect(refs.buscar(escopo, 'repositorio', chaveDeProjeto(PROJETO))?.refId).toBe(
      `${OWNER}/${REPO}`
    )
    // O número da issue é o que a M9-F05 usa para escrever `refs #N`.
    const daFatia = refs.buscar(escopo, 'issue', chaveDeFatia(PROJETO, 1, 1))
    expect(Number(daFatia?.refId)).toBeGreaterThan(0)
  })

  it('republicar atualiza o ExternalRef em vez de acumular linhas', async () => {
    comRoadmapAprovado()
    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })
    const primeira = refs.listar({ userId: USER, workspaceId: WS, projectId: PROJETO }).length

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    // Republicar é a operação normal desta fatia. Um INSERT acumularia, e "qual é o número da
    // issue?" passaria a ter várias respostas.
    expect(refs.listar({ userId: USER, workspaceId: WS, projectId: PROJETO })).toHaveLength(
      primeira
    )
  })

  it('o corpo da fatia traz `Bloqueada por: #N` do épico (emenda 5)', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    const daFatia = operacoes(GITHUB_OPERATIONS.ensureIssue).find(
      (c) => c.input.externalKey === chaveDeFatia(PROJETO, 1, 1)
    )
    const doMvp = operacoes(GITHUB_OPERATIONS.ensureIssue).find(
      (c) => c.input.externalKey === chaveDeMvp(PROJETO, 1)
    )
    // O GitHub não tem dependência nativa entre issues: `ensureIssueDependency` liga como
    // sub-issue, e a linha no corpo é o que expressa "esta espera aquela".
    expect(String(daFatia?.input.body)).toContain('Bloqueada por: #')
    expect(doMvp).toBeDefined()
  })

  it('garante os rótulos da Convention do alvo, e nenhum quando ela não os define (emenda 4)', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })
    // Sem Convention que os defina, nenhum rótulo é aplicado — o estado vive só no app.
    expect(operacoes(GITHUB_OPERATIONS.ensureLabel)).toHaveLength(0)

    chamadas = []
    await service.publicar(PROJETO, WS, {
      owner: OWNER,
      repo: REPO,
      origem: bare,
      rotulos: [{ nome: 'fatia', cor: 'a2eeef', descricao: 'Uma fatia do roadmap' }]
    })

    const label = operacoes(GITHUB_OPERATIONS.ensureLabel)
    expect(label).toHaveLength(1)
    expect(label[0]?.input.nome).toBe('fatia')
  })

  it('os `proplan:` desta base NÃO são exportados por padrão (emenda 4)', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    // Exportá-los imporia o processo do JARVIS a um projeto que não o adotou.
    expect(JSON.stringify(chamadas)).not.toContain('proplan:')
  })
})

comGit('o token e a auditoria', () => {
  it('o token nunca chega ao input do conector — quem fala com o GitHub é o adapter', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    // A decisão cravada da spec: o executor nunca recebe token. O envelope carrega a
    // *referência* da credencial, e é o `ConnectorService` que resolve o cofre.
    expect(JSON.stringify(chamadas)).not.toContain(TOKEN)
  })

  it('o token não entra na auditoria, mesmo com o push carregando a URL', async () => {
    comRoadmapAprovado()

    await service.publicar(PROJETO, WS, { owner: OWNER, repo: REPO, origem: bare })

    const linhas = db.prepare('SELECT payload FROM audit_event').all() as { payload: string }[]
    for (const linha of linhas) {
      expect(linha.payload).not.toContain(TOKEN)
    }
  })
})
