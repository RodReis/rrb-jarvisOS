/**
 * Os achados da revisão contra o SQLite real (SPEC-Squads-04, critérios 2, 3 e 5).
 *
 * Banco real, não dublê: a garantia de "uma assinatura por problema" é a `PRIMARY KEY`, e um
 * repositório dublado concordaria com qualquer sequência de chamadas — inclusive a que o índice
 * existe para impedir.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AchadoRegistrado } from '@shared/domain/squad-achado'
import { openDatabase } from '../storage/database'
import { AchadoRepository, type EscopoDoRun } from './achado-repository'

const ESCOPO: EscopoDoRun = { userId: 'u-1', workspaceId: 'jarvis', runId: 'run-1' }

let dir: string
let db: Db
let repo: AchadoRepository

const achado = (extra: Partial<AchadoRegistrado> = {}): AchadoRegistrado => ({
  categoria: 'corretude',
  severidade: 'P1',
  titulo: 'O parser perde o último item',
  arquivo: 'src/a.ts',
  trecho: 'items.slice(0, -1)',
  impacto: 'Dado perdido.',
  correcao: 'Usar items.slice().',
  foraDaSpec: false,
  assinatura: 'sig-1',
  estado: 'open',
  vistoPor: ['rev-1'],
  contestadoPor: [],
  deltaDaPrimeiraVista: 'd1',
  deltaDaUltimaVista: 'd1',
  ...extra
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-achados-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new AchadoRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('salvar e listar', () => {
  it('guarda o achado e o devolve igual', () => {
    repo.salvar(ESCOPO, [achado()])

    expect(repo.listar('u-1', 'run-1')).toEqual([achado()])
  })

  it('guardar de novo a mesma assinatura atualiza, não duplica', () => {
    repo.salvar(ESCOPO, [achado()])
    repo.salvar(ESCOPO, [achado({ vistoPor: ['rev-1', 'rev-2'], deltaDaUltimaVista: 'd2' })])

    const lista = repo.listar('u-1', 'run-1')
    expect(lista).toHaveLength(1)
    expect(lista[0]?.vistoPor).toEqual(['rev-1', 'rev-2'])
    expect(lista[0]?.deltaDaUltimaVista).toBe('d2')
  })

  it('o texto da primeira vista não muda: a assinatura o ancora', () => {
    repo.salvar(ESCOPO, [achado()])
    repo.salvar(ESCOPO, [achado({ titulo: 'Outro título', impacto: 'Outro impacto' })])

    expect(repo.listar('u-1', 'run-1')[0]?.titulo).toBe('O parser perde o último item')
  })

  it('guarda o ciclo de vida: fechamento, motivo e reaberturas', () => {
    repo.salvar(ESCOPO, [
      achado({
        estado: 'fixed',
        deltaDoFechamento: 'd2',
        motivoDoEstado: 'trecho-removido',
        reaberturas: 1
      })
    ])

    expect(repo.listar('u-1', 'run-1')[0]).toMatchObject({
      estado: 'fixed',
      deltaDoFechamento: 'd2',
      motivoDoEstado: 'trecho-removido',
      reaberturas: 1
    })
  })

  it('recusa a transição que o ciclo de vida não permite, sem gravar nada', () => {
    repo.salvar(ESCOPO, [achado({ estado: 'superseded' })])

    expect(() =>
      repo.salvar(ESCOPO, [achado({ assinatura: 'sig-2' }), achado({ estado: 'open' })])
    ).toThrow(/superseded → open/)
    expect(repo.listar('u-1', 'run-1')).toHaveLength(1)
  })

  it('o achado de um usuário não vaza para outro, nem é sobrescrito por ele', () => {
    repo.salvar(ESCOPO, [achado()])
    repo.salvar({ ...ESCOPO, userId: 'u-2' }, [achado({ severidade: 'P3' })])

    expect(repo.listar('u-2', 'run-1')).toEqual([])
    expect(repo.listar('u-1', 'run-1')[0]?.severidade).toBe('P1')
  })

  it('o estado fora do vocabulário é barrado pelo banco, mesmo por SQL direto', () => {
    expect(() =>
      db.exec(
        "INSERT INTO squad_achado VALUES ('r','s','u','w','aprovado','P1','c','t','a','x','i','c',0,NULL,'[]','[]','d','d',NULL,NULL,0,'agora')"
      )
    ).toThrow(/CHECK/)
  })
})

describe('voltas do retrabalho', () => {
  it('registra cada volta, na ordem, com o que voltou ao escritor', () => {
    repo.registrarVolta(ESCOPO, {
      tentativa: 1,
      origem: 'teste',
      decisao: 'voltar',
      assinaturas: []
    })
    repo.registrarVolta(ESCOPO, {
      tentativa: 2,
      origem: 'revisao',
      decisao: 'voltar',
      assinaturas: ['sig-1']
    })
    repo.registrarVolta(ESCOPO, {
      tentativa: 3,
      origem: 'revisao',
      decisao: 'parar',
      motivo: 'tentativas-esgotadas',
      assinaturas: ['sig-1']
    })

    const voltas = repo.listarVoltas('u-1', 'run-1')
    expect(voltas.map((v) => [v.tentativa, v.origem, v.decisao])).toEqual([
      [1, 'teste', 'voltar'],
      [2, 'revisao', 'voltar'],
      [3, 'revisao', 'parar']
    ])
    expect(voltas[2]).toMatchObject({ motivo: 'tentativas-esgotadas', assinaturas: ['sig-1'] })
  })

  it('a mesma volta duas vezes é erro: o registro não mente sobre quantas houve', () => {
    const volta = { tentativa: 1, origem: 'teste', decisao: 'voltar', assinaturas: [] } as const
    repo.registrarVolta(ESCOPO, volta)

    expect(() => repo.registrarVolta(ESCOPO, volta)).toThrow()
  })

  it('tentativa menor que 1 é barrada pelo banco', () => {
    expect(() =>
      repo.registrarVolta(ESCOPO, {
        tentativa: 0,
        origem: 'teste',
        decisao: 'voltar',
        assinaturas: []
      })
    ).toThrow(/CHECK/)
  })
})
