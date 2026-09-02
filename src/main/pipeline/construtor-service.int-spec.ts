import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { ConstrutorService } from './construtor-service'
import type { DockerRunner } from './docker-runner'
import type { PipelineRepository } from './pipeline-repository'
import type { AuditRepository } from '../storage/audit-repository'
import type { SandboxPreparado } from '@shared/domain/preflight'

const sandbox: SandboxPreparado = {
  runId: 'run-1',
  containerNome: 'jarvis-run-1',
  cwd: '/work',
  baseSha: 'abc123',
  branch: 'feat/run-1',
  worktreeNoHost: '/host/worktree',
  pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'SPEC-Entrega-04 §Entrada' },
  proxyUrl: 'http://172.20.0.2:8080'
}

function dockerDuble(
  roteiro: (comando: readonly string[]) => {
    ok: boolean
    stdout: string
    stderr: string
    exitCode: number | null
    timeoutExcedido: boolean
  }
): DockerRunner {
  return {
    exec: vi.fn((_container: string, comando: readonly string[]) => roteiro(comando)),
    matarProcesso: vi.fn()
  } as unknown as DockerRunner
}

/**
 * Simula o compare-and-set real de `PipelineRepository.transicionar`: só aplica (e retorna
 * `true`) quando `de` bate com o estado atual simulado; senão recusa (`false`) sem mudar nada.
 * Um double que sempre retorna `true` esconderia exatamente o bug do finding #1.
 */
function repoDuble(estadoInicial: string = 'RUNNING'): PipelineRepository {
  let estadoAtual = estadoInicial
  return {
    transicionar: vi.fn((_runId: string, de: string, para: string) => {
      if (de !== estadoAtual) return false
      estadoAtual = para
      return true
    })
  } as unknown as PipelineRepository
}

function auditDuble(): AuditRepository {
  return { append: vi.fn() } as unknown as AuditRepository
}

const comandosDeValidacao = {
  test: ['npm', 'run', 'test'],
  lint: ['npm', 'run', 'lint'],
  typecheck: ['npm', 'run', 'typecheck'],
  build: ['npm', 'run', 'build']
}

describe('ConstrutorService — tentativa única bem-sucedida', () => {
  it('claude roda, validação passa, run vai para PR_CI numa tentativa só', async () => {
    const docker = dockerDuble((comando) => {
      // git status vazio: nenhum arquivo tocado, dentro do escopo por vacuidade.
      if (comando[0] === 'git' && comando.includes('status')) {
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      }
      // Todo outro comando (claude e os 4 de validação) responde ok nesta suíte.
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const audit = auditDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      audit,
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(resultado.tentativas).toHaveLength(1)
    expect(resultado.tentativas[0]?.numero).toBe(1)
    expect(pipeline.transicionar).toHaveBeenCalledWith(
      'run-1',
      'RUNNING',
      'VALIDATING',
      expect.any(Date),
      undefined
    )
    expect(pipeline.transicionar).toHaveBeenCalledWith(
      'run-1',
      'VALIDATING',
      'PR_CI',
      expect.any(Date),
      undefined
    )
  })
})

describe('ConstrutorService — recuperação corrigível', () => {
  it('validação falha corrigível na 1ª tentativa, passa na 2ª: run termina em PR_CI com 2 tentativas', async () => {
    let chamadasDeValidacao = 0
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude')
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando[0] === 'git' && comando.includes('status')) {
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      }
      // Só a validação de teste falha, e só na primeira passagem.
      if (comando.includes('test')) {
        chamadasDeValidacao += 1
        if (chamadasDeValidacao === 1) {
          return {
            ok: false,
            stdout: 'FAIL src/foo.spec.ts',
            stderr: '',
            exitCode: 1,
            timeoutExcedido: false
          }
        }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(resultado.tentativas).toHaveLength(2)
    expect(resultado.tentativas[0]?.classificacao).toBe('corrigivel')
    expect(pipeline.transicionar).toHaveBeenCalledWith(
      'run-1',
      'VALIDATING',
      'RUNNING',
      expect.any(Date),
      undefined
    )
  })

  /**
   * Critério 3 ("recuperação não repete descoberta resolvida") e a regra da SPEC ("recuperação
   * recebe diff atual, erros novos e histórico resumido") não tinham teste algum: trocar
   * `promptDaVez = promptDeRecuperacao(...)` por `promptDaVez = pedido.promptInicial` deixava
   * os 16 testes anteriores verdes. Este teste captura o prompt de cada chamada ao `claude` e
   * afirma que a segunda é DIFERENTE da primeira e carrega o stderr da falha anterior.
   */
  it('a 2ª chamada ao claude recebe prompt de recuperação, diferente do inicial, com o erro anterior', async () => {
    const promptsDoClaude: string[] = []
    let chamadasDeValidacao = 0
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') {
        promptsDoClaude.push(comando[2] ?? '')
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      }
      if (comando[0] === 'git' && comando.includes('status')) {
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      }
      if (comando.includes('test')) {
        chamadasDeValidacao += 1
        if (chamadasDeValidacao === 1) {
          return {
            ok: false,
            stdout: '',
            stderr: 'TypeError: erro específico da tentativa 1',
            exitCode: 1,
            timeoutExcedido: false
          }
        }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(promptsDoClaude).toHaveLength(2)
    expect(promptsDoClaude[0]).toBe('Implemente a SPEC.')
    expect(promptsDoClaude[1]).not.toBe('Implemente a SPEC.')
    expect(promptsDoClaude[1]).toContain('TypeError: erro específico da tentativa 1')
    expect(promptsDoClaude[1]).toMatch(/Tentativa 1/)
  })
})

describe('ConstrutorService — três tentativas esgotadas', () => {
  it('validação falha corrigível nas três tentativas: run termina BLOCKED', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude')
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando.includes('test'))
        return { ok: false, stdout: 'FAIL sempre', stderr: '', exitCode: 1, timeoutExcedido: false }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.tentativas).toHaveLength(3)
    expect(resultado.bloqueio?.causa).toBe('corrigivel')
    expect(pipeline.transicionar).toHaveBeenCalledWith(
      'run-1',
      'VALIDATING',
      'BLOCKED',
      expect.any(Date),
      expect.anything()
    )
  })
})

describe('ConstrutorService — falha externa não gasta tentativa de correção, bloqueia direto', () => {
  it('erro de rede na chamada ao claude bloqueia sem tentar recuperação', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') {
        return {
          ok: false,
          stdout: '',
          stderr: 'ETIMEDOUT: connection timed out',
          exitCode: 1,
          timeoutExcedido: false
        }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.bloqueio?.causa).toBe('externo')
    expect(resultado.tentativas).toHaveLength(1)
  })
})

describe('ConstrutorService — bloqueio por falha do claude sai de RUNNING, não de VALIDATING', () => {
  it('erro de rede na chamada ao claude transiciona RUNNING -> BLOCKED (nunca VALIDATING -> BLOCKED)', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') {
        return {
          ok: false,
          stdout: '',
          stderr: 'ETIMEDOUT: connection timed out',
          exitCode: 1,
          timeoutExcedido: false
        }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    // Com o double simulando compare-and-set de verdade: se o serviço tentasse
    // VALIDATING -> BLOCKED aqui (o bug do finding #1), a chamada seria recusada (`de` não bate
    // com o estado real do run, que nunca saiu de RUNNING) e o resultado devolvido seria
    // inconsistente com o banco — exatamente o que este teste existe para pegar.
    expect(pipeline.transicionar).toHaveBeenCalledWith(
      'run-1',
      'RUNNING',
      'BLOCKED',
      expect.any(Date),
      expect.anything()
    )
    expect(pipeline.transicionar).not.toHaveBeenCalledWith(
      'run-1',
      'VALIDATING',
      'BLOCKED',
      expect.any(Date),
      expect.anything()
    )
  })
})

describe('ConstrutorService — comando do executor é sempre dentro do container', () => {
  it('nenhuma chamada usa cwd do host; container é sempre o nome do sandbox', async () => {
    const chamadas: string[][] = []
    const docker = {
      exec: vi.fn((container: string, comando: readonly string[]) => {
        expect(container).toBe(sandbox.containerNome)
        chamadas.push([...comando])
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    expect(chamadas.length).toBeGreaterThan(0)
    expect(chamadas[0]?.[0]).toBe('claude')
  })
})

describe('ConstrutorService — sem container não há execução (critério 8)', () => {
  it('todo comando de claude e validação passa pelo DockerRunner.exec com o nome do container do sandbox — nunca um caminho de execução direta no host', async () => {
    const containersUsados = new Set<string>()
    const docker = {
      exec: vi.fn((container: string, comando: readonly string[]) => {
        containersUsados.add(container)
        if (comando[0] === 'git' && comando.includes('status')) {
          return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
        }
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    // Seis chamadas (claude + 4 validadores + git status de verificação de escopo), todas no
    // mesmo container — nunca vazio, nunca um segundo caminho que ignore o sandbox.
    expect(docker.exec).toHaveBeenCalledTimes(6)
    expect(containersUsados.size).toBe(1)
    expect(containersUsados.has(sandbox.containerNome)).toBe(true)
  })
})

describe('ConstrutorService — cancelamento mata a árvore de processos (critério 5)', () => {
  it('sinal abortado entre passos interrompe o laço e chama matarProcesso, sem completar a construção', async () => {
    const controle = new AbortController()
    let chamadasExec = 0
    const docker = {
      exec: vi.fn(() => {
        chamadasExec += 1
        if (chamadasExec === 1) controle.abort() // aborta depois do primeiro passo (claude)
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const pipeline = repoDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'x',
      comandosDeValidacao,
      signal: controle.signal
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(docker.matarProcesso).toHaveBeenCalledWith(sandbox.containerNome, sandbox.worktreeNoHost)
    // Não chegou a rodar os 4 validadores inteiros — parou no meio.
    expect(chamadasExec).toBeLessThan(5)
  })

  it('cancelar() explícito mata processos sem esperar o próximo passo', () => {
    const docker = { exec: vi.fn(), matarProcesso: vi.fn() } as unknown as DockerRunner
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    service.cancelar('run-1', sandbox)

    expect(docker.matarProcesso).toHaveBeenCalledWith(sandbox.containerNome, sandbox.worktreeNoHost)
  })
})

describe('ConstrutorService — alteração fora do escopo bloqueia (critério 4)', () => {
  it('status com arquivo fora de pathsPermitidos bloqueia antes de PR_CI, mesmo com validação verde', async () => {
    const docker = {
      exec: vi.fn((_container: string, comando: readonly string[]) => {
        if (comando[0] === 'git' && comando.includes('status')) {
          return {
            ok: true,
            stdout: ' M src/foo.ts\n?? segredo/fora-do-escopo.ts\n',
            stderr: '',
            exitCode: 0,
            timeoutExcedido: false
          }
        }
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const sandboxComEscopo: SandboxPreparado = {
      ...sandbox,
      pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'teste' }
    }
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox: sandboxComEscopo,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.bloqueio?.causa).toBe('risco-usuario')
    expect(resultado.bloqueio?.evidencia).toContain('segredo/fora-do-escopo.ts')
  })

  it('arquivo novo não rastreado (?? no status) fora do escopo também bloqueia — o vetor do critical #1', async () => {
    const docker = {
      exec: vi.fn((_container: string, comando: readonly string[]) => {
        if (comando[0] === 'git' && comando.includes('status')) {
          // Só `??`, sem nenhum arquivo modificado: exatamente o estado que `git diff
          // --name-only` (sem `git add` prévio) NUNCA reportaria, e que era o bug do critical #1.
          return {
            ok: true,
            stdout: '?? segredo/backdoor.ts\n',
            stderr: '',
            exitCode: 0,
            timeoutExcedido: false
          }
        }
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const sandboxComEscopo: SandboxPreparado = {
      ...sandbox,
      pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'teste' }
    }
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox: sandboxComEscopo,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.bloqueio?.causa).toBe('risco-usuario')
    expect(resultado.bloqueio?.evidencia).toContain('segredo/backdoor.ts')
  })

  it('status inteiramente dentro do escopo segue para PR_CI normalmente', async () => {
    const docker = {
      exec: vi.fn((_container: string, comando: readonly string[]) => {
        if (comando[0] === 'git' && comando.includes('status')) {
          return {
            ok: true,
            stdout: ' M src/foo.ts\n?? src/bar.ts\n',
            stderr: '',
            exitCode: 0,
            timeoutExcedido: false
          }
        }
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const sandboxComEscopo: SandboxPreparado = {
      ...sandbox,
      pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'teste' }
    }
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox: sandboxComEscopo,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
  })
})

describe('ConstrutorService — verificação de escopo contra Git real (critical #1)', () => {
  /**
   * `git diff --name-only` (o comando original desta checagem) NUNCA enxerga um arquivo novo e
   * não commitado — e o worktree do run nunca passa por `git add`. Um agente que cria
   * `segredo/backdoor.ts` sem tocar em arquivo já rastreado escaparia da checagem por completo.
   * Este teste roda o `docker.exec` double contra um repositório Git de verdade (sem `git add`
   * do arquivo novo, replicando o estado real do worktree) para provar que o comando trocado
   * (`git status --porcelain --untracked-files=all`) realmente vê o que o `git diff` não via —
   * nenhum path é fabricado pelo double, só o resultado real do comando.
   */
  it('arquivo novo não commitado fora do escopo é visto pelo comando real e bloqueia', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-construtor-'))
    try {
      execFileSync('git', ['init', '--initial-branch=main', dir], { encoding: 'utf8' })
      execFileSync('git', ['config', 'user.email', 'teste@exemplo.com'], {
        cwd: dir,
        encoding: 'utf8'
      })
      execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: dir, encoding: 'utf8' })
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'a.ts'), 'a\n')
      execFileSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' })
      execFileSync('git', ['commit', '-m', 'inicial'], { cwd: dir, encoding: 'utf8' })

      // Modifica um arquivo rastreado (dentro do escopo) e cria um arquivo novo fora do
      // escopo — sem `git add`, exatamente o estado do worktree quando o ConstrutorService roda.
      writeFileSync(join(dir, 'src', 'a.ts'), 'a\nb\n')
      mkdirSync(join(dir, 'segredo'), { recursive: true })
      writeFileSync(join(dir, 'segredo', 'backdoor.ts'), 'backdoor\n')

      const docker = {
        exec: vi.fn((_container: string, comando: readonly string[]) => {
          // Só o comando `git` desta checagem roda de verdade — claude e os 4 validadores
          // seguem dublados, porque o que este teste mede é a semântica do `git status`, não o
          // resto do pipeline (já coberto pelos outros testes deste arquivo).
          if (comando[0] !== 'git')
            return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
          const stdout = execFileSync('git', [...comando.slice(1)], { cwd: dir, encoding: 'utf8' })
          return { ok: true, stdout, stderr: '', exitCode: 0, timeoutExcedido: false }
        }),
        matarProcesso: vi.fn()
      } as unknown as DockerRunner
      const sandboxComEscopo: SandboxPreparado = {
        ...sandbox,
        pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'teste' }
      }
      const service = new ConstrutorService(
        docker,
        repoDuble(),
        auditDuble(),
        () => 'u1',
        () => 'ws1' as never
      )

      const resultado = await service.construir({
        runId: 'run-1',
        sandbox: sandboxComEscopo,
        promptInicial: 'x',
        comandosDeValidacao
      })

      expect(resultado.estadoFinal).toBe('BLOCKED')
      expect(resultado.bloqueio?.causa).toBe('risco-usuario')
      expect(resultado.bloqueio?.evidencia).toContain('segredo/backdoor.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /**
   * Com `core.quotepath` ligado (padrão do Git), um path non-ASCII sai quotado/escapado em
   * octal. Sem `-c core.quotepath=false` no comando, `desaspar` falha o `JSON.parse` e devolve
   * a string crua com aspas — a aspa vira o primeiro segmento e o arquivo, que está DENTRO do
   * escopo, é reportado como fuga espúria (falso bloqueio num projeto pt-BR).
   */
  it('arquivo com acento dentro do escopo não é reportado como fuga (core.quotepath)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-construtor-quotepath-'))
    try {
      execFileSync('git', ['init', '--initial-branch=main', dir], { encoding: 'utf8' })
      execFileSync('git', ['config', 'user.email', 'teste@exemplo.com'], {
        cwd: dir,
        encoding: 'utf8'
      })
      execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: dir, encoding: 'utf8' })
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'a.ts'), 'a\n')
      execFileSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' })
      execFileSync('git', ['commit', '-m', 'inicial'], { cwd: dir, encoding: 'utf8' })

      // Arquivo novo, non-ASCII, DENTRO do escopo declarado (src) — sem git add, como o
      // worktree do run está de verdade quando ConstrutorService roda.
      writeFileSync(join(dir, 'src', 'ação.ts'), 'ação\n')

      const docker = {
        exec: vi.fn((_container: string, comando: readonly string[]) => {
          if (comando[0] !== 'git')
            return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
          const stdout = execFileSync('git', [...comando.slice(1)], { cwd: dir, encoding: 'utf8' })
          return { ok: true, stdout, stderr: '', exitCode: 0, timeoutExcedido: false }
        }),
        matarProcesso: vi.fn()
      } as unknown as DockerRunner
      const sandboxComEscopo: SandboxPreparado = {
        ...sandbox,
        pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'teste' }
      }
      const service = new ConstrutorService(
        docker,
        repoDuble(),
        auditDuble(),
        () => 'u1',
        () => 'ws1' as never
      )

      const resultado = await service.construir({
        runId: 'run-1',
        sandbox: sandboxComEscopo,
        promptInicial: 'x',
        comandosDeValidacao
      })

      expect(resultado.estadoFinal).toBe('PR_CI')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ConstrutorService — bloqueio traz ação mínima de retomada (critério 7)', () => {
  it('bloqueio corrigível esgotado traz retomada acionável', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude')
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando.includes('test'))
        return { ok: false, stdout: 'FAIL sempre', stderr: '', exitCode: 1, timeoutExcedido: false }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.bloqueio?.retomada).toBeTruthy()
    expect(resultado.bloqueio?.retomada.length).toBeGreaterThan(10)
  })

  it('bloqueio externo traz retomada distinta do corrigível', async () => {
    const docker = dockerDuble(() => ({
      ok: false,
      stdout: '',
      stderr: 'ETIMEDOUT',
      exitCode: 1,
      timeoutExcedido: false
    }))
    const service = new ConstrutorService(
      docker,
      repoDuble(),
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.bloqueio?.causa).toBe('externo')
    expect(resultado.bloqueio?.retomada).toMatch(/conectividade|rede|externo|serviço/i)
  })
})

describe('ConstrutorService — bloqueio persiste os cinco campos do BloqueioExterno (CONVENTION §4)', () => {
  it('transicionar para BLOCKED recebe causa, evidencia, tentativas, porQueNaoSeguir e retomada', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude')
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando.includes('test'))
        return { ok: false, stdout: 'FAIL sempre', stderr: '', exitCode: 1, timeoutExcedido: false }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(
      docker,
      pipeline,
      auditDuble(),
      () => 'u1',
      () => 'ws1' as never
    )

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(pipeline.transicionar).toHaveBeenCalledWith(
      'run-1',
      'VALIDATING',
      'BLOCKED',
      expect.any(Date),
      expect.objectContaining({
        causa: 'corrigivel',
        evidencia: expect.any(String),
        tentativas: 3,
        porQueNaoSeguir: expect.any(String),
        retomada: expect.any(String)
      })
    )
  })
})
