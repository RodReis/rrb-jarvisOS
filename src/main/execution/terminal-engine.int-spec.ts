/**
 * Terminal controlado (SPEC-ExecucaoReal-02, categoria Banco).
 *
 * A prova é **por efeito**, como na F01: o comando permitido deixa um arquivo no disco; o
 * barrado não deixa nada. Verificar só o estado devolvido provaria que o motor *diz* ter
 * barrado — não que barrou.
 *
 * Os comandos usados são `node` (sempre presente, é o que roda a suíte) e um binário
 * inexistente. Nada de `rm`/`git` de verdade: o teste não deve depender do que está instalado
 * na máquina nem apagar nada fora do diretório temporário.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
const { ExecutionRepository } = await import('./execution-repository')
const { ApprovalRepository } = await import('./approval-repository')
const { TerminalEngine } = await import('./terminal-engine')

let dir: string
let appDir: string
let permitido: string
let fora: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let comandos: InstanceType<typeof CommandAllowlistRepository>
let approvals: InstanceType<typeof ApprovalRepository>
let engine: InstanceType<typeof TerminalEngine>

/** Um comando `node -e` que cria um arquivo — o efeito observável de "executou de verdade". */
function criaArquivo(alvo: string): readonly string[] {
  return ['-e', `require('fs').writeFileSync(${JSON.stringify(alvo)}, 'efeito')`]
}

function montarEngine(timeoutMs?: number): InstanceType<typeof TerminalEngine> {
  const policy = new PolicyService(audit, () => 'u-1')
  const diretorios = new AllowlistRepository(db, audit, appDir)
  diretorios.add('u-1', permitido)
  comandos = new CommandAllowlistRepository(db, audit, policy)

  return new TerminalEngine(
    policy,
    comandos,
    diretorios,
    new ExecutionRepository(db),
    approvals,
    audit,
    () => 'u-1',
    timeoutMs
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-terminal-'))
  appDir = join(dir, 'userData')
  permitido = join(dir, 'permitido')
  fora = join(dir, 'fora')
  mkdirSync(appDir)
  mkdirSync(permitido)
  mkdirSync(fora)

  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  approvals = new ApprovalRepository(db)
  engine = montarEngine()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('primeira barreira — allowlist de binário', () => {
  it('barra binário fora da allowlist sem produzir efeito (critério 1)', () => {
    const alvo = join(permitido, 'nao-deve-existir.txt')

    const execucao = engine.run(
      { binary: 'node', args: criaArquivo(alvo), cwd: permitido },
      'jarvis'
    )

    expect(execucao.state).toBe('bloqueado')
    expect(execucao.reason).toBe('binario-fora-da-allowlist')
    expect(existsSync(alvo)).toBe(false)
    expect(execucao.exitCode).toBeNull()
    // A tentativa barrada deixa rastro: par antes/depois, mesmo sem execução.
    expect(audit.list('u-1').filter((e) => e.type === 'terminal-command')).toHaveLength(2)
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('barra tudo enquanto a allowlist estiver vazia (default de fábrica)', () => {
    expect(comandos.list('u-1', 'jarvis')).toHaveLength(0)
    expect(engine.run({ binary: 'node', args: ['-v'], cwd: permitido }, 'jarvis').state).toBe(
      'bloqueado'
    )
  })

  it('escopa a allowlist por workspace — permitir no JARVIS não libera no NOA', () => {
    comandos.add('u-1', 'jarvis', 'node')

    expect(engine.run({ binary: 'node', args: ['-v'], cwd: permitido }, 'jarvis').state).toBe(
      'concluido'
    )
    expect(engine.run({ binary: 'node', args: ['-v'], cwd: permitido }, 'noa').reason).toBe(
      'binario-fora-da-allowlist'
    )
  })
})

describe('execução real (critério 2)', () => {
  it('executa comando permitido e audita antes/depois com saída e exit code', () => {
    comandos.add('u-1', 'jarvis', 'node')
    const alvo = join(permitido, 'criado.txt')

    const execucao = engine.run(
      { binary: 'node', args: criaArquivo(alvo), cwd: permitido },
      'jarvis'
    )

    expect(execucao.state).toBe('concluido')
    expect(execucao.reason).toBe('executado')
    expect(execucao.exitCode).toBe(0)
    expect(execucao.durationMs).toBeGreaterThanOrEqual(0)
    // O efeito é a prova: o arquivo existe porque o processo rodou de verdade.
    expect(existsSync(alvo)).toBe(true)

    const eventos = audit.list('u-1').filter((e) => e.type === 'terminal-command')
    expect(eventos).toHaveLength(2)
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('captura stdout do processo', () => {
    comandos.add('u-1', 'jarvis', 'node')

    const execucao = engine.run(
      { binary: 'node', args: ['-e', 'console.log("ola do processo")'], cwd: permitido },
      'jarvis'
    )

    expect(execucao.stdout).toContain('ola do processo')
  })

  it('não repassa o ambiente do main ao processo filho', () => {
    // Um segredo no env do app não pode alcançar um comando allowlistado: a allowlist de
    // binários não protege contra isso — o binário é legítimo, o que vazaria é o ambiente.
    comandos.add('u-1', 'jarvis', 'node')
    process.env['JARVIS_SEGREDO_DE_TESTE'] = 'nao-deve-vazar'

    try {
      const execucao = engine.run(
        {
          binary: 'node',
          args: ['-e', 'console.log(process.env.JARVIS_SEGREDO_DE_TESTE ?? "ausente")'],
          cwd: permitido
        },
        'jarvis'
      )

      expect(execucao.stdout).toContain('ausente')
      expect(execucao.stdout).not.toContain('nao-deve-vazar')
    } finally {
      delete process.env['JARVIS_SEGREDO_DE_TESTE']
    }
  })
})

describe('cwd na allowlist de diretórios (critério 3)', () => {
  it('barra cwd fora da allowlist sem produzir efeito', () => {
    comandos.add('u-1', 'jarvis', 'node')
    const alvo = join(fora, 'nao-deve-existir.txt')

    const execucao = engine.run({ binary: 'node', args: criaArquivo(alvo), cwd: fora }, 'jarvis')

    expect(execucao.state).toBe('bloqueado')
    expect(execucao.reason).toBe('cwd-fora-da-allowlist')
    expect(existsSync(alvo)).toBe(false)
  })

  it('barra travessia com .. que escapa do diretório permitido', () => {
    comandos.add('u-1', 'jarvis', 'node')

    const execucao = engine.run(
      { binary: 'node', args: ['-v'], cwd: join(permitido, '..', 'fora') },
      'jarvis'
    )

    expect(execucao.reason).toBe('cwd-fora-da-allowlist')
  })
})

describe('segunda barreira — denylist destrutiva (critério 4)', () => {
  it('pausa comando destrutivo mesmo com binário allowlistado, e executa se aprovado', () => {
    comandos.add('u-1', 'jarvis', 'node')
    const alvo = join(permitido, 'aprovado.txt')

    // `--force` casa a denylist universal: binário permitido, uso destrutivo. Vai depois do
    // `--` para o `node` tratá-lo como argumento do script (ele rejeita flags que não conhece)
    // — o motor inspeciona a lista de argumentos inteira, então a posição não muda a barreira.
    const pendente = engine.run(
      { binary: 'node', args: [...criaArquivo(alvo), '--', '--force'], cwd: permitido },
      'jarvis'
    )

    expect(pendente.state).toBe('aguardando-aprovacao')
    expect(pendente.motivoDestrutivo).toBeDefined()
    expect(existsSync(alvo)).toBe(false)

    const fila = approvals.listPending('u-1', 'jarvis')
    expect(fila).toHaveLength(1)

    const concluido = engine.resolveApproval(fila[0]!.id, 'aprovado')

    expect(concluido?.state).toBe('concluido')
    expect(existsSync(alvo)).toBe(true)
    expect(approvals.listPending('u-1', 'jarvis')).toHaveLength(0)
  })

  it('não executa quando a aprovação é negada', () => {
    comandos.add('u-1', 'jarvis', 'node')
    const alvo = join(permitido, 'negado.txt')

    engine.run(
      { binary: 'node', args: [...criaArquivo(alvo), '--', '--force'], cwd: permitido },
      'jarvis'
    )
    const pedido = approvals.listPending('u-1', 'jarvis')[0]!

    const negado = engine.resolveApproval(pedido.id, 'negado')

    expect(negado?.state).toBe('bloqueado')
    expect(negado?.reason).toBe('aprovacao-negada')
    expect(existsSync(alvo)).toBe(false)
  })

  it('não deixa a aprovação sobrepor uma allowlist revogada no meio do caminho', () => {
    // A aprovação autoriza este comando; ela não congela o mundo. Revogar o binário enquanto
    // o pedido espera tem de barrar a execução, senão aprovar viraria exceção permanente.
    comandos.add('u-1', 'jarvis', 'node')
    const alvo = join(permitido, 'revogado.txt')

    engine.run(
      { binary: 'node', args: [...criaArquivo(alvo), '--', '--force'], cwd: permitido },
      'jarvis'
    )
    const pedido = approvals.listPending('u-1', 'jarvis')[0]!

    comandos.remove('u-1', 'jarvis', 'node')
    const depois = engine.resolveApproval(pedido.id, 'aprovado')

    expect(depois?.reason).toBe('binario-fora-da-allowlist')
    expect(existsSync(alvo)).toBe(false)
  })
})

describe('timeout obrigatório (critério 5)', () => {
  it('mata o processo que excede o limite e marca como falhou', () => {
    engine = montarEngine(300)
    comandos.add('u-1', 'jarvis', 'node')

    const execucao = engine.run(
      // Bloqueia o event loop por 5s — bem além do timeout de 300ms.
      {
        binary: 'node',
        args: ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)'],
        cwd: permitido
      },
      'jarvis'
    )

    expect(execucao.state).toBe('falhou')
    expect(execucao.reason).toBe('timeout-excedido')
    expect(execucao.exitCode).toBeNull()
    expect(execucao.stderr).toContain('encerrado por exceder')
    expect(audit.list('u-1').filter((e) => e.type === 'terminal-command')).toHaveLength(2)
  })
})

describe('sem elevação (critério 6)', () => {
  it('barra tentativa de elevação mesmo que o binário esteja na allowlist', () => {
    // Permitir `sudo` explicitamente não pode destravar o que a ARCHITECTURE proíbe.
    comandos.add('u-1', 'jarvis', 'sudo')

    const execucao = engine.run({ binary: 'sudo', args: ['node', '-v'], cwd: permitido }, 'jarvis')

    expect(execucao.state).toBe('bloqueado')
    expect(execucao.reason).toBe('elevacao-negada')
  })
})

describe('edição da allowlist de comandos (critério 7)', () => {
  it('audita e classifica como alto risco cada mudança', () => {
    comandos.add('u-1', 'jarvis', 'node')
    comandos.remove('u-1', 'jarvis', 'node')

    const eventos = audit.list('u-1')
    const mudancas = eventos.filter(
      (e) => e.type === 'allowlist-change' && e.payload['alvo'] === 'comando'
    )
    const decisoes = eventos.filter(
      (e) => e.type === 'policy-decision' && e.payload['action'] === 'permissions.change'
    )

    expect(mudancas).toHaveLength(2)
    expect(decisoes).toHaveLength(2)
    expect(decisoes.every((e) => e.payload['tier'] === 'alto')).toBe(true)
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('não audita re-adição de comando já permitido (no-op não é decisão)', () => {
    comandos.add('u-1', 'jarvis', 'node')
    const antes = audit.list('u-1').length

    comandos.add('u-1', 'jarvis', 'NODE.EXE')

    expect(audit.list('u-1')).toHaveLength(antes)
    expect(comandos.list('u-1', 'jarvis')).toEqual(['node'])
  })
})

describe('erro de execução (critério 8)', () => {
  it('mostra o erro na saída E gera AuditEvent', () => {
    comandos.add('u-1', 'jarvis', 'node')

    const execucao = engine.run(
      { binary: 'node', args: ['-e', 'process.exit(3)'], cwd: permitido },
      'jarvis'
    )

    expect(execucao.state).toBe('falhou')
    expect(execucao.exitCode).toBe(3)

    const erro = audit
      .list('u-1')
      .filter((e) => e.type === 'terminal-command' && e.payload['marco'] === 'erro')
    expect(erro).toHaveLength(1)
    expect(erro[0]?.payload['exitCode']).toBe(3)
  })

  it('reporta stderr do processo na saída da execução', () => {
    comandos.add('u-1', 'jarvis', 'node')

    const execucao = engine.run(
      {
        binary: 'node',
        args: ['-e', 'console.error("deu ruim"); process.exit(1)'],
        cwd: permitido
      },
      'jarvis'
    )

    expect(execucao.stderr).toContain('deu ruim')
    expect(execucao.state).toBe('falhou')
  })

  it('reporta falha de spawn quando o binário permitido não existe no sistema', () => {
    comandos.add('u-1', 'jarvis', 'binario-que-nao-existe-jarvis')

    const execucao = engine.run(
      { binary: 'binario-que-nao-existe-jarvis', args: [], cwd: permitido },
      'jarvis'
    )

    expect(execucao.state).toBe('falhou')
    expect(execucao.reason).toBe('falha-na-execucao')
    expect(execucao.stderr.length).toBeGreaterThan(0)
  })
})
