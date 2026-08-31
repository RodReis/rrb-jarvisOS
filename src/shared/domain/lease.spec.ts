/**
 * Testes do domínio de lease (SPEC-Entrega-02, critérios 2 e 3).
 *
 * O critério 3 — *"lease expirado não autoriza roubo antes da reconciliação"* — é o que este
 * arquivo prova. A tentação seria testar "expirou ⇒ pode adquirir"; o teste correto é o
 * contrário, e é ele que impede dois executores sobre o mesmo worktree.
 */

import { describe, expect, it } from 'vitest'

import {
  RECURSO_WIP_GLOBAL,
  VALIDADE_DO_LEASE_MS,
  estadoDoLease,
  podeAdquirir,
  proximaExpiracao,
  type Lease
} from './lease'

const AGORA = 1_700_000_000_000

function lease(sobrescreve: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1',
    user_id: 'user-1',
    proprietario: 'run-1',
    recurso: RECURSO_WIP_GLOBAL,
    heartbeatEm: AGORA,
    expiraEm: proximaExpiracao(AGORA),
    created_at: new Date(AGORA).toISOString(),
    ...sobrescreve
  }
}

describe('estado do lease', () => {
  it('trata a ausência de lease como livre', () => {
    expect(estadoDoLease(undefined, AGORA)).toBe('livre')
  })

  it('mantém vigente enquanto o heartbeat não vencer', () => {
    expect(estadoDoLease(lease(), AGORA + VALIDADE_DO_LEASE_MS - 1)).toBe('vigente')
  })

  it('expira no instante exato do vencimento, não depois dele', () => {
    // `>=` e não `>`: com `>`, o próprio instante da expiração contaria como vigente, e a
    // fronteira passaria a depender da resolução do relógio.
    expect(estadoDoLease(lease(), AGORA + VALIDADE_DO_LEASE_MS)).toBe('expirado')
  })
})

describe('aquisição de lease', () => {
  it('autoriza quando o recurso está livre', () => {
    expect(podeAdquirir(undefined, 'run-2', AGORA)).toBe(true)
  })

  it('recusa quando outro run detém o lease e está vivo (critério 2)', () => {
    expect(podeAdquirir(lease({ proprietario: 'run-1' }), 'run-2', AGORA)).toBe(false)
  })

  it('NÃO autoriza roubo de lease expirado — a reconciliação decide (critério 3)', () => {
    const vencido = AGORA + VALIDADE_DO_LEASE_MS + 1

    expect(estadoDoLease(lease(), vencido)).toBe('expirado')
    expect(podeAdquirir(lease(), 'run-2', vencido)).toBe(false)
  })

  it('não autoriza nem o próprio dono a readquirir depois de expirar', () => {
    // Mesmo o dono original passa pela reconciliação: se o heartbeat parou, o que sobrou no
    // disco e no Docker precisa ser olhado antes de continuar como se nada tivesse havido.
    const vencido = AGORA + VALIDADE_DO_LEASE_MS + 1

    expect(podeAdquirir(lease({ proprietario: 'run-1' }), 'run-1', vencido)).toBe(false)
  })

  it('deixa o próprio dono readquirir o lease vigente — retry depois de crash (critério 4)', () => {
    expect(podeAdquirir(lease({ proprietario: 'run-1' }), 'run-1', AGORA + 10)).toBe(true)
  })
})

describe('slot global de WIP', () => {
  it('usa recurso constante, sem projeto: o slot é da máquina (emenda 1)', () => {
    const slot = lease({ recurso: RECURSO_WIP_GLOBAL })

    expect(slot.recurso).toBe('wip:global')
    expect(slot.projectId).toBeUndefined()
  })

  it('impede um run de outro projeto de adquirir o mesmo slot', () => {
    // É o critério 2 na forma mais direta: o recurso é o mesmo string para todo projeto, então
    // um lease vigente de qualquer projeto barra todos os outros.
    const doProjetoA = lease({ proprietario: 'run-do-projeto-a' })

    expect(podeAdquirir(doProjetoA, 'run-do-projeto-b', AGORA)).toBe(false)
  })
})
