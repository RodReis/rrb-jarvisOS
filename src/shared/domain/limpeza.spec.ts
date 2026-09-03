import { describe, expect, it } from 'vitest'
import { FASES_DE_CANCELAMENTO, planoDeLimpeza } from './limpeza'

describe('planoDeLimpeza', () => {
  it('antes do executor não há efeito a desfazer', () => {
    const plano = planoDeLimpeza('antes-do-executor')
    expect(plano.mataProcessos).toBe(false)
    expect(plano.preservaBranch).toBe(true)
    expect(plano.preservaPr).toBe(true)
  })

  it('durante a execução mata a árvore de processos e preserva o snapshot', () => {
    const plano = planoDeLimpeza('durante-execucao')
    expect(plano.mataProcessos).toBe(true)
    expect(plano.preservaSnapshot).toBe(true)
  })

  it('depois do push preserva branch e PR e converte o PR para rascunho', () => {
    const plano = planoDeLimpeza('depois-do-push')
    expect(plano.preservaBranch).toBe(true)
    expect(plano.preservaPr).toBe(true)
    expect(plano.convertePrParaRascunho).toBe(true)
  })

  it('durante o CI para o monitoramento', () => {
    expect(planoDeLimpeza('durante-ci').paraMonitoramentoDeCi).toBe(true)
  })

  it('depois do merge o resultado continua MERGED — nada é desfeito', () => {
    const plano = planoDeLimpeza('depois-do-merge')
    expect(plano.preservaBranch).toBe(true)
    expect(plano.preservaPr).toBe(true)
    expect(plano.convertePrParaRascunho).toBe(false)
  })

  it('nenhuma fase apaga branch, PR ou cria revert', () => {
    for (const fase of FASES_DE_CANCELAMENTO) {
      const plano = planoDeLimpeza(fase)
      expect(plano.preservaBranch).toBe(true)
      expect(plano.preservaPr).toBe(true)
      expect(plano.criaRevert).toBe(false)
    }
  })

  it('volume persistente nunca é removido, em fase alguma', () => {
    for (const fase of FASES_DE_CANCELAMENTO) {
      expect(planoDeLimpeza(fase).removeVolumePersistente).toBe(false)
    }
  })

  it('só as fases terminais removem worktree e container', () => {
    expect(planoDeLimpeza('durante-execucao').removeRecursos).toBe(false)
    expect(planoDeLimpeza('depois-do-merge').removeRecursos).toBe(true)
  })
})
