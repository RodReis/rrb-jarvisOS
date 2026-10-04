import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { InventarioRepository } = await import('./inventario-repository')

const USER = 'u-1'
const AGORA = 1_700_000_000_000
const LABELS = { 'jarvisos.run': 'a' }

let dir: string
let db: Db
let inventario: InstanceType<typeof InventarioRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-inv-'))
  db = openDatabase(join(dir, 'teste.db'))
  inventario = new InventarioRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const planejar = (runId: string, tipo: 'container' | 'rede' | 'branch', identificador: string) =>
  inventario.planejar(
    USER,
    { runId, projectId: 'p', tipo, identificador, labels: { ...LABELS, 'jarvisos.run': runId } },
    AGORA
  )

describe('planejar', () => {
  it('grava a intenção antes da criação, com as labels do run', () => {
    const recurso = planejar('a', 'container', 'jarvisos-run-a')

    expect(recurso).toMatchObject({
      runId: 'a',
      projectId: 'p',
      tipo: 'container',
      identificador: 'jarvisos-run-a',
      estado: 'planejado',
      labels: { 'jarvisos.run': 'a' }
    })
  })

  it('devolve o mesmo registro quando o próprio run repete a intenção (retomada)', () => {
    const primeiro = planejar('a', 'container', 'jarvisos-run-a')
    const segundo = planejar('a', 'container', 'jarvisos-run-a')

    expect(segundo?.id).toBe(primeiro?.id)
    expect(inventario.listarDoRun(USER, 'a')).toHaveLength(1)
  })

  it('recusa o identificador que outro run já registrou: dois runs nunca dividem recurso', () => {
    planejar('a', 'container', 'jarvisos-run-x')

    expect(planejar('b', 'container', 'jarvisos-run-x')).toBeUndefined()
    expect(inventario.listarDoRun(USER, 'b')).toHaveLength(0)
  })

  it('o mesmo nome em tipos diferentes não colide', () => {
    expect(planejar('a', 'container', 'x')).toBeDefined()
    expect(planejar('b', 'rede', 'x')).toBeDefined()
  })

  it('libera o identificador depois de removido: o recurso recriado é um registro novo', () => {
    const antigo = planejar('a', 'branch', 'feat/f03-aaaaaaaa')
    inventario.mudarEstado(USER, antigo!.id, 'removido', AGORA)

    const novo = planejar('b', 'branch', 'feat/f03-aaaaaaaa')

    expect(novo).toBeDefined()
    expect(novo?.id).not.toBe(antigo?.id)
  })

  it('isola por usuário', () => {
    planejar('a', 'container', 'x')

    expect(
      inventario.planejar(
        'u-2',
        { runId: 'z', projectId: 'p', tipo: 'container', identificador: 'x', labels: {} },
        AGORA
      )
    ).toBeDefined()
  })
})

describe('mudarEstado', () => {
  it('avança planejado → criado → parado → removido', () => {
    const r = planejar('a', 'container', 'c')!

    expect(inventario.mudarEstado(USER, r.id, 'criado', AGORA + 1)).toBe(true)
    expect(inventario.mudarEstado(USER, r.id, 'parado', AGORA + 2)).toBe(true)
    expect(inventario.mudarEstado(USER, r.id, 'removido', AGORA + 3)).toBe(true)
    expect(inventario.listarDoRun(USER, 'a', true)[0]).toMatchObject({
      estado: 'removido',
      atualizadoEm: AGORA + 3
    })
  })

  it('recusa a transição que volta no ciclo', () => {
    const r = planejar('a', 'container', 'c')!
    inventario.mudarEstado(USER, r.id, 'criado', AGORA)

    expect(inventario.mudarEstado(USER, r.id, 'planejado', AGORA)).toBe(false)
    expect(inventario.listarDoRun(USER, 'a')[0]?.estado).toBe('criado')
  })

  it('recusa registro inexistente', () => {
    expect(inventario.mudarEstado(USER, 999, 'criado', AGORA)).toBe(false)
  })

  it('não mexe no registro de outro usuário', () => {
    const r = planejar('a', 'container', 'c')!

    expect(inventario.mudarEstado('u-2', r.id, 'criado', AGORA)).toBe(false)
  })
})

describe('consultas', () => {
  it('lista só o que é do run, e esconde o removido por padrão', () => {
    const a1 = planejar('a', 'container', 'ca')!
    planejar('a', 'rede', 'ra')
    planejar('b', 'container', 'cb')
    inventario.mudarEstado(USER, a1.id, 'removido', AGORA)

    expect(inventario.listarDoRun(USER, 'a').map((r) => r.identificador)).toEqual(['ra'])
    expect(inventario.listarDoRun(USER, 'a', true).map((r) => r.identificador)).toEqual([
      'ca',
      'ra'
    ])
  })

  it('lista tudo que ainda não foi removido, de todos os runs', () => {
    const a = planejar('a', 'container', 'ca')!
    planejar('b', 'container', 'cb')
    inventario.mudarEstado(USER, a.id, 'removido', AGORA)

    expect(inventario.listarAtivos(USER).map((r) => r.runId)).toEqual(['b'])
  })

  it('lista os runs que ainda têm recurso a reconciliar', () => {
    planejar('a', 'container', 'ca')
    planejar('a', 'rede', 'ra')
    planejar('b', 'container', 'cb')

    expect(inventario.runsComRecurso(USER)).toEqual(['a', 'b'])
  })

  it('as redes ativas alimentam a exceção da limpeza', () => {
    const r = planejar('a', 'rede', 'jarvisos-egress-a')!
    planejar('a', 'container', 'jarvisos-run-a')

    expect([...inventario.redesAtivas(USER)]).toEqual(['jarvisos-egress-a'])

    inventario.mudarEstado(USER, r.id, 'removido', AGORA)
    expect([...inventario.redesAtivas(USER)]).toEqual([])
  })

  it('busca pelo identificador dentro do tipo', () => {
    planejar('a', 'container', 'ca')

    expect(inventario.buscar(USER, 'container', 'ca')?.runId).toBe('a')
    expect(inventario.buscar(USER, 'rede', 'ca')).toBeUndefined()
  })
})
