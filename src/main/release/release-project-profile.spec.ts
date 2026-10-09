import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertRepositorioPermitido, carregarPerfilDoProjeto } from './release-project-profile'

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

describe('contenção de caminhos (revisão de segurança)', () => {
  it.each([
    ['context com ..', { backend: { ...perfilValido.backend, context: '../fora' } }],
    [
      'migrationsDir absoluto fora da pasta',
      { migrationsDir: process.platform === 'win32' ? 'C:/Windows' : '/etc' }
    ],
    ['seedFile com ..', { seedFile: '../../seed.sql' }],
    ['envLocalFile fora da pasta', { envLocalFile: '../.ssh/id_rsa' }],
    ['envExampleFile fora da pasta', { envExampleFile: '../../outro/.env.example' }]
  ])('recusa %s', (_nome, troca) => {
    expect(() =>
      carregarPerfilDoProjeto(gravar({ ...perfilValido, ...troca }), 'a'.repeat(40))
    ).toThrow(/dentro da pasta do perfil/)
  })

  it('subpasta do projeto continua valendo', () => {
    const projeto = carregarPerfilDoProjeto(
      gravar({ ...perfilValido, migrationsDir: 'db/migrations' }),
      'a'.repeat(40)
    )
    expect(projeto.migrationsDir).toBe(resolve(dir, 'db/migrations'))
  })
})

describe('assertRepositorioPermitido', () => {
  it('exige o registry do operador', () => {
    expect(() => assertRepositorioPermitido('docker.io/x/y', 'ghcr.io')).toThrow(TypeError)
    expect(() => assertRepositorioPermitido('ghcr.io/x/y', 'ghcr.io')).not.toThrow()
  })

  it('com namespace do operador, outro dono é recusado', () => {
    expect(() => assertRepositorioPermitido('ghcr.io/outro/img', 'ghcr.io', 'meu-dono')).toThrow(
      /ghcr\.io\/meu-dono\//
    )
    expect(() =>
      assertRepositorioPermitido('ghcr.io/meu-dono/img', 'ghcr.io', 'meu-dono')
    ).not.toThrow()
  })

  it('prefixo parecido não vale: meu-dono2 não é meu-dono', () => {
    expect(() =>
      assertRepositorioPermitido('ghcr.io/meu-dono2/img', 'ghcr.io', 'meu-dono')
    ).toThrow(TypeError)
  })
})
