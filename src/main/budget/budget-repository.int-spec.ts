/**
 * Persistência e recorte de período do orçamento (SPEC-Providers-03, critérios 1, 3 e 6).
 *
 * Banco real (SQLite em diretório temporário), não dublê: o que estes testes afirmam é
 * justamente o comportamento do storage — o `SUM` que ignora NULL, o `ON CONFLICT` que
 * atualiza em vez de duplicar, e o recorte por prefixo de ISO. Um repositório dublado
 * concordaria com qualquer coisa que eu escrevesse.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMIAR_DE_ALERTA_PADRAO, LIMITE_DIARIO_PADRAO } from '@shared/domain/budget'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from '../storage/database'
import { AuditRepository } from '../storage/audit-repository'
import { BudgetRepository } from './budget-repository'
import { BudgetInputError, BudgetService } from './budget-service'

const USUARIO = 'user-teste'

let dir: string
let db: Db
let repo: BudgetRepository
let audit: InstanceType<typeof AuditRepository>

/** Uma chamada custando `realUsd` naquele instante. */
function gastar(realUsd: number, quando: Date, workspace: 'noa' | 'jarvis' = 'jarvis'): void {
  repo.recordCost(
    {
      user_id: USUARIO,
      workspace_id: workspace,
      callId: `call-${quando.toISOString()}-${realUsd}`,
      provider: 'anthropic',
      model: 'claude-opus-5',
      estimadoUsd: realUsd,
      realUsd
    },
    quando
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-budget-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  repo = new BudgetRepository(db)
  audit = new AuditRepository(db, 'chave-de-teste')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('BudgetPolicy persistida (critério 1)', () => {
  it('sem linha gravada, devolve o padrão USD 1/USD 1/0,8', () => {
    const policy = repo.find(USUARIO, 'jarvis')

    expect(policy.dailyLimit).toBe(LIMITE_DIARIO_PADRAO)
    expect(policy.monthlyLimit).toBe(1)
    expect(policy.alertThreshold).toBe(LIMIAR_DE_ALERTA_PADRAO)
    expect(policy.currency).toBe('USD')
  })

  it('grava e relê os limites ajustados', () => {
    repo.save(
      {
        user_id: USUARIO,
        workspace_id: 'jarvis',
        dailyLimit: 5,
        monthlyLimit: 50,
        alertThreshold: 0.5,
        currency: 'USD'
      },
      new Date('2026-08-29T12:00:00.000Z')
    )

    const relido = repo.find(USUARIO, 'jarvis')
    expect(relido.dailyLimit).toBe(5)
    expect(relido.monthlyLimit).toBe(50)
    expect(relido.alertThreshold).toBe(0.5)
  })

  it('salvar de novo atualiza a linha — o orçamento é um por escopo, não um histórico', () => {
    const base = {
      user_id: USUARIO,
      workspace_id: 'jarvis' as const,
      monthlyLimit: 50,
      alertThreshold: 0.8,
      currency: 'USD' as const
    }
    const quando = new Date('2026-08-29T12:00:00.000Z')

    repo.save({ ...base, dailyLimit: 5 }, quando)
    repo.save({ ...base, dailyLimit: 9 }, quando)

    expect(repo.find(USUARIO, 'jarvis').dailyLimit).toBe(9)
    const linhas = db.prepare('SELECT COUNT(*) AS n FROM budget_policy').get() as { n: number }
    expect(linhas.n).toBe(1)
  })

  it('NOA e JARVIS têm orçamentos próprios (escopo user+workspace)', () => {
    repo.save(
      {
        user_id: USUARIO,
        workspace_id: 'noa',
        dailyLimit: 7,
        monthlyLimit: 70,
        alertThreshold: 0.8,
        currency: 'USD'
      },
      new Date('2026-08-29T12:00:00.000Z')
    )

    expect(repo.find(USUARIO, 'noa').dailyLimit).toBe(7)
    expect(repo.find(USUARIO, 'jarvis').dailyLimit).toBe(LIMITE_DIARIO_PADRAO)
  })
})

describe('total corrente — dia e mês contam separado (critério 3)', () => {
  const AGORA = new Date('2026-08-29T15:00:00.000Z')

  it('soma só o dia corrente no diário, e o mês inteiro no mensal', () => {
    gastar(0.1, new Date('2026-08-29T09:00:00.000Z')) // hoje
    gastar(0.2, new Date('2026-08-29T14:00:00.000Z')) // hoje
    gastar(0.4, new Date('2026-08-28T09:00:00.000Z')) // ontem, mesmo mês

    const total = repo.totals(USUARIO, 'jarvis', AGORA)

    expect(total.diaUsd).toBeCloseTo(0.3)
    expect(total.mesUsd).toBeCloseTo(0.7)
  })

  it('gasto de outro mês não entra em nenhum dos dois', () => {
    gastar(5, new Date('2026-07-29T09:00:00.000Z'))

    const total = repo.totals(USUARIO, 'jarvis', AGORA)

    expect(total.diaUsd).toBe(0)
    expect(total.mesUsd).toBe(0)
  })

  it('gasto de outro workspace não conta no escopo consultado', () => {
    gastar(0.5, AGORA, 'noa')

    expect(repo.totals(USUARIO, 'jarvis', AGORA).diaUsd).toBe(0)
    expect(repo.totals(USUARIO, 'noa', AGORA).diaUsd).toBeCloseTo(0.5)
  })

  it('sem nenhuma chamada, o acumulado é zero — não NULL', () => {
    expect(repo.totals(USUARIO, 'jarvis', AGORA)).toEqual({ diaUsd: 0, mesUsd: 0 })
  })

  it('chamada sem custo medido não entra como zero: NULL não é somado', () => {
    // A falha antes do `usage` não sabe quanto custou. Se `realUsd` ausente virasse zero, o
    // acumulado afirmaria que a chamada não custou nada — que é diferente de "não se sabe".
    repo.recordCost(
      {
        user_id: USUARIO,
        workspace_id: 'jarvis',
        callId: 'call-sem-usage',
        provider: 'anthropic',
        model: 'claude-opus-5',
        estimadoUsd: 0.9
      },
      AGORA
    )
    gastar(0.1, AGORA)

    const linha = db
      .prepare("SELECT real_usd FROM cost_event WHERE call_id = 'call-sem-usage'")
      .get() as { real_usd: number | null }

    expect(linha.real_usd).toBeNull()
    expect(repo.totals(USUARIO, 'jarvis', AGORA).diaUsd).toBeCloseTo(0.1)
  })
})

describe('BudgetService — gate auditado (critérios 2 e 6)', () => {
  const AGORA = new Date('2026-08-29T15:00:00.000Z')

  function servico(): BudgetService {
    return new BudgetService(repo, audit, () => AGORA)
  }

  function decisoes(): readonly unknown[] {
    return audit
      .list(USUARIO)
      .filter((e) => e.type === 'budget-decision')
      .map((e) => (e.payload as Record<string, unknown>).decisao)
  }

  it('permite quando cabe, e audita a decisão', () => {
    const veredito = servico().check({ userId: USUARIO, workspace: 'jarvis' }, 0.01)

    expect(veredito.decisao).toBe('permitido')
    expect(decisoes()).toEqual(['permitido'])
  })

  it('alerta ao cruzar o limiar, e a decisão auditada nomeia o alerta', () => {
    gastar(0.79, AGORA)

    const veredito = servico().check({ userId: USUARIO, workspace: 'jarvis' }, 0.01)

    expect(veredito.decisao).toBe('alerta')
    expect(decisoes()).toEqual(['alerta'])
  })

  it('bloqueia ao exceder, e a decisão auditada nomeia o bloqueio (estourar é auditado)', () => {
    gastar(0.99, AGORA)

    const veredito = servico().check({ userId: USUARIO, workspace: 'jarvis' }, 0.5)

    expect(veredito.decisao).toBe('bloqueado')
    expect(decisoes()).toEqual(['bloqueado'])
  })

  it('audita os três desfechos, não só o bloqueio', () => {
    // "O orçamento nunca barrou" e "o gate nunca rodou" são fatos diferentes; um log só dos
    // bloqueios os tornaria indistinguíveis na auditoria.
    const gate = servico()
    gate.check({ userId: USUARIO, workspace: 'jarvis' }, 0.01)
    gastar(0.79, AGORA)
    gate.check({ userId: USUARIO, workspace: 'jarvis' }, 0.01)
    gastar(0.5, AGORA)
    gate.check({ userId: USUARIO, workspace: 'jarvis' }, 0.5)

    expect(decisoes()).toEqual(['permitido', 'alerta', 'bloqueado'])
  })

  it('a cadeia de auditoria continua íntegra depois das decisões (critério 6)', () => {
    const gate = servico()
    gate.check({ userId: USUARIO, workspace: 'jarvis' }, 0.01)
    gate.setLimits(
      { userId: USUARIO, workspace: 'jarvis' },
      { dailyLimit: 5, monthlyLimit: 50, alertThreshold: 0.8 }
    )

    const verificacao = audit.verify(USUARIO)
    expect(verificacao.ok).toBe(true)
  })

  it('editar limites gera `budget-change` com o antes e o depois', () => {
    servico().setLimits(
      { userId: USUARIO, workspace: 'jarvis' },
      { dailyLimit: 5, monthlyLimit: 50, alertThreshold: 0.5 }
    )

    const evento = audit.list(USUARIO).find((e) => e.type === 'budget-change')
    expect(evento).toBeDefined()
    const payload = evento?.payload as { de: Record<string, number>; para: Record<string, number> }
    expect(payload.de.dailyLimit).toBe(LIMITE_DIARIO_PADRAO)
    expect(payload.para.dailyLimit).toBe(5)
  })

  it('o snapshot devolve limites e acumulado juntos — o que a tela mostra', () => {
    gastar(0.25, AGORA)

    const snapshot = servico().snapshot({ userId: USUARIO, workspace: 'jarvis' })

    expect(snapshot.policy.dailyLimit).toBe(LIMITE_DIARIO_PADRAO)
    expect(snapshot.gasto.diaUsd).toBeCloseTo(0.25)
  })

  it('limite elevado destrava a chamada que o padrão barrava', () => {
    gastar(0.99, AGORA)
    const gate = servico()

    expect(gate.check({ userId: USUARIO, workspace: 'jarvis' }, 0.5).decisao).toBe('bloqueado')

    gate.setLimits(
      { userId: USUARIO, workspace: 'jarvis' },
      { dailyLimit: 50, monthlyLimit: 50, alertThreshold: 0.8 }
    )

    expect(gate.check({ userId: USUARIO, workspace: 'jarvis' }, 0.5).decisao).toBe('permitido')
  })
})

describe('BudgetService — entrada recusada na fronteira', () => {
  function servico(): BudgetService {
    return new BudgetService(repo, audit, () => new Date('2026-08-29T15:00:00.000Z'))
  }

  it.each([
    ['limite diário negativo', { dailyLimit: -1, monthlyLimit: 10, alertThreshold: 0.8 }],
    ['limite mensal negativo', { dailyLimit: 1, monthlyLimit: -5, alertThreshold: 0.8 }],
    ['limiar acima de 1', { dailyLimit: 1, monthlyLimit: 10, alertThreshold: 1.5 }],
    ['limiar zero', { dailyLimit: 1, monthlyLimit: 10, alertThreshold: 0 }],
    ['limite não-finito', { dailyLimit: Number.NaN, monthlyLimit: 10, alertThreshold: 0.8 }]
  ])('recusa %s sem gravar', (_caso, limites) => {
    expect(() => servico().setLimits({ userId: USUARIO, workspace: 'jarvis' }, limites)).toThrow(
      BudgetInputError
    )

    // Nada gravado: o orçamento segue no padrão. Uma recusa que já tivesse escrito deixaria o
    // banco num estado que o erro diz não existir.
    expect(repo.find(USUARIO, 'jarvis').dailyLimit).toBe(LIMITE_DIARIO_PADRAO)
  })
})

describe('consumoDoRun', () => {
  /** Uma chamada correlacionada a um run, com tokens medidos. */
  function gastarNoRun(
    runId: string,
    realUsd: number,
    tokens: { entrada: number; saida: number },
    tentativa: number,
    opcoes: { unmetered?: boolean } = {}
  ): void {
    repo.recordCost(
      {
        user_id: USUARIO,
        workspace_id: 'jarvis',
        callId: `call-${runId}-${tentativa}-${realUsd}`,
        provider: 'anthropic',
        model: 'claude-opus-5',
        estimadoUsd: realUsd,
        realUsd,
        tokensEntrada: tokens.entrada,
        tokensSaida: tokens.saida,
        runId,
        tentativa,
        ...(opcoes.unmetered === undefined ? {} : { unmetered: opcoes.unmetered })
      },
      new Date('2026-09-02T10:00:00.000Z')
    )
  }

  it('devolve zeros quando o run não gerou chamada alguma', () => {
    expect(repo.consumoDoRun(USUARIO, 'run-vazio')).toEqual({
      custoUsd: 0,
      tokens: 0,
      tentativas: 0
    })
  })

  it('soma custo e tokens de todas as tentativas do run', () => {
    gastarNoRun('run-1', 0.5, { entrada: 100, saida: 50 }, 1)
    gastarNoRun('run-1', 0.25, { entrada: 40, saida: 10 }, 2)

    expect(repo.consumoDoRun(USUARIO, 'run-1')).toEqual({
      custoUsd: 0.75,
      tokens: 200,
      tentativas: 2
    })
  })

  it('não mistura o consumo de dois runs', () => {
    gastarNoRun('run-1', 0.5, { entrada: 100, saida: 50 }, 1)
    gastarNoRun('run-2', 9, { entrada: 900, saida: 900 }, 1)

    expect(repo.consumoDoRun(USUARIO, 'run-1').custoUsd).toBe(0.5)
  })

  it('não vaza consumo de outro usuário', () => {
    gastarNoRun('run-1', 0.5, { entrada: 100, saida: 50 }, 1)
    expect(repo.consumoDoRun('outro-usuario', 'run-1').tokens).toBe(0)
  })

  it('conta os tokens da rota de assinatura — ela não gasta orçamento, mas consumiu tokens', () => {
    gastarNoRun('run-3', 0, { entrada: 300, saida: 200 }, 1, { unmetered: true })
    expect(repo.consumoDoRun(USUARIO, 'run-3').tokens).toBe(500)
  })
})
