import { describe, expect, it } from 'vitest'
import type { EstadoDoRun } from './pipeline'
import {
  decidirRecuperacao,
  faseDoCancelamento,
  type ObservacaoDoRun,
  type SlotObservado
} from './recuperacao'

const base: ObservacaoDoRun = {
  estado: 'RUNNING',
  slot: 'vigente',
  executor: 'vivo',
  mergeEmCurso: false
}

const com = (parcial: Partial<ObservacaoDoRun>): ObservacaoDoRun => ({ ...base, ...parcial })

describe('decidirRecuperacao — o que a fonte real mostra vence a suposição local (regra 1)', () => {
  it('run saudável com lease vigente não é tocado', () => {
    expect(decidirRecuperacao(com({})).acao).toBe('manter')
  })

  it('lease expirado com executor vivo é lentidão, não morte: o run não é tocado', () => {
    const d = decidirRecuperacao(com({ slot: 'expirado', executor: 'vivo' }))
    expect(d.acao).toBe('manter')
  })

  it('lease expirado e executor morto bloqueia o run e recolhe os recursos', () => {
    const d = decidirRecuperacao(com({ slot: 'expirado', executor: 'morto' }))
    expect(d.acao).toBe('bloquear-e-recolher')
  })

  it('lease expirado e executor indeterminado espera: falha de detecção não é morte', () => {
    const d = decidirRecuperacao(com({ slot: 'expirado', executor: 'desconhecido' }))
    expect(d.acao).toBe('aguardar')
  })

  it('merge em curso nunca é interrompido por suposição — a origem é consultada antes', () => {
    const d = decidirRecuperacao(
      com({ estado: 'PR_CI', slot: 'expirado', executor: 'morto', mergeEmCurso: true })
    )
    expect(d.acao).toBe('aguardar')
  })

  it('run terminal que ainda segura slot é recolhido, vigente ou expirado', () => {
    const terminais: EstadoDoRun[] = ['BLOCKED', 'CANCELLED', 'MERGED', 'AWAITING_MERGE']
    const slots: SlotObservado[] = ['vigente', 'expirado']
    for (const estado of terminais) {
      for (const slot of slots) {
        expect(decidirRecuperacao(com({ estado, slot })).acao).toBe('recolher')
      }
    }
  })

  it('run terminal sem slot não tem o que recolher', () => {
    expect(decidirRecuperacao(com({ estado: 'CANCELLED', slot: 'ausente' })).acao).toBe('manter')
  })

  it('run que ainda não executa e não tem slot segue na fila', () => {
    expect(decidirRecuperacao(com({ estado: 'READY', slot: 'ausente' })).acao).toBe('manter')
  })

  it('todo motivo é legível: nenhuma decisão sai sem explicação', () => {
    const observacoes = [
      com({}),
      com({ slot: 'expirado', executor: 'morto' }),
      com({ slot: 'expirado', executor: 'desconhecido' }),
      com({ estado: 'BLOCKED' })
    ]
    for (const o of observacoes) expect(decidirRecuperacao(o).motivo.trim()).not.toBe('')
  })
})

describe('faseDoCancelamento — a matriz aprovada por estado do run', () => {
  const casos: readonly (readonly [EstadoDoRun, string])[] = [
    ['PLANNED', 'antes-do-executor'],
    ['AWAITING_PI', 'antes-do-executor'],
    ['READY', 'antes-do-executor'],
    ['RUNNING', 'durante-execucao'],
    ['VALIDATING', 'durante-execucao'],
    ['PR_CI', 'durante-ci']
  ]

  it.each(casos)('%s cancela na fase %s', (estado, fase) => {
    expect(faseDoCancelamento(estado)).toBe(fase)
  })

  it('executando com o PR já publicado é depois do push: o trabalho está no remoto', () => {
    // O run volta a VALIDATING para revalidar depois de a base avançar, com o PR aberto.
    expect(faseDoCancelamento('RUNNING', true)).toBe('depois-do-push')
    expect(faseDoCancelamento('VALIDATING', true)).toBe('depois-do-push')
  })

  it('o CI com PR continua sendo a fase do CI', () => {
    expect(faseDoCancelamento('PR_CI', true)).toBe('durante-ci')
  })

  it('antes do executor não há PR, mesmo se alguém disser que há', () => {
    expect(faseDoCancelamento('READY', true)).toBe('antes-do-executor')
  })

  it('run terminal não tem fase de cancelamento: não há o que cancelar', () => {
    expect(faseDoCancelamento('MERGED')).toBeUndefined()
    expect(faseDoCancelamento('CANCELLED')).toBeUndefined()
    expect(faseDoCancelamento('BLOCKED')).toBeUndefined()
    expect(faseDoCancelamento('AWAITING_MERGE')).toBeUndefined()
  })
})
