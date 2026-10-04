import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EntradaDoScanner } from '@shared/domain/isolamento'
import { recursoDaPorta, recursoDoContainer, recursoDoWorktree } from '@shared/domain/preflight'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { InventarioRepository } = await import('./inventario-repository')
const { ExecutionLedgerRepository } = await import('./execution-ledger-repository')
const { IsolamentoService } = await import('./isolamento-service')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const AGORA = 1_700_000_000_000
const CWD = '/raiz'
const REPO = '/repo'

/** O Docker de mentira: um mundo em memória que responde como o real, mas de forma controlável. */
class MundoDocker {
  containers = new Map<string, { runId?: string; portas: number[] }>()
  redes = new Map<string, { runId?: string }>()
  inspecoes = new Map<string, EntradaDoScanner | undefined>()
  caiu = false
  pararFalha = new Set<string>()
  redeFalha = new Set<string>()
  chamadas: string[] = []

  portasEmUso = (): ReadonlySet<number> | undefined =>
    this.caiu ? undefined : new Set([...this.containers.values()].flatMap((c) => c.portas))
  listarGeridos = (): { containers: unknown[]; redes: unknown[] } | undefined =>
    this.caiu
      ? undefined
      : {
          containers: [...this.containers].map(([nome, c]) => ({ nome, runId: c.runId })),
          redes: [...this.redes].map(([nome, r]) => ({ nome, runId: r.runId }))
        }
  inspecionarSandbox = (nome: string): EntradaDoScanner | undefined => this.inspecoes.get(nome)
  parar = (nome: string): boolean => {
    this.chamadas.push(`parar:${nome}`)
    if (this.pararFalha.has(nome)) return false
    this.containers.delete(nome)
    return true
  }
  removerRede = (nome: string): boolean => {
    this.chamadas.push(`rede-rm:${nome}`)
    if (this.redeFalha.has(nome)) return false
    this.redes.delete(nome)
    return true
  }
  containerExiste = (nome: string): boolean => this.containers.has(nome)
  redeDeEgressExiste = (nome: string): boolean => this.redes.has(nome)
}

let dir: string
let db: Db
let docker: MundoDocker
let leases: InstanceType<typeof LeaseRepository>
let inventario: InstanceType<typeof InventarioRepository>
let ledger: InstanceType<typeof ExecutionLedgerRepository>
let ativos: Set<string>
let worktrees: Set<string>
let gitChamadas: string[][]
let gitFalha: boolean
let diretoriosRemovidos: string[]
let hostOcupado: Set<number>

function montar(): InstanceType<typeof IsolamentoService> {
  return new IsolamentoService({
    docker: docker as never,
    git: {
      run: (args: readonly string[]) => {
        gitChamadas.push([...args])
        if (gitFalha) return { ok: false, saida: '' }
        if (args[0] === 'worktree' && args[1] === 'remove') worktrees.delete(String(args[2]))
        return { ok: true, saida: '' }
      }
    },
    inventario,
    leases,
    ledger,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    runAtivo: (runId) => ativos.has(runId),
    worktreeExiste: (caminho) => worktrees.has(caminho),
    descartarArtefatos: vi.fn(),
    removerDiretorio: (caminho) => {
      diretoriosRemovidos.push(caminho)
    },
    portaLivreNoHost: (porta) => !hostOcupado.has(porta),
    cwd: () => CWD,
    agora: () => AGORA
  })
}

let servico: ReturnType<typeof montar>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-isol-'))
  db = openDatabase(join(dir, 'app.db'))
  docker = new MundoDocker()
  leases = new LeaseRepository(db)
  inventario = new InventarioRepository(db)
  ledger = new ExecutionLedgerRepository(db)
  ativos = new Set()
  worktrees = new Set()
  gitChamadas = []
  gitFalha = false
  diretoriosRemovidos = []
  hostOcupado = new Set()
  servico = montar()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const identidade = (runId: string) => ({ runId, sliceId: 'F03', projectId: 'p', tentativa: 1 })

/** Cria os recursos de um run como o preflight cria: intenção, recurso real, confirmação. */
function criarRun(runId: string, opcoes: { portas?: number[] } = {}): void {
  const id = identidade(runId)
  const caminho = `/raiz/jarvisos-run-${runId}`
  worktrees.add(caminho)
  docker.containers.set(`jarvisos-run-${runId}`, { runId, portas: [] })
  docker.containers.set(`jarvisos-proxy-${runId}`, { runId, portas: [] })
  docker.redes.set(`jarvisos-egress-${runId}`, { runId })
  const itens: [Parameters<typeof servico.planejar>[1], string, Record<string, string>?][] = [
    ['worktree', caminho, { repositorio: REPO }],
    ['branch', `feat/f03-${runId}`],
    ['container', `jarvisos-run-${runId}`],
    ['sidecar', `jarvisos-proxy-${runId}`],
    ['rede', `jarvisos-egress-${runId}`],
    ['perfil', `/raiz/jarvisos-run-${runId}-perfil`]
  ]
  for (const [tipo, identificador, detalhes] of itens) {
    const r = servico.planejar(id, tipo, identificador, detalhes)
    servico.confirmar(r!.id)
  }
  leases.adquirir(
    USER,
    { proprietario: runId, recurso: recursoDoWorktree(runId), projectId: 'p' },
    AGORA
  )
  leases.adquirir(
    USER,
    { proprietario: runId, recurso: recursoDoContainer(runId), projectId: 'p' },
    AGORA
  )
  for (const porta of opcoes.portas ?? []) {
    expect(servico.reservarPorta(id, porta)).toEqual({ ok: true, porta })
  }
}

const estados = (runId: string): Record<string, string> =>
  Object.fromEntries(
    inventario.listarDoRun(USER, runId, true).map((r) => [`${r.tipo}:${r.identificador}`, r.estado])
  )

describe('planejar e confirmar', () => {
  it('o recurso nasce planejado e só vira criado quando confirmado', () => {
    const r = servico.planejar(identidade('a'), 'container', 'c-a')!

    expect(inventario.listarDoRun(USER, 'a')[0]?.estado).toBe('planejado')
    servico.confirmar(r.id)
    expect(inventario.listarDoRun(USER, 'a')[0]?.estado).toBe('criado')
  })

  it('grava as labels do run no inventário', () => {
    servico.planejar(identidade('a'), 'container', 'c-a')

    expect(inventario.listarDoRun(USER, 'a')[0]?.labels).toMatchObject({
      'jarvisos.run': 'a',
      'jarvisos.fatia': 'F03',
      'jarvisos.gerido': 'true'
    })
  })

  it('recusa o nome que outro run já tem: colisão de nome nunca é compartilhada', () => {
    servico.planejar(identidade('a'), 'container', 'mesmo-nome')

    expect(servico.planejar(identidade('b'), 'container', 'mesmo-nome')).toBeUndefined()
  })
})

describe('reservarPorta', () => {
  it('reserva a porta livre: lease do run e registro no inventário', () => {
    expect(servico.reservarPorta(identidade('a'), 20001)).toEqual({ ok: true, porta: 20001 })

    expect(leases.buscar(USER, recursoDaPorta(20001))?.proprietario).toBe('a')
    expect(inventario.buscar(USER, 'porta', '20001')?.estado).toBe('criado')
  })

  it('recusa a porta que outro run já reservou', () => {
    servico.reservarPorta(identidade('a'), 20001)

    const r = servico.reservarPorta(identidade('b'), 20001)

    expect(r.ok).toBe(false)
    expect(leases.buscar(USER, recursoDaPorta(20001))?.proprietario).toBe('a')
  })

  it('recusa a porta que um container ativo publica, sem deixar lease para trás', () => {
    docker.containers.set('de-fora', { portas: [20002] })

    const r = servico.reservarPorta(identidade('a'), 20002)

    expect(r.ok).toBe(false)
    expect(leases.buscar(USER, recursoDaPorta(20002))).toBeUndefined()
    expect(inventario.listarDoRun(USER, 'a')).toHaveLength(0)
  })

  it('recusa a porta que o processo do host já ocupa', () => {
    hostOcupado.add(20003)

    expect(servico.reservarPorta(identidade('a'), 20003).ok).toBe(false)
    expect(leases.buscar(USER, recursoDaPorta(20003))).toBeUndefined()
  })

  it('fail closed: com o Docker fora do ar não reserva nada', () => {
    docker.caiu = true

    const r = servico.reservarPorta(identidade('a'), 20004)

    expect(r.ok).toBe(false)
    expect(leases.buscar(USER, recursoDaPorta(20004))).toBeUndefined()
  })

  it('o mesmo run repetindo a reserva (retomada) continua dono', () => {
    servico.reservarPorta(identidade('a'), 20005)

    expect(servico.reservarPorta(identidade('a'), 20005)).toEqual({ ok: true, porta: 20005 })
  })
})

describe('alocarPorta', () => {
  it('dois runs simultâneos recebem portas distintas', () => {
    const a = servico.alocarPorta(identidade('a'))
    const b = servico.alocarPorta(identidade('b'))

    expect(a).toEqual({ ok: true, porta: 20000 })
    expect(b).toEqual({ ok: true, porta: 20001 })
  })

  it('pula a porta configurada por container e a ocupada no host', () => {
    docker.containers.set('x', { portas: [20000] })
    hostOcupado.add(20001)

    expect(servico.alocarPorta(identidade('a'))).toEqual({ ok: true, porta: 20002 })
  })

  it('pula a porta reservada por run cujo lease expirou: só a reconciliação a devolve', () => {
    servico.reservarPorta(identidade('a'), 20000)
    const depois = montarComRelogio(AGORA + 10 * 60_000)

    expect(depois.alocarPorta(identidade('b'))).toEqual({ ok: true, porta: 20001 })
  })

  it('devolve ok:false quando a faixa acabou', () => {
    const curto = new IsolamentoService({ ...depsDe(), faixa: { inicio: 20000, fim: 20000 } })
    curto.alocarPorta(identidade('a'))

    expect(curto.alocarPorta(identidade('b')).ok).toBe(false)
  })

  it('fail closed: Docker fora do ar não aloca', () => {
    docker.caiu = true

    expect(servico.alocarPorta(identidade('a')).ok).toBe(false)
  })
})

function depsDe(
  agora: () => number = () => AGORA
): ConstructorParameters<typeof IsolamentoService>[0] {
  return {
    docker: docker as never,
    git: { run: () => ({ ok: true, saida: '' }) },
    inventario,
    leases,
    ledger,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    runAtivo: (runId) => ativos.has(runId),
    worktreeExiste: (caminho) => worktrees.has(caminho),
    descartarArtefatos: vi.fn(),
    removerDiretorio: vi.fn(),
    portaLivreNoHost: (porta) => !hostOcupado.has(porta),
    cwd: () => CWD,
    agora
  }
}

function montarComRelogio(agora: number): InstanceType<typeof IsolamentoService> {
  return new IsolamentoService(depsDe(() => agora))
}

describe('escanear', () => {
  const limpo: EntradaDoScanner = {
    env: ['PATH=/usr/bin', 'ANTHROPIC_BASE_URL=http://172.20.0.2:8080'],
    montagens: [{ origem: '/raiz/c', destino: '/work', somenteLeitura: false }],
    comando: ['sleep', 'infinity'],
    arquivos: []
  }

  it('sandbox limpo: estado limpo, sem achado', () => {
    docker.inspecoes.set('c-a', limpo)

    expect(servico.escanear('c-a')).toEqual({ estado: 'limpo', achados: [] })
  })

  it('achado de credencial: estado achados, sem o valor, e auditado', () => {
    docker.inspecoes.set('c-a', { ...limpo, env: [...limpo.env, 'GITHUB_TOKEN=ghp_segredo123'] })

    const r = servico.escanear('c-a')

    expect(r.estado).toBe('achados')
    expect(JSON.stringify(r)).not.toContain('ghp_segredo123')
    const eventos = new AuditRepository(db, 'chave-de-teste').list(USER)
    expect(JSON.stringify(eventos)).toContain('scanner')
    expect(JSON.stringify(eventos)).not.toContain('ghp_segredo123')
  })

  it('não conseguir inspecionar é indeterminado, nunca limpo', () => {
    expect(servico.escanear('c-que-nao-inspeciona').estado).toBe('indeterminado')
  })
})

describe('liberarRun', () => {
  it('remove tudo o que o run criou, e deixa o inventário vazio', () => {
    criarRun('a', { portas: [20010] })

    const r = servico.liberarRun('a')

    expect(r.pendencias).toEqual([])
    expect(docker.containers.size).toBe(0)
    expect(docker.redes.size).toBe(0)
    expect(worktrees.size).toBe(0)
    expect(inventario.listarDoRun(USER, 'a')).toEqual([])
    expect(leases.listar(USER)).toEqual([])
    expect(diretoriosRemovidos).toEqual(['/raiz/jarvisos-run-a-perfil'])
  })

  it('remove o worktree sem --force: trabalho não registrado não se destrói', () => {
    criarRun('a')

    servico.liberarRun('a')

    const remove = gitChamadas.find((a) => a[0] === 'worktree' && a[1] === 'remove') ?? []
    expect(remove).toEqual(['worktree', 'remove', '/raiz/jarvisos-run-a'])
    expect(remove).not.toContain('--force')
  })

  it('a branch não é apagada: sai do inventário, mas o Git a preserva', () => {
    criarRun('a')

    servico.liberarRun('a')

    expect(gitChamadas.some((a) => a.includes('branch'))).toBe(false)
    expect(estados('a')['branch:feat/f03-a']).toBe('removido')
  })

  it('só toca nos recursos do run pedido: o outro continua inteiro', () => {
    criarRun('a', { portas: [20010] })
    criarRun('b', { portas: [20011] })

    servico.liberarRun('a')

    expect([...docker.containers.keys()].sort()).toEqual(['jarvisos-proxy-b', 'jarvisos-run-b'])
    expect([...docker.redes.keys()]).toEqual(['jarvisos-egress-b'])
    expect(worktrees.has('/raiz/jarvisos-run-b')).toBe(true)
    expect(leases.buscar(USER, recursoDaPorta(20011))?.proprietario).toBe('b')
    expect(inventario.listarDoRun(USER, 'b')).toHaveLength(7)
  })

  it('container que não para vira pendência e a porta continua reservada', () => {
    criarRun('a', { portas: [20010] })
    docker.pararFalha.add('jarvisos-run-a')

    const r = servico.liberarRun('a')

    expect(r.pendencias.map((p) => p.recurso)).toContain('container')
    expect(leases.buscar(USER, recursoDaPorta(20010))?.proprietario).toBe('a')
    expect(estados('a')['porta:20010']).toBe('criado')
    expect(ledger.listarPendencias(USER).some((p) => p.identificador === 'jarvisos-run-a')).toBe(
      true
    )
  })

  it('recurso com label de outro run não é tocado: vira pendência', () => {
    criarRun('a')
    docker.containers.set('jarvisos-run-a', { runId: 'intruso', portas: [] })

    const r = servico.liberarRun('a')

    expect(docker.containers.has('jarvisos-run-a')).toBe(true)
    expect(r.pendencias.some((p) => p.motivo.includes('intruso'))).toBe(true)
  })

  it('worktree que o Git recusa remover (sujo) vira pendência e o lease fica', () => {
    criarRun('a')
    gitFalha = true

    const r = servico.liberarRun('a')

    expect(r.pendencias.map((p) => p.recurso)).toContain('worktree')
    expect(leases.buscar(USER, recursoDoWorktree('a'))?.proprietario).toBe('a')
    expect(estados('a')['worktree:/raiz/jarvisos-run-a']).toBe('criado')
  })

  it('Docker fora do ar: nada do Docker é removido nem dado como removido', () => {
    criarRun('a')
    docker.caiu = true

    const r = servico.liberarRun('a')

    expect(r.pendencias.length).toBeGreaterThan(0)
    expect(estados('a')['container:jarvisos-run-a']).toBe('criado')
    expect(docker.chamadas).toEqual([])
  })

  it('ordem: sidecar e container param antes da rede sair', () => {
    criarRun('a')

    servico.liberarRun('a')

    const ordem = docker.chamadas
    expect(ordem.indexOf('rede-rm:jarvisos-egress-a')).toBeGreaterThan(
      ordem.indexOf('parar:jarvisos-run-a')
    )
    expect(ordem.indexOf('rede-rm:jarvisos-egress-a')).toBeGreaterThan(
      ordem.indexOf('parar:jarvisos-proxy-a')
    )
  })

  it('recurso planejado que nunca chegou a existir é dado como removido, sem comando', () => {
    servico.planejar(identidade('a'), 'container', 'jarvisos-run-a')

    const r = servico.liberarRun('a')

    expect(r.pendencias).toEqual([])
    expect(docker.chamadas).toEqual([])
    expect(inventario.listarDoRun(USER, 'a')).toEqual([])
  })

  it('é idempotente: a segunda chamada não encontra nada a fazer', () => {
    criarRun('a')
    servico.liberarRun('a')
    docker.chamadas.length = 0

    expect(servico.liberarRun('a')).toEqual({ removidos: [], pendencias: [] })
    expect(docker.chamadas).toEqual([])
  })
})

describe('reconciliar (crash)', () => {
  it('limpa o run morto e não afeta o run que continua ativo', async () => {
    criarRun('morto', { portas: [20010] })
    criarRun('vivo', { portas: [20011] })
    ativos.add('vivo')

    const achados = await servico.reconciliar()

    expect(achados.find((a) => a.recurso === 'run:morto')?.decisao).toBe('liberado')
    expect(achados.find((a) => a.recurso === 'run:vivo')?.decisao).toBe('bloqueado')
    expect(inventario.listarDoRun(USER, 'morto')).toEqual([])
    expect(inventario.listarDoRun(USER, 'vivo')).toHaveLength(7)
    expect(docker.containers.has('jarvisos-run-vivo')).toBe(true)
    expect(docker.containers.has('jarvisos-run-morto')).toBe(false)
  })

  it('crash durante a criação: achado planejado cujo container nem subiu é limpo sem erro', async () => {
    servico.planejar(identidade('a'), 'worktree', '/raiz/jarvisos-run-a', { repositorio: REPO })
    servico.planejar(identidade('a'), 'rede', 'jarvisos-egress-a')
    docker.redes.set('jarvisos-egress-a', { runId: 'a' })

    await servico.reconciliar()

    expect(docker.redes.size).toBe(0)
    expect(inventario.listarAtivos(USER)).toEqual([])
  })

  it('crash durante a limpeza: o que sobrou de uma limpeza pela metade é concluído', async () => {
    criarRun('a')
    docker.containers.delete('jarvisos-run-a')
    docker.containers.delete('jarvisos-proxy-a')

    await servico.reconciliar()

    expect(docker.redes.size).toBe(0)
    expect(inventario.listarAtivos(USER)).toEqual([])
  })

  it('recurso gerido no Docker sem registro no inventário é reportado, não destruído', async () => {
    docker.containers.set('jarvisos-run-orfao', { runId: 'desconhecido', portas: [] })
    docker.redes.set('jarvisos-egress-orfa', { runId: undefined })

    const achados = await servico.reconciliar()

    expect(docker.containers.has('jarvisos-run-orfao')).toBe(true)
    expect(docker.redes.has('jarvisos-egress-orfa')).toBe(true)
    expect(achados.filter((a) => a.decisao === 'bloqueado').map((a) => a.recurso)).toEqual(
      expect.arrayContaining(['container:jarvisos-run-orfao', 'rede:jarvisos-egress-orfa'])
    )
    expect(ledger.listarPendencias(USER).map((p) => p.identificador)).toEqual(
      expect.arrayContaining(['jarvisos-run-orfao', 'jarvisos-egress-orfa'])
    )
  })

  it('o órfão não gera uma pendência nova a cada boot', async () => {
    docker.containers.set('jarvisos-run-orfao', { runId: 'x', portas: [] })

    await servico.reconciliar()
    await servico.reconciliar()

    expect(
      ledger.listarPendencias(USER).filter((p) => p.identificador === 'jarvisos-run-orfao')
    ).toHaveLength(1)
  })

  it('fail closed: se o Docker não lista, nada é removido e o achado diz por quê', async () => {
    criarRun('morto')
    docker.caiu = true

    const achados = await servico.reconciliar()

    expect(achados.some((a) => a.decisao === 'bloqueado')).toBe(true)
    expect(inventario.listarDoRun(USER, 'morto').length).toBeGreaterThan(0)
  })

  it('inventário antes e depois: sem órfãos em nenhum dos dois lados', async () => {
    criarRun('a', { portas: [20010] })
    criarRun('b', { portas: [20011] })
    const antes = inventario.listarAtivos(USER).length

    await servico.reconciliar()

    expect(antes).toBe(14)
    expect(inventario.listarAtivos(USER)).toEqual([])
    expect(docker.containers.size).toBe(0)
    expect(docker.redes.size).toBe(0)
    expect(worktrees.size).toBe(0)
    expect(leases.listar(USER)).toEqual([])
  })
})
