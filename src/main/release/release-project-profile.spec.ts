import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { carregarPerfilDoProjeto } from './release-project-profile'

let dir = ''
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const perfilValido = {
  backend: { context: 'backend', containerPort: 3000, healthPath: '/health', preferredPort: 55000 },
  frontend: { context: 'frontend', containerPort: 3001, healthPath: '/', preferredPort: 55010 },
  postgresPreferredPort: 54990,
  migrationsDir: 'migrations',
  seedFile: 'seed.sql',
  envExampleFile: '.env.example',
  envLocalFile: '.env.local',
  repository: 'ghcr.io/dono/projeto-backend'
}

function gravar(conteudo: unknown): string {
  dir = mkdtempSync(join(tmpdir(), 'perfil-'))
  const arquivo = join(dir, 'release-profile.json')
  writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo))
  return arquivo
}

describe('carregarPerfilDoProjeto', () => {
  it('resolve os caminhos relativos ao arquivo do perfil e repassa o SHA', () => {
    const projeto = carregarPerfilDoProjeto(gravar(perfilValido), 'a'.repeat(40))
    expect(projeto.profile.backend.context).toBe(resolve(dir, 'backend'))
    expect(projeto.migrationsDir).toBe(resolve(dir, 'migrations'))
    expect(projeto.seedFile).toBe(resolve(dir, 'seed.sql'))
    expect(projeto.contextDir).toBe(resolve(dir, 'backend'))
    expect(projeto.sourceSha).toBe('a'.repeat(40))
  })

  it('seed é opcional', () => {
    const semSeed = { ...perfilValido, seedFile: undefined }
    expect(carregarPerfilDoProjeto(gravar(semSeed), 'a'.repeat(40)).seedFile).toBeUndefined()
  })

  it('JSON inválido é erro claro', () => {
    expect(() => carregarPerfilDoProjeto(gravar('{ não é json'), 'a'.repeat(40))).toThrow(/JSON/)
  })

  it.each([
    ['sem repositório', { ...perfilValido, repository: undefined }],
    [
      'porta de contêiner inválida',
      { ...perfilValido, backend: { ...perfilValido.backend, containerPort: 0 } }
    ],
    [
      'health path sem barra',
      { ...perfilValido, backend: { ...perfilValido.backend, healthPath: 'health' } }
    ],
    ['repositório com tag', { ...perfilValido, repository: 'ghcr.io/dono/projeto:latest' }]
  ])('recusa %s', (_nome, perfil) => {
    expect(() => carregarPerfilDoProjeto(gravar(perfil), 'a'.repeat(40))).toThrow(TypeError)
  })
})
