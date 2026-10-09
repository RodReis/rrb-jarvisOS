import { describe, expect, it } from 'vitest'
import type { CommandResult, CommandRunner } from './command-runner'
import { GitSourceVerifier } from './git-source-verifier'

const SHA = 'abcdef0123456789abcdef0123456789abcdef01'
const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const falha: CommandResult = { code: 128, stdout: '', stderr: 'fatal', timedOut: false }

function runner(
  head: CommandResult,
  status: CommandResult
): CommandRunner & { chamadas: string[][] } {
  const chamadas: string[][] = []
  return {
    chamadas,
    async run(_b, args) {
      chamadas.push([...args])
      return args.includes('rev-parse') ? head : status
    }
  }
}

describe('GitSourceVerifier', () => {
  it('HEAD igual ao SHA da release e árvore limpa: ok', async () => {
    const r = runner(ok(`${SHA}\n`), ok(''))
    expect(await new GitSourceVerifier(r).verify('/ctx', SHA)).toBe('ok')
  })

  it('aceita SHA abreviado da release', async () => {
    const r = runner(ok(`${SHA}\n`), ok(''))
    expect(await new GitSourceVerifier(r).verify('/ctx', SHA.slice(0, 12))).toBe('ok')
  })

  it('HEAD de outro commit: a imagem seria rotulada com um SHA que não é o dela', async () => {
    const r = runner(ok(`${'1'.repeat(40)}\n`), ok(''))
    expect(await new GitSourceVerifier(r).verify('/ctx', SHA)).toBe('source-mismatch')
  })

  it('árvore suja no contexto bloqueia', async () => {
    const r = runner(ok(`${SHA}\n`), ok(' M server.js\n'))
    expect(await new GitSourceVerifier(r).verify('/ctx', SHA)).toBe('source-dirty')
  })

  it('contexto que não é repositório Git bloqueia (não há como provar a origem)', async () => {
    const r = runner(falha, ok(''))
    expect(await new GitSourceVerifier(r).verify('/ctx', SHA)).toBe('source-mismatch')
  })

  it('falha em consultar o status não vira "limpo"', async () => {
    const r = runner(ok(`${SHA}\n`), falha)
    expect(await new GitSourceVerifier(r).verify('/ctx', SHA)).toBe('source-dirty')
  })

  it('consulta só o contexto e inclui arquivos não rastreados', async () => {
    const r = runner(ok(`${SHA}\n`), ok(''))
    await new GitSourceVerifier(r).verify('/ctx', SHA)
    const status = r.chamadas.find((a) => a.includes('status'))!
    expect(status).toContain('--untracked-files=all')
    expect(status.slice(0, 2)).toEqual(['-C', '/ctx'])
  })

  it('SHA que não é hexadecimal nunca chega ao Git', async () => {
    const r = runner(ok(`${SHA}\n`), ok(''))
    expect(await new GitSourceVerifier(r).verify('/ctx', '--upload-pack=x')).toBe('source-mismatch')
    expect(r.chamadas).toHaveLength(0)
  })
})
