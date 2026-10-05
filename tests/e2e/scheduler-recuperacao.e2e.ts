import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * A recuperação do scheduler no **app real**, depois de uma queda (SPEC-Scheduler-05, PR-C —
 * critérios 3, 4 e 6).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que o `reconcileAll` que o `index.ts`
 * monta no boot — com o `DockerRunner`, o `IsolamentoService` e a `RecuperacaoService` de verdade,
 * sobre o Docker de verdade — dá destino a três runs que o processo anterior deixou no meio:
 *
 *  - **A**: lease vencido, sem container (o executor morreu junto com o app);
 *  - **B**: lease vencido e o **container ainda de pé** (o `sleep infinity` detached sobrevive à
 *    queda do app — foi o defeito que o E2E concorrente achou);
 *  - **C**: a fatia saudável, com lease vigente e container de pé — a que nenhuma recuperação pode
 *    tocar.
 *
 * **Sem canal de escrita novo** (decisão do PI, 2026-10-04): o estado é semeado no SQLite com o app
 * fechado, e o que o app fez é lido pela ponte que já existe (`vistaDaFila`, `vistaDoPool`,
 * `ledgerDoRun`, `pendenciasDeLimpeza`). O bloqueio de A e B, que nenhum desses canais mostra, é lido
 * do próprio arquivo, com o app já fechado. O SQLite é aberto pelo Electron como Node
 * (`ELECTRON_RUN_AS_NODE`) porque o `better-sqlite3` é compilado para o ABI do Electron.
 */

const PROJETO = 'proj-e2e'
const USER = 'local'
const IMAGEM = 'alpine:latest'
const SUFIXO = randomUUID().slice(0, 8)

let app: ElectronApplication | undefined
let userData: string
let dockerNoAr = false
const containers = new Set<string>()

function docker(args: readonly string[]): { ok: boolean; saida: string } {
  try {
    return { ok: true, saida: execFileSync('docker', [...args], { encoding: 'utf8' }) }
  } catch (erro) {
    return { ok: false, saida: erro instanceof Error ? erro.message : String(erro) }
  }
}

/** Roda SQL no banco do app com o Electron como Node. Devolve as linhas do último `SELECT`. */
function sqlite(
  dbPath: string,
  comandos: readonly { sql: string; params?: readonly unknown[] }[]
): readonly Record<string, unknown>[] {
  const programa = `
    const Database = require('better-sqlite3')
    const { dbPath, comandos } = JSON.parse(process.argv[1])
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    let linhas = []
    for (const c of comandos) {
      const stmt = db.prepare(c.sql)
      if (stmt.reader) linhas = stmt.all(...(c.params ?? []))
      else stmt.run(...(c.params ?? []))
    }
    db.close()
    process.stdout.write(JSON.stringify(linhas))
  `
  const saida = execFileSync(
    electronPath as unknown as string,
    ['-e', programa, JSON.stringify({ dbPath, comandos })],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  )
  return JSON.parse(saida) as Record<string, unknown>[]
}

async function subir(): Promise<ElectronApplication> {
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  const aplicacao = await electron.launch({
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...ambiente, NODE_ENV: 'development', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }
  })
  aplicacao.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
  return aplicacao
}

async function encerrar(aplicacao: ElectronApplication | undefined): Promise<void> {
  await aplicacao?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await aplicacao?.close().catch(() => undefined)
}

test.beforeAll(() => {
  dockerNoAr = docker(['info', '--format', '{{.ServerVersion}}']).ok
  if (!dockerNoAr && process.env.CI) {
    throw new Error('Docker não respondeu. No CI o daemon é obrigatório.')
  }
  if (dockerNoAr) docker(['pull', '--quiet', IMAGEM])
})

test.afterAll(() => {
  // Sobra de um worker que morreu antes do `afterEach`: só o que é deste arquivo, pelo sufixo.
  const nomes = docker(['ps', '-a', '--format', '{{.Names}}'])
    .saida.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith(`-${SUFIXO}`))
  for (const nome of nomes) docker(['rm', '--force', nome])
})

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-recuperacao-'))
})

test.afterEach(async () => {
  await encerrar(app)
  app = undefined
  for (const c of containers) docker(['rm', '--force', c])
  containers.clear()
  rmSync(userData, { recursive: true, force: true })
})

/** Um container com as labels que o preflight dá, de pé como o `DockerRunner` o deixa. */
function subirContainer(runId: string, fatia: string): string {
  const nome = `test-e2e-run-${runId.slice(0, 8)}-${SUFIXO}`
  containers.add(nome)
  const r = docker([
    'run',
    '-d',
    // `--rm`, como o `DockerRunner` o sobe: é o que faz o `docker stop` remover o container.
    '--rm',
    '--name',
    nome,
    '--label',
    'jarvisos.gerido=true',
    '--label',
    `jarvisos.run=${runId}`,
    '--label',
    `jarvisos.fatia=${fatia}`,
    '--label',
    `jarvisos.projeto=${PROJETO}`,
    '--label',
    'jarvisos.tentativa=1',
    IMAGEM,
    'sleep',
    'infinity'
  ])
  expect(r.ok, r.saida).toBe(true)
  return nome
}

const containerDeP = (runId: string): string =>
  docker(['ps', '-a', '--filter', `label=jarvisos.run=${runId}`, '--format', '{{.Names}}'])
    .saida.split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(',')

test('o boot depois da queda recupera A e B, devolve o slot e não toca em C', async () => {
  test.skip(!dockerNoAr, 'Docker fora do ar: sem ele a recuperação não observa o executor')
  test.setTimeout(180_000)

  // 1) O primeiro boot só cria o banco e roda as migrations.
  app = await subir()
  const primeira = await app.firstWindow()
  await primeira.waitForLoadState('domcontentloaded')
  // O terminal do Docker só roda binário que o usuário permitiu (1ª barreira da allowlist): sem
  // isto o app não enxerga container nenhum e a recuperação, fail closed, não decide nada.
  // A allowlist é por espaço, e o terminal do Docker roda no espaço **atual** do app.
  const WS = await primeira.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          getWorkspace: () => Promise<string>
          addAllowedCommand: (b: string, w: string) => Promise<readonly string[]>
        }
      }
    ).jarvis
    const atual = await bridge.getWorkspace()
    await bridge.addAllowedCommand('docker', atual)
    return atual
  })
  await encerrar(app)
  app = undefined
  const dbPath = join(userData, 'jarvis.db')
  // Os comandos do Docker rodam com o cwd do app (`app.getAppPath()`), que **não** é o `userData`
  // que a allowlist de diretórios traz de fábrica. Sem permitir essa pasta, o terminal recusa o cwd,
  // o app não enxerga container e a recuperação, fail closed, não decide nada.
  sqlite(dbPath, [
    {
      sql: 'INSERT INTO allowed_directory (id, user_id, path, created_at) VALUES (?, ?, ?, ?)',
      params: [randomUUID(), USER, realpathSync(resolve(process.cwd())), new Date().toISOString()]
    }
  ])

  // 2) O estado que o processo anterior deixou: três runs ativos, cada um com o seu slot.
  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()]
  const containerB = subirContainer(b, 'f2')
  const containerC = subirContainer(c, 'f3')
  const agora = Date.now()
  const iso = new Date(agora).toISOString()
  const run = (id: string, fatia: string): { sql: string; params: unknown[] } => ({
    sql: `INSERT INTO pipeline_run (id, user_id, workspace_id, project_id, slice_id, estado, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?)`,
    params: [id, USER, WS, PROJETO, fatia, iso, iso]
  })
  const slot = (id: string, n: number, vigente: boolean): { sql: string; params: unknown[] } => ({
    sql: `INSERT INTO lease (id, user_id, proprietario, recurso, project_id, heartbeat_em, expira_em, fencing_token, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      randomUUID(),
      USER,
      id,
      `wip:slot:${n}`,
      PROJETO,
      vigente ? agora : 1_000,
      vigente ? agora + 3_600_000 : 2_000,
      n,
      iso
    ]
  })
  const inventario = (
    id: string,
    fatia: string,
    nome: string
  ): { sql: string; params: unknown[] } => ({
    sql: `INSERT INTO recurso_run (user_id, run_id, project_id, tipo, identificador, estado, labels, detalhes, criado_em, atualizado_em)
          VALUES (?, ?, ?, 'container', ?, 'criado', ?, '{}', ?, ?)`,
    params: [
      USER,
      id,
      PROJETO,
      nome,
      JSON.stringify({
        'jarvisos.gerido': 'true',
        'jarvisos.run': id,
        'jarvisos.fatia': fatia,
        'jarvisos.projeto': PROJETO,
        'jarvisos.tentativa': '1'
      }),
      agora,
      agora
    ]
  })
  // A fila do pool guarda o item de cada run que adquiriu slot (é dela que a vista sabe de que
  // espaço é o slot), e o contador de tokens parte do último que o processo anterior deu.
  const itemDoPool = (id: string, fatia: string): { sql: string; params: unknown[] } => ({
    sql: `INSERT INTO pool_fila (run_id, user_id, workspace_id, project_id, slice_id, prioridade, enfileirado_em, estado, atualizado_em)
          VALUES (?, ?, ?, ?, ?, 1, ?, 'adquirido', ?)`,
    params: [id, USER, WS, PROJETO, fatia, agora, agora]
  })
  sqlite(dbPath, [
    { sql: 'INSERT INTO pool_sequencia (user_id, ultimo) VALUES (?, 3)', params: [USER] },
    itemDoPool(a, 'f1'),
    itemDoPool(b, 'f2'),
    itemDoPool(c, 'f3'),
    run(a, 'f1'),
    run(b, 'f2'),
    run(c, 'f3'),
    slot(a, 1, false),
    slot(b, 2, false),
    slot(c, 3, true),
    inventario(b, 'f2', containerB),
    inventario(c, 'f3', containerC)
  ])
  expect(containerDeP(b)).toBe(containerB)

  // 3) O segundo boot: o `reconcileAll` de verdade, com o Docker de verdade.
  app = await subir()
  // A janela só abre depois do `reconcileAll`, que consulta o Docker (síncrono) várias vezes.
  const janela = await app.firstWindow({ timeout: 120_000 })
  await janela.waitForLoadState('domcontentloaded')

  const vistaDaFila = (): Promise<{ ativos: { id: string }[] }> =>
    janela.evaluate(
      async ([projeto, ws]: [string, string]) =>
        await (
          window as unknown as {
            jarvis: { vistaDaFila: (p: string, w: string) => Promise<{ ativos: { id: string }[] }> }
          }
        ).jarvis.vistaDaFila(projeto, ws),
      [PROJETO, WS] as [string, string]
    )

  // O que o boot recupera já está feito quando a janela abre, mas a leitura espera o desfecho em
  // vez de apostar nele.
  await expect
    .poll(async () => (await vistaDaFila()).ativos.map((r) => r.id), { timeout: 60_000 })
    .toEqual([c])

  // 4) O que a ponte mostra: só C ocupa slot, ninguém espera, nada ficou pendente de limpeza.
  const pool = await janela.evaluate(
    async () =>
      await (
        window as unknown as {
          jarvis: {
            vistaDoPool: () => Promise<{
              ocupados: { runId: string }[]
              fila: unknown[]
            }>
          }
        }
      ).jarvis.vistaDoPool()
  )
  expect(pool.ocupados.map((o) => o.runId)).toEqual([c])
  expect(pool.fila).toEqual([])
  const pendencias = await janela.evaluate(
    async () =>
      await (
        window as unknown as { jarvis: { pendenciasDeLimpeza: () => Promise<unknown[]> } }
      ).jarvis.pendenciasDeLimpeza()
  )
  expect(pendencias).toEqual([])
  const ledgerDeB = await janela.evaluate(
    async (runId: string) =>
      await (
        window as unknown as { jarvis: { ledgerDoRun: (r: string) => Promise<unknown> } }
      ).jarvis.ledgerDoRun(runId),
    b
  )
  expect(ledgerDeB).toBeUndefined()

  // 5) O Docker: o container órfão de B foi parado; o de C continua de pé.
  // O `docker stop` de um container `--rm` volta antes de ele sair da listagem.
  await expect.poll(() => containerDeP(b), { timeout: 15_000 }).toBe('')
  expect(containerDeP(c)).toBe(containerC)

  // 6) O banco, lido com o app já fechado: A e B bloqueados com a ação de retomada, C intacto.
  await encerrar(app)
  app = undefined
  const runs = sqlite(dbPath, [
    {
      sql: `SELECT id, estado, bloqueio FROM pipeline_run WHERE user_id = ? ORDER BY slice_id`,
      params: [USER]
    }
  ])
  const porId = new Map(runs.map((r) => [String(r.id), r]))
  for (const id of [a, b]) {
    expect(porId.get(id)?.estado).toBe('BLOCKED')
    const bloqueio = JSON.parse(String(porId.get(id)?.bloqueio)) as {
      causa: string
      evidencia: string
      retomada: string
    }
    expect(bloqueio.causa).toBe('executor-perdido')
    // A evidência diz qual caminho foi: B tinha container de pé; A não tinha nenhum.
    expect(bloqueio.evidencia).toMatch(id === b ? /sobreviveu sem dono/ : /não encontrou container/)
    expect(bloqueio.retomada).toMatch(/continuaDe|vinculado/)
  }
  expect(porId.get(c)?.estado).toBe('RUNNING')
  const slots = sqlite(dbPath, [
    {
      sql: `SELECT proprietario FROM lease WHERE user_id = ? AND recurso LIKE 'wip:slot:%'`,
      params: [USER]
    }
  ])
  expect(slots.map((s) => s.proprietario)).toEqual([c])
})
