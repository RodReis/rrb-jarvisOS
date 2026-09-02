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
  pathsPermitidos: { paths: ['src/**'], origem: 'spec', justificativa: 'SPEC-Entrega-04 §Entrada' },
  proxyUrl: 'http://172.20.0.2:8080'
}

function dockerDuble(
  roteiro: (comando: readonly string[]) => { ok: boolean; stdout: string; stderr: string; exitCode: number | null; timeoutExcedido: boolean }
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
    const docker = dockerDuble((_comando) => {
      // Todo comando (claude e os 4 de validação) responde ok nesta suíte.
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const audit = auditDuble()
    const service = new ConstrutorService(docker, pipeline, audit, () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(resultado.tentativas).toHaveLength(1)
    expect(resultado.tentativas[0]?.numero).toBe(1)
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'RUNNING', 'VALIDATING', expect.any(Date))
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'VALIDATING', 'PR_CI', expect.any(Date))
  })
})

describe('ConstrutorService — recuperação corrigível', () => {
  it('validação falha corrigível na 1ª tentativa, passa na 2ª: run termina em PR_CI com 2 tentativas', async () => {
    let chamadasDeValidacao = 0
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      // Só a validação de teste falha, e só na primeira passagem.
      if (comando.includes('test')) {
        chamadasDeValidacao += 1
        if (chamadasDeValidacao === 1) {
          return { ok: false, stdout: 'FAIL src/foo.spec.ts', stderr: '', exitCode: 1, timeoutExcedido: false }
        }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(resultado.tentativas).toHaveLength(2)
    expect(resultado.tentativas[0]?.classificacao).toBe('corrigivel')
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'VALIDATING', 'RUNNING', expect.any(Date))
  })
})

describe('ConstrutorService — três tentativas esgotadas', () => {
  it('validação falha corrigível nas três tentativas: run termina BLOCKED', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando.includes('test')) return { ok: false, stdout: 'FAIL sempre', stderr: '', exitCode: 1, timeoutExcedido: false }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.tentativas).toHaveLength(3)
    expect(resultado.bloqueio?.causa).toBe('corrigivel')
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'VALIDATING', 'BLOCKED', expect.any(Date))
  })
})

describe('ConstrutorService — falha externa não gasta tentativa de correção, bloqueia direto', () => {
  it('erro de rede na chamada ao claude bloqueia sem tentar recuperação', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') {
        return { ok: false, stdout: '', stderr: 'ETIMEDOUT: connection timed out', exitCode: 1, timeoutExcedido: false }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

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
        return { ok: false, stdout: '', stderr: 'ETIMEDOUT: connection timed out', exitCode: 1, timeoutExcedido: false }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

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
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'RUNNING', 'BLOCKED', expect.any(Date))
    expect(pipeline.transicionar).not.toHaveBeenCalledWith('run-1', 'VALIDATING', 'BLOCKED', expect.any(Date))
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
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    expect(chamadas.length).toBeGreaterThan(0)
    expect(chamadas[0]?.[0]).toBe('claude')
  })
})

describe('ConstrutorService — sem container não há execução (critério 8)', () => {
  it('todo comando de claude e validação passa pelo DockerRunner.exec com o nome do container do sandbox — nunca um caminho de execução direta no host', async () => {
    const containersUsados = new Set<string>()
    const docker = {
      exec: vi.fn((container: string) => {
        containersUsados.add(container)
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    // Cinco chamadas (claude + 4 validadores), todas no mesmo container — nunca vazio, nunca
    // um segundo caminho que ignore o sandbox.
    expect(docker.exec).toHaveBeenCalledTimes(5)
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
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

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
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    service.cancelar('run-1', sandbox)

    expect(docker.matarProcesso).toHaveBeenCalledWith(sandbox.containerNome, sandbox.worktreeNoHost)
  })
})
