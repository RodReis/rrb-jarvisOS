import { getEventListeners } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  AgenteNoContainer,
  argsDoClaudeNoContainer,
  CWD_DO_ESCRITOR_NO_CONTAINER,
  executarProcessoReal,
  FERRAMENTAS_DO_ESCRITOR,
  type PedidoDeProcesso,
  type SaidaDoProcesso
} from './squad-agente-container'
import type { PedidoAoAgente } from './squad-escritor'

const OPCOES = {
  container: 'jarvisos-run-run-1-api-t1',
  modelo: 'claude-sonnet-5-5',
  system: 'SISTEMA DO ESCRITOR',
  maxTurnos: 7
}

const pedidoAoAgente = (parcial: Record<string, unknown> = {}): PedidoAoAgente =>
  ({
    worktree: { worktree: '/raiz/wt' },
    system: 'SISTEMA',
    prompt: 'PROMPT GRANDE',
    limites: { maxTurnos: 7, maxMinutos: 5, maxTokensEntrada: 1000, maxTokensSaida: 500 },
    modelo: { provider: 'claude-code', modelo: 'claude-sonnet-5-5' },
    signal: new AbortController().signal,
    ...parcial
  }) as unknown as PedidoAoAgente

describe('argumentos do claude no container', () => {
  const args = argsDoClaudeNoContainer(OPCOES)

  it('é um `docker exec -i` no container e no diretório do worktree montado', () => {
    expect(args.slice(0, 6)).toEqual([
      'exec',
      '-i',
      '-w',
      CWD_DO_ESCRITOR_NO_CONTAINER,
      'jarvisos-run-run-1-api-t1',
      'claude'
    ])
    expect(CWD_DO_ESCRITOR_NO_CONTAINER).toBe('/work')
  })

  it('restringe as ferramentas a ler e editar: nenhuma delas executa comando', () => {
    const i = args.indexOf('--tools')

    expect(args[i + 1]).toBe('Read,Edit,Write,Grep,Glob')
    expect(FERRAMENTAS_DO_ESCRITOR).toEqual(['Read', 'Edit', 'Write', 'Grep', 'Glob'])
    expect(args.join(' ')).not.toMatch(/Bash|Shell|Task|WebFetch|WebSearch|NotebookEdit/)
  })

  it('não pré-aprova nada além do que restringiu, e não pula permissão', () => {
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--allowed-tools')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
  })

  it('ignora settings, hooks e MCP do repositório, e não grava sessão', () => {
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--no-session-persistence')
  })

  it('leva o modelo, o limite de turnos e o prompt do sistema — e nunca o prompt do material', () => {
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-5-5')
    expect(args[args.indexOf('--max-turns') + 1]).toBe('7')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('SISTEMA DO ESCRITOR')
    expect(args).toContain('--print')
    expect(args[args.indexOf('--output-format') + 1]).toBe('text')
    // O material vai por stdin: a linha de comando não o comporta.
    expect(args.join('\n')).not.toContain('PROMPT')
  })

  it('o limite de turnos acompanha a tarefa', () => {
    expect(argsDoClaudeNoContainer({ ...OPCOES, maxTurnos: 3 })).toContain('3')
  })
})

describe('o agente no container', () => {
  const saida = (parcial: Partial<SaidaDoProcesso> = {}): SaidaDoProcesso => ({
    codigo: 0,
    stdout: '  {"ok":true}\n',
    stderr: '',
    abortado: false,
    ...parcial
  })

  function montar(retorno: SaidaDoProcesso | Error = saida()) {
    const chamadas: PedidoDeProcesso[] = []
    const matar = vi.fn()
    const agente = new AgenteNoContainer({
      containerDe: (p) => (p.worktree.worktree === '/raiz/wt' ? { container: 'c-1' } : undefined),
      matarNoContainer: matar,
      executarProcesso: async (p) => {
        chamadas.push(p)
        if (retorno instanceof Error) throw retorno
        return retorno
      }
    })
    return { agente, chamadas, matar }
  }

  it('manda o prompt por stdin, o sistema por argumento, e devolve o texto aparado', async () => {
    const { agente, chamadas } = montar()

    const r = await agente.executar(pedidoAoAgente())

    expect(r).toEqual({ ok: true, texto: '{"ok":true}' })
    expect(chamadas[0].binario).toBe('docker')
    expect(chamadas[0].stdin).toBe('PROMPT GRANDE')
    expect(chamadas[0].args).toContain('SISTEMA')
    expect(chamadas[0].args).not.toContain('PROMPT GRANDE')
    expect(chamadas[0].args[4]).toBe('c-1')
  })

  it('roda com o ambiente controlado, sem credencial', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-nao-deve-passar'
    try {
      const { agente, chamadas } = montar()

      await agente.executar(pedidoAoAgente())

      expect(chamadas[0].env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(Object.keys(chamadas[0].env).some((k) => /KEY|TOKEN|SECRET/i.test(k))).toBe(false)
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('passa o sinal do executor ao processo', async () => {
    const controle = new AbortController()
    const { agente, chamadas } = montar()

    await agente.executar(pedidoAoAgente({ signal: controle.signal }))

    expect(chamadas[0].signal).toBe(controle.signal)
  })

  it('o código de saída diferente de zero é falha, sem repassar o stderr', async () => {
    const { agente } = montar(saida({ codigo: 2, stderr: 'segredo-no-stderr' }))

    const r = await agente.executar(pedidoAoAgente())

    expect(r).toEqual({ ok: false, motivo: 'claude-saiu-com-codigo-2' })
    expect(JSON.stringify(r)).not.toContain('segredo-no-stderr')
  })

  it('o processo que nem saiu com código é falha', async () => {
    const { agente } = montar(saida({ codigo: null }))

    expect(await agente.executar(pedidoAoAgente())).toEqual({
      ok: false,
      motivo: 'claude-saiu-com-codigo-nenhum'
    })
  })

  it('abortado: mata o que ficou rodando dentro do container e devolve interrompido', async () => {
    const { agente, matar } = montar(saida({ abortado: true, codigo: null }))

    const r = await agente.executar(pedidoAoAgente())

    expect(r).toEqual({ ok: false, motivo: 'interrompido' })
    expect(matar).toHaveBeenCalledWith('c-1')
  })

  it('terminar bem não mata nada no container', async () => {
    const { agente, matar } = montar()

    await agente.executar(pedidoAoAgente())

    expect(matar).not.toHaveBeenCalled()
  })

  it('worktree que não é de um sandbox vivo é recusa, sem rodar processo', async () => {
    const { agente, chamadas } = montar()

    const r = await agente.executar(pedidoAoAgente({ worktree: { worktree: '/outro' } }))

    expect(r).toEqual({ ok: false, motivo: 'container-desconhecido' })
    expect(chamadas).toHaveLength(0)
  })

  it('só o Claude Code roda aqui: outro provider é recusa, sem rodar processo', async () => {
    const { agente, chamadas } = montar()

    for (const provider of ['ollama', 'anthropic', 'gemini', 'codex']) {
      const r = await agente.executar(pedidoAoAgente({ modelo: { provider, modelo: 'x' } }))
      expect(r).toEqual({ ok: false, motivo: 'modelo-nao-suportado' })
    }
    expect(chamadas).toHaveLength(0)
  })

  it('usa o binário injetado quando há', async () => {
    const chamadas: PedidoDeProcesso[] = []
    const agente = new AgenteNoContainer({
      containerDe: () => ({ container: 'c' }),
      matarNoContainer: () => undefined,
      binario: 'docker-especial',
      executarProcesso: async (p) => {
        chamadas.push(p)
        return saida()
      }
    })

    await agente.executar(pedidoAoAgente())

    expect(chamadas[0].binario).toBe('docker-especial')
  })
})

describe('o processo real (sem Docker: um script Node faz o papel do cliente)', () => {
  const node = process.execPath
  const rodar = (script: string, stdin: string, signal = new AbortController().signal) =>
    executarProcessoReal({ binario: node, args: ['-e', script], stdin, env: process.env, signal })

  it('escreve o stdin, lê o stdout e devolve o código de saída', async () => {
    const r = await rodar(
      "process.stdin.on('data', d => process.stdout.write('eco:' + d)); process.stdin.on('end', () => process.exit(3))",
      'oi'
    )

    expect(r).toMatchObject({ codigo: 3, stdout: 'eco:oi', abortado: false })
  })

  it('o stderr fica separado do stdout', async () => {
    const r = await rodar("console.error('erro'); console.log('saida')", '')

    expect(r.stdout.trim()).toBe('saida')
    expect(r.stderr.trim()).toBe('erro')
    expect(r.codigo).toBe(0)
  })

  it('o sinal abortado mata o processo pendurado', async () => {
    const controle = new AbortController()
    setTimeout(() => controle.abort(), 50)

    const r = await rodar('setInterval(() => {}, 1000)', '', controle.signal)

    expect(r.abortado).toBe(true)
    expect(r.codigo).not.toBe(0)
  })

  it('mata com SIGKILL: o processo que ignora SIGTERM não escapa', async () => {
    const controle = new AbortController()
    setTimeout(() => controle.abort(), 80)

    const r = await rodar(
      "process.on('SIGTERM', () => {}); console.log('pronto'); setInterval(() => {}, 1000)",
      '',
      controle.signal
    )

    expect(r.abortado).toBe(true)
  })

  it('o ouvinte do sinal sai quando o processo termina por conta própria', async () => {
    const controle = new AbortController()

    await rodar('console.log(1)', '', controle.signal)

    expect(getEventListeners(controle.signal, 'abort')).toHaveLength(0)
  })

  it('o sinal que já chegou abortado nem deixa o processo viver', async () => {
    const controle = new AbortController()
    controle.abort()

    const r = await rodar('setInterval(() => {}, 1000)', '', controle.signal)

    expect(r.abortado).toBe(true)
  })

  it('o binário que não existe devolve falha, não exceção', async () => {
    const r = await executarProcessoReal({
      binario: 'binario-que-nao-existe-xyz',
      args: [],
      stdin: '',
      env: process.env,
      signal: new AbortController().signal
    })

    expect(r.codigo).toBeNull()
    expect(r.abortado).toBe(false)
  })

  it('corta a saída gigante em vez de estourar a memória', async () => {
    const r = await rodar("process.stdout.write('x'.repeat(5 * 1024 * 1024))", '')

    expect(r.stdout.length).toBeLessThan(2 * 1024 * 1024)
    expect(r.stdout.length).toBeGreaterThan(0)
  })
})
