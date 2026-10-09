import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ReferenciaMutavelError } from '@shared/domain/release-artifact'
import type { CommandResult, CommandRunner } from './command-runner'
import { ArtifactRegistryError, GhcrArtifactAdapter } from './ghcr-artifact-adapter'

const DIGEST = `sha256:${'a'.repeat(64)}`
const REPO = 'ghcr.io/dono/projeto-backend'
const SLSA = JSON.stringify({
  SLSA: {
    buildDefinition: { buildType: 'https://github.com/moby/buildkit/slsa' },
    runDetails: { builder: { id: 'builder-1' } }
  }
})

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '', timedOut: false }
}

interface Script {
  build?: CommandResult
  digestInspecionado?: CommandResult
  provenance?: CommandResult
  metadataDigest?: string | null
}

/** Dublê de contrato: responde pelo formato do comando, não por ordem. Registra as chamadas. */
function runnerDe(script: Script): CommandRunner & { chamadas: string[][] } {
  const chamadas: string[][] = []
  return {
    chamadas,
    async run(_binary, args) {
      chamadas.push([...args])
      if (args[0] === 'buildx' && args[1] === 'build') {
        const arquivo = args[args.indexOf('--metadata-file') + 1]!
        if (script.metadataDigest !== null)
          writeFileSync(
            arquivo,
            JSON.stringify({ 'containerimage.digest': script.metadataDigest ?? DIGEST })
          )
        return script.build ?? ok()
      }
      if (args.includes('{{.Manifest.Digest}}')) return script.digestInspecionado ?? ok(DIGEST)
      if (args.includes('{{json .Provenance}}')) return script.provenance ?? ok(SLSA)
      throw new Error(`comando inesperado: ${args.join(' ')}`)
    }
  }
}

const entrada = { repository: REPO, contextDir: '.', sourceSha: 'b'.repeat(40) }

describe('GhcrArtifactAdapter.publish', () => {
  it('publica uma vez, devolve repositório@digest e declara o transporte', async () => {
    const runner = runnerDe({})
    const artefato = await new GhcrArtifactAdapter(runner).publish(entrada)
    expect(artefato.uri).toBe(`${REPO}@${DIGEST}`)
    expect(artefato.digest).toBe(DIGEST)
    expect(artefato.provenance).toMatchObject({
      transport: 'docker-cli',
      buildType: 'https://github.com/moby/buildkit/slsa',
      builderId: 'builder-1'
    })
    expect(artefato.provenance.provenanceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(runner.chamadas.filter((a) => a[1] === 'build')).toHaveLength(1)
  })

  it('usa tag só para leitura humana e nunca como identidade', async () => {
    const runner = runnerDe({})
    await new GhcrArtifactAdapter(runner).publish({ ...entrada, readableTag: 'f02' })
    const build = runner.chamadas.find((a) => a[1] === 'build')!
    expect(build[build.indexOf('-t') + 1]).toBe(`${REPO}:f02`)
    expect(build).toContain('--provenance=mode=max')
    expect(build).toContain(`org.opencontainers.image.revision=${entrada.sourceSha}`)
    expect(runner.chamadas.some((a) => a.join(' ').includes('latest'))).toBe(false)
  })

  it('auth inválida vira erro "auth", sem repetir a saída bruta do registry', async () => {
    const runner = runnerDe({
      build: {
        code: 1,
        stdout: '',
        stderr: 'denied: token=segredo-x unauthorized',
        timedOut: false
      }
    })
    const erro = await new GhcrArtifactAdapter(runner).publish(entrada).catch((e) => e)
    expect(erro).toBeInstanceOf(ArtifactRegistryError)
    expect(erro.code).toBe('auth')
  })

  it('builder nomeado vai no build; sem builder o argumento não existe', async () => {
    const com = runnerDe({})
    await new GhcrArtifactAdapter(com, 'ghcr.io', 'meu-builder').publish(entrada)
    const build = com.chamadas.find((a) => a[1] === 'build')!
    expect(build[build.indexOf('--builder') + 1]).toBe('meu-builder')
    const sem = runnerDe({})
    await new GhcrArtifactAdapter(sem).publish(entrada)
    expect(sem.chamadas.find((a) => a[1] === 'build')).not.toContain('--builder')
  })

  it('driver sem attestation vira erro explícito, nunca build sem provenance', async () => {
    const runner = runnerDe({
      build: {
        code: 1,
        stdout: '',
        stderr: 'ERROR: Attestation is not supported for the docker driver',
        timedOut: false
      }
    })
    await expect(new GhcrArtifactAdapter(runner).publish(entrada)).rejects.toMatchObject({
      code: 'attestation-unsupported'
    })
  })

  it('timeout vira erro "timeout"', async () => {
    const runner = runnerDe({ build: { code: null, stdout: '', stderr: '', timedOut: true } })
    await expect(new GhcrArtifactAdapter(runner).publish(entrada)).rejects.toMatchObject({
      code: 'timeout'
    })
  })

  it('digest divergente entre o build e o registry vira "digest-mismatch"', async () => {
    const runner = runnerDe({ digestInspecionado: ok(`sha256:${'c'.repeat(64)}`) })
    await expect(new GhcrArtifactAdapter(runner).publish(entrada)).rejects.toMatchObject({
      code: 'digest-mismatch'
    })
  })

  it('resposta parcial: build sem digest no metadata', async () => {
    const runner = runnerDe({ metadataDigest: null })
    await expect(new GhcrArtifactAdapter(runner).publish(entrada)).rejects.toMatchObject({
      code: 'partial'
    })
  })

  it('resposta parcial: registry sem provenance', async () => {
    const runner = runnerDe({ provenance: ok('null') })
    await expect(new GhcrArtifactAdapter(runner).publish(entrada)).rejects.toMatchObject({
      code: 'partial'
    })
  })

  it('recusa repositório fora do registry configurado', async () => {
    await expect(
      new GhcrArtifactAdapter(runnerDe({})).publish({ ...entrada, repository: 'docker.io/x/y' })
    ).rejects.toThrow(/ghcr\.io/)
  })
})

describe('GhcrArtifactAdapter.resolve', () => {
  it('resolve o mesmo digest e a mesma provenance que o publish devolveu', async () => {
    const adapter = new GhcrArtifactAdapter(runnerDe({}))
    const publicado = await adapter.publish(entrada)
    const resolvido = await adapter.resolve(publicado.uri)
    expect(resolvido).toEqual(publicado)
  })

  it('contrafactual: tag mutável é recusada antes de qualquer chamada', async () => {
    const runner = runnerDe({})
    await expect(new GhcrArtifactAdapter(runner).resolve(`${REPO}:latest`)).rejects.toBeInstanceOf(
      ReferenciaMutavelError
    )
    expect(runner.chamadas).toHaveLength(0)
  })

  it('digest que o registry não confirma vira "not-found"', async () => {
    const runner = runnerDe({
      digestInspecionado: { code: 1, stdout: '', stderr: 'ERROR: not found', timedOut: false }
    })
    await expect(
      new GhcrArtifactAdapter(runner).resolve(`${REPO}@${DIGEST}`)
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})
