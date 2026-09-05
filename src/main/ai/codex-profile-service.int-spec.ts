/**
 * O perfil isolado do Codex contra o SQLite real (SPEC-Multi-Executor-02).
 *
 * O `spawn` é dublê **de propósito**: o que este nível mede é a decisão do serviço — como ele
 * traduz o que o CLI respondeu em estado, o que ele manda ao processo, e o que chega à
 * auditoria. O CLI real é exercitado no smoke, onde o binário e o `CODEX_HOME` existem.
 *
 * As respostas do dublê são as **medidas** no CLI 0.149.0, não inventadas: `"Not logged in"` no
 * perfil vazio, e o JSON do `doctor` com `auth.credentials` em `fail`.
 *
 * As garantias que só este nível alcança:
 *  - **o segredo nunca alcança este processo** (critério 1): o login vai por `--device-auth`, e
 *    nenhum arg carrega chave, token ou senha;
 *  - **o perfil é isolado do pessoal** (critério 3): o `CODEX_HOME` do subprocess é o da
 *    pipeline, sob `userData`, e nunca o `~/.codex` do PI;
 *  - **rate limit não abre a porta do modo pago** (critério 4, regra 3);
 *  - **a decisão de cobrança é auditada, a recusa não** (regra 4).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
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
const { CodexProfileService, DIRETORIO_DO_PERFIL, localizarScriptDoCodex, resolverInvocacao } =
  await import('./codex-profile-service')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'

let db: Db
let dir: string
let audit: InstanceType<typeof AuditRepository>

/** Uma chamada capturada ao `spawn`, para as asserções sobre args e ambiente. */
interface ChamadaSpawn {
  readonly binario: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * Um `spawn` dublê que responde o roteiro e captura o que recebeu.
 *
 * O processo falso emite `stdout` e fecha no próximo tick — o serviço só resolve no `close`, e
 * emitir de forma síncrona faria o evento chegar antes de o serviço registrar o listener.
 */
function spawnDuble(
  roteiro: (args: readonly string[]) => {
    stdout?: string
    /**
     * O `stderr` é parte do roteiro porque **é sinal de estado neste CLI**: medido no 0.149.0,
     * `login status` escreve `"Not logged in"` aqui, com exit 1. O dublê que só emitia stdout
     * escondia isso, e o smoke real foi quem achou.
     */
    stderr?: string
    exitCode?: number | null
  },
  chamadas: ChamadaSpawn[] = []
): { impl: never; chamadas: ChamadaSpawn[] } {
  const impl = ((binario: string, args: readonly string[], opcoes: { env: NodeJS.ProcessEnv }) => {
    chamadas.push({ binario, args: [...args], env: opcoes.env })
    const resposta = roteiro(args)

    const processo = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: () => void
    }
    processo.stdout = new EventEmitter()
    processo.stderr = new EventEmitter()
    processo.kill = vi.fn()

    setImmediate(() => {
      if (resposta.stdout !== undefined) {
        processo.stdout.emit('data', Buffer.from(resposta.stdout, 'utf8'))
      }
      if (resposta.stderr !== undefined) {
        processo.stderr.emit('data', Buffer.from(resposta.stderr, 'utf8'))
      }
      if (resposta.exitCode === null) {
        processo.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        return
      }
      processo.emit('close', resposta.exitCode ?? 0)
    })

    return processo
  }) as never

  return { impl, chamadas }
}

function servico(
  roteiro: (args: readonly string[]) => {
    stdout?: string
    stderr?: string
    exitCode?: number | null
  },
  chamadas: ChamadaSpawn[] = []
): InstanceType<typeof CodexProfileService> {
  return new CodexProfileService({
    userDataDir: dir,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    spawnImpl: spawnDuble(roteiro, chamadas).impl,
    // A resolução do script é dublada para o teste medir a **decisão** do serviço, e não a
    // máquina onde ele roda: sem isto, uma máquina com o Codex instalado globalmente faria os
    // args virarem `[<caminho>/codex.js, 'login', ...]` e as asserções sobre `args[0]` mediriam
    // o caminho de instalação. O caminho real é exercitado no smoke, que é onde ele importa.
    execSyncImpl: (() => '') as never,
    existeImpl: () => false,
    agora: () => new Date('2026-09-05T00:00:00.000Z')
  })
}

/** A resposta medida do `doctor --json` com o perfil vazio — recortada ao que o serviço lê. */
const DOCTOR_SEM_CREDENCIAL = JSON.stringify({
  schemaVersion: 1,
  overallStatus: 'fail',
  checks: {
    'auth.credentials': {
      status: 'fail',
      summary: 'no Codex credentials were found'
    },
    'config.load': { status: 'ok', summary: 'config loaded' }
  }
})

const DOCTOR_SADIO = JSON.stringify({
  schemaVersion: 1,
  overallStatus: 'ok',
  checks: { 'config.load': { status: 'ok', summary: 'config loaded' } }
})

function eventosDeAuditoria(): readonly { type: string; payload: Record<string, unknown> }[] {
  return (
    db
      .prepare('SELECT type, payload FROM audit_event WHERE user_id = ? ORDER BY seq')
      .all(USER) as readonly { type: string; payload: string }[]
  ).map((r) => ({ type: r.type, payload: JSON.parse(r.payload) as Record<string, unknown> }))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-codex-'))
  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('perfil isolado (critérios 1 e 3)', () => {
  /**
   * Critério 3, a metade provável no host: o subprocess enxerga o perfil **da pipeline**.
   *
   * A asserção é sobre o `env` que o serviço montou, não sobre o retorno — é o `CODEX_HOME` que
   * decide qual perfil o CLI abre, e um serviço que esquecesse de passá-lo cairia no `~/.codex`
   * pessoal do PI sem erro nenhum aparecer.
   */
  it('aponta o CODEX_HOME da pipeline, sob userData e fora do repositório', async () => {
    const chamadas: ChamadaSpawn[] = []
    await servico(() => ({ stderr: 'Not logged in', exitCode: 1 }), chamadas).estado()

    expect(chamadas.length).toBeGreaterThan(0)
    const home = chamadas[0]?.env.CODEX_HOME ?? ''
    expect(home).toBe(join(dir, DIRETORIO_DO_PERFIL))
    expect(home).toContain(DIRETORIO_DO_PERFIL)
  })

  /**
   * O contrafactual do teste acima: o perfil da pipeline **não** é o pessoal.
   *
   * Sem esta asserção, um serviço que devolvesse `~/.codex` passaria no teste anterior se o
   * `userDataDir` por acaso apontasse para lá.
   */
  it('não usa o diretório padrão do Codex pessoal', async () => {
    const chamadas: ChamadaSpawn[] = []
    await servico(() => ({ stderr: 'Not logged in', exitCode: 1 }), chamadas).estado()

    const home = chamadas[0]?.env.CODEX_HOME ?? ''
    expect(home.endsWith(join('.codex'))).toBe(false)
  })

  /**
   * Critério 1: nenhum argumento carrega segredo — o login vai pelo fluxo de dispositivo.
   *
   * `--with-api-key` e `--with-access-token` existem no CLI e leem do **stdin**; escolhê-los
   * faria o segredo passar por dentro deste processo. O teste trava a escolha, não só a ausência
   * de uma chave literal nos args.
   */
  it('inicia o login por device-auth, sem nenhum segredo em argumento', async () => {
    const chamadas: ChamadaSpawn[] = []
    await servico(
      () => ({ stdout: 'Acesse https://example.test/device e informe: ABCD-1234', exitCode: 0 }),
      chamadas
    ).iniciarLogin()

    const login = chamadas.find((c) => c.args[0] === 'login')
    expect(login?.args).toContain('--device-auth')
    expect(login?.args).not.toContain('--with-api-key')
    expect(login?.args).not.toContain('--with-access-token')
  })

  /**
   * **O segundo defeito que o smoke real achou:** o CLI exige que o `CODEX_HOME` já exista.
   *
   * Medido: com o diretório ausente, ele responde `Error loading configuration: CODEX_HOME points
   * to ...` e sai com erro em **todo** comando. Em produção o perfil nasce vazio, então sem a
   * criação a fatia inteira falharia no primeiro uso — e o dublê, que responde igual exista ou
   * não o diretório, nunca mostraria isso.
   */
  it('cria o diretório do perfil antes de invocar o CLI', async () => {
    const criados: string[] = []
    const s = new CodexProfileService({
      userDataDir: dir,
      audit,
      userId: () => USER,
      workspaceId: () => WS,
      spawnImpl: spawnDuble(() => ({ stderr: 'Not logged in', exitCode: 1 })).impl,
      execSyncImpl: (() => '') as never,
      existeImpl: () => false,
      mkdirImpl: ((caminho: string) => {
        criados.push(caminho)
        return undefined
      }) as never
    })

    await s.estado()

    expect(criados).toContain(join(dir, DIRETORIO_DO_PERFIL))
  })

  /** O ambiente do subprocess não carrega o `process.env` inteiro — só a lista + `CODEX_HOME`. */
  it('não repassa o ambiente do main ao subprocess', async () => {
    const chamadas: ChamadaSpawn[] = []
    process.env.SEGREDO_DE_TESTE_M10F02 = 'nao-deve-vazar'
    try {
      await servico(() => ({ stderr: 'Not logged in', exitCode: 1 }), chamadas).estado()
      expect(chamadas[0]?.env.SEGREDO_DE_TESTE_M10F02).toBeUndefined()
    } finally {
      delete process.env.SEGREDO_DE_TESTE_M10F02
    }
  })
})

/**
 * A invocação do CLI no Windows (decisão do PI, 2026-09-05).
 *
 * **O defeito que o smoke real achou e o dublê escondia:** no Windows o `codex` do npm existe só
 * como `.cmd`, e o Node recusa executá-lo com `shell: false` (`EINVAL`). O serviço responderia
 * `offline` numa máquina com o Codex instalado e funcionando.
 */
describe('resolução do binário sem abrir mão de shell:false', () => {
  it('chama o script pelo Node quando ele existe, mantendo os args do comando', () => {
    const invocacao = resolverInvocacao('codex', ['login', 'status'], () => 'C:/npm/codex.js')

    expect(invocacao.comando).toBe(process.execPath)
    expect(invocacao.args).toEqual(['C:/npm/codex.js', 'login', 'status'])
  })

  /** Sem script resolvido, cai no binário do PATH — o caminho normal em Linux e macOS. */
  it('usa o binário direto quando não há script a resolver', () => {
    const invocacao = resolverInvocacao('codex', ['logout'], () => undefined)

    expect(invocacao.comando).toBe('codex')
    expect(invocacao.args).toEqual(['logout'])
  })

  it('localiza o script sob a raiz global do npm', () => {
    const script = localizarScriptDoCodex(
      (() => 'C:/npm/node_modules\n') as never,
      (caminho) => caminho === join('C:/npm/node_modules', '@openai', 'codex', 'bin', 'codex.js')
    )

    expect(script).toBe(join('C:/npm/node_modules', '@openai', 'codex', 'bin', 'codex.js'))
  })

  /**
   * Falha na resolução **não derruba nada**: devolve `undefined` e o chamador cai no PATH.
   *
   * `npm root -g` pode não existir (instalação por outro gerenciador), demorar, ou falhar. Um
   * throw aqui transformaria uma otimização de caminho numa falha de leitura de estado.
   */
  it('devolve undefined quando npm root falha, em vez de lançar', () => {
    const script = localizarScriptDoCodex(
      (() => {
        throw new Error('npm não encontrado')
      }) as never,
      () => true
    )

    expect(script).toBeUndefined()
  })

  it('devolve undefined quando a raiz existe mas o script não está lá', () => {
    const script = localizarScriptDoCodex((() => 'C:/npm/node_modules\n') as never, () => false)

    expect(script).toBeUndefined()
  })
})

describe('saúde do perfil (critério 6)', () => {
  /**
   * **O caso que o smoke real achou.** A resposta é a medida no CLI 0.149.0: `"Not logged in"` no
   * **stderr**, com exit 1 — não no stdout com exit 0, como o dublê original supunha.
   *
   * Um serviço que lesse só o stdout veria string vazia, não casaria o regex, e trataria o perfil
   * como autenticado. O run começaria e morreria na primeira chamada, depois de o preflight ter
   * dito que estava tudo bem.
   */
  it('perfil sem credencial responde auth_required, lendo o stderr do CLI', async () => {
    const estado = await servico((args) =>
      args[0] === 'login'
        ? { stderr: 'Not logged in', exitCode: 1 }
        : { stdout: DOCTOR_SEM_CREDENCIAL, exitCode: 1 }
    ).estado()

    expect(estado.saude).toBe('auth_required')
  })

  /**
   * Saída não-zero que **não** é "not logged in" é problema de ferramenta, não de conta.
   *
   * O caso real: `CODEX_HOME` ilegível faz o CLI responder `Error loading configuration`. Chamar
   * isso de `auth_required` mandaria o PI fazer login para resolver o que login nenhum resolve.
   */
  it('erro de configuração responde offline, não auth_required', async () => {
    const estado = await servico(() => ({
      stderr: 'Error loading configuration: CODEX_HOME points to a missing path',
      exitCode: 1
    })).estado()

    expect(estado.saude).toBe('offline')
  })

  /**
   * Binário ausente é `offline`, e **não** `auth_required`.
   *
   * A distinção governa a ação: `auth_required` manda o PI fazer login; `offline` manda instalar
   * o CLI. Trocá-las mandaria alguém tentar autenticar num binário que não existe — a mesma
   * lição do `exitCode` vs `reason` que a M26-F04 registrou.
   */
  it('binário ausente responde offline, não auth_required', async () => {
    const estado = await servico(() => ({ exitCode: null })).estado()
    expect(estado.saude).toBe('offline')
  })

  /**
   * **Perfil autenticado responde `quota_unknown`, não `ready`** — e isto é medição, não escolha.
   *
   * Medido no CLI 0.149.0: os 24 checks do `doctor --json` não trazem quota, uso, rate limit nem
   * crédito. Sem telemetria legível, a regra 2 da spec manda `quota_unknown`, e afirmar `ready`
   * seria dizer "dentro do limite" sobre um limite que ninguém mediu.
   */
  it('perfil autenticado responde quota_unknown enquanto não houver telemetria', async () => {
    const estado = await servico((args) =>
      args[0] === 'login'
        ? { stdout: 'Logged in using ChatGPT', exitCode: 0 }
        : { stdout: DOCTOR_SADIO, exitCode: 0 }
    ).estado()

    expect(estado.saude).toBe('quota_unknown')
    expect(estado.saude).not.toBe('ready')
  })

  /** O estado carrega a referência opaca ao perfil, e nada de dentro dele. */
  it('expõe o caminho do perfil e nenhum conteúdo', async () => {
    const estado = await servico(() => ({ stderr: 'Not logged in', exitCode: 1 })).estado()

    expect(estado.codexHome).toBe(join(dir, DIRETORIO_DO_PERFIL))
    expect(JSON.stringify(estado)).not.toMatch(/token|secret|api[-_]?key|password/i)
  })

  /**
   * Critério 3: o diagnóstico sai do `summary` dos checks, nunca dos `details`.
   *
   * Os `details` do doctor carregam caminhos absolutos do perfil (medido). O teste dá ao dublê um
   * `details` com um valor reconhecível e afirma que ele **não** aparece.
   */
  it('monta o diagnóstico sem os details do doctor', async () => {
    const comDetails = JSON.stringify({
      checks: {
        'auth.credentials': {
          status: 'fail',
          summary: 'no Codex credentials were found',
          details: { 'auth file': 'C:/segredo/rastreavel/auth.json' }
        }
      }
    })

    const estado = await servico((args) =>
      args[0] === 'login'
        ? { stdout: 'Logged in using ChatGPT', exitCode: 0 }
        : { stdout: comDetails, exitCode: 1 }
    ).estado()

    expect(estado.diagnostico).toContain('no Codex credentials')
    expect(estado.diagnostico).not.toContain('segredo/rastreavel')
  })

  /** Saída que não é o JSON esperado não vira diagnóstico: é justo a que não se sabe o que traz. */
  it('descarta diagnóstico quando a saída do doctor não parseia', async () => {
    const estado = await servico((args) =>
      args[0] === 'login'
        ? { stdout: 'Logged in using ChatGPT', exitCode: 0 }
        : { stdout: 'panic: unexpected token at /home/pi/.codex/auth.json', exitCode: 1 }
    ).estado()

    expect(estado.diagnostico).toBeUndefined()
  })
})

describe('modos de cobrança (critério 4, regras 3 e 4)', () => {
  it('nasce no modo que não gasta dinheiro', () => {
    expect(servico(() => ({ exitCode: 0 })).modoAtual).toBe('subscription_limited')
  })

  /**
   * **A regra 3 no serviço:** sem habilitação explícita, o modo não sobe — e o estado da
   * assinatura não é argumento. O serviço nem consulta a saúde para decidir.
   */
  it('recusa subir para modo monetário sem habilitação do PI', () => {
    const s = servico(() => ({ exitCode: 0 }))

    expect(s.aplicarModo('subscription_credits', false)).toBeUndefined()
    expect(s.aplicarModo('api', false)).toBeUndefined()
    expect(s.modoAtual).toBe('subscription_limited')
  })

  it('aceita a subida quando o PI habilita, e mantém o novo modo', () => {
    const s = servico(() => ({ exitCode: 0 }))

    expect(s.aplicarModo('subscription_credits', true)).toBe('subscription_credits')
    expect(s.modoAtual).toBe('subscription_credits')
  })

  /** Regra 4: a troca que **acontece** vira decisão auditada. */
  it('audita a troca de modo com o par de/para', () => {
    servico(() => ({ exitCode: 0 })).aplicarModo('api', true)

    const evento = eventosDeAuditoria().find((e) => e.payload.acao === 'modo-alterado')
    expect(evento?.type).toBe('codex-profile')
    expect(evento?.payload.de).toBe('subscription_limited')
    expect(evento?.payload.para).toBe('api')
    expect(evento?.payload.gastaDinheiro).toBe(true)
  })

  /**
   * **Recusa não é auditada** — a régua do `RoutingService` e do `PhaseModelService`.
   *
   * Registrar uma troca que não aconteceu faria a auditoria mentir sobre o estado do sistema, e
   * é justamente a auditoria que a regra 4 manda encadear.
   */
  it('não audita a troca recusada', () => {
    servico(() => ({ exitCode: 0 })).aplicarModo('api', false)

    expect(eventosDeAuditoria().filter((e) => e.payload.acao === 'modo-alterado')).toHaveLength(0)
  })
})

describe('gate de execução (critério 5)', () => {
  it('modo de assinatura executa sem teto configurado', () => {
    expect(servico(() => ({ exitCode: 0 })).podeExecutar({ gastoUsd: 0 }).permitida).toBe(true)
  })

  it('modo monetário sem teto bloqueia antes de executar', () => {
    const s = servico(() => ({ exitCode: 0 }))
    s.aplicarModo('subscription_credits', true)

    const veredicto = s.podeExecutar({ gastoUsd: 0 })
    expect(veredicto.permitida).toBe(false)
    expect(veredicto.motivo).toMatch(/teto/i)
  })

  it('teto atingido bloqueia', () => {
    const s = servico(() => ({ exitCode: 0 }))
    s.aplicarModo('api', true)

    expect(s.podeExecutar({ tetoUsd: 5, gastoUsd: 5 }).permitida).toBe(false)
    expect(s.podeExecutar({ tetoUsd: 5, gastoUsd: 4.99 }).permitida).toBe(true)
  })
})

describe('logout (regra 5)', () => {
  it('desconecta o perfil e audita', async () => {
    const chamadas: ChamadaSpawn[] = []
    const ok = await servico(() => ({ stdout: '', exitCode: 0 }), chamadas).logout()

    expect(ok).toBe(true)
    expect(chamadas[0]?.args[0]).toBe('logout')
    expect(eventosDeAuditoria().some((e) => e.payload.acao === 'logout')).toBe(true)
  })

  /**
   * **Regra 5: revogar não apaga evidência anterior.**
   *
   * O teste grava um evento antes do logout e afirma que ele sobrevive. Um `logout` que
   * limpasse o rastro seria ferramenta de encobrir, não de desconectar — e o `AuditEvent` é
   * append-only justamente para que isso não seja possível.
   */
  it('não apaga a evidência já registrada', async () => {
    const s = servico(() => ({ stdout: '', exitCode: 0 }))
    s.aplicarModo('api', true)
    const antes = eventosDeAuditoria().length

    await s.logout()

    expect(eventosDeAuditoria().length).toBeGreaterThan(antes)
    expect(eventosDeAuditoria().some((e) => e.payload.acao === 'modo-alterado')).toBe(true)
  })
})
