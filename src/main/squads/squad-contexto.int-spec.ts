/**
 * O contexto de uma tarefa do Squad (SPEC-Squads-03, critério 3), de ponta a ponta: Git real,
 * `TerminalEngine` real, `ContextService` e SQLite reais.
 *
 * O que se prova é por efeito: o texto que entra vem **da revisão**, não do disco; cada item do
 * pack tem o hash do texto exato que o prompt carrega; e o que a tarefa pediu e a revisão não
 * tem aparece como descartado, com o motivo, em vez de sumir.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const { ProjectRepository } = await import('../projects/project-repository')
const { ContextRepository } = await import('../context/context-repository')
const { ContextService } = await import('../context/context-service')
const { SquadGit } = await import('./squad-git')
const { ContextoDaTarefa, MAX_FONTES_DA_TAREFA, rotuloDaTarefa } = await import('./squad-contexto')

const USER = 'u-1'
const PROJETO = 'p-1'

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
let sha: string
let montador: InstanceType<typeof ContextoDaTarefa>
let squadGit: InstanceType<typeof SquadGit>

const git = (args: string[], cwd = repo): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const hash = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex')

/** Commita arquivos no repositório e devolve o SHA. */
function commitar(arquivos: Record<string, string | Buffer>): string {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(repo, caminho, '..'), { recursive: true })
    writeFileSync(join(repo, caminho), conteudo)
  }
  git(['add', '-A'])
  git(['commit', '-m', 'arquivos'])
  return git(['rev-parse', 'HEAD'])
}

function pedido(
  entradas: readonly string[],
  extra: Partial<Parameters<InstanceType<typeof ContextoDaTarefa>['montar']>[0]> = {}
): Parameters<InstanceType<typeof ContextoDaTarefa>['montar']>[0] {
  return {
    projectId: PROJETO,
    workspaceId: 'jarvis',
    repositorio: repo,
    revisao: sha,
    runId: 'run-1',
    tarefa: { id: 't1', entradas: [...entradas] },
    rota: 'anthropic',
    ...extra
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-ctx-'))
  appDir = join(dir, 'userData')
  repo = join(appDir, 'projeto')
  mkdirSync(repo, { recursive: true })
  db = openDatabase(join(dir, 'app.db'))

  const audit = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(audit, () => USER)
  const comandos = new CommandAllowlistRepository(db, audit, policy)
  comandos.remove(USER, 'jarvis', 'git')
  comandos.add(USER, 'jarvis', 'git')
  const runner = new GitRunner(
    new TerminalEngine(
      policy,
      comandos,
      new AllowlistRepository(db, audit, appDir),
      new ExecutionRepository(db),
      new ApprovalRepository(db),
      audit,
      () => USER
    )
  )
  squadGit = new SquadGit({ git: runner, workspaceId: () => 'jarvis' })

  new ProjectRepository(db).save({
    id: PROJETO,
    user_id: USER,
    workspace_id: 'jarvis',
    nome: 'Projeto de teste',
    slug: 'projeto-de-teste',
    diretorio: repo,
    origem: 'criado',
    gitPreexistente: false,
    created_at: new Date().toISOString()
  })
  const contexto = new ContextService({
    repository: new ContextRepository(db),
    projects: new ProjectRepository(db),
    audit,
    userId: () => USER,
    skills: () => []
  })
  montador = new ContextoDaTarefa({ git: squadGit, contexto })

  git(['init', '--initial-branch=main'])
  git(['config', 'user.email', 'teste@local'])
  git(['config', 'user.name', 'Teste'])
  git(['config', 'core.autocrlf', 'false'])
  sha = commitar({
    'src/a.ts': 'export const a = 1\n',
    'src/b.ts': 'export const b = 2\n',
    'README.md': '# projeto\n'
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const packsNoBanco = (): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM context_pack').get() as { n: number }).n

comGit('as entradas exatas da tarefa', () => {
  it('entram com o texto da revisão e o hash do texto exato', () => {
    const r = montador.montar(pedido(['src/a.ts', 'README.md']))

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fontes.map((f) => [f.caminho, f.texto, f.origem])).toEqual([
      ['src/a.ts', 'export const a = 1\n', 'explicito'],
      ['README.md', '# projeto\n', 'explicito']
    ])
    expect(r.pack.itens.map((i) => [i.caminho, i.hash, i.bytes])).toEqual([
      ['src/a.ts', hash('export const a = 1\n'), 'export const a = 1\n'.length],
      ['README.md', hash('# projeto\n'), '# projeto\n'.length]
    ])
    expect(r.pack.itens.map((i) => i.motivo)).toEqual([
      'entrada da tarefa t1',
      'entrada da tarefa t1'
    ])
    expect(r.descartadas).toEqual([])
    expect(r.pack.tarefa).toBe(`squad:run-1/t1@${sha.slice(0, 12)}`)
    expect(rotuloDaTarefa('run-1', 't1', sha)).toBe(r.pack.tarefa)
    expect(r.pack.rota).toBe('anthropic')
  })

  it('o que mudou no disco depois do commit não entra: o contexto é o da revisão', () => {
    writeFileSync(join(repo, 'src', 'a.ts'), 'ADULTERADO NO DISCO\n')

    const r = montador.montar(pedido(['src/a.ts']))

    expect(r.ok && r.fontes[0]?.texto).toBe('export const a = 1\n')
  })

  it('a mesma tarefa na mesma revisão reaproveita o pack; outra tarefa ou revisão não', () => {
    const a = montador.montar(pedido(['src/a.ts']))
    const igual = montador.montar(pedido(['src/a.ts']))
    const outraTarefa = montador.montar(
      pedido(['src/a.ts'], { tarefa: { id: 't2', entradas: ['src/a.ts'] } })
    )
    const novoSha = commitar({ 'src/c.ts': 'x\n' })
    const outraRevisao = montador.montar(pedido(['src/a.ts'], { revisao: novoSha }))

    expect(a.ok && igual.ok && a.pack.id === igual.pack.id).toBe(true)
    const ids = [a, outraTarefa, outraRevisao].map((x) => (x.ok ? x.pack.id : ''))
    expect(new Set(ids).size).toBe(3)
    expect(packsNoBanco()).toBe(3)
  })

  it('repassa as regras de domínio ao pack', () => {
    const r = montador.montar(pedido(['src/a.ts'], { regras: ['Policy Engine é fail closed'] }))

    expect(r.ok && r.pack.regras).toEqual(['Policy Engine é fail closed'])
  })
})

comGit('o que a tarefa pede e a revisão não entrega vira descartado, com o motivo', () => {
  it('caminho inválido, inexistente, diretório e repetido', () => {
    const r = montador.montar(
      pedido([
        'src/a.ts',
        '../fora.ts',
        '/abs.ts',
        '.env',
        'src/nao-existe.ts',
        'src',
        './src/a.ts'
      ])
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fontes.map((f) => f.caminho)).toEqual(['src/a.ts'])
    expect(r.descartadas).toEqual([
      { caminho: '../fora.ts', motivo: 'caminho-invalido' },
      { caminho: '/abs.ts', motivo: 'caminho-invalido' },
      { caminho: '.env', motivo: 'caminho-invalido' },
      { caminho: 'src/nao-existe.ts', motivo: 'inexistente-na-revisao' },
      { caminho: 'src', motivo: 'inexistente-na-revisao' },
      { caminho: 'src/a.ts', motivo: 'repetido' }
    ])
  })

  it('link simbólico e submódulo da árvore não são arquivo', () => {
    const oidDoLink = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo,
      input: 'src/a.ts',
      encoding: 'utf8'
    }).trim()
    git(['update-index', '--add', '--cacheinfo', `120000,${oidDoLink},atalho.ts`])
    git(['update-index', '--add', '--cacheinfo', `160000,${sha},submodulo`])
    git(['commit', '-m', 'link e submódulo'])
    const novo = git(['rev-parse', 'HEAD'])

    const r = montador.montar(pedido(['src/a.ts', 'atalho.ts', 'submodulo'], { revisao: novo }))

    expect(r.ok && r.descartadas).toEqual([
      { caminho: 'atalho.ts', motivo: 'inexistente-na-revisao' },
      { caminho: 'submodulo', motivo: 'inexistente-na-revisao' }
    ])
  })

  it('arquivo binário e arquivo grande demais', () => {
    const novo = commitar({
      'dados.bin': Buffer.from([0x61, 0x00, 0x62]),
      'src/grande.ts': 'x'.repeat(256 * 1024 + 1)
    })

    const r = montador.montar(pedido(['src/a.ts', 'dados.bin', 'src/grande.ts'], { revisao: novo }))

    expect(r.ok && r.fontes.map((f) => f.caminho)).toEqual(['src/a.ts'])
    expect(r.ok && r.descartadas).toEqual([
      { caminho: 'dados.bin', motivo: 'binario' },
      { caminho: 'src/grande.ts', motivo: 'grande-demais' }
    ])
  })

  it('o teto de fontes corta o excesso e o registra', () => {
    const muitos: Record<string, string> = {}
    for (let i = 0; i < MAX_FONTES_DA_TAREFA + 5; i++) muitos[`src/m${i}.ts`] = `m${i}\n`
    const novo = commitar(muitos)

    const r = montador.montar(pedido(Object.keys(muitos), { revisao: novo }))

    expect(r.ok && r.fontes).toHaveLength(MAX_FONTES_DA_TAREFA)
    expect(r.ok && r.descartadas.filter((d) => d.motivo === 'limite-de-fontes')).toHaveLength(5)
  })
})

comGit('recusas do pack', () => {
  it('segredo no conteúdo recusa tudo, sem gravar pack nem devolver o trecho', () => {
    const novo = commitar({ 'src/notas.ts': '// ghp_abcdefghijklmnopqrstuvwxyz0123456789\n' })

    const r = montador.montar(pedido(['src/a.ts', 'src/notas.ts'], { revisao: novo }))

    expect(r).toMatchObject({
      ok: false,
      razao: 'segredo-no-contexto',
      caminhosComSegredo: ['src/notas.ts']
    })
    expect(packsNoBanco()).toBe(0)
  })

  it('sem nenhuma fonte utilizável é contexto vazio', () => {
    const r = montador.montar(pedido(['../x', 'src/nao-existe.ts']))

    expect(r).toMatchObject({ ok: false, razao: 'contexto-vazio' })
  })

  it('revisão inválida é revisão indisponível, e o projeto desconhecido é recusa', () => {
    expect(montador.montar(pedido(['src/a.ts'], { revisao: 'HEAD' }))).toMatchObject({
      ok: false,
      razao: 'revisao-indisponivel'
    })
    expect(montador.montar(pedido(['src/a.ts'], { projectId: 'nao-existe' }))).toMatchObject({
      ok: false,
      razao: 'projeto-desconhecido'
    })
  })
})

comGit('busca estrutural dentro de um escopo', () => {
  it('traz trechos com o contexto ao redor, o hash do trecho e a faixa de linhas', () => {
    const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`)
    linhas[9] = 'aqui está o ALVO'
    const novo = commitar({ 'src/c.ts': `${linhas.join('\n')}\n` })

    const r = montador.montar(
      pedido(['README.md'], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['src'] }] })
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const trecho = r.fontes.find((f) => f.origem === 'busca-estrutural')
    expect(trecho?.caminho).toBe('src/c.ts')
    expect(trecho?.linhas).toEqual({ de: 5, ate: 15 })
    expect(trecho?.texto).toBe(`${linhas.slice(4, 15).join('\n')}\n`)
    expect(trecho?.motivo).toBe('busca por "ALVO"')
    const item = r.pack.itens.find((i) => i.origem === 'busca-estrutural')
    expect(item?.hash).toBe(hash(trecho?.texto ?? ''))
    expect(item?.hash).not.toBe(hash(`${linhas.join('\n')}\n`))
  })

  it('ocorrências próximas viram um trecho só; distantes, dois', () => {
    const linhas = Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`)
    linhas[9] = 'ALVO um'
    linhas[11] = 'ALVO dois'
    linhas[49] = 'ALVO tres'
    const novo = commitar({ 'src/c.ts': `${linhas.join('\n')}\n` })

    const r = montador.montar(
      pedido([], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['src/c.ts'] }] })
    )

    expect(r.ok && r.fontes.map((f) => f.linhas)).toEqual([
      { de: 5, ate: 17 },
      { de: 45, ate: 55 }
    ])
  })

  it('o arquivo que já entrou inteiro não entra de novo em trecho', () => {
    const novo = commitar({ 'src/c.ts': 'um\nALVO\ntres\n' })

    const r = montador.montar(
      pedido(['src/c.ts'], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['src'] }] })
    )

    expect(r.ok && r.fontes.map((f) => f.origem)).toEqual(['explicito'])
  })

  it('só acha dentro do escopo pedido', () => {
    const novo = commitar({ 'src/c.ts': 'ALVO\n', 'docs/d.md': 'ALVO\n' })

    const r = montador.montar(
      pedido([], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['docs'] }] })
    )

    expect(r.ok && r.fontes.map((f) => f.caminho)).toEqual(['docs/d.md'])
  })

  it('busca sem ocorrência não acrescenta nada', () => {
    const r = montador.montar(
      pedido(['src/a.ts'], { buscas: [{ termo: 'nao-existe-xyz', caminhos: ['src'] }] })
    )

    expect(r.ok && r.fontes).toHaveLength(1)
  })

  it('escopo inválido, termo inválido e buscas demais são erro do kernel, não do pack', () => {
    const base = ['src/a.ts']
    for (const busca of [
      { termo: 'x', caminhos: [] },
      { termo: 'x', caminhos: ['../fora'] },
      { termo: 'x', caminhos: ['/abs'] },
      { termo: '', caminhos: ['src'] }
    ]) {
      expect(montador.montar(pedido(base, { buscas: [busca] }))).toMatchObject({
        ok: false,
        razao: 'busca-invalida'
      })
    }
    const muitas = Array.from({ length: 11 }, () => ({ termo: 'x', caminhos: ['src'] }))
    expect(montador.montar(pedido(base, { buscas: muitas }))).toMatchObject({
      ok: false,
      razao: 'busca-invalida'
    })
    expect(packsNoBanco()).toBe(0)
  })

  it('o arquivo com NUL depois do que o Git olha para decidir se é binário também é descartado', () => {
    const novo = commitar({
      'src/tardio.dat': Buffer.concat([
        Buffer.from('ALVO\n'),
        Buffer.from('x'.repeat(9000)),
        Buffer.from([0x00])
      ])
    })

    const r = montador.montar(
      pedido(['src/a.ts'], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['src'] }] })
    )

    expect(r.ok && r.fontes.map((f) => f.caminho)).toEqual(['src/a.ts'])
    expect(r.ok && r.descartadas).toEqual([{ caminho: 'src/tardio.dat', motivo: 'binario' }])
  })

  it('o teto de fontes vale também para os trechos da busca', () => {
    const linhas = Array.from({ length: 2000 }, (_, i) => (i % 25 === 0 ? 'ALVO' : `linha ${i}`))
    const novo = commitar({ 'src/c.ts': `${linhas.join('\n')}\n` })

    const r = montador.montar(
      pedido([], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['src/c.ts'] }] })
    )

    expect(r.ok && r.fontes).toHaveLength(MAX_FONTES_DA_TAREFA)
    expect(r.ok && r.descartadas.some((d) => d.motivo === 'limite-de-fontes')).toBe(true)
  })

  it('trecho de arquivo binário ou grande demais é descartado, não incluído', () => {
    const novo = commitar({
      'src/bin.dat': Buffer.from('ALVO\0binario'),
      'src/grande.ts': `${'x'.repeat(256 * 1024)}\nALVO\n`
    })

    const r = montador.montar(
      pedido(['src/a.ts'], { revisao: novo, buscas: [{ termo: 'ALVO', caminhos: ['src'] }] })
    )

    expect(r.ok && r.fontes.map((f) => f.caminho)).toEqual(['src/a.ts'])
    expect(r.ok && r.descartadas).toEqual([{ caminho: 'src/grande.ts', motivo: 'grande-demais' }])
  })
})
