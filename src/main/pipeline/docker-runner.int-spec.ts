import { describe, it, expect, vi } from 'vitest'
import { DockerRunner } from './docker-runner'
import type { TerminalEngine } from '../execution/terminal-engine'
import type { CommandReason, CommandState } from '@shared/domain/terminal'

/** Dublê do TerminalEngine — captura o comando `docker` submetido, sem shell real. */
function terminalDuble(
  respostaPorArgs: (args: readonly string[]) => {
    stdout: string
    stderr: string
    state: CommandState
    reason: CommandReason
    exitCode: number | null
  }
): TerminalEngine {
  return {
    run: vi.fn((submission: { readonly args: readonly string[] }) => {
      const r = respostaPorArgs(submission.args)
      return {
        id: 'x',
        state: r.state,
        reason: r.reason,
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        durationMs: 1
      }
    })
  } as unknown as TerminalEngine
}

describe('DockerRunner.exec — comando dentro do container (critério 11)', () => {
  it('monta docker exec com o comando pedido e devolve stdout/exitCode', () => {
    const terminal = terminalDuble((args) => {
      expect(args[0]).toBe('exec')
      expect(args).toContain('meu-container')
      expect(args.slice(-3)).toEqual(['npm', 'run', 'test'])
      return { stdout: 'ok\n', stderr: '', state: 'concluido', reason: 'executado', exitCode: 0 }
    })
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['npm', 'run', 'test'], '/host/cwd')

    expect(resultado.ok).toBe(true)
    expect(resultado.stdout).toBe('ok\n')
    expect(resultado.exitCode).toBe(0)
    expect(resultado.timeoutExcedido).toBe(false)
  })

  it('exit code não-zero é ok:false, sem timeoutExcedido', () => {
    const terminal = terminalDuble(() => ({
      stdout: '',
      stderr: 'falhou',
      state: 'falhou',
      reason: 'falha-na-execucao',
      exitCode: 1
    }))
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['npm', 'run', 'lint'], '/host/cwd')

    expect(resultado.ok).toBe(false)
    expect(resultado.timeoutExcedido).toBe(false)
  })

  it('timeout do TerminalEngine vira timeoutExcedido:true', () => {
    const terminal = terminalDuble(() => ({
      stdout: '',
      stderr: '',
      state: 'falhou',
      reason: 'timeout-excedido',
      exitCode: null
    }))
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['claude', '--print'], '/host/cwd')

    expect(resultado.ok).toBe(false)
    expect(resultado.timeoutExcedido).toBe(true)
  })

  it('falha de execução sem exit code não é confundida com timeout', () => {
    const terminal = terminalDuble(() => ({
      stdout: '',
      stderr: 'binário não encontrado',
      state: 'falhou',
      reason: 'falha-na-execucao',
      exitCode: null
    }))
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['comando-inexistente'], '/host/cwd')

    expect(resultado.ok).toBe(false)
    expect(resultado.timeoutExcedido).toBe(false)
  })

  it('matarProcesso monta docker exec com pkill, não docker stop', () => {
    const terminal = terminalDuble((args) => {
      expect(args[0]).toBe('exec')
      expect(args).toContain('pkill')
      return { stdout: '', stderr: '', state: 'concluido', reason: 'executado', exitCode: 0 }
    })
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    runner.matarProcesso('meu-container', '/host/cwd')
  })
})
