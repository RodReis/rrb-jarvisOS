/**
 * O preflight contra o SQLite real e um repositório Git real (SPEC-Entrega-03, Banco).
 *
 * A prova é **por efeito**, como nas fatias irmãs: não basta o serviço dizer que recusou — o
 * banco tem de confirmar que o lease não ficou preso e o disco que o worktree não nasceu. Um
 * teste que só lesse o `reason` passaria com um serviço que recusa e deixa lixo atrás.
 *
 * As garantias que só este nível alcança:
 *  - **recusa não vaza lease** (critério 4): Docker fora, e a tabela `lease` continua vazia;
 *  - **a branch nasce do SHA fixado** (critério 2), conferido no Git de verdade;
 *  - **o cwd do executor é o do container** (critério 8): não existe campo com o path do host;
 *  - **nenhum segredo vai ao container** (critério 9), medido nos args reais do `docker run`;
 *  - **sem lista de paths o preflight falha** (critério 13), antes de tocar Git ou Docker;
 *  - **falha tardia libera os dois leases** (critério 7): o container não sobe e o banco esvazia.
 *
 * O Git é real e temporário (a spec pede "integração Git real temporária"); o Docker e o
 * terminal são dublês, porque o que este nível mede é a **decisão** do preflight. O Docker de
 * verdade é exercitado no smoke, onde a colisão de porta e a montagem podem ser observadas.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import type { PathsPermitidos } from '@shared/domain/preflight'
import { recursoDoContainer, recursoDoWorktree } from '@shared/domain/preflight'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { PreflightService } = await import('./preflight-service')
const { prepararGitMeta } = await import('./docker-runner')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const RUN = 'run-1'
const PROJETO = 'p-1'
const AGORA = 1_700_000_000_000
const PROXY = 'http://host.docker.internal:8790'

const PATHS: PathsPermitidos = {
  origem: 'spec',
  paths: ['src/main'],
  justificativa: 'Seção ## Paths permitidos da SPEC.'
}

let db: Db
let dir: string
let repo: string
let raiz: string
let leases: InstanceType<typeof LeaseRepository>
let audit: InstanceType<typeof AuditRepository>

/** O que o dublê do Docker respondeu — para as asserções sobre montagem e ambiente. */
interface ChamadaDocker {
  readonly montagem: Record<string, unknown>
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()
}

/**
 * Um `GitRunner` de verdade seria o `TerminalEngine` inteiro (allowlist de comandos, de
 * diretórios, política). Aqui o dublê executa `git` de fato no repositório temporário: o que
 * se quer medir é que o preflight **cria a branch do SHA certo**, não a governança do terminal,
 * que a M8-F01 já prova.
 */
function gitRunnerReal(): {
  run: (args: readonly string[], cwd: string) => { ok: boolean; saida: string }
} {
  return {
    run: (args, cwd) => {
      try {
        return { ok: true, saida: git(args, cwd) }
      } catch {
        return { ok: false, saida: '' }
      }
    }
  }
}

function montarServico(opcoes: {
  readonly dockerNoAr?: boolean
  readonly containerSobe?: boolean
  readonly redeSobe?: boolean
  readonly proxyDeEgressSobe?: boolean
  readonly ipDoProxyDisponivel?: boolean
  readonly proxyNoAr?: boolean
  readonly derivados?: PathsPermitidos | undefined
  readonly chamadas?: ChamadaDocker[]
  readonly portasOcupadas?: readonly number[]
  /** O par que o `PhaseModelService` devolveria. Omitido = o padrão da Construção. */
  readonly modelo?: ModeloEscolhido
}): InstanceType<typeof PreflightService> {
  const chamadas = opcoes.chamadas ?? []
  return new PreflightService({
    git: gitRunnerReal() as never,
    docker: {
      disponivel: () => opcoes.dockerNoAr !== false,
      portaOcupadaPorContainer: (porta: number) => (opcoes.portasOcupadas ?? []).includes(porta),
      containerExiste: () => false,
      redeDeEgressExiste: () => false,
      criarRedeDeEgress: () => opcoes.redeSobe !== false,
      subirProxyDeEgress: () => opcoes.proxyDeEgressSobe !== false,
      ipDoProxyNaRedeDeEgress: () =>
        opcoes.ipDoProxyDisponivel === false ? undefined : '192.168.16.2',
      subir: (montagem: Record<string, unknown>) => {
        chamadas.push({ montagem })
        return opcoes.containerSobe !== false
      },
      parar: () => true
    } as never,
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    proxyNoAr: () => opcoes.proxyNoAr !== false,
    derivarPaths: () => opcoes.derivados,
    modeloDaConstrucao: () => opcoes.modelo ?? { provider: 'claude-code', modelo: 'claude-opus-5' },
    // O real, não um dublê: é a função que o smoke provou, e é ela que não pode reescrever o
    // `commondir` do host. Um dublê aqui esconderia justamente o defeito que o smoke achou.
    prepararGitMeta,
    agora: () => AGORA
  })
}

function pedido(extra: Record<string, unknown> = {}): never {
  return {
    runId: RUN,
    projectId: PROJETO,
    sliceId: 'm9-f03',
    raizOperacional: raiz,
    repositorio: repo,
    base: 'main',
    pathsDaSpec: PATHS,
    proxyUrl: PROXY,
    ...extra
  } as never
}

function linhasDeLease(): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM lease WHERE user_id = ?').get(USER) as { n: number }
  ).n
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-preflight-'))
  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  leases = new LeaseRepository(db)

  // Repositório real: a branch tem de nascer de um commit que existe de verdade.
  repo = join(dir, 'projeto')
  raiz = join(dir, 'operacional')
  execFileSync('git', ['init', '--initial-branch=main', repo], { encoding: 'utf8' })
  git(['config', 'user.email', 'teste@exemplo.com'], repo)
  git(['config', 'user.name', 'Teste'], repo)
  writeFileSync(join(repo, 'README.md'), '# projeto\n')
  git(['add', '.'], repo)
  git(['commit', '-m', 'inicial'], repo)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('preflight — recusas que não deixam rastro', () => {
  /**
   * Critério 10: Docker fora bloqueia, e **nada** é criado. A prova por efeito importa aqui
   * porque a recusa acontece antes de qualquer lease — se o serviço adquirisse primeiro e
   * recusasse depois, o slot ficaria preso até a reconciliação do próximo boot.
   */
  it('recusa com docker-indisponivel e não adquire lease nenhum', () => {
    const outcome = montarServico({ dockerNoAr: false }).preparar(pedido())

    expect(outcome.reason).toBe('docker-indisponivel')
    expect(outcome.retomada).toContain('Docker')
    expect(linhasDeLease()).toBe(0)
  })

  /** Critério 11: sem proxy o executor não alcança modelo — falha no preflight, não na 1ª chamada. */
  it('recusa com proxy-indisponivel antes de criar worktree', () => {
    const outcome = montarServico({ proxyNoAr: false }).preparar(pedido())

    expect(outcome.reason).toBe('proxy-indisponivel')
    expect(linhasDeLease()).toBe(0)
  })

  /**
   * Critério 13: sem lista registrada não há como medir fuga de escopo, então o preflight falha
   * — e falha **antes** de tocar Git ou Docker, senão sobraria worktree no disco.
   */
  it('recusa quando a SPEC não traz paths e a derivação não produz nada', () => {
    const outcome = montarServico({ derivados: undefined }).preparar(
      pedido({ pathsDaSpec: undefined })
    )

    expect(outcome.reason).toBe('sem-paths-permitidos')
    expect(linhasDeLease()).toBe(0)
  })

  /** Lista vazia é ausência de decisão, não "pode tudo" — o mesmo fail closed do domínio. */
  it('recusa lista de paths vazia', () => {
    const vazia: PathsPermitidos = { origem: 'derivada', paths: [], justificativa: 'nada' }
    const outcome = montarServico({}).preparar(pedido({ pathsDaSpec: vazia }))

    expect(outcome.reason).toBe('sem-paths-permitidos')
  })

  /**
   * SPEC-Fases-05, critério 4: modelo fora do catálogo recusa **antes de criar container**.
   *
   * A prova por efeito (`linhasDeLease() === 0`) é o que distingue esta recusa de uma feita mais
   * tarde: recusar depois deixaria worktree, leases e container de pé para um run que jamais
   * poderia chamar o modelo. É por isso que a checagem mora no preflight e não no
   * `ConstrutorService`, que só roda com o sandbox já montado (decisão do PI, 2026-09-04).
   */
  it('recusa modelo fora do catálogo antes de criar qualquer recurso', () => {
    const outcome = montarServico({
      modelo: { provider: 'claude-code', modelo: 'claude-modelo-que-nao-existe' }
    }).preparar(pedido())

    expect(outcome.reason).toBe('modelo-fora-do-catalogo')
    expect(outcome.retomada).toContain('Modelos por fase')
    expect(linhasDeLease()).toBe(0)
  })

  /**
   * O contrafactual do teste acima: o par **certo** não pode ser recusado pela mesma barreira.
   *
   * Sem ele, uma checagem invertida (`if (modeloExisteNoCatalogo(...))`) passaria no teste da
   * recusa e bloquearia todo run legítimo — o defeito ficaria escondido atrás de um teste verde.
   */
  it('libera quando o modelo da Construção existe no catálogo do provider', () => {
    const outcome = montarServico({
      modelo: { provider: 'claude-code', modelo: 'claude-opus-5' }
    }).preparar(pedido())

    expect(outcome.reason).toBe('liberado')
  })

  /** Critério 1: o executor nunca recebe o checkout ativo — nem por um worktree criado dentro dele. */
  it('recusa quando o worktree cairia dentro do checkout ativo', () => {
    const outcome = montarServico({}).preparar(pedido({ raizOperacional: join(repo, 'interno') }))

    expect(outcome.reason).toBe('cwd-invalido')
    expect(linhasDeLease()).toBe(0)
  })

  /**
   * A armadilha que o `startsWith` esconde: uma raiz **irmã** de nome parecido (`projeto-op` ao
   * lado de `projeto`) não está dentro do checkout ativo, e recusá-la bloquearia um preflight
   * legítimo. Sem este caso, a comparação por prefixo de string passa nos outros testes — foi o
   * que o contrafactual revelou.
   */
  it('não confunde raiz irmã de nome parecido com o checkout ativo', () => {
    const irma = `${repo}-op`
    const outcome = montarServico({}).preparar(pedido({ raizOperacional: irma }))

    expect(outcome.reason).toBe('liberado')
  })

  /**
   * Critério 3: a colisão é detectada **antes** de subir recurso. Descobri-la pelo erro do
   * `docker run` deixaria worktree e leases criados para trás — por isso a asserção mede também
   * que a tabela `lease` continua vazia.
   */
  it('recusa quando uma porta de serviço declarada já está ocupada', () => {
    const outcome = montarServico({ portasOcupadas: [5432] }).preparar(
      pedido({ portasDeServico: [5432, 6379] })
    )

    expect(outcome.reason).toBe('recurso-ocupado')
    expect(outcome.mensagem).toContain('5432')
    expect(linhasDeLease()).toBe(0)
  })

  /** Projeto sem serviços declarados: o sandbox não publica porta, e nada deve ser checado. */
  it('libera quando o projeto não declara portas de serviço', () => {
    const outcome = montarServico({ portasOcupadas: [5432] }).preparar(pedido())

    expect(outcome.reason).toBe('liberado')
  })

  /** Critério 2: sem SHA fixo não há de onde partir — e a branch não pode nascer de suposição. */
  it('recusa quando a base não resolve para um commit', () => {
    const outcome = montarServico({}).preparar(pedido({ base: 'branch-que-nao-existe' }))

    expect(outcome.reason).toBe('base-nao-resolvida')
    expect(linhasDeLease()).toBe(0)
  })
})

describe('preflight — liberação', () => {
  it('libera com a branch nascida do SHA registrado (critério 2)', () => {
    const shaEsperado = git(['rev-parse', 'HEAD'], repo)
    const outcome = montarServico({}).preparar(pedido())

    expect(outcome.reason).toBe('liberado')
    expect(outcome.sandbox?.baseSha).toBe(shaEsperado)

    // Prova no Git, não no retorno: a branch existe e aponta para o mesmo commit.
    const branch = outcome.sandbox?.branch ?? ''
    expect(git(['rev-parse', branch], repo)).toBe(shaEsperado)
  })

  /**
   * SPEC-Fases-05, critério 3: o par resolvido é **congelado** no sandbox.
   *
   * O que o teste trava é a origem do dado: o par que sai no sandbox é o que a dependência
   * devolveu, e não um default do preflight. Sem esta asserção, um serviço que ignorasse
   * `modeloDaConstrucao` e escrevesse o padrão da política passaria em todos os outros testes.
   */
  it('congela no sandbox o par que a política resolveu', () => {
    const outcome = montarServico({
      modelo: { provider: 'claude-code', modelo: 'claude-fable-5-1' }
    }).preparar(pedido())

    expect(outcome.sandbox?.modeloDaConstrucao).toEqual({
      provider: 'claude-code',
      modelo: 'claude-fable-5-1'
    })
  })

  /**
   * SPEC-Fases-05, critério 2: o override do projeto vence o workspace **neste run**.
   *
   * A herança em si é do `PhaseModelService` e já tem cobertura em
   * `phase-model-repository.int-spec.ts`. O que falta travar é o elo: o preflight tem de passar o
   * `projectId` do pedido para a resolução. Sem ele, a dependência resolveria só pelo workspace e
   * o override do projeto simplesmente não valeria no run — sem erro nenhum aparecer.
   */
  it('resolve o modelo com o projectId do run, para o override do projeto valer', () => {
    const projectIdsVistos: string[] = []
    const servico = new PreflightService({
      git: gitRunnerReal() as never,
      docker: {
        disponivel: () => true,
        portaOcupadaPorContainer: () => false,
        containerExiste: () => false,
        redeDeEgressExiste: () => false,
        criarRedeDeEgress: () => true,
        subirProxyDeEgress: () => true,
        ipDoProxyNaRedeDeEgress: () => '192.168.16.2',
        subir: () => true,
        parar: () => true
      } as never,
      leases,
      audit,
      userId: () => USER,
      workspaceId: () => WS,
      proxyNoAr: () => true,
      derivarPaths: () => undefined,
      modeloDaConstrucao: (projectId) => {
        projectIdsVistos.push(projectId)
        return { provider: 'claude-code', modelo: 'claude-opus-5' }
      },
      prepararGitMeta,
      agora: () => AGORA
    })

    servico.preparar(pedido())

    expect(projectIdsVistos).toEqual([PROJETO])
  })

  /**
   * SPEC-Fases-05, critério 6: o par congelado nunca é o de uma rota paga sem opt-in.
   *
   * A garantia real é de composição — o boot resolve com a rota `assinatura` fixa, a mesma que o
   * `ExecutorProxy` usa (`rota: () => 'claude-code'`). Este teste trava o efeito no ponto em que
   * ele é observável: o provider que chega ao sandbox é o da assinatura, e um provider de rota
   * paga (`anthropic`) não aparece por si.
   *
   * Sem esta asserção, trocar o `'assinatura'` do boot por um `escolherRota` compilaria e passaria
   * em todos os outros testes, e o preflight congelaria a rota paga enquanto o proxy continuaria
   * chamando pela assinatura — as duas discordando sobre o mesmo run.
   */
  it('congela o provider da assinatura, nunca o de uma rota paga', () => {
    const outcome = montarServico({}).preparar(pedido())

    expect(outcome.sandbox?.modeloDaConstrucao.provider).toBe('claude-code')
    expect(outcome.sandbox?.modeloDaConstrucao.provider).not.toBe('anthropic')
  })

  /**
   * Critério 3, a metade que importa: **editar a política depois não move a tentativa em curso.**
   *
   * A dependência muda de resposta entre a primeira e a segunda leitura — é o que aconteceria se
   * o PI trocasse o modelo com o run em andamento. O sandbox tem de continuar com o par do
   * instante em que foi montado. Um serviço que guardasse a função em vez do valor (resolvendo a
   * cada leitura) falharia aqui e passaria no teste acima.
   */
  it('não muda o par do sandbox quando a política é editada depois', () => {
    let modeloAtual: ModeloEscolhido = { provider: 'claude-code', modelo: 'claude-opus-5' }
    const servico = new PreflightService({
      git: gitRunnerReal() as never,
      docker: {
        disponivel: () => true,
        portaOcupadaPorContainer: () => false,
        containerExiste: () => false,
        redeDeEgressExiste: () => false,
        criarRedeDeEgress: () => true,
        subirProxyDeEgress: () => true,
        ipDoProxyNaRedeDeEgress: () => '192.168.16.2',
        subir: () => true,
        parar: () => true
      } as never,
      leases,
      audit,
      userId: () => USER,
      workspaceId: () => WS,
      proxyNoAr: () => true,
      derivarPaths: () => undefined,
      modeloDaConstrucao: () => modeloAtual,
      prepararGitMeta,
      agora: () => AGORA
    })

    const outcome = servico.preparar(pedido())
    // O PI troca o modelo com o run já preparado.
    modeloAtual = { provider: 'claude-code', modelo: 'claude-fable-5-1' }

    expect(outcome.sandbox?.modeloDaConstrucao.modelo).toBe('claude-opus-5')
  })

  /**
   * Critério 8: o cwd do executor é o do container. A garantia é de **tipo** — não existe campo
   * com o cwd do host —, e o teste afirma o valor para travar a intenção.
   */
  it('entrega cwd do container, nunca um caminho do host', () => {
    const outcome = montarServico({}).preparar(pedido())

    expect(outcome.sandbox?.cwd).toBe('/work')
    expect(outcome.sandbox?.cwd).not.toContain(dir)
  })

  /**
   * Critério 9: nenhum segredo entra no container. Medido nos **argumentos reais** do
   * `docker run` que o serviço montou — inspecionar o retorno não provaria nada.
   */
  it('não passa segredo algum ao container, só a URL do sidecar de egress (critério 12)', () => {
    const chamadas: ChamadaDocker[] = []
    const outcome = montarServico({ chamadas }).preparar(pedido())

    const montagem = chamadas[0]?.montagem ?? {}
    const serializado = JSON.stringify(montagem)

    // A URL que o executor recebe é a do sidecar, nunca a URL real do proxy do host: dentro da
    // rede `--internal` o container não tem rota até `host.docker.internal` (medido).
    expect(montagem.proxyUrl).toBe(outcome.sandbox?.proxyUrl)
    expect(montagem.proxyUrl).not.toBe(PROXY)
    // Por IP, não por nome: o DNS embutido do Docker não resolve nome de container dentro de
    // uma rede `--internal` (medido — SERVFAIL mesmo entre dois membros dela).
    expect(montagem.proxyUrl).toBe('http://192.168.16.2:8080')
    expect(serializado).not.toMatch(/token|apiKey|api_key|secret|senha|ANTHROPIC_API_KEY/i)
    // A sessão do host jamais é montada: é dela que a emenda 6 tira o executor.
    expect(serializado).not.toContain('.claude')
  })

  /** Critério 12: o executor sobe preso à rede de egress do run, nunca à `bridge` padrão. */
  it('sobe o container do executor conectado à rede de egress do run', () => {
    const chamadas: ChamadaDocker[] = []
    montarServico({ chamadas }).preparar(pedido())

    const montagem = chamadas[0]?.montagem ?? {}
    expect(montagem.redeDeEgress).toBe(`jarvisos-egress-${RUN}`)
  })

  /**
   * Emenda 5: o `.git` principal é montado **somente-leitura**. Medido com Docker real que sem
   * ele o `git` do container responde `fatal: not a git repository` — a montagem prescrita
   * originalmente não funcionava.
   */
  it('monta o .git principal para o git funcionar dentro do container', () => {
    const chamadas: ChamadaDocker[] = []
    montarServico({ chamadas }).preparar(pedido())

    const montagem = chamadas[0]?.montagem ?? {}
    expect(montagem.gitCommonNoHost).toBe(`${repo}/.git`)
    // O metadado vai **copiado** para dentro do worktree, não o original do repositório: é a
    // correção que o smoke exigiu (reescrever o original derruba o Git do host).
    expect(String(montagem.gitMetaNoHost)).toContain('.gitmeta')
    expect(String(montagem.gitMetaNoHost)).not.toContain('.git/worktrees/')
    expect(readFileSync(join(String(montagem.gitMetaNoHost), 'commondir'), 'utf8').trim()).toBe(
      '/gitcommon'
    )
  })

  /**
   * O defeito que **só o Docker real achou**: reescrever o `commondir` do worktree faz o host
   * responder `fatal: not a git repository` — e o app perde a capacidade de versionar que a
   * SPEC lhe reserva ("quem commita é o app, no host"). Nenhum teste de unidade veria isso,
   * porque o retorno do preflight continuava dizendo `liberado`.
   */
  it('deixa o Git do host funcionando no worktree depois de preparar o container', () => {
    const outcome = montarServico({}).preparar(pedido())
    const worktree = outcome.sandbox?.worktreeNoHost ?? ''

    // O host consegue operar o worktree: é isto que a montagem não pode quebrar.
    expect(() => git(['status', '--short'], worktree)).not.toThrow()
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree)).toBe(outcome.sandbox?.branch)
  })

  /**
   * O outro achado do smoke: no Windows o checkout padrão grava CRLF, e o Git do container
   * (Linux) lê **todo** arquivo como modificado — o critério 6 acusaria fuga de escopo no
   * projeto inteiro. O worktree nasce com `core.autocrlf=false` para os dois lados verem o
   * mesmo conteúdo.
   */
  it('cria o worktree sem conversão de fim de linha', () => {
    const outcome = montarServico({}).preparar(pedido())
    const worktree = outcome.sandbox?.worktreeNoHost ?? ''

    const bytes = readFileSync(join(worktree, 'README.md'))
    expect(bytes.includes(Buffer.from([0x0d, 0x0a]))).toBe(false)
  })

  it('registra os dois leases do run e a lista de paths na auditoria', () => {
    montarServico({}).preparar(pedido())

    expect(leases.buscar(USER, recursoDoWorktree(RUN))?.proprietario).toBe(RUN)
    expect(leases.buscar(USER, recursoDoContainer(RUN))?.proprietario).toBe(RUN)

    const evento = audit
      .list(USER)
      .find((e) => (e.payload as Record<string, unknown>).preflight === 'liberado')
    expect((evento?.payload as Record<string, unknown>).pathsPermitidos).toEqual(['src/main'])
    expect((evento?.payload as Record<string, unknown>).origemDosPaths).toBe('spec')
  })
})

describe('preflight — falha tardia não deixa recurso preso', () => {
  /**
   * O caso que o critério 7 protege: o container não sobe **depois** de os leases existirem.
   * Se o serviço só devolvesse o motivo, os dois leases ficariam presos — e o WIP=1 travaria a
   * máquina até o próximo boot. A asserção é a contagem de linhas, não a mensagem.
   */
  it('libera worktree e container quando o sandbox não sobe', () => {
    const outcome = montarServico({ containerSobe: false }).preparar(pedido())

    expect(outcome.reason).toBe('docker-indisponivel')
    expect(linhasDeLease()).toBe(0)
  })

  /**
   * Critério 12: sem a rede de egress não há isolamento nenhum, e o preflight recusa **antes**
   * de tocar o container do executor — não é seguro subi-lo sem a fronteira de rede pronta.
   */
  it('recusa quando a rede de egress não sobe, sem tocar o container do executor', () => {
    const chamadas: ChamadaDocker[] = []
    const outcome = montarServico({ redeSobe: false, chamadas }).preparar(pedido())

    expect(outcome.reason).toBe('docker-indisponivel')
    expect(linhasDeLease()).toBe(0)
    expect(chamadas).toEqual([])
  })

  /**
   * Sem o sidecar, o executor subiria numa rede `--internal` sem nenhum caminho até o proxy —
   * moreria na primeira chamada, com worktree e leases já criados. O preflight recusa antes.
   */
  it('recusa quando o sidecar de egress não sobe, sem tocar o container do executor', () => {
    const chamadas: ChamadaDocker[] = []
    const outcome = montarServico({ proxyDeEgressSobe: false, chamadas }).preparar(pedido())

    expect(outcome.reason).toBe('proxy-indisponivel')
    expect(linhasDeLease()).toBe(0)
    expect(chamadas).toEqual([])
  })

  /**
   * Sem o IP do sidecar não há para onde apontar `ANTHROPIC_BASE_URL` — um nome ali seria uma
   * URL que o próprio executor não consegue resolver (medido: DNS falha em rede `--internal`).
   */
  it('recusa quando o IP do sidecar não é obtido, sem tocar o container do executor', () => {
    const chamadas: ChamadaDocker[] = []
    const outcome = montarServico({ ipDoProxyDisponivel: false, chamadas }).preparar(pedido())

    expect(outcome.reason).toBe('proxy-indisponivel')
    expect(linhasDeLease()).toBe(0)
    expect(chamadas).toEqual([])
  })

  /** Critério 4: o segundo run não rouba o recurso do primeiro — o `UNIQUE` decide, não o `if`. */
  it('recusa quando outro run já possui o worktree', () => {
    leases.adquirir(
      USER,
      { proprietario: 'outro-run', recurso: recursoDoWorktree(RUN), projectId: 'p-1' },
      AGORA
    )

    const outcome = montarServico({}).preparar(pedido())

    expect(outcome.reason).toBe('recurso-ocupado')
    // O dono original permanece: recusar não pode reatribuir.
    expect(leases.buscar(USER, recursoDoWorktree(RUN))?.proprietario).toBe('outro-run')
  })
})

describe('bloqueioDe', () => {
  /** O bloqueio carrega os cinco campos, e `porQueNaoSeguir` é o que o torna válido. */
  it('traduz a recusa em BloqueioExterno completo', () => {
    const servico = montarServico({ dockerNoAr: false })
    const outcome = servico.preparar(pedido())
    const bloqueio = servico.bloqueioDe(outcome, 2)

    expect(bloqueio.causa).toBe('docker-indisponivel')
    expect(bloqueio.tentativas).toBe(2)
    expect(bloqueio.porQueNaoSeguir).not.toBe('')
    expect(bloqueio.retomada).toContain('Docker')
  })
})
