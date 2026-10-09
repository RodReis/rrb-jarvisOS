import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReferenciaMutavelError } from '@shared/domain/release-artifact'
import { createCommandRunner } from './command-runner'
import { GhcrArtifactAdapter } from './ghcr-artifact-adapter'

/**
 * Smoke REAL no GHCR (SPEC-Release-02, critério 9): explícito, limitado e registrado.
 *
 * **Explícito:** só roda com `RELEASE_GHCR_SMOKE_REPOSITORY=ghcr.io/<dono>/<imagem>` no ambiente;
 * sem ela o teste aparece como `skipped` (não como `pass`) e a suíte comum nunca toca a rede.
 * **Limitado:** uma imagem mínima (o backend do projeto de prova), uma tag de leitura humana por
 * execução, nenhuma remoção automática de pacote. **Credencial:** a do `docker login ghcr.io` já
 * feito na máquina (escopo `write:packages`); nada de token em variável deste teste.
 *
 * Quem roda registra o resultado na PR/issue (repositório usado, digest e data).
 */

const REPOSITORIO = process.env.RELEASE_GHCR_SMOKE_REPOSITORY
const PROJETO = resolve(process.cwd(), 'tests/fixtures/release-project')

describe.skipIf(!REPOSITORIO)('GHCR real (opt-in)', () => {
  it('publica uma vez, resolve o mesmo digest e recusa tag mutável', async () => {
    const adapter = new GhcrArtifactAdapter(createCommandRunner({ allowed: ['docker'] }))
    const sha = Date.now().toString(16).padStart(40, '0')
    const publicado = await adapter.publish({
      repository: REPOSITORIO as string,
      contextDir: resolve(PROJETO, 'backend'),
      sourceSha: sha,
      readableTag: `smoke-${sha.slice(-12)}`
    })
    expect(publicado.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(await adapter.resolve(publicado.uri)).toEqual(publicado)
    await expect(adapter.resolve(`${REPOSITORIO}:latest`)).rejects.toBeInstanceOf(
      ReferenciaMutavelError
    )
  }, 300_000)
})
