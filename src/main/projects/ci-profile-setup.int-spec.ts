import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { perfilNodeEmWindows, perfilPythonEmWindows } from '@shared/domain/ci-profile-perfis'
import { CiProfileSetupService } from './ci-profile-setup'

let raiz: string | undefined
afterEach(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true })
  raiz = undefined
})

function montar(): CiProfileSetupService {
  raiz = mkdtempSync(join(tmpdir(), 'jarvis-ci-setup-'))
  mkdirSync(join(raiz, 'docs'))
  for (const arquivo of ['TESTING.md', 'REVIEW.md'])
    writeFileSync(join(raiz, 'docs', arquivo), `# ${arquivo}\n`)
  return new CiProfileSetupService(
    {
      findById: () => ({ diretorio: raiz, workspace_id: 'jarvis' })
    } as never,
    () => 'u-1'
  )
}

describe('escolha explícita de stack para E1', () => {
  it('gera perfil Node somente quando o pacote declara scripts e lock', () => {
    const service = montar()
    const semPacote = service.selecionar('p-1', 'jarvis', 'node')
    expect(semPacote.ok).toBe(false)
    expect(service.estado('p-1', 'jarvis').ok).toBe(false)

    writeFileSync(
      join(raiz!, 'package.json'),
      JSON.stringify({
        scripts: { lint: 'eslint .', typecheck: 'tsc', test: 'vitest', build: 'vite' }
      })
    )
    writeFileSync(join(raiz!, 'package-lock.json'), '{}')
    expect(service.selecionar('p-1', 'jarvis', 'node')).toMatchObject({ ok: true, runtime: 'node' })
    expect(service.estado('p-1', 'jarvis')).toMatchObject({ ok: true, runtime: 'node' })
    expect(JSON.parse(readFileSync(join(raiz!, 'ci-profile.json'), 'utf8'))).toMatchObject({
      profileId: 'p-1',
      runtime: 'node'
    })
  })

  it('preserva perfil próprio e recusa outro workspace', () => {
    const service = montar()
    writeFileSync(join(raiz!, 'requirements.txt'), 'ruff\nmypy\npytest\n')
    writeFileSync(
      join(raiz!, 'ci-profile.json'),
      JSON.stringify(perfilPythonEmWindows('personalizado'))
    )
    expect(service.selecionar('p-1', 'jarvis', 'python').ok).toBe(false)
    expect(service.selecionar('p-1', 'noa', 'python').ok).toBe(false)
    expect(JSON.parse(readFileSync(join(raiz!, 'ci-profile.json'), 'utf8')).profileId).toBe(
      'personalizado'
    )
  })

  it('não sobrescreve perfil editado que manteve o id do projeto', () => {
    const service = montar()
    writeFileSync(
      join(raiz!, 'package.json'),
      JSON.stringify({
        scripts: {
          lint: 'eslint .',
          typecheck: 'tsc',
          test: 'vitest',
          build: 'vite'
        }
      })
    )
    writeFileSync(join(raiz!, 'package-lock.json'), '{}')
    const editado = { ...perfilNodeEmWindows('p-1'), timeoutEmMinutos: 29 }
    writeFileSync(join(raiz!, 'ci-profile.json'), JSON.stringify(editado))

    expect(service.selecionar('p-1', 'jarvis', 'node').ok).toBe(false)
    expect(JSON.parse(readFileSync(join(raiz!, 'ci-profile.json'), 'utf8'))).toMatchObject({
      timeoutEmMinutos: 29
    })
  })
})
