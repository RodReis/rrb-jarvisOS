import { describe, expect, it } from 'vitest'
import { rulesetMudou, type SnapshotDeRuleset } from './ruleset'

const BASE: SnapshotDeRuleset = {
  runId: 'run-1',
  branch: 'main',
  contexts: ['validacao'],
  strict: true,
  protegida: true,
  mergeQueueExigida: false,
  ref: 'RodReis/projeto/protection/main',
  observadoEm: '2026-09-02T10:00:00.000Z'
}

/** O que a origem devolve agora — o formato de `RequiredChecksNormalizado`, sem os campos do snapshot. */
const OBSERVADO = {
  contexts: ['validacao'],
  strict: true,
  protegida: true,
  mergeQueueExigida: false
}

describe('rulesetMudou — critério 11 da M9-F05', () => {
  it('não vê mudança quando a origem devolve a mesma regra', () => {
    expect(rulesetMudou(BASE, OBSERVADO)).toBe(false)
  })

  it('detecta um check obrigatório que entrou durante o run', () => {
    // É o cenário que o critério existe para pegar: mergear contra o snapshot velho entraria na
    // branch-base sem a verificação que a origem passou a exigir.
    expect(rulesetMudou(BASE, { ...OBSERVADO, contexts: ['validacao', 'seguranca'] })).toBe(true)
  })

  it('detecta um check obrigatório que saiu durante o run', () => {
    expect(rulesetMudou(BASE, { ...OBSERVADO, contexts: [] })).toBe(true)
  })

  it('não confunde ordem diferente com mudança', () => {
    // A ordem em que o GitHub devolve `contexts` não é contrato. Tratá-la como mudança forçaria
    // reconciliação a cada consulta, transformando o sinal em ruído — e ruído é o que faz um
    // alarme legítimo passar despercebido.
    const anterior = { ...BASE, contexts: ['validacao', 'seguranca'] }
    expect(rulesetMudou(anterior, { ...OBSERVADO, contexts: ['seguranca', 'validacao'] })).toBe(
      false
    )
  })

  it('detecta a proteção que sumiu no meio do run', () => {
    expect(rulesetMudou(BASE, { ...OBSERVADO, protegida: false, contexts: [] })).toBe(true)
  })

  it('detecta a merge queue que passou a ser exigida', () => {
    // Sem isto, um run que começou antes da merge queue tentaria mergear direto — o contorno que
    // o critério 12 proíbe.
    expect(rulesetMudou(BASE, { ...OBSERVADO, mergeQueueExigida: true })).toBe(true)
  })

  it('detecta a exigência de branch atualizado que passou a valer', () => {
    expect(rulesetMudou({ ...BASE, strict: false }, OBSERVADO)).toBe(true)
  })

  it('não deixa um check repetido mascarar outro que entrou', () => {
    // Comparar só o tamanho da lista deixaria `['a','a']` passar por `['a','b']`. O conjunto
    // ordenado é o que fecha esse vão.
    const anterior = { ...BASE, contexts: ['validacao', 'validacao'] }
    expect(rulesetMudou(anterior, { ...OBSERVADO, contexts: ['validacao', 'seguranca'] })).toBe(
      true
    )
  })
})
