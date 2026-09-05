/**
 * Smoke real do perfil Codex (SPEC-Multi-Executor-02 § Testes e evidência).
 *
 * Roda **só** com `JARVIS_SMOKE_CODEX=1` — nunca na suíte comum, que não pode depender de um
 * binário de terceiro estar instalado. Ausente é `not_run`, nunca `pass`: por isso
 * `describe.skipIf` em vez de simplesmente não existir, para a ausência ficar registrada como
 * skipped no relatório.
 *
 * ## O que este smoke prova, e por que o dublê não provaria
 *
 * O `int-spec` mede a **decisão** do serviço com um `spawn` dublê. Este mede a **mecânica**: que
 * `CODEX_HOME` de fato isola o perfil, que o CLI responde o que o serviço espera ler, e que um
 * perfil recém-criado não vaza nada para o pessoal. Foi assim que se descobriu, medindo, que o
 * Codex **recusa** criar binários auxiliares sob diretório temporário — um `CODEX_HOME` em
 * `TEMP` pareceria funcionar e degradaria em silêncio.
 *
 * **Não exige conta autenticada, de propósito.** O que precisa de login (o `ready`, a quota) não
 * é verificável sem a sessão do PI, e um smoke que pedisse credencial não rodaria nunca. O que
 * dá para provar sem ela — isolamento, mapeamento de estado, ausência de vazamento — é
 * exatamente o que o critério 3 pede.
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const {
  CodexProfileService,
  BINARIO_CODEX,
  DIRETORIO_DO_PERFIL,
  localizarScriptDoCodex,
  resolverInvocacao
} = await import('./codex-profile-service')

const habilitado = process.env.JARVIS_SMOKE_CODEX === '1'

/**
 * O binário existe no host? Nunca lança — ausência vira skip, não erro de infraestrutura.
 *
 * Pré-condição verificada **fora** do `it`, para que a ausência vire `not_run` em vez de um teste
 * que roda `--version` e chama isso de sucesso — o vacuous pass que a régua do projeto proíbe.
 */
const codexInstalado = ((): boolean => {
  if (!habilitado) return false
  // Pela **mesma** invocação que o serviço usa, e não `execFileSync(BINARIO_CODEX)` direto: no
  // Windows o binário do npm é um `.cmd`, que o Node recusa sem `shell: true` (`EINVAL`). Uma
  // detecção pelo caminho ingênuo responderia "não instalado" numa máquina com o Codex
  // funcionando — e o smoke inteiro viraria `not_run` sem ninguém notar. Foi assim que o defeito
  // apareceu.
  const invocacao = resolverInvocacao(BINARIO_CODEX, ['--version'], () =>
    localizarScriptDoCodex(execSync, existsSync)
  )
  try {
    execFileSync(invocacao.comando, [...invocacao.args], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const USER = 'u-smoke'
const WS: WorkspaceId = 'jarvis'

let db: Db
let dir: string

function servico(): InstanceType<typeof CodexProfileService> {
  return new CodexProfileService({
    userDataDir: dir,
    audit: new AuditRepository(db, 'chave-de-smoke'),
    userId: () => USER,
    workspaceId: () => WS
  })
}

beforeEach(() => {
  // `userData` simulado por diretório temporário: o que se mede é o **isolamento**, e o perfil
  // real do app fica sob `app.getPath('userData')`, que não existe fora do Electron.
  dir = mkdtempSync(join(tmpdir(), 'jarvis-codex-smoke-'))
  db = openDatabase(join(dir, 'app.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!codexInstalado)('CodexProfileService — smoke real (codex CLI instalado)', () => {
  /**
   * Critério 6 contra o CLI de verdade: um perfil vazio responde `auth_required`.
   *
   * O dublê responde `"Not logged in"` porque foi isso que se mediu; este teste confirma que o
   * CLI real ainda responde assim. É o contrato com um terceiro — a linha que muda numa
   * atualização do CLI sem ninguém avisar.
   */
  it('perfil recém-criado responde auth_required', async () => {
    const estado = await servico().estado()

    expect(estado.saude).toBe('auth_required')
    expect(estado.codexHome).toBe(join(dir, DIRETORIO_DO_PERFIL))
  }, 60_000)

  /**
   * **Critério 3, medido:** o perfil da pipeline não é o pessoal, e nada é escrito nele.
   *
   * A asserção sobre `~/.codex` é o ponto: rodar o serviço não pode criar nem alterar o perfil
   * pessoal do PI. Um serviço que esquecesse o `CODEX_HOME` no `env` passaria em todo o
   * `int-spec` (que só olha o que foi passado ao dublê) e falharia aqui.
   */
  it('não toca o perfil pessoal do PI', async () => {
    const pessoal = join(homedir(), '.codex')
    const antes = existsSync(pessoal) ? readdirSync(pessoal).sort().join('|') : '<ausente>'

    await servico().estado()

    const depois = existsSync(pessoal) ? readdirSync(pessoal).sort().join('|') : '<ausente>'
    expect(depois).toBe(antes)
  }, 60_000)

  /**
   * Critério 3: nada do perfil vaza para o estado que atravessa a fronteira.
   *
   * O `JSON.stringify` do estado é o que a tela recebe — se um token, cookie ou caminho de
   * credencial aparecesse ali, ele chegaria ao renderer e ao log.
   */
  it('o estado exposto não carrega credencial nem caminho de auth', async () => {
    const estado = await servico().estado()
    const serializado = JSON.stringify(estado)

    expect(serializado).not.toMatch(/token|secret|api[-_]?key|password|auth\.json/i)
  }, 60_000)

  /**
   * O `CODEX_HOME` da pipeline fica sob `userData`, **fora de `TEMP` no uso real**.
   *
   * Medido: o Codex responde *"Refusing to create helper binaries under temporary dir"* quando o
   * perfil está em temp. O smoke roda em temp de propósito (é um teste), então o que ele afirma
   * é o formato do caminho que o serviço **calcula** — que em produção nasce de `userData`.
   */
  it('deriva o perfil do userData recebido, num diretório próprio', () => {
    expect(servico().codexHome).toBe(join(dir, DIRETORIO_DO_PERFIL))
    expect(servico().codexHome).not.toBe(join(homedir(), '.codex'))
  })
})
