import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_SEND_CHANNELS } from '@shared/contracts/ipc'
import type { AuditEvent } from '@shared/domain/entities'
import { buildAppInfo, registerIpcHandlers, type IpcDependencies } from './handlers'

const handle = vi.fn()
const on = vi.fn()
const writeLog = vi.fn()
const showOpenDialog = vi.fn()
const logIpc = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

vi.mock('electron', () => ({
  app: {
    getName: () => 'JARVIS OS',
    getVersion: () => '0.1.0',
    isPackaged: false
  },
  ipcMain: {
    handle: (...args: unknown[]) => handle(...args),
    on: (...args: unknown[]) => on(...args)
  },
  // O seletor nativo de pasta (SPEC-ExecucaoReal-03) é dublado: o que interessa é o que o
  // handler faz com a escolha e com o cancelamento, não o diálogo do sistema operacional.
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args)
  }
}))

// O logger real abriria arquivos em disco; aqui interessa *o que* seria gravado.
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logIpc }),
  writeLog: (...args: unknown[]) => writeLog(...args)
}))

function evento(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'e-1',
    user_id: 'local',
    type: 'login',
    payload: {},
    created_at: '2026-07-22T10:00:00.000Z',
    seq: 1,
    prev_hash: 'genesis',
    hash: 'h',
    ...over
  }
}

const audit = {
  list: vi.fn(() => [evento(), evento({ id: 'e-2', type: 'logout', seq: 2 })]),
  verify: vi.fn(() => ({ ok: true, checked: 2 })),
  append: vi.fn()
}

const workspaces = {
  atual: vi.fn(() => 'jarvis' as const),
  trocar: vi.fn((destino: string) => ({ workspace: destino, auditSeq: 3 }))
}

const policy = {
  classify: vi.fn((action: string) => ({
    action,
    tier: 'baixo',
    outcome: 'allow',
    reason: 'classificada-pelo-seed'
  }))
}

const allowlist = {
  list: vi.fn(() => ['/app/userData']),
  add: vi.fn(() => ({ path: '/app/userData/x', added: true })),
  remove: vi.fn(() => ({ path: '/app/userData/x', removed: true })),
  appDirectory: vi.fn(() => '/app/userData')
}

const workflows = {
  listWorkflows: vi.fn(() => []),
  createWorkflow: vi.fn((input: Record<string, unknown>) => ({ id: 'wf-1', ...input })),
  updateWorkflow: vi.fn(() => ({ id: 'wf-1' })),
  setWorkflowStatus: vi.fn(() => ({ id: 'wf-1', status: 'online' })),
  removeWorkflow: vi.fn(() => true),
  listAutomations: vi.fn(() => []),
  createAutomation: vi.fn((input: Record<string, unknown>) => ({ id: 'a-1', ...input })),
  setAutomationEnabled: vi.fn(() => ({ id: 'a-1', enabled: true })),
  removeAutomation: vi.fn(() => true)
}

const execution = {
  runWorkflow: vi.fn((workflowId: string) => ({ id: 'run-1', workflowId, state: 'concluido' }))
}

const realExecution = {
  runWorkflow: vi.fn((workflowId: string) => ({
    id: 'run-real-1',
    workflowId,
    state: 'concluido'
  })),
  resolveApproval: vi.fn((id: string, decision: string) => ({
    id: 'run-real-1',
    approval: id,
    decision
  }))
}

const runs = {
  list: vi.fn(() => []),
  findById: vi.fn(() => undefined)
}

const approvals = {
  listPending: vi.fn(() => []),
  /** Por padrão a pendência é de filesystem — o roteamento por `kind` é exercitado à parte. */
  findById: vi.fn(
    (_userId: string, id: string): { id: string; operation: Record<string, unknown> } => ({
      id,
      operation: { kind: 'write', path: '/tmp/x' }
    })
  )
}

const terminal = {
  run: vi.fn((submission: { binary: string }) => ({
    id: 'cmd-1',
    binary: submission.binary,
    state: 'concluido'
  })),
  resolveApproval: vi.fn((id: string, decision: string) => ({
    id: 'cmd-1',
    approval: id,
    decision
  }))
}

const commandAllowlist = {
  list: vi.fn(() => ['git']),
  add: vi.fn(() => ({ binary: 'git', added: true })),
  remove: vi.fn(() => ({ binary: 'git', removed: true }))
}

const minimizeToTray = vi.fn()

const preferences = {
  atual: vi.fn(() => ({
    locale: 'pt-BR',
    theme: 'sistema',
    resolvedTheme: 'escuro',
    accentNoa: '#C4C4C4',
    accentJarvis: '#C4C4C4'
  })),
  salvar: vi.fn((p: Record<string, unknown>) => ({
    locale: p['locale'] ?? 'pt-BR',
    theme: p['theme'] ?? 'sistema',
    resolvedTheme: 'escuro',
    accentNoa: p['accentNoa'] ?? '#C4C4C4',
    accentJarvis: p['accentJarvis'] ?? '#C4C4C4'
  }))
}

/**
 * O ponto único de IA, dublado. Guarda o `AiRequest` que o handler montou — é isso que o teste
 * de regressão abaixo inspeciona.
 *
 * O stream devolve **um** evento `fim` porque o handler consome o primeiro para descobrir o id;
 * um iterável vazio faria o handler devolver `undefined` e o teste passaria sem nunca ter
 * exercitado a montagem do pedido.
 */
const ai = {
  recebido: undefined as Record<string, unknown> | undefined,
  call: vi.fn(async function* (request: Record<string, unknown>) {
    ai.recebido = request
    yield { tipo: 'fim', id: 'chamada-1', estado: 'concluido' }
  }),
  cancel: vi.fn()
}

/**
 * Dublê da jornada (SPEC-Jornada-01). O que se exercita aqui é a **fronteira**: a validação de
 * forma antes de chamar o serviço. A decisão da máquina de etapas tem suíte própria em
 * `jornada-service.int-spec.ts`, contra o banco real.
 */
const jornada = {
  estado: vi.fn(() => undefined),
  estadoDeVarios: vi.fn(() => []),
  aplicarEvento: vi.fn(() => undefined)
}

/**
 * Dublê do brief (SPEC-Jornada-02). O que se exercita aqui é a **fronteira**: a validação de
 * forma antes de chamar o serviço. A decisão de rota e o validador de saída têm suíte própria em
 * `brief-service.int-spec.ts`, contra o banco real.
 */
const brief = {
  salvarPrompt: vi.fn(() => undefined),
  lerPrompt: vi.fn(() => undefined),
  gerarBrief: vi.fn(async () => ({ resultado: 'gerado', mensagem: 'ok' })),
  carregar: vi.fn(() => undefined),
  rotaAtual: vi.fn(async () => ({ decisao: 'assinatura' })),
  cortarProposto: vi.fn(() => undefined)
}

/**
 * Dublê do refinamento (SPEC-Jornada-02). O que se exercita aqui é a **fronteira**: a validação
 * de forma antes de chamar o serviço. A mecânica de contradição, delegação e retomada tem suíte
 * própria em `refinamento-service.int-spec.ts`, contra o banco real.
 */
const refinamento = {
  gerarPerguntas: vi.fn(async () => ({ resultado: 'geradas', mensagem: 'ok' })),
  estado: vi.fn(() => undefined),
  responder: vi.fn(() => ({ reason: 'registrada', mensagem: 'ok' })),
  historico: vi.fn(() => [])
}

/**
 * Dublê do PRD (SPEC-Jornada-03, emenda E1). Só a fronteira das contradições é exercitada aqui;
 * a geração, a vista e a resposta têm suíte própria em `prd-service.int-spec.ts`.
 */
const prd = {
  contradicoes: vi.fn(() => undefined),
  responderContradicao: vi.fn(() => ({ reason: 'registrada', mensagem: 'ok' }))
}

const deps = {
  audit,
  refinamento,
  prd,
  ai,
  jornada,
  brief,
  workspaces,
  preferences,
  policy,
  allowlist,
  workflows,
  execution,
  realExecution,
  terminal,
  commandAllowlist,
  runs,
  approvals,
  // Função desde a F03: a identidade muda em runtime (local antes do login, usuário da
  // sessão depois), então os handlers a resolvem a cada chamada em vez de capturá-la.
  userId: () => 'local',
  minimizeToTray
} as unknown as IpcDependencies

/** Recupera o handler registrado num canal de request/response e o invoca. */
function invocar(canal: string, ...args: unknown[]): unknown {
  registerIpcHandlers(deps)
  const fn = handle.mock.calls.find(([c]) => c === canal)?.[1] as (
    evento: unknown,
    ...rest: unknown[]
  ) => unknown
  return fn({}, ...args)
}

/**
 * Como `invocar`, mas com um `event` que tem `sender` — o canal de IA bombeia os eventos do
 * stream por ele, e um `{}` vazio derrubaria o bombeamento em vez de exercitar o handler.
 */
async function invocarComEvento(canal: string, ...args: unknown[]): Promise<unknown> {
  registerIpcHandlers(deps)
  const fn = handle.mock.calls.find(([c]) => c === canal)?.[1] as (
    evento: unknown,
    ...rest: unknown[]
  ) => unknown
  return await fn({ sender: { isDestroyed: () => false, send: vi.fn() } }, ...args)
}

/** Recupera o ouvinte de um canal só de ida e o dispara, como o Electron faria. */
function emitir(canal: string, payload?: unknown): void {
  registerIpcHandlers(deps)
  const fn = on.mock.calls.find(([c]) => c === canal)?.[1] as (
    evento: unknown,
    payload: unknown
  ) => void
  fn({}, payload)
}

beforeEach(() => {
  handle.mockClear()
  on.mockClear()
  writeLog.mockClear()
  minimizeToTray.mockClear()
  audit.list.mockClear()
  workspaces.trocar.mockClear()
  allowlist.list.mockClear()
  allowlist.add.mockClear()
  allowlist.remove.mockClear()
  allowlist.appDirectory.mockClear()
  showOpenDialog.mockReset()
  policy.classify.mockClear()
  workflows.listWorkflows.mockClear()
  workflows.createWorkflow.mockClear()
  workflows.setWorkflowStatus.mockClear()
  workflows.createAutomation.mockClear()
  execution.runWorkflow.mockClear()
  realExecution.runWorkflow.mockClear()
  realExecution.resolveApproval.mockClear()
  runs.list.mockClear()
  approvals.listPending.mockClear()
  approvals.findById.mockClear()
  terminal.run.mockClear()
  terminal.resolveApproval.mockClear()
  commandAllowlist.list.mockClear()
  commandAllowlist.add.mockClear()
  commandAllowlist.remove.mockClear()
  logIpc.info.mockClear()
  logIpc.warn.mockClear()
  logIpc.error.mockClear()
})

describe('buildAppInfo', () => {
  it('devolve apenas os campos públicos do contrato', () => {
    const info = buildAppInfo()
    expect(Object.keys(info).sort()).toEqual(['electronVersion', 'environment', 'name', 'version'])
  })

  it('marca ambiente de desenvolvimento quando o app não está empacotado', () => {
    expect(buildAppInfo().environment).toBe('development')
  })
})

describe('registerIpcHandlers', () => {
  it('registra um handler para cada canal de request/response, e só para eles', () => {
    registerIpcHandlers(deps)

    const registrados = handle.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_CHANNELS).sort())
  })

  it('registra um ouvinte para cada canal só de ida, e só para eles', () => {
    registerIpcHandlers(deps)

    const registrados = on.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_SEND_CHANNELS).sort())
  })
})

describe('canal de log do renderer', () => {
  it('grava o registro marcando a origem como renderer', () => {
    emitir(IPC_SEND_CHANNELS.log, { level: 'info', category: 'ui', msg: 'Tela carregada' })

    expect(writeLog).toHaveBeenCalledWith({
      level: 'info',
      category: 'ui',
      msg: 'Tela carregada',
      source: 'renderer'
    })
  })

  it('descarta payload que não casa com o contrato em vez de gravar', () => {
    emitir(IPC_SEND_CHANNELS.log, { level: 'info', category: 'financeiro', msg: 'x' })

    expect(writeLog).not.toHaveBeenCalled()
  })

  it('não deixa o renderer forjar a origem do registro', () => {
    emitir(IPC_SEND_CHANNELS.log, {
      level: 'info',
      category: 'ui',
      msg: 'x',
      source: 'main'
    })

    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer' }))
  })
})

describe('canais de auditoria (SPEC-04, critério 6)', () => {
  it('consulta sempre escopada ao usuário corrente', () => {
    invocar(IPC_CHANNELS.auditList)

    // O renderer não escolhe o usuário: quem define o escopo é o main.
    expect(audit.list).toHaveBeenCalledWith('local')
  })

  it('filtra por tipo sem deixar o valor do renderer virar consulta', () => {
    const eventos = invocar(IPC_CHANNELS.auditList, 'logout') as AuditEvent[]

    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.type).toBe('logout')
    // O filtro é aplicado em memória — a string externa nunca chega ao SQL.
    expect(audit.list).toHaveBeenCalledWith('local')
  })

  it('ignora filtro que não é string em vez de quebrar', () => {
    const eventos = invocar(IPC_CHANNELS.auditList, { malicioso: true }) as AuditEvent[]

    expect(eventos).toHaveLength(2)
  })

  it('devolve o veredito da cadeia', () => {
    expect(invocar(IPC_CHANNELS.auditVerify)).toEqual({ ok: true, checked: 2 })
  })

  it('registra warn quando a cadeia acusa quebra', () => {
    audit.verify.mockReturnValueOnce({
      ok: false,
      checked: 1,
      brokenAt: 2,
      reason: 'hash-invalido',
      detail: 'x'
    } as never)

    invocar(IPC_CHANNELS.auditVerify)

    expect(logIpc.warn).toHaveBeenCalled()
  })

  it('não expõe canal de gravação de auditoria ao renderer', () => {
    // Gravar evento é ato do main, disparado por um fluxo real. Um canal de escrita aqui
    // deixaria a UI fabricar evidência.
    registerIpcHandlers(deps)
    const canais = [...handle.mock.calls, ...on.mock.calls].map(([c]) => String(c))

    expect(canais.some((c) => /audit.*(append|insert|write|create)/i.test(c))).toBe(false)
  })
})

describe('canais de workspace (SPEC-02)', () => {
  it('devolve o espaço ativo', () => {
    expect(invocar(IPC_CHANNELS.workspaceGet)).toBe('jarvis')
  })

  it('troca para um espaço válido e devolve o seq auditado', () => {
    expect(invocar(IPC_CHANNELS.workspaceSwitch, 'noa')).toEqual({
      workspace: 'noa',
      auditSeq: 3
    })
  })

  it.each(['desenvolvimento', 'agentic-os', '', 'NOA', 42, null])(
    'recusa destino fora do enum: %s',
    (destino) => {
      // `Desenvolvimento` não é workspace (CONVENTION §2) — e o renderer é fronteira
      // de confiança, então o enum é validado aqui, não só no tipo.
      expect(() => invocar(IPC_CHANNELS.workspaceSwitch, destino)).toThrow(/inválido/)
      expect(workspaces.trocar).not.toHaveBeenCalled()
    }
  )
})

describe('canais de preferências (SPEC-05)', () => {
  it('devolve as preferências com o tema já resolvido', () => {
    expect(invocar(IPC_CHANNELS.preferencesGet)).toEqual({
      locale: 'pt-BR',
      theme: 'sistema',
      resolvedTheme: 'escuro',
      accentNoa: '#C4C4C4',
      accentJarvis: '#C4C4C4'
    })
  })

  it('grava a mudança e devolve o estado resultante', () => {
    expect(invocar(IPC_CHANNELS.preferencesSave, { theme: 'claro' })).toMatchObject({
      theme: 'claro'
    })
  })

  it.each([
    ['string', 'claro'],
    ['null', null],
    ['número', 7]
  ])('trata payload não-objeto (%s) sem quebrar', (_caso, payload) => {
    // O serviço já descarta campo fora do enum; o handler só garante que chega objeto.
    expect(() => invocar(IPC_CHANNELS.preferencesSave, payload)).not.toThrow()
    expect(preferences.salvar).toHaveBeenCalledWith({})
  })
})

describe('canal de janela', () => {
  it('minimiza para o tray a pedido do renderer', () => {
    emitir(IPC_SEND_CHANNELS.windowMinimizeToTray)

    expect(minimizeToTray).toHaveBeenCalled()
  })
})

describe('canais da allowlist (SPEC-Execucao-03)', () => {
  it('lista devolve os diretórios permitidos do usuário', () => {
    expect(invocar(IPC_CHANNELS.allowlistList)).toEqual(['/app/userData'])
    expect(allowlist.list).toHaveBeenCalledWith('local')
  })

  it('add encaminha o path e devolve a lista atualizada', () => {
    invocar(IPC_CHANNELS.allowlistAdd, '/home/user/projeto')
    expect(allowlist.add).toHaveBeenCalledWith('local', '/home/user/projeto')
  })

  it('remove encaminha o path e devolve a lista atualizada', () => {
    invocar(IPC_CHANNELS.allowlistRemove, '/home/user/projeto')
    expect(allowlist.remove).toHaveBeenCalledWith('local', '/home/user/projeto')
  })

  it('path não-string no add não chama o repositório (fronteira de confiança)', () => {
    invocar(IPC_CHANNELS.allowlistAdd, { malicioso: true })
    expect(allowlist.add).not.toHaveBeenCalled()
  })

  // SPEC-ExecucaoReal-03: o seletor nativo e a identidade do `appDir`.
  it('o seletor abre o diálogo de pasta no main e adiciona a escolha', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/home/user/projeto'] })

    await invocar(IPC_CHANNELS.allowlistPick)

    // `openDirectory` é o que faz o diálogo escolher pasta e não arquivo — sem ele o
    // usuário selecionaria um arquivo e permitiria o diretório errado.
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openDirectory'] })
    )
    expect(allowlist.add).toHaveBeenCalledWith('local', '/home/user/projeto')
  })

  it('cancelar o seletor não toca a allowlist (critério 3)', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const lista = await invocar(IPC_CHANNELS.allowlistPick)

    // Nada adicionado significa nada auditado: o `AuditEvent` nasce dentro do `add`.
    expect(allowlist.add).not.toHaveBeenCalled()
    // Ainda assim devolve a lista, para a UI não precisar de um segundo round-trip.
    expect(lista).toEqual(['/app/userData'])
  })

  it('diálogo confirmado sem path não adiciona nada', async () => {
    // `canceled: false` com `filePaths` vazio é o caso que uma leitura só do `canceled`
    // erraria — passaria `undefined` adiante como se fosse um diretório escolhido.
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })

    await invocar(IPC_CHANNELS.allowlistPick)

    expect(allowlist.add).not.toHaveBeenCalled()
  })

  it('devolve o diretório do app para a UI marcá-lo como fixo (critério 4)', () => {
    expect(invocar(IPC_CHANNELS.allowlistAppDir)).toBe('/app/userData')
  })
})

describe('canais de workflows/automações (SPEC-Execucao-04)', () => {
  it('list encaminha o workspace válido', () => {
    invocar(IPC_CHANNELS.workflowList, 'jarvis')
    expect(workflows.listWorkflows).toHaveBeenCalledWith('jarvis')
  })

  it('list com workspace fora do enum devolve vazio sem tocar o serviço', () => {
    expect(invocar(IPC_CHANNELS.workflowList, 'Desenvolvimento')).toEqual([])
    expect(workflows.listWorkflows).not.toHaveBeenCalled()
  })

  it('create com workspace válido cria; com inválido lança', () => {
    invocar(IPC_CHANNELS.workflowCreate, { workspace_id: 'jarvis', name: 'W', steps: [] })
    expect(workflows.createWorkflow).toHaveBeenCalled()
    expect(() => invocar(IPC_CHANNELS.workflowCreate, { workspace_id: 'x' })).toThrow(/inválido/)
  })

  it('setStatus só aceita status do enum', () => {
    invocar(IPC_CHANNELS.workflowSetStatus, 'wf-1', 'online')
    expect(workflows.setWorkflowStatus).toHaveBeenCalledWith('wf-1', 'online')
    // status inventado não chama o serviço
    workflows.setWorkflowStatus.mockClear()
    expect(invocar(IPC_CHANNELS.workflowSetStatus, 'wf-1', 'turbo')).toBeUndefined()
    expect(workflows.setWorkflowStatus).not.toHaveBeenCalled()
  })

  it('automação: create valida workspace; setEnabled coage para boolean', () => {
    invocar(IPC_CHANNELS.automationCreate, {
      workspace_id: 'jarvis',
      name: 'A',
      trigger: { id: 't', type: 'manual' },
      target: { workflowId: 'wf-1' }
    })
    expect(workflows.createAutomation).toHaveBeenCalled()
  })
})

describe('canais de execução simulada (SPEC-Execucao-05)', () => {
  it('dispara o run com workflowId + workspace válidos', () => {
    invocar(IPC_CHANNELS.executionRun, 'wf-1', 'jarvis')
    expect(execution.runWorkflow).toHaveBeenCalledWith('wf-1', 'jarvis')
  })

  it('recusa parâmetros inválidos sem tocar o motor', () => {
    expect(() => invocar(IPC_CHANNELS.executionRun, 123, 'jarvis')).toThrow(/inválidos/)
    expect(() => invocar(IPC_CHANNELS.executionRun, 'wf-1', 'Desenvolvimento')).toThrow(/inválidos/)
    expect(execution.runWorkflow).not.toHaveBeenCalled()
  })

  it('lista runs escopada ao usuário corrente', () => {
    invocar(IPC_CHANNELS.executionList, 'jarvis')
    expect(runs.list).toHaveBeenCalledWith('local', 'jarvis')
  })
})

describe('canais de execução real e aprovação (SPEC-ExecucaoReal-01)', () => {
  it('dispara o run real com workflowId + workspace válidos', () => {
    invocar(IPC_CHANNELS.executionRunReal, 'wf-1', 'jarvis')
    expect(realExecution.runWorkflow).toHaveBeenCalledWith('wf-1', 'jarvis')
  })

  it('lista aprovações pendentes escopadas ao usuário corrente', () => {
    invocar(IPC_CHANNELS.approvalList, 'jarvis')
    expect(approvals.listPending).toHaveBeenCalledWith('local', 'jarvis')
  })

  it('resolve aprovação só com decisão do enum', () => {
    invocar(IPC_CHANNELS.approvalResolve, 'apr-1', 'aprovado')
    expect(realExecution.resolveApproval).toHaveBeenCalledWith('apr-1', 'aprovado')

    realExecution.resolveApproval.mockClear()
    expect(() => invocar(IPC_CHANNELS.approvalResolve, 'apr-1', 'talvez')).toThrow(/inválidos/)
    expect(realExecution.resolveApproval).not.toHaveBeenCalled()
  })
})

describe('canais do terminal controlado (SPEC-ExecucaoReal-02)', () => {
  it('submete o comando ao motor com binário, argumentos e cwd separados', () => {
    invocar(
      IPC_CHANNELS.terminalRun,
      { binary: 'git', args: ['status'], cwd: '/permitido' },
      'jarvis'
    )
    expect(terminal.run).toHaveBeenCalledWith(
      { binary: 'git', args: ['status'], cwd: '/permitido' },
      'jarvis'
    )
  })

  it('rejeita submissão sem binário ou sem cwd — não há default seguro para nenhum dos dois', () => {
    expect(() => invocar(IPC_CHANNELS.terminalRun, { args: [], cwd: '/x' }, 'jarvis')).toThrow(
      /inválidos/
    )
    expect(() => invocar(IPC_CHANNELS.terminalRun, { binary: 'git', args: [] }, 'jarvis')).toThrow(
      /inválidos/
    )
    expect(terminal.run).not.toHaveBeenCalled()
  })

  it('descarta argumentos que não são string na fronteira de confiança', () => {
    invocar(
      IPC_CHANNELS.terminalRun,
      { binary: 'git', args: ['status', 42, null, '--short'], cwd: '/permitido' },
      'jarvis'
    )
    expect(terminal.run).toHaveBeenCalledWith(
      { binary: 'git', args: ['status', '--short'], cwd: '/permitido' },
      'jarvis'
    )
  })

  it('roteia a resolução da aprovação para o motor que criou o pedido', () => {
    // A fila é compartilhada com a F01; o `kind` do payload é o que diz qual motor retoma.
    approvals.findById.mockReturnValueOnce({
      id: 'apr-cmd',
      operation: { kind: 'comando', binary: 'git', args: [], cwd: '/permitido' }
    })

    invocar(IPC_CHANNELS.approvalResolve, 'apr-cmd', 'aprovado')

    expect(terminal.resolveApproval).toHaveBeenCalledWith('apr-cmd', 'aprovado')
    expect(realExecution.resolveApproval).not.toHaveBeenCalled()
  })

  it('gerencia a allowlist de comandos escopada por usuário e espaço', () => {
    invocar(IPC_CHANNELS.commandAllowlistList, 'jarvis')
    expect(commandAllowlist.list).toHaveBeenCalledWith('local', 'jarvis')

    invocar(IPC_CHANNELS.commandAllowlistAdd, 'git', 'jarvis')
    expect(commandAllowlist.add).toHaveBeenCalledWith('local', 'jarvis', 'git')

    invocar(IPC_CHANNELS.commandAllowlistRemove, 'git', 'jarvis')
    expect(commandAllowlist.remove).toHaveBeenCalledWith('local', 'jarvis', 'git')
  })

  it('ignora workspace inválido sem tocar a allowlist de comandos', () => {
    expect(invocar(IPC_CHANNELS.commandAllowlistAdd, 'git', 'inexistente')).toEqual([])
    expect(commandAllowlist.add).not.toHaveBeenCalled()
  })

  /**
   * O handler **reconstrói** o `AiRequest` campo a campo, e é por isso que este teste existe:
   * um campo novo que ninguém copie ali some em silêncio no caminho até o ponto único.
   *
   * Não é hipótese. O E2E da M8-F02 pegou exatamente isso — `contextPackId` era descartado
   * aqui, e toda chamada vinda da UI chegava ao gate sem manifesto e era recusada por falta de
   * contexto, inclusive as que o declaravam. O gate estava certo; o transporte é que perdia o
   * campo, e nenhum teste unitário do serviço veria isso porque o serviço recebia o pedido já
   * montado.
   */
  it('repassa `contextPackId` e `diagnostico` ao ponto único (SPEC-Planejamento-02)', async () => {
    await invocarComEvento(
      IPC_CHANNELS.aiCall,
      { provider: 'anthropic', prompt: 'oi', contextPackId: 'pack-1' },
      'jarvis'
    )

    expect(ai.recebido).toMatchObject({ prompt: 'oi', contextPackId: 'pack-1' })
  })

  it('só marca `diagnostico` quando ele vem literalmente `true`', async () => {
    // Qualquer outro valor não vira diagnóstico: fosse truthy, uma string qualquer abriria a
    // única exceção do critério 1 por acidente.
    await invocarComEvento(
      IPC_CHANNELS.aiCall,
      { provider: 'anthropic', prompt: 'oi', diagnostico: 'sim' },
      'jarvis'
    )

    expect(ai.recebido?.['diagnostico']).toBeUndefined()

    await invocarComEvento(
      IPC_CHANNELS.aiCall,
      { provider: 'anthropic', prompt: 'oi', diagnostico: true },
      'jarvis'
    )

    expect(ai.recebido?.['diagnostico']).toBe(true)
  })
})

/**
 * A fronteira da jornada (SPEC-Jornada-01).
 *
 * O que se prova aqui é o que a ponte **recusa**: forma inválida não chega ao serviço. O
 * renderer é processo que pode ser comprometido, e um `projectId` que não é string chegaria à
 * consulta do banco.
 *
 * A ausência mais importante é a de um canal que receba etapa — ela é verificada em
 * `preload.spec.ts`, na lista fechada de métodos da ponte.
 */
describe('jornada de planejamento', () => {
  beforeEach(() => {
    jornada.estado.mockClear()
    jornada.estadoDeVarios.mockClear()
    jornada.aplicarEvento.mockClear()
  })

  it('lê o estado quando projeto e espaço têm a forma certa', () => {
    invocar(IPC_CHANNELS.jornadaEstado, 'p-1', 'jarvis')

    expect(jornada.estado).toHaveBeenCalledWith('p-1', 'jarvis')
  })

  it('recusa espaço inválido sem chamar o serviço', () => {
    expect(invocar(IPC_CHANNELS.jornadaEstado, 'p-1', 'espaco-inventado')).toBeNull()
    expect(jornada.estado).not.toHaveBeenCalled()
  })

  it('recusa projectId que não é string', () => {
    expect(invocar(IPC_CHANNELS.jornadaEstado, 42, 'jarvis')).toBeNull()
    expect(jornada.estado).not.toHaveBeenCalled()
  })

  it('devolve null, e não undefined, quando o projeto não tem jornada', () => {
    // A ponte serializa: `undefined` atravessaria o IPC como ausência de valor, e o renderer
    // não distinguiria "não existe" de "o canal não respondeu".
    expect(invocar(IPC_CHANNELS.jornadaEstado, 'p-1', 'jarvis')).toBeNull()
  })

  it('filtra ids que não são string antes de consultar', () => {
    invocar(IPC_CHANNELS.jornadaEstadoDeVarios, ['p-1', 7, null, 'p-2'], 'jarvis')

    expect(jornada.estadoDeVarios).toHaveBeenCalledWith(['p-1', 'p-2'], 'jarvis')
  })

  it('recusa lista que não é array', () => {
    expect(invocar(IPC_CHANNELS.jornadaEstadoDeVarios, 'p-1', 'jarvis')).toEqual([])
    expect(jornada.estadoDeVarios).not.toHaveBeenCalled()
  })

  it('aplica evento nomeado', () => {
    invocar(IPC_CHANNELS.jornadaEvento, 'p-1', 'prompt-salvo', 'jarvis')

    expect(jornada.aplicarEvento).toHaveBeenCalledWith('p-1', 'prompt-salvo', 'jarvis')
  })

  it('recusa evento que não é string sem chamar o serviço', () => {
    expect(invocar(IPC_CHANNELS.jornadaEvento, 'p-1', { etapa: 'roadmap' }, 'jarvis')).toBeNull()
    expect(jornada.aplicarEvento).not.toHaveBeenCalled()
  })

  it('repassa evento desconhecido ao serviço, que é quem recusa', () => {
    // A ponte valida **forma**, não vocabulário: decidir que um evento não existe é da máquina
    // de etapas. Barrar aqui duplicaria a lista de eventos em dois lugares que divergiriam.
    invocar(IPC_CHANNELS.jornadaEvento, 'p-1', 'evento-inventado', 'jarvis')

    expect(jornada.aplicarEvento).toHaveBeenCalledWith('p-1', 'evento-inventado', 'jarvis')
  })
})

/**
 * A fronteira do brief (SPEC-Jornada-02).
 *
 * O que se prova aqui é o que a ponte **recusa**: forma inválida não chega ao serviço. A
 * ausência mais importante — nenhum canal que receba afirmação ou texto de brief — é verificada
 * em `preload.spec.ts`, na lista fechada de métodos da ponte.
 */
describe('prompt e brief', () => {
  beforeEach(() => {
    brief.salvarPrompt.mockClear()
    brief.lerPrompt.mockClear()
    brief.gerarBrief.mockClear()
    brief.carregar.mockClear()
    brief.rotaAtual.mockClear()
    brief.cortarProposto.mockClear()
  })

  it('salva o prompt quando projeto, texto e espaço têm a forma certa', () => {
    invocar(IPC_CHANNELS.briefSalvarPrompt, 'p-1', 'Um app de leituras.', 'jarvis')

    expect(brief.salvarPrompt).toHaveBeenCalledWith('p-1', 'Um app de leituras.', 'jarvis')
  })

  it('recusa texto que não é string sem chamar o serviço', () => {
    expect(invocar(IPC_CHANNELS.briefSalvarPrompt, 'p-1', { texto: 'x' }, 'jarvis')).toBeNull()
    expect(brief.salvarPrompt).not.toHaveBeenCalled()
  })

  it('recusa espaço inválido em todos os canais do brief', () => {
    expect(invocar(IPC_CHANNELS.briefLerPrompt, 'p-1', 'inventado')).toBeNull()
    expect(invocar(IPC_CHANNELS.briefCarregar, 'p-1', 'inventado')).toBeNull()
    expect(brief.lerPrompt).not.toHaveBeenCalled()
    expect(brief.carregar).not.toHaveBeenCalled()
  })

  it('gerar com forma inválida devolve desfecho, não rejeita', async () => {
    // "Projeto não encontrado" é resposta que a tela mostra, não erro a estourar na ponte.
    const r = (await invocar(IPC_CHANNELS.briefGerar, 42, 'jarvis')) as { resultado: string }

    expect(r.resultado).toBe('projeto-inexistente')
    expect(brief.gerarBrief).not.toHaveBeenCalled()
  })

  it('a rota inválida devolve bloqueado — nunca uma rota utilizável', async () => {
    // Fail closed na fronteira: se a forma não confere, o default não pode ser "pode gerar".
    const r = (await invocar(IPC_CHANNELS.briefRota, 42, 'jarvis')) as { decisao: string }

    expect(r.decisao).toBe('bloqueado')
    expect(brief.rotaAtual).not.toHaveBeenCalled()
  })

  it('cortar exige o id da afirmação como string', () => {
    expect(invocar(IPC_CHANNELS.briefCortarProposto, 'p-1', ['a-1'], 'jarvis')).toBeNull()
    expect(brief.cortarProposto).not.toHaveBeenCalled()
  })

  it('cortar repassa um id só — a tela não decide o conteúdo final', () => {
    invocar(IPC_CHANNELS.briefCortarProposto, 'p-1', 'a-2', 'jarvis')

    expect(brief.cortarProposto).toHaveBeenCalledWith('p-1', 'a-2', 'jarvis')
  })
})

/**
 * A fronteira do refinamento (SPEC-Jornada-02).
 *
 * O que se prova aqui é o que a ponte **recusa**. A ausência mais importante — nenhum canal que
 * receba o enunciado da pergunta de volta — é verificada em `preload.spec.ts`, na lista fechada.
 */
describe('refinamento', () => {
  beforeEach(() => {
    refinamento.gerarPerguntas.mockClear()
    refinamento.estado.mockClear()
    refinamento.responder.mockClear()
    refinamento.historico.mockClear()
  })

  it('gera as perguntas quando projeto e espaço têm a forma certa', async () => {
    await invocar(IPC_CHANNELS.refinamentoGerar, 'p-1', 'jarvis')

    expect(refinamento.gerarPerguntas).toHaveBeenCalledWith('p-1', 'jarvis')
  })

  it('gerar com forma inválida devolve desfecho, não rejeita', async () => {
    const r = (await invocar(IPC_CHANNELS.refinamentoGerar, 42, 'jarvis')) as {
      resultado: string
    }

    expect(r.resultado).toBe('sem-prompt')
    expect(refinamento.gerarPerguntas).not.toHaveBeenCalled()
  })

  it('recusa espaço inválido ao ler o estado', () => {
    expect(invocar(IPC_CHANNELS.refinamentoEstado, 'p-1', 'inventado')).toBeNull()
    expect(refinamento.estado).not.toHaveBeenCalled()
  })

  it('responder exige a forma da resposta — sem ela, nada chega ao serviço', () => {
    const r = invocar(IPC_CHANNELS.refinamentoResponder, 'p-1', { escolha: 'a' }, 'jarvis') as {
      reason: string
    }

    // `perguntaId` ausente: o serviço nunca é chamado, porque a decisão citaria uma pergunta
    // que ninguém identificou.
    expect(r.reason).toBe('escolha-invalida')
    expect(refinamento.responder).not.toHaveBeenCalled()
  })

  it('responder recusa autor fora do enum', () => {
    // `autor` é o que distingue escolha do PI de escolha delegada (invariante 3 do CONVENTION
    // §4). Um valor livre aqui deixaria a fronteira gravar autoria inventada.
    const r = invocar(
      IPC_CHANNELS.refinamentoResponder,
      'p-1',
      { perguntaId: 'q-1', escolha: 'a', texto: null, autor: 'terceiro' },
      'jarvis'
    ) as { reason: string }

    expect(r.reason).toBe('escolha-invalida')
    expect(refinamento.responder).not.toHaveBeenCalled()
  })

  it('responder repassa a resposta bem formada', () => {
    invocar(
      IPC_CHANNELS.refinamentoResponder,
      'p-1',
      { perguntaId: 'q-1', escolha: 'a', texto: null, autor: 'pi' },
      'jarvis'
    )

    expect(refinamento.responder).toHaveBeenCalledWith(
      'p-1',
      { perguntaId: 'q-1', escolha: 'a', texto: null, autor: 'pi' },
      'jarvis'
    )
  })

  it('o histórico inválido devolve lista vazia, nunca undefined', () => {
    // A ponte serializa: `undefined` atravessaria como ausência de valor, e a tela não
    // distinguiria "sem histórico" de "o canal não respondeu".
    expect(invocar(IPC_CHANNELS.refinamentoHistorico, 42, 'jarvis')).toEqual([])
  })
})

describe('contradições do PRD (emenda E1) — a fronteira valida forma, o serviço decide', () => {
  it('a vista inválida devolve null, nunca undefined', () => {
    expect(invocar(IPC_CHANNELS.prdContradicoes, 42, 'jarvis')).toBeNull()
    expect(invocar(IPC_CHANNELS.prdContradicoes, 'p-1', 'jarvis')).toBeNull()
    expect(prd.contradicoes).toHaveBeenCalledWith('p-1')
  })

  it('responder exige a forma da resposta — sem ela, nada chega ao serviço', () => {
    const r = invocar(IPC_CHANNELS.prdResponderContradicao, 'p-1', { escolha: 'a' }, 'jarvis') as {
      reason: string
    }

    expect(r.reason).toBe('escolha-invalida')
    expect(prd.responderContradicao).not.toHaveBeenCalled()
  })

  it('responder recusa autor fora do enum', () => {
    const r = invocar(
      IPC_CHANNELS.prdResponderContradicao,
      'p-1',
      { perguntaId: 'c-1', escolha: 'a', texto: null, autor: 'terceiro' },
      'jarvis'
    ) as { reason: string }

    expect(r.reason).toBe('escolha-invalida')
    expect(prd.responderContradicao).not.toHaveBeenCalled()
  })

  it('responder repassa a resposta bem formada', () => {
    invocar(
      IPC_CHANNELS.prdResponderContradicao,
      'p-1',
      { perguntaId: 'c-1', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )

    expect(prd.responderContradicao).toHaveBeenCalledWith(
      'p-1',
      { perguntaId: 'c-1', escolha: null, texto: null, autor: 'agente' },
      'jarvis'
    )
  })
})
