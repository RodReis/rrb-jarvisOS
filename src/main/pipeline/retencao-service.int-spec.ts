/**
 * O coletor de retenção contra disco e banco reais (SPEC-Entrega-06, critério 9).
 *
 * O que se prova aqui é a **ordem**: marcar a linha antes de apagar o anexo. Invertida, uma
 * falha no meio deixaria a referência versionada afirmando que o conteúdo está presente quando
 * ele já saiu — exatamente o que o critério proíbe. Com disco real, o teste vê o arquivo sumir;
 * com um `fs` dublado, veria só a intenção.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import { COTA_BYTES } from '@shared/domain/retencao'
import type { ArtefatoRetido } from '@shared/domain/retencao'
import { openDatabase } from '../storage/database'
import { ExecutionLedgerRepository } from './execution-ledger-repository'
import { RetencaoService } from './retencao-service'

const DIA_MS = 24 * 60 * 60 * 1000
const USER = 'user-1'
const AGORA = Date.parse('2026-09-02T00:00:00.000Z')

let dir: string
let db: Db
let ledger: ExecutionLedgerRepository

function anexo(nome: string, conteudo = 'conteudo pesado'): string {
  const caminho = join(dir, nome)
  writeFileSync(caminho, conteudo)
  return caminho
}

function registrar(over: Partial<ArtefatoRetido> & { readonly id: string }): void {
  ledger.registrarArtefato(USER, {
    runId: 'run-1',
    hash: 'h'.repeat(64),
    bytes: 15,
    criadoEm: new Date(AGORA - DIA_MS).toISOString(),
    fixado: false,
    estadoDoRun: 'MERGED' as EstadoDoRun,
    ...over
  })
}

function servico(caminhoDoAnexo: (item: ArtefatoRetido) => string): RetencaoService {
  return new RetencaoService({ ledger, caminhoDoAnexo, agora: () => AGORA })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-retencao-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  ledger = new ExecutionLedgerRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('RetencaoService', () => {
  it('apaga o anexo do artefato vencido e marca a linha como expirada', () => {
    const caminho = anexo('log.txt')
    registrar({ id: 'art-1', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })

    const saiu = servico(() => caminho).coletar(USER)

    expect(saiu.map((a) => a.id)).toEqual(['art-1'])
    expect(existsSync(caminho)).toBe(false)
    expect(ledger.listarArtefatos(USER)).toHaveLength(0)
  })

  it('a linha sobrevive à expiração — o hash continua sendo a prova', () => {
    const caminho = anexo('log.txt')
    registrar({ id: 'art-1', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })

    servico(() => caminho).coletar(USER)

    const row = db.prepare('SELECT hash FROM artefato_retido WHERE id = ?').get('art-1') as
      | { hash: string }
      | undefined
    expect(row?.hash).toBe('h'.repeat(64))
  })

  it('preserva artefato de run não resolvido, por mais velho que seja', () => {
    const caminho = anexo('preso.txt')
    registrar({
      id: 'art-2',
      criadoEm: new Date(AGORA - 900 * DIA_MS).toISOString(),
      estadoDoRun: 'AWAITING_MERGE'
    })

    expect(servico(() => caminho).coletar(USER)).toEqual([])
    expect(existsSync(caminho)).toBe(true)
  })

  it('preserva artefato fixado, por mais velho que seja', () => {
    const caminho = anexo('fixado.txt')
    registrar({
      id: 'art-3',
      criadoEm: new Date(AGORA - 900 * DIA_MS).toISOString(),
      fixado: true
    })

    expect(servico(() => caminho).coletar(USER)).toEqual([])
    expect(existsSync(caminho)).toBe(true)
  })

  it('estourada a cota, o mais antigo sai primeiro', () => {
    const antigo = anexo('antigo.txt')
    const recente = anexo('recente.txt')
    const metade = Math.floor(COTA_BYTES / 2) + 1

    registrar({
      id: 'antigo',
      bytes: metade,
      criadoEm: new Date(AGORA - 3 * DIA_MS).toISOString()
    })
    registrar({
      id: 'recente',
      bytes: metade,
      criadoEm: new Date(AGORA - 1 * DIA_MS).toISOString()
    })

    const caminhos: Record<string, string> = { antigo, recente }
    const saiu = servico((item) => caminhos[item.id] ?? '').coletar(USER)

    expect(saiu.map((a) => a.id)).toEqual(['antigo'])
    expect(existsSync(antigo)).toBe(false)
    expect(existsSync(recente)).toBe(true)
  })

  it('anexo já ausente não impede a marcação: o objetivo é a coerência, não o arquivo', () => {
    registrar({ id: 'art-4', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })

    const saiu = servico(() => join(dir, 'nao-existe.txt')).coletar(USER)

    expect(saiu).toHaveLength(1)
    expect(ledger.listarArtefatos(USER)).toHaveLength(0)
  })

  it('marca a linha antes de apagar o anexo — invertido, a referência mentiria', () => {
    const caminho = anexo('ordem.txt')
    registrar({ id: 'art-5', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })

    const ordem: string[] = []
    const espiao = vi.spyOn(ledger, 'marcarExpirado').mockImplementation((userId, id, quando) => {
      ordem.push('marcou')
      ExecutionLedgerRepository.prototype.marcarExpirado.call(ledger, userId, id, quando)
    })

    servico((item) => {
      // Lido no momento em que o serviço vai apagar: se a marcação viesse depois, `ordem`
      // registraria "apagou" primeiro.
      ordem.push('apagou')
      return join(dir, `${item.id}.txt`)
    }).coletar(USER)

    expect(ordem).toEqual(['marcou', 'apagou'])
    espiao.mockRestore()
    expect(existsSync(caminho)).toBe(true)
  })

  it('nada elegível: nenhuma linha é tocada', () => {
    const caminho = anexo('novo.txt')
    registrar({ id: 'art-6' })

    expect(servico(() => caminho).coletar(USER)).toEqual([])
    expect(ledger.listarArtefatos(USER)).toHaveLength(1)
    expect(existsSync(caminho)).toBe(true)
  })

  it('não coleta artefato de outro usuário', () => {
    const caminho = anexo('outro.txt')
    registrar({ id: 'art-7', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })

    expect(servico(() => caminho).coletar('outro-usuario')).toEqual([])
    expect(existsSync(caminho)).toBe(true)
  })
})
