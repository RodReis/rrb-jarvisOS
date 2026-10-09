import { describe, expect, it } from 'vitest'
import { createCommandRunner, redigir } from './command-runner'

describe('redigir', () => {
  it('troca cada ocorrência do segredo e ignora segredo vazio', () => {
    expect(redigir('a=SEGREDO b=SEGREDO', ['SEGREDO', ''])).toBe('a=[REDIGIDO] b=[REDIGIDO]')
  })
})

describe('createCommandRunner', () => {
  const runner = createCommandRunner({ allowed: [process.execPath] })

  it('recusa binário fora da lista: nada de shell arbitrário', async () => {
    await expect(createCommandRunner({ allowed: ['docker'] }).run('node', [])).rejects.toThrow(
      /não permitido/
    )
  })

  it('captura saída e código sem passar por shell', async () => {
    const r = await runner.run(process.execPath, ['-e', 'console.log("ok");process.exit(3)'])
    expect(r).toMatchObject({ code: 3, timedOut: false })
    expect(r.stdout.trim()).toBe('ok')
  })

  it('não herda segredo do ambiente do processo', async () => {
    process.env.SEGREDO_DO_PROCESSO = 'valor-que-nao-pode-vazar'
    try {
      const r = await runner.run(process.execPath, [
        '-e',
        'console.log(process.env.SEGREDO_DO_PROCESSO ?? "ausente")'
      ])
      expect(r.stdout.trim()).toBe('ausente')
    } finally {
      delete process.env.SEGREDO_DO_PROCESSO
    }
  })

  it('repassa só o env explícito e redige o valor na saída', async () => {
    const r = await runner.run(process.execPath, ['-e', 'console.log(process.env.TOKEN_FALSO)'], {
      env: { TOKEN_FALSO: 'SENTINELA-123' },
      redact: ['SENTINELA-123']
    })
    expect(r.stdout).not.toContain('SENTINELA-123')
    expect(r.stdout).toContain('[REDIGIDO]')
  })

  it('o timeout mata o filho e marca timedOut', async () => {
    const r = await runner.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeoutMs: 300
    })
    expect(r.timedOut).toBe(true)
  })

  it('entrega o stdin ao filho', async () => {
    const r = await runner.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'via-stdin'
    })
    expect(r.stdout).toBe('via-stdin')
  })
})
