/**
 * Preferências contra o SQLite real (categoria "Banco").
 *
 * Persistência e isolamento por usuário são os critérios 1 e 3 da SPEC-05, e nenhum dos
 * dois se prova com mock: é o `WHERE id = ?` da query que garante que a preferência de um
 * usuário não toca a de outro.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedTheme } from '@shared/domain/entities'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logCat }) }))

const { openDatabase } = await import('../storage/database')
const { UserProfileRepository } = await import('../storage/repositories')
const { PreferencesService } = await import('./preferences-service')

let dir: string
let db: Db
let profiles: InstanceType<typeof UserProfileRepository>
let temaDoSistema: ResolvedTheme

function servicoDe(userId: string): InstanceType<typeof PreferencesService> {
  return new PreferencesService(profiles, userId, () => temaDoSistema)
}

function perfil(id: string) {
  return { id, name: 'Usuário', email: '', locale: 'pt-BR' as const, theme: 'sistema' as const }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pref-'))
  db = openDatabase(join(dir, 'teste.db'))
  profiles = new UserProfileRepository(db)
  temaDoSistema = 'escuro'
  logCat.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('padrões do produto', () => {
  it('nasce em pt-BR com tema seguindo o sistema (critério 2)', () => {
    profiles.save(perfil('u-1'))

    expect(servicoDe('u-1').atual()).toEqual({
      locale: 'pt-BR',
      theme: 'sistema',
      resolvedTheme: 'escuro'
    })
  })

  it('resolve `sistema` conforme o SO responde no momento da leitura', () => {
    // O usuário pode trocar o tema do SO com o app aberto; resolver no boot e cachear
    // deixaria a UI presa no valor antigo.
    profiles.save(perfil('u-1'))
    const service = servicoDe('u-1')

    temaDoSistema = 'claro'
    expect(service.atual().resolvedTheme).toBe('claro')

    temaDoSistema = 'escuro'
    expect(service.atual().resolvedTheme).toBe('escuro')
  })

  it('cai no padrão sem derrubar a UI quando o perfil não existe', () => {
    expect(servicoDe('inexistente').atual()).toMatchObject({ locale: 'pt-BR', theme: 'sistema' })
    expect(logCat.warn).toHaveBeenCalled()
  })
})

describe('gravação (critério 1)', () => {
  it('persiste idioma e devolve o estado resultante', () => {
    profiles.save(perfil('u-1'))

    expect(servicoDe('u-1').salvar({ locale: 'en-US' }).locale).toBe('en-US')
    // Persistência real: um serviço novo, lendo do banco, enxerga a mudança.
    expect(servicoDe('u-1').atual().locale).toBe('en-US')
  })

  it('override manual de tema vence o sistema', () => {
    profiles.save(perfil('u-1'))
    temaDoSistema = 'escuro'

    const resultado = servicoDe('u-1').salvar({ theme: 'claro' })

    expect(resultado).toMatchObject({ theme: 'claro', resolvedTheme: 'claro' })
  })

  it('altera um campo sem apagar o outro', () => {
    // `COALESCE` na query: a UI muda idioma e tema separadamente.
    profiles.save(perfil('u-1'))
    const service = servicoDe('u-1')

    service.salvar({ locale: 'en-US' })
    service.salvar({ theme: 'escuro' })

    expect(service.atual()).toMatchObject({ locale: 'en-US', theme: 'escuro' })
  })

  it.each([
    ['idioma inventado', { locale: 'klingon' }],
    ['tema inventado', { theme: 'neon' }],
    ['tipo errado', { locale: 42 }]
  ])('descarta %s em vez de gravar', (_caso, mudanca) => {
    // O renderer é fronteira de confiança: um `locale` fora do enum viraria uma UI sem
    // tradução nenhuma.
    profiles.save(perfil('u-1'))
    const service = servicoDe('u-1')

    const resultado = service.salvar(mudanca as never)

    expect(resultado).toMatchObject({ locale: 'pt-BR', theme: 'sistema' })
    expect(logCat.warn).toHaveBeenCalled()
  })

  it('ignora campo inválido mas aplica o válido do mesmo pedido', () => {
    profiles.save(perfil('u-1'))

    const resultado = servicoDe('u-1').salvar({ locale: 'en-US', theme: 'neon' } as never)

    expect(resultado).toMatchObject({ locale: 'en-US', theme: 'sistema' })
  })
})

describe('isolamento por usuário (critério 3)', () => {
  it('preferência de um usuário não vaza para outro', () => {
    profiles.save(perfil('u-1'))
    profiles.save(perfil('u-2'))

    servicoDe('u-1').salvar({ locale: 'en-US', theme: 'escuro' })

    expect(servicoDe('u-2').atual()).toMatchObject({ locale: 'pt-BR', theme: 'sistema' })
    expect(servicoDe('u-1').atual()).toMatchObject({ locale: 'en-US', theme: 'escuro' })
  })
})
