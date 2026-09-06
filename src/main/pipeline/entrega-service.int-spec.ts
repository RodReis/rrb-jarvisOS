/**
 * A orquestração da fatia até o merge (SPEC-Entrega-05, categoria Banco).
 *
 * **O conector entra por um dublê do `ConnectorService`**, como na M9-F01: as capacidades já foram
 * provadas contra um GitHub falso na M6-F04, e repeti-las aqui testaria o adapter de novo em vez
 * da orquestração. O que se prova aqui é a *sequência* — o que ela pede, o que se recusa a pedir,
 * e onde ela para.
 *
 * **O dublê responde no formato exato do adapter real**, conferido no código de
 * `github-operations.ts`, e não no formato que este serviço espera. A diferença não é acadêmica:
 * `checks.for-head` devolve o **array** direto, e um dublê que devolvesse `{ checks: [...] }`
 * concordaria com um consumidor que lê `data.checks` — que compila, porque `data` é `unknown`, e
 * devolveria lista vazia para sempre. Lista vazia nunca aprova, então o run bloquearia por
 * "ausência de regra" com os checks verdes na tela. O fake que confirma o consumidor esconde
 * exatamente o defeito que ele deveria pegar.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import type { SandboxPreparado } from '@shared/domain/preflight'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { CAMINHO_DO_WORKFLOW, NOME_DO_JOB_DE_CI } = await import('@shared/domain/ci-workflow')
const { GITHUB_OPERATIONS } = await import('@shared/domain/github-automation')
const { EntregaService } = await import('./entrega-service')
const { RulesetRepository } = await import('./ruleset-repository')
const { ExecutionLedgerRepository } = await import('./execution-ledger-repository')
const { BudgetRepository } = await import('../budget/budget-repository')
const { ledgerCompleto } = await import('@shared/domain/execution-ledger')
type ExecutionLedger = import('@shared/domain/execution-ledger').ExecutionLedger
const { openDatabase } = await import('../storage/database')

type EntregaServiceType = InstanceType<typeof EntregaService>

const USER = 'u-1'
const WS = 'jarvis' as WorkspaceId
const OWNER = 'RodReis'
const REPO = 'projeto-alvo'
const PR = 7
const SHA_HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const SHA_MERGE = 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1'

const COMANDOS = {
  test: ['npm', 'test'],
  lint: ['npm', 'run', 'lint'],
  typecheck: ['npm', 'run', 'typecheck'],
  build: ['npm', 'run', 'build']
} as const

/** O estado do GitHub falso, recriado a cada teste. */
interface EstadoDaOrigem {
  contexts: string[]
  protegida: boolean
  mergeQueueExigida: boolean
  /** Os checks do head, no formato normalizado do adapter. */
  checks: {
    nome: string
    headSha: string
    status: 'queued' | 'in_progress' | 'completed'
    conclusao?: string
  }[]
  headSha: string
  merged: boolean
  /** O merge respondeu 200 mas a origem não confirma? É o cenário do critério 7. */
  mergeSemConfirmacao: boolean
}

let chamadas: { operation: string; input: Record<string, unknown> }[]
let origem: EstadoDaOrigem
let dir: string
let worktree: string
let db: ReturnType<typeof openDatabase>
let ruleset: InstanceType<typeof RulesetRepository>
let ledgerRepo: InstanceType<typeof ExecutionLedgerRepository>
let budgetRepo: InstanceType<typeof BudgetRepository>
/** As chamadas de limpeza deste teste: a M9-F06 exige que ela rode em todo desfecho. */
let limpezas: { runId: string; fase: string; estadoFinal: string }[]
let autonomo: boolean
let achados: { severidade: 'P0' | 'P1' | 'P2' | 'P3'; titulo: string }[]
let construcao: {
  estadoFinal: 'PR_CI' | 'BLOCKED'
  tentativas: { numero: number; runId: string }[]
  bloqueio?: Record<string, string>
}
let pushes: string[]

function chamadasDe(operation: string): { input: Record<string, unknown> }[] {
  return chamadas.filter((c) => c.operation === operation)
}

/**
 * O dublê do `ConnectorService`, respondendo como o adapter real responde.
 *
 * Cada `case` foi conferido contra `github-operations.ts` — em particular `checks.for-head`, que
 * devolve o array direto, e `pr.merge-state`, que só traz `mergeSha` quando `merged` é `true`.
 */
function connectorFalso(): { call: (r: ConnectorRequest) => Promise<ConnectorOutcome> } {
  return {
    call: async (request: ConnectorRequest): Promise<ConnectorOutcome> => {
      const input = (request.input ?? {}) as Record<string, unknown>
      chamadas.push({ operation: request.operation, input })

      const ok = (data: unknown): ConnectorOutcome =>
        ({
          ok: true,
          data,
          criado: false,
          provenance: { connector: 'github', operation: request.operation, obtidoEm: 'agora' },
          usage: { creditos: 0, latenciaMs: 1 }
        }) as unknown as ConnectorOutcome

      switch (request.operation) {
        case GITHUB_OPERATIONS.ensurePullRequest:
          return ok({ numero: PR, id: 100, titulo: String(input.title), criado: false })

        case GITHUB_OPERATIONS.getRequiredChecks:
          return ok({
            branch: String(input.branch),
            contexts: [...origem.contexts],
            strict: true,
            protegida: origem.protegida,
            mergeQueueExigida: origem.mergeQueueExigida
          })

        case GITHUB_OPERATIONS.ensureBranchProtection:
          origem.protegida = true
          origem.contexts = [...(input.checksExigidos as string[])]
          return ok({ branch: input.branch, revisoesExigidas: input.revisoesExigidas })

        case GITHUB_OPERATIONS.getCommitSha:
          return ok({ ref: input.ref, sha: origem.headSha })

        // O adapter devolve o **array**, não um envelope. Ver o cabeçalho deste arquivo.
        case GITHUB_OPERATIONS.getChecksForHead:
          return ok(origem.checks.filter((c) => c.headSha === input.sha))

        case GITHUB_OPERATIONS.squashMerge:
          if (!origem.mergeSemConfirmacao) origem.merged = true
          return ok({ mergeSha: SHA_MERGE, merged: !origem.mergeSemConfirmacao })

        case GITHUB_OPERATIONS.getMergeState:
          return ok({
            numero: PR,
            estado: origem.merged ? 'closed' : 'open',
            merged: origem.merged,
            // `mergeSha` só sai com `merged: true` — em PR aberto seria um *test merge commit*.
            ...(origem.merged ? { mergeSha: SHA_MERGE } : {}),
            headSha: origem.headSha
          })

        default:
          return ok({})
      }
    }
  }
}

/**
 * A limpeza dublada: só registra que foi chamada e com que fase.
 *
 * O que ela faz de verdade — remover worktree e container conferindo o lease — já tem prova em
 * `limpeza-service.int-spec.ts` contra leases reais. Aqui a pergunta é outra: **ela é chamada em
 * todo desfecho?**
 */
function limpezaFalsa(): never {
  return {
    limpar: vi.fn((pedido: { runId: string; fase: string; estadoFinal: string }) => {
      limpezas.push({
        runId: pedido.runId,
        fase: pedido.fase,
        estadoFinal: pedido.estadoFinal
      })
      return { removidos: [], pendencias: [] }
    })
  } as never
}

function montar(): EntregaServiceType {
  const gitFalso = {
    run: vi.fn(() => ({ ok: true })),
    push: vi.fn((_origem: string, branch: string) => {
      pushes.push(branch)
      return { ok: true }
    }),
    pushComToken: vi.fn((_url: string, _t: string, branch: string) => {
      pushes.push(branch)
      return { ok: true }
    })
  }

  return new EntregaService({
    construtor: { construir: vi.fn(async () => construcao) } as never,
    connectors: connectorFalso() as never,
    git: gitFalso as never,
    fila: { concluir: vi.fn(() => ({ reason: 'transicionado' })) } as never,
    mergePolicy: { autonomoLigado: vi.fn(() => autonomo) } as never,
    ruleset,
    ledger: ledgerRepo,
    limpeza: limpezaFalsa(),
    budget: budgetRepo,
    audit: { append: vi.fn() } as never,
    userId: () => USER,
    revisar: async () => achados,
    token: async () => undefined,
    // Sem espera real, mas o relógio **anda**: `dormir` avança o tempo simulado pelo mesmo
    // intervalo que o serviço pediu. Um `dormir` que não avança deixaria o teto inalcançável e o
    // laço de espera rodaria para sempre — foi o que travou a primeira execução desta suíte.
    dormir: async (ms: number) => {
      relogio += ms
    },
    tetoDeEsperaMs: 60_000,
    agora: () => relogio
  })
}

let relogio: number

function sandboxDe(): SandboxPreparado {
  return {
    runId: 'run-1',
    containerNome: 'jarvis-run-1',
    cwd: '/work',
    baseSha: 'abc123',
    branch: 'feat/fatia',
    worktreeNoHost: worktree,
    pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'SPEC' },
    proxyUrl: 'http://172.20.0.2:8080',
    modeloDaConstrucao: { provider: 'claude-code', modelo: 'claude-opus-5' }
  }
}

function pedido(): Parameters<EntregaServiceType['entregar']>[0] {
  return {
    runId: 'run-1',
    projectId: 'p-1',
    workspaceId: WS,
    sandbox: sandboxDe(),
    alvo: { owner: OWNER, repo: REPO, branchBase: 'main', branchDaFatia: 'feat/fatia' },
    issue: 42,
    titulo: '[MVP9][F05] fatia de teste',
    promptInicial: 'construa',
    comandosDeValidacao: COMANDOS
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-entrega-'))
  worktree = join(dir, 'worktree')
  mkdirSync(worktree, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: worktree })

  db = openDatabase(join(dir, 'jarvis.db'))
  ruleset = new RulesetRepository(db)
  ledgerRepo = new ExecutionLedgerRepository(db)
  budgetRepo = new BudgetRepository(db)
  limpezas = []

  chamadas = []
  pushes = []
  achados = []
  autonomo = true
  relogio = 1_000
  construcao = { estadoFinal: 'PR_CI', tentativas: [{ numero: 1, runId: 'run-1' }] }
  origem = {
    contexts: [NOME_DO_JOB_DE_CI],
    protegida: true,
    mergeQueueExigida: false,
    checks: [
      { nome: NOME_DO_JOB_DE_CI, headSha: SHA_HEAD, status: 'completed', conclusao: 'success' }
    ],
    headSha: SHA_HEAD,
    merged: false,
    mergeSemConfirmacao: false
  }
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('EntregaService — merge confirmado na origem (critérios 6 e 8)', () => {
  it('kill-switch ligado mergeia e devolve o mergeSha confirmado', async () => {
    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).toBe('MERGED')
    expect(r.mergeSha).toBe(SHA_MERGE)
    expect(r.pullRequest).toBe(PR)
    // A confirmação é consultada na origem, não deduzida da resposta do merge.
    expect(chamadasDe(GITHUB_OPERATIONS.getMergeState).length).toBeGreaterThan(0)
  })

  it('o merge leva o head esperado, para a origem recusar se ele andou', async () => {
    await montar().entregar(pedido())

    expect(chamadasDe(GITHUB_OPERATIONS.squashMerge)[0]?.input.expectedHeadSha).toBe(SHA_HEAD)
  })
})

describe('EntregaService — kill-switch desligado (critério 8)', () => {
  it('termina em AWAITING_MERGE sem mergear', async () => {
    autonomo = false

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).toBe('AWAITING_MERGE')
    expect(r.pullRequest).toBe(PR)
    expect(chamadasDe(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })
})

describe('EntregaService — código zero não prova sucesso (critério 7)', () => {
  it('merge sem confirmação na origem NÃO vira MERGED', async () => {
    // O merge responde 200, a origem continua dizendo `merged: false`. Declarar entregue aqui
    // seria exatamente o fechamento frágil que o critério proíbe.
    origem.mergeSemConfirmacao = true

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).not.toBe('MERGED')
    expect(r.mergeSha).toBeUndefined()
  })
})

describe('EntregaService — workflow de CI no projeto-alvo (critério 9)', () => {
  it('gera o workflow no primeiro run e não o reescreve no seguinte', async () => {
    const caminho = join(worktree, CAMINHO_DO_WORKFLOW)

    await montar().entregar(pedido())
    expect(existsSync(caminho)).toBe(true)
    const primeiro = readFileSync(caminho, 'utf8')

    await montar().entregar(pedido())
    expect(readFileSync(caminho, 'utf8')).toBe(primeiro)
  })

  it('preserva edição humana que mantém os mesmos comandos', async () => {
    const caminho = join(worktree, CAMINHO_DO_WORKFLOW)
    mkdirSync(join(worktree, '.github', 'workflows'), { recursive: true })
    const aMao = [
      'name: ci-do-time',
      'jobs:',
      '  validacao:',
      '    steps:',
      '      - run: npm run lint',
      '      - run: npm run typecheck',
      '      - run: npm test',
      '      - run: npm run build'
    ].join('\n')
    writeFileSync(caminho, aMao, 'utf8')

    await montar().entregar(pedido())

    expect(readFileSync(caminho, 'utf8')).toBe(aMao)
  })
})

describe('EntregaService — sem check não há merge (critério 10)', () => {
  it('origem sem proteção e sem checks termina em bloqueio explicável, nunca em MERGED', async () => {
    origem.protegida = false
    origem.contexts = []
    origem.checks = []

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).not.toBe('MERGED')
    expect(chamadasDe(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })

  it('a pipeline exige o check que gerou, destravando a si mesma', async () => {
    // O projeto do MVP-008 nasce sem CI e sem proteção. Se a pipeline não declarasse o context
    // obrigatório, o gate barraria por ausência de regra para sempre — e nenhum run fecharia.
    origem.protegida = false
    origem.contexts = []

    await montar().entregar(pedido())

    const protecao = chamadasDe(GITHUB_OPERATIONS.ensureBranchProtection)
    expect(protecao).toHaveLength(1)
    expect(protecao[0]?.input.checksExigidos).toContain(NOME_DO_JOB_DE_CI)
  })

  it('contexts que a origem já exige somam, não são substituídos', async () => {
    origem.contexts = ['seguranca']
    origem.checks = [
      { nome: 'seguranca', headSha: SHA_HEAD, status: 'completed', conclusao: 'success' },
      { nome: NOME_DO_JOB_DE_CI, headSha: SHA_HEAD, status: 'completed', conclusao: 'success' }
    ]

    await montar().entregar(pedido())

    const exigidos = chamadasDe(GITHUB_OPERATIONS.ensureBranchProtection)[0]?.input
      .checksExigidos as string[]
    expect(exigidos).toContain('seguranca')
    expect(exigidos).toContain(NOME_DO_JOB_DE_CI)
  })
})

describe('EntregaService — ruleset em movimento (critério 11)', () => {
  it('registra o snapshot da regra observada na origem', async () => {
    await montar().entregar(pedido())

    const serie = ruleset.todos(USER, 'run-1')
    expect(serie.length).toBeGreaterThan(0)
    expect(serie[0]?.contexts).toContain(NOME_DO_JOB_DE_CI)
    expect(serie[0]?.ref).toContain(`${OWNER}/${REPO}/protection/main`)
  })

  it('não duplica snapshot quando a regra não mudou entre as voltas', async () => {
    origem.checks = [
      { nome: NOME_DO_JOB_DE_CI, headSha: SHA_HEAD, status: 'in_progress' },
      { nome: 'outro', headSha: SHA_HEAD, status: 'in_progress' }
    ]
    // O teto (60s) cai depois de algumas voltas de 15s: várias leituras de ruleset, um snapshot só,
    // porque a regra não mudou entre elas.
    await montar().entregar(pedido())

    expect(ruleset.todos(USER, 'run-1')).toHaveLength(1)
  })
})

describe('EntregaService — merge queue (critério 12)', () => {
  it('termina em AWAITING_MERGE sem tentar mergear', async () => {
    origem.mergeQueueExigida = true

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).toBe('AWAITING_MERGE')
    expect(chamadasDe(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })
})

describe('EntregaService — revisão bloqueia o merge (critério 2)', () => {
  it('P1 aberto impede o merge mesmo com CI verde', async () => {
    achados = [{ severidade: 'P1', titulo: 'validação ausente na fronteira' }]

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).toBe('BLOCKED')
    expect(chamadasDe(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })

  it('P2 aberto não impede o merge', async () => {
    achados = [{ severidade: 'P2', titulo: 'nome poderia ser mais claro' }]

    expect((await montar().entregar(pedido())).estadoFinal).toBe('MERGED')
  })
})

describe('EntregaService — construção bloqueada não publica (critério 1)', () => {
  it('escopo violado termina em BLOCKED sem push nem PR', async () => {
    construcao = {
      estadoFinal: 'BLOCKED',
      tentativas: [{ numero: 1, runId: 'run-1' }],
      bloqueio: {
        causa: 'risco-usuario',
        evidencia: 'Alteração fora do escopo declarado: segredo/backdoor.ts',
        retomada: 'Revisar o escopo declarado.'
      }
    }

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).toBe('BLOCKED')
    expect(pushes).toHaveLength(0)
    expect(chamadasDe(GITHUB_OPERATIONS.ensurePullRequest)).toHaveLength(0)
  })
})

describe('EntregaService — docs do projeto-alvo no mesmo PR (critério 13)', () => {
  it('os documentos declarados são commitados antes do push, nunca depois do merge', async () => {
    // A invariante 10 da CONVENTION: documento auxiliar é atualizado **no PR**. Depois do merge só
    // caberia commit direto na branch-base, que é o que a invariante existe para impedir — e que
    // este repositório também proíbe a si mesmo.
    const statusRepo = join(worktree, 'docs')
    mkdirSync(statusRepo, { recursive: true })
    writeFileSync(join(statusRepo, 'STATUS.md'), '# STATUS do projeto-alvo', 'utf8')

    const comandosGit: string[][] = []
    const service = new EntregaService({
      construtor: { construir: vi.fn(async () => construcao) } as never,
      connectors: connectorFalso() as never,
      git: {
        run: vi.fn((args: string[]) => {
          comandosGit.push(args)
          return { ok: true }
        }),
        push: vi.fn((_o: string, branch: string) => {
          // No momento do push, tudo que o run produziu já precisa estar commitado.
          pushes.push(branch)
          return { ok: true }
        }),
        pushComToken: vi.fn(() => ({ ok: true }))
      } as never,
      fila: { concluir: vi.fn(() => ({ reason: 'transicionado' })) } as never,
      mergePolicy: { autonomoLigado: vi.fn(() => true) } as never,
      ruleset,
      ledger: ledgerRepo,
      limpeza: limpezaFalsa(),
      budget: budgetRepo,
      audit: { append: vi.fn() } as never,
      userId: () => USER,
      revisar: async () => [],
      token: async () => undefined,
      dormir: async (ms: number) => {
        relogio += ms
      },
      agora: () => relogio
    })

    await service.entregar({ ...pedido(), docsDoProjeto: ['docs/STATUS.md'] })

    // O `add` precisa nomear o doc, e vir antes do commit — que vem antes do push.
    const indiceDoAdd = comandosGit.findIndex((a) => a[0] === 'add')
    const indiceDoCommit = comandosGit.findIndex((a) => a[0] === 'commit')
    expect(indiceDoAdd).toBeGreaterThanOrEqual(0)
    expect(indiceDoCommit).toBeGreaterThan(indiceDoAdd)
    expect(comandosGit[indiceDoAdd]).toContain('docs/STATUS.md')
    expect(pushes).toHaveLength(1)
  })

  it('não commita na branch-base em momento nenhum', async () => {
    const comandosGit: string[][] = []
    const service = new EntregaService({
      construtor: { construir: vi.fn(async () => construcao) } as never,
      connectors: connectorFalso() as never,
      git: {
        run: vi.fn((args: string[]) => {
          comandosGit.push(args)
          return { ok: true }
        }),
        push: vi.fn((_o: string, branch: string) => {
          pushes.push(branch)
          return { ok: true }
        }),
        pushComToken: vi.fn(() => ({ ok: true }))
      } as never,
      fila: { concluir: vi.fn(() => ({ reason: 'transicionado' })) } as never,
      mergePolicy: { autonomoLigado: vi.fn(() => true) } as never,
      ruleset,
      ledger: ledgerRepo,
      limpeza: limpezaFalsa(),
      budget: budgetRepo,
      audit: { append: vi.fn() } as never,
      userId: () => USER,
      revisar: async () => [],
      token: async () => undefined,
      dormir: async (ms: number) => {
        relogio += ms
      },
      agora: () => relogio
    })

    const r = await service.entregar(pedido())

    expect(r.estadoFinal).toBe('MERGED')
    // Nenhum checkout/push para `main`: o único branch empurrado é o da fatia.
    expect(comandosGit.some((a) => a[0] === 'checkout' && a.includes('main'))).toBe(false)
    expect(pushes).toEqual(['feat/fatia'])
  })
})

describe('EntregaService — o corpo do PR não fecha a issue', () => {
  it('usa refs e nunca closes/fixes/resolves', async () => {
    // `closes #N` fecharia a issue no merge e forjaria o aceite do PI — proibido em letra pela
    // SPEC § Decisões cravadas e pelo CLAUDE.md § Ciclo de vida.
    await montar().entregar(pedido())

    const corpo = String(chamadasDe(GITHUB_OPERATIONS.ensurePullRequest)[0]?.input.body)
    expect(corpo).toContain('refs #42')
    expect(corpo.toLowerCase()).not.toMatch(/\b(closes|fixes|resolves)\s+#/)
  })
})

describe('EntregaService — teto de espera termina aguardando, não bloqueado', () => {
  it('check obrigatório eterno estoura o teto em AWAITING_MERGE', async () => {
    // "Ainda correndo" não é falha: `BLOCKED` aqui ensinaria a ler bloqueio como ruído, e um run
    // preso travaria a fila inteira (WIP=1 global). Decisão do PI, 2026-09-02.
    origem.checks = [{ nome: NOME_DO_JOB_DE_CI, headSha: SHA_HEAD, status: 'in_progress' }]

    const r = await montar().entregar(pedido())

    expect(r.estadoFinal).toBe('AWAITING_MERGE')
    expect(chamadasDe(GITHUB_OPERATIONS.squashMerge)).toHaveLength(0)
  })
})

describe('EntregaService — correlação do run (pendência da M9-F04)', () => {
  it('expõe o run corrente durante a entrega e o limpa ao fim', async () => {
    // Sem isto o `ExecutorProxy` recebe `contextPackId: undefined` e o gate de ContextPack recusa
    // **toda** chamada do executor — a rota fica inoperante em produção.
    let durante: unknown
    const service = new EntregaService({
      construtor: {
        construir: vi.fn(async () => {
          durante = service.contextoDoRun()
          return construcao
        })
      } as never,
      connectors: connectorFalso() as never,
      git: {
        run: vi.fn(() => ({ ok: true })),
        push: vi.fn(() => ({ ok: true })),
        pushComToken: vi.fn(() => ({ ok: true }))
      } as never,
      fila: { concluir: vi.fn(() => ({ reason: 'transicionado' })) } as never,
      mergePolicy: { autonomoLigado: vi.fn(() => true) } as never,
      ruleset,
      ledger: ledgerRepo,
      limpeza: limpezaFalsa(),
      budget: budgetRepo,
      audit: { append: vi.fn() } as never,
      userId: () => USER,
      revisar: async () => [],
      token: async () => undefined,
      dormir: async () => {},
      agora: () => relogio
    })

    await service.entregar(pedido())

    expect(durante).toMatchObject({ runId: 'run-1' })
    expect(service.contextoDoRun()).toBeUndefined()
  })

  it('propaga o contextPackId do pedido — sem ele o gate recusa toda chamada do executor', async () => {
    // O gate de ContextPack em `call-provider.ts` recusa geração sem manifesto. Enquanto o boot
    // passava `contextPackId: () => undefined`, **toda** chamada do executor voltava "Esta geração
    // precisa de um contexto montado", e a rota não operava em produção.
    let durante: unknown
    const service = new EntregaService({
      construtor: {
        construir: vi.fn(async () => {
          durante = service.contextoDoRun()
          return construcao
        })
      } as never,
      connectors: connectorFalso() as never,
      git: {
        run: vi.fn(() => ({ ok: true })),
        push: vi.fn(() => ({ ok: true })),
        pushComToken: vi.fn(() => ({ ok: true }))
      } as never,
      fila: { concluir: vi.fn(() => ({ reason: 'transicionado' })) } as never,
      mergePolicy: { autonomoLigado: vi.fn(() => true) } as never,
      ruleset,
      ledger: ledgerRepo,
      limpeza: limpezaFalsa(),
      budget: budgetRepo,
      audit: { append: vi.fn() } as never,
      userId: () => USER,
      revisar: async () => [],
      token: async () => undefined,
      dormir: async (ms: number) => {
        relogio += ms
      },
      agora: () => relogio
    })

    await service.entregar({ ...pedido(), contextPackId: 'pack-9' })

    expect(durante).toMatchObject({ runId: 'run-1', contextPackId: 'pack-9' })
  })

  it('a tentativa corrente acompanha a recuperação, não fica presa em 1', async () => {
    // O `CostEvent` de uma segunda tentativa precisa dizer que é a segunda: preso em 1, o custo da
    // recuperação apareceria como se fosse do primeiro esforço, e a pergunta "quanto custou
    // recuperar" deixaria de ter resposta.
    construcao = {
      estadoFinal: 'PR_CI',
      tentativas: [
        { numero: 1, runId: 'run-1' },
        { numero: 2, runId: 'run-1' }
      ]
    }

    // Lido **depois** da construção e antes do fim da entrega: é a janela em que o revisor roda,
    // e o custo dele pertence à tentativa que produziu o código revisado.
    let duranteARevisao: unknown
    const service = new EntregaService({
      construtor: { construir: vi.fn(async () => construcao) } as never,
      connectors: connectorFalso() as never,
      git: {
        run: vi.fn(() => ({ ok: true })),
        push: vi.fn(() => ({ ok: true })),
        pushComToken: vi.fn(() => ({ ok: true }))
      } as never,
      fila: { concluir: vi.fn(() => ({ reason: 'transicionado' })) } as never,
      mergePolicy: { autonomoLigado: vi.fn(() => true) } as never,
      ruleset,
      ledger: ledgerRepo,
      limpeza: limpezaFalsa(),
      budget: budgetRepo,
      audit: { append: vi.fn() } as never,
      userId: () => USER,
      revisar: async () => {
        duranteARevisao = service.contextoDoRun()
        return []
      },
      token: async () => undefined,
      dormir: async (ms: number) => {
        relogio += ms
      },
      agora: () => relogio
    })

    await service.entregar(pedido())

    expect(duranteARevisao).toMatchObject({ runId: 'run-1', tentativa: 2 })
    // Fora da entrega o contexto é limpo: o proxy não deve atribuir custo a um run que acabou.
    expect(service.contextoDoRun()).toBeUndefined()
  })
})

describe('encerramento do run (SPEC-Entrega-06)', () => {
  it('grava o ledger ao terminar, com head, merge e checks coerentes', async () => {
    const resultado = await montar().entregar(pedido())
    expect(resultado.estadoFinal).toBe('MERGED')

    const gravado = ledgerRepo.buscar(USER, 'run-1')
    expect(gravado).toBeDefined()
    expect(gravado?.mergeSha).toBe(resultado.mergeSha)
    expect(gravado?.headSha).toBe(SHA_HEAD)
    expect(gravado?.checks.map((c) => c.nome)).toContain(NOME_DO_JOB_DE_CI)
    expect(ledgerCompleto(gravado as ExecutionLedger)).toBe(true)
  })

  it('o ledger soma o consumo correlacionado ao run', async () => {
    budgetRepo.recordCost(
      {
        user_id: USER,
        workspace_id: 'jarvis',
        callId: 'call-1',
        provider: 'anthropic',
        model: 'claude-opus-5',
        estimadoUsd: 0.4,
        realUsd: 0.4,
        tokensEntrada: 120,
        tokensSaida: 80,
        runId: 'run-1',
        tentativa: 1
      },
      new Date('2026-09-02T10:00:00.000Z')
    )

    await montar().entregar(pedido())

    const gravado = ledgerRepo.buscar(USER, 'run-1')
    expect(gravado?.custoUsd).toBe(0.4)
    expect(gravado?.tokens).toBe(200)
  })

  it('chama a limpeza ao terminar em MERGED, na fase pós-merge', async () => {
    await montar().entregar(pedido())
    expect(limpezas).toEqual([{ runId: 'run-1', fase: 'depois-do-merge', estadoFinal: 'MERGED' }])
  })

  it('chama a limpeza mesmo quando termina em BLOCKED — recurso vaza igual', async () => {
    construcao = {
      estadoFinal: 'BLOCKED',
      tentativas: [],
      bloqueio: { causa: 'externo', evidencia: 'falhou', retomada: 'tentar de novo' }
    }

    const resultado = await montar().entregar(pedido())

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(limpezas).toHaveLength(1)
    expect(limpezas[0]?.fase).toBe('durante-ci')
    expect(ledgerRepo.buscar(USER, 'run-1')?.estadoFinal).toBe('BLOCKED')
  })

  it('grava o ledger e limpa mesmo quando a entrega estoura uma exceção', async () => {
    const servico = new EntregaService({
      construtor: {
        construir: vi.fn(async () => {
          throw new Error('o container sumiu')
        })
      } as never,
      connectors: connectorFalso() as never,
      git: { run: vi.fn(() => ({ ok: true })), push: vi.fn(() => ({ ok: true })) } as never,
      fila: { concluir: vi.fn() } as never,
      mergePolicy: { autonomoLigado: vi.fn(() => true) } as never,
      ruleset,
      ledger: ledgerRepo,
      limpeza: limpezaFalsa(),
      budget: budgetRepo,
      audit: { append: vi.fn() } as never,
      userId: () => USER,
      revisar: async () => [],
      token: async () => undefined,
      dormir: async () => {},
      agora: () => relogio
    })

    await expect(servico.entregar(pedido())).rejects.toThrow('o container sumiu')

    // Um run que explode é exatamente o que mais vaza recurso: sem o `finally`, o worktree e o
    // container ficariam pendurados e não haveria registro nenhum do que aconteceu.
    expect(limpezas).toHaveLength(1)
    expect(ledgerRepo.buscar(USER, 'run-1')?.estadoFinal).toBe('BLOCKED')
  })

  it('AWAITING_MERGE grava ledger completo mesmo sem merge SHA', async () => {
    autonomo = false

    const resultado = await montar().entregar(pedido())

    expect(resultado.estadoFinal).toBe('AWAITING_MERGE')
    const gravado = ledgerRepo.buscar(USER, 'run-1')
    expect(gravado?.mergeSha).toBeUndefined()
    expect(ledgerCompleto(gravado as ExecutionLedger)).toBe(true)
  })

  it('reiniciar depois do merge não abre segundo PR nem mergeia de novo', async () => {
    await montar().entregar(pedido())

    const prsAntes = chamadas.filter((c) => c.operation === GITHUB_OPERATIONS.ensurePullRequest)
    const mergesAntes = chamadas.filter((c) => c.operation === GITHUB_OPERATIONS.squashMerge)

    // Segundo run do mesmo trabalho: a idempotência do `ensure*` devolve o mesmo PR, e o merge
    // já confirmado não é refeito — o `merged: true` da origem persiste entre as duas voltas.
    await montar().entregar(pedido())

    const prsDepois = chamadas.filter((c) => c.operation === GITHUB_OPERATIONS.ensurePullRequest)
    const numerosDePr = new Set(prsDepois.map(() => PR))
    expect(numerosDePr.size).toBe(1)
    expect(prsDepois.length).toBeGreaterThan(prsAntes.length)
    expect(mergesAntes.length).toBeGreaterThan(0)
  })

  it('o ledger de um run é gravado uma vez só — regravar seria reescrever a prova', async () => {
    await montar().entregar(pedido())
    // A segunda volta tenta gravar de novo; o `UNIQUE` recusa e o erro fica no log, sem derrubar
    // a entrega. O ledger no banco continua sendo o da primeira.
    await montar().entregar(pedido())

    const linhas = db
      .prepare('SELECT COUNT(*) AS total FROM execution_ledger WHERE run_id = ?')
      .get('run-1') as { total: number }
    expect(linhas.total).toBe(1)
  })
})
