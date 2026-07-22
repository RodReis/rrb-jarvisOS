/**
 * Testes do núcleo `evaluate` (SPEC-Execucao-02, categoria Regras).
 *
 * O engine é puro, então estes testes não tocam storage nem Electron — exercitam a decisão
 * diretamente. Cobrem os quatro tiers (critério 1), a sensibilidade no JARVIS (critério 2),
 * o fail-closed (critério 1) e a leitura do seed (critério 4).
 */

import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate'
import { RISK_TAXONOMY } from './taxonomy'
import type { PolicyContext } from './contracts'

const noa: PolicyContext = { workspace: 'noa' }
const jarvis: PolicyContext = { workspace: 'jarvis' }

describe('evaluate — tiers a partir do seed (critério 1)', () => {
  it('classifica ação de baixo risco como baixo/allow', () => {
    const d = evaluate('workflow.run-simulated', noa)
    expect(d.tier).toBe('baixo')
    expect(d.outcome).toBe('allow')
    expect(d.reason).toBe('classificada-pelo-seed')
  })

  it('classifica ação de médio risco como medio/requires-approval', () => {
    const d = evaluate('api.external-call', noa)
    expect(d.tier).toBe('medio')
    expect(d.outcome).toBe('requires-approval')
  })

  it('classifica ação de alto risco como alto/requires-approval', () => {
    const d = evaluate('deploy.production', noa)
    expect(d.tier).toBe('alto')
    expect(d.outcome).toBe('requires-approval')
  })

  it('classifica ação desconhecida como bloqueado/block (fail-closed)', () => {
    const d = evaluate('acao.que.nao.existe', noa)
    expect(d.tier).toBe('bloqueado')
    expect(d.outcome).toBe('block')
    expect(d.reason).toBe('acao-desconhecida-fail-closed')
  })

  it('o `action` da decisão ecoa o id recebido, mesmo desconhecido', () => {
    expect(evaluate('x.y', noa).action).toBe('x.y')
  })
})

describe('evaluate — sensibilidade no JARVIS (critério 2)', () => {
  it.each(['personal', 'financial', 'health'] as const)(
    'eleva a alto/requires-approval quando toca %s no JARVIS',
    (sensitivity) => {
      // `analysis.read-only` é baixo no seed; a sensibilidade o empurra para alto.
      const d = evaluate('analysis.read-only', { workspace: 'jarvis', sensitivity })
      expect(d.tier).toBe('alto')
      expect(d.outcome).toBe('requires-approval')
      expect(d.reason).toBe('elevada-por-sensibilidade-no-jarvis')
    }
  )

  it('NÃO eleva a mesma ação sensível no NOA — a regra é do JARVIS', () => {
    const d = evaluate('analysis.read-only', { workspace: 'noa', sensitivity: 'financial' })
    expect(d.tier).toBe('baixo')
    expect(d.reason).toBe('classificada-pelo-seed')
  })

  it('NÃO eleva por sensibilidade não protegida (internal/public)', () => {
    const d = evaluate('analysis.read-only', { workspace: 'jarvis', sensitivity: 'internal' })
    expect(d.tier).toBe('baixo')
  })

  it('a elevação vale mesmo para uma ação que já seria média', () => {
    // Precedência: sensibilidade eleva para alto independentemente do tier de origem.
    const d = evaluate('api.external-call', { workspace: 'jarvis', sensitivity: 'health' })
    expect(d.tier).toBe('alto')
  })

  it('fail-closed precede a sensibilidade: ação desconhecida sensível ⇒ bloqueado', () => {
    const d = evaluate('acao.inexistente', { workspace: 'jarvis', sensitivity: 'personal' })
    expect(d.tier).toBe('bloqueado')
    expect(d.reason).toBe('acao-desconhecida-fail-closed')
  })
})

describe('evaluate — a decisão vem do seed, não de constante embutida (critério 4)', () => {
  it('toda entrada do seed classifica no próprio tier', () => {
    for (const [id, entrada] of RISK_TAXONOMY) {
      // `noa` sem sensitivity: nenhuma regra de contexto interfere, o tier é o do seed.
      expect(evaluate(id, noa).tier).toBe(entrada.tier)
    }
  })

  it('nenhuma entrada do seed nasce como bloqueado', () => {
    // `bloqueado` é destino do desconhecido, não um tier semeável (ver taxonomy.ts).
    for (const entrada of RISK_TAXONOMY.values()) {
      expect(entrada.tier).not.toBe('bloqueado')
    }
  })
})

describe('evaluate — modo report não é visível aqui, mas o outcome é o que o runtime lê', () => {
  it('bloqueado devolve outcome block — barrar (ou não) é decisão do chamador', () => {
    // O engine só classifica; que `block` não barre nesta fatia é responsabilidade do
    // runtime (testado na categoria Banco). Aqui só se afirma que o outcome está correto.
    expect(evaluate('acao.desconhecida', jarvis).outcome).toBe('block')
  })
})
