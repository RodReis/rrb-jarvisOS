import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carregarPerfilDePromocao } from './release-promotion-profile'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'promotion-profile-'))
  mkdirSync(join(dir, 'e2e'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const valido = () => ({
  railway: {
    workdir: 'railway',
    projectId: 'proj-0001',
    backendService: 'backend',
    databaseService: 'postgres',
    environments: { staging: 'staging', production: 'production' },
    backendPort: 3311
  },
  vercel: {
    workdir: 'web',
    scope: 'meu-time',
    stagingDomain: 'app-staging.exemplo.com',
    productionDomain: 'app.exemplo.com'
  },
  environments: {
    staging: {
      backendUrl: 'https://api-staging.exemplo.com',
      frontendUrl: 'https://app-staging.exemplo.com'
    },
    production: { backendUrl: 'https://api.exemplo.com', frontendUrl: 'https://app.exemplo.com' }
  },
  verification: {
    healthPath: '/health',
    runtimeConfigPath: '/runtime-config.json',
    smokePaths: ['/', '/login'],
    e2e: { command: 'npx', args: ['playwright', 'test', '--grep', '@essencial'], cwd: 'e2e' }
  },
  configuration: { isolatedKeys: ['DATABASE_URL'] },
  stabilization: { windowMs: 300000, intervalMs: 30000, maxRestarts: 1 }
})

function gravar(perfil: unknown): string {
  const arquivo = join(dir, 'promotion.json')
  writeFileSync(arquivo, typeof perfil === 'string' ? perfil : JSON.stringify(perfil))
  return arquivo
}

describe('carregarPerfilDePromocao', () => {
  it('carrega um perfil válido e resolve caminhos a partir da pasta do perfil', () => {
    const perfil = carregarPerfilDePromocao(gravar(valido()))
    expect(perfil.railway.workdir).toBe(join(dir, 'railway'))
    expect(perfil.verification.e2e?.cwd).toBe(join(dir, 'e2e'))
    expect(perfil.configuration.isolatedKeys).toEqual(['DATABASE_URL'])
    expect(perfil.stabilization).toEqual({ windowMs: 300000, intervalMs: 30000, maxRestarts: 1 })
  })

  it('aplica os padrões de verificação e deixa a estabilização para o padrão do domínio', () => {
    const base = valido() as Record<string, unknown>
    base.verification = {}
    delete base.stabilization
    const perfil = carregarPerfilDePromocao(gravar(base))
    expect(perfil.verification).toMatchObject({
      healthPath: '/health',
      runtimeConfigPath: '/runtime-config.json',
      smokePaths: ['/']
    })
    expect(perfil.verification.e2e).toBeUndefined()
    expect(perfil.stabilization).toBeUndefined()
  })

  it.each([
    ['JSON inválido', '{ não é json'],
    [
      'sem railway',
      (() => {
        const p = valido() as Record<string, unknown>
        delete p.railway
        return p
      })()
    ]
  ])('recusa %s', (_nome, perfil) => {
    expect(() => carregarPerfilDePromocao(gravar(perfil))).toThrow(TypeError)
  })

  it('recusa URL de ambiente que não é https, que leva credencial ou query', () => {
    for (const url of [
      'http://api.exemplo.com',
      'https://u:senha@api.exemplo.com',
      'https://api.exemplo.com/?token=1'
    ]) {
      const p = valido()
      p.environments.production.backendUrl = url
      expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(TypeError)
    }
  })

  it('recusa Staging e Produção apontando para a mesma URL: isolamento começa pelo endereço', () => {
    const p = valido()
    p.environments.production = { ...p.environments.staging }
    expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(/isolad|mesma/i)
  })

  it('recusa URL de frontend que não é o domínio que a Vercel promove', () => {
    const a = valido()
    a.environments.production.frontendUrl = 'https://outro.exemplo.com'
    expect(() => carregarPerfilDePromocao(gravar(a))).toThrow(/productionDomain/)
    const b = valido()
    b.environments.staging.frontendUrl = 'https://outro-staging.exemplo.com'
    expect(() => carregarPerfilDePromocao(gravar(b))).toThrow(/stagingDomain/)
  })

  it('o repositório do GitHub é opcional e só aceita dono/nome (SPEC-Release-05)', () => {
    expect(carregarPerfilDePromocao(gravar(valido())).github).toBeUndefined()
    const com = carregarPerfilDePromocao(
      gravar({ ...valido(), github: { repository: 'dono/projeto' } })
    )
    expect(com.github).toEqual({ repository: 'dono/projeto' })
    for (const repository of ['sem-barra', 'a/b; c', 'a/b/c', '', 42, '../..', 'dono/..', './x'])
      expect(() =>
        carregarPerfilDePromocao(gravar({ ...valido(), github: { repository } }))
      ).toThrow(TypeError)
  })

  it('o bloco do GitHub não tem campo para credencial', () => {
    expect(() =>
      carregarPerfilDePromocao(
        gravar({ ...valido(), github: { repository: 'dono/projeto', token: 'ghp_x' } })
      )
    ).toThrow(TypeError)
  })

  it('recusa o mesmo ambiente do Railway para Staging e Produção', () => {
    const p = valido()
    p.railway.environments.production = 'staging'
    expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(TypeError)
  })

  it('recusa caminho que escapa da pasta do perfil', () => {
    const p = valido()
    p.railway.workdir = '../fora'
    expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(TypeError)
  })

  it('recusa comando de E2E fora da lista permitida', () => {
    const p = valido()
    p.verification.e2e.command = 'powershell'
    expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(TypeError)
  })

  it.each(['//evil.com', '/\\evil', 'sem-barra'])(
    'recusa caminho de verificação inválido %s',
    (caminho) => {
      const p = valido()
      p.verification.healthPath = caminho
      expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(TypeError)
    }
  )

  it('recusa nome de chave de isolamento inválido e janela de estabilização inválida', () => {
    const a = valido()
    a.configuration.isolatedKeys = ['minha chave']
    expect(() => carregarPerfilDePromocao(gravar(a))).toThrow(TypeError)
    const b = valido()
    b.stabilization = { windowMs: 1000, intervalMs: 30000, maxRestarts: 1 }
    expect(() => carregarPerfilDePromocao(gravar(b))).toThrow(TypeError)
  })

  it('o perfil não tem campo para segredo: valor sensível no arquivo é recusado', () => {
    const p = { ...valido(), railway: { ...valido().railway, token: 'tok_x' } }
    expect(() => carregarPerfilDePromocao(gravar(p))).toThrow(TypeError)
  })
})
