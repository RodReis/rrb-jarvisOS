import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CommandResult, CommandRunner } from './command-runner'
import { GhcrArtifactAdapter } from './ghcr-artifact-adapter'
import { GhcrPreviewImageAdapter } from './ghcr-preview-image-adapter'

const REPO = 'ghcr.io/dono/projeto-backend'
const SHA = 'c'.repeat(40)
const DIGEST = `sha256:${'a'.repeat(64)}`
const SLSA = JSON.stringify({
  SLSA: { buildDefinition: { buildType: 'tipo' }, runDetails: { builder: { id: 'b' } } }
})

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const falha = (stderr: string): CommandResult => ({ code: 1, stdout: '', stderr, timedOut: false })

/** Responde pelo formato do comando; a tag publicada só passa a existir depois do build. */
function registry(inicial: { publicadas?: Set<string>; erroNoLookup?: CommandResult } = {}) {
  const publicadas = inicial.publicadas ?? new Set<string>()
  const chamadas: string[][] = []
  const runner: CommandRunner = {
    async run(_binary, args) {
      chamadas.push([...args])
      if (args[1] === 'build') {
        writeFileSync(
          args[args.indexOf('--metadata-file') + 1]!,
          JSON.stringify({ 'containerimage.digest': DIGEST })
        )
        publicadas.add(args[args.indexOf('-t') + 1]!)
        return ok()
      }
      const alvo = args[3]!
      if (alvo.includes('@')) {
        return args.includes('{{json .Provenance}}') ? ok(SLSA) : ok(DIGEST)
      }
      if (inicial.erroNoLookup) return inicial.erroNoLookup
      return publicadas.has(alvo) ? ok(DIGEST) : falha('manifest unknown')
    }
  }
  return { runner, chamadas, publicadas }
}

const fonte = { repository: REPO, contextDir: '.' }
const builds = (chamadas: string[][]): number => chamadas.filter((a) => a[1] === 'build').length

describe('GhcrPreviewImageAdapter', () => {
  it('publica uma vez quando o SHA ainda não tem imagem e devolve repositório@digest', async () => {
    const { runner, chamadas } = registry()
    const adapter = new GhcrPreviewImageAdapter(new GhcrArtifactAdapter(runner), fonte)

    const r = await adapter.ensure({ sourceSha: SHA })

    expect(r).toEqual({ uri: `${REPO}@${DIGEST}`, digest: DIGEST })
    expect(builds(chamadas)).toBe(1)
    expect(chamadas.find((a) => a[1] === 'build')).toContain(`${REPO}:pv-${SHA}`)
  })

  it('repetir o SHA reaproveita a imagem publicada e não reconstrói', async () => {
    const { runner, chamadas } = registry()
    const adapter = new GhcrPreviewImageAdapter(new GhcrArtifactAdapter(runner), fonte)

    await adapter.ensure({ sourceSha: SHA })
    const segunda = await adapter.ensure({ sourceSha: SHA })

    expect(segunda.digest).toBe(DIGEST)
    expect(builds(chamadas)).toBe(1)
  })

  it('SHAs diferentes não compartilham tag', async () => {
    const { runner, chamadas } = registry()
    const adapter = new GhcrPreviewImageAdapter(new GhcrArtifactAdapter(runner), fonte)

    await adapter.ensure({ sourceSha: SHA })
    await adapter.ensure({ sourceSha: 'd'.repeat(40) })

    expect(builds(chamadas)).toBe(2)
  })

  it('traduz erro de registro para código fechado do Preview, sem repassar a saída', async () => {
    const { runner } = registry({ erroNoLookup: falha('unauthorized: token=SEGREDO') })
    const adapter = new GhcrPreviewImageAdapter(new GhcrArtifactAdapter(runner), fonte)

    const erro = await adapter.ensure({ sourceSha: SHA }).catch((e: unknown) => e)

    expect(erro).toMatchObject({ code: 'auth' })
    expect((erro as Error).message).not.toContain('SEGREDO')
  })

  it('exige o SHA completo: abreviação poderia colidir', async () => {
    const { runner, chamadas } = registry()
    const adapter = new GhcrPreviewImageAdapter(new GhcrArtifactAdapter(runner), fonte)

    await expect(adapter.ensure({ sourceSha: 'abc1234' })).rejects.toMatchObject({
      code: 'incompatible-state'
    })
    expect(chamadas).toEqual([])
  })
})
