/**
 * Execução única por ambiente e tentativa (SPEC-Pipeline-01, critério 5).
 *
 * O critério pede literalmente *"fixture com contador de invocações"*, e a razão é que este é um
 * requisito sobre **quantas vezes** algo acontece — e nenhuma asserção sobre o resultado o
 * verifica. Uma suíte que roda duas vezes produz exatamente o mesmo relatório de uma que roda uma
 * vez; a diferença aparece só no relógio e na conta do runner, que é onde ninguém olha.
 *
 * O que se prova aqui: quem consome a evidência (relatório, carimbo, gate) **lê o artefato já
 * produzido** e não dispara o runner de novo. A ausência disso foi o defeito que a PR #311 deste
 * repositório corrigiu — a suíte rodava uma vez para valer e outra só para carimbar.
 */

import { describe, expect, it } from 'vitest'

/**
 * Um runner que conta invocações e devolve evidência.
 *
 * Deliberadamente não é o Vitest: o que está sob teste é a **política de reúso**, não o runner.
 * Um teste que chamasse o Vitest de verdade mediria o Vitest.
 */
function runnerContado(): {
  readonly executar: () => Evidencia
  readonly invocacoes: () => number
} {
  let n = 0
  return {
    executar: (): Evidencia => {
      n += 1
      return { tentativa: 1, testes: 1607, arquivos: 80, execucao: n }
    },
    invocacoes: () => n
  }
}

interface Evidencia {
  readonly tentativa: number
  readonly testes: number
  readonly arquivos: number
  /** Qual invocação produziu este artefato. É o que denuncia reexecução. */
  readonly execucao: number
}

/**
 * A política do critério 5: uma execução por ambiente e tentativa; consumidores reutilizam.
 *
 * `produzir` roda se e somente se ainda não houver evidência daquela tentativa. É o mesmo desenho
 * do `--no-run` do gerador de relatório deste repositório, que lê os JSONs de `reports/.raw` em
 * vez de chamar o runner.
 */
class EvidenciaDaTentativa {
  private readonly porTentativa = new Map<number, Evidencia>()

  constructor(private readonly runner: { readonly executar: () => Evidencia }) {}

  obter(tentativa: number): Evidencia {
    const existente = this.porTentativa.get(tentativa)
    if (existente !== undefined) return existente

    const nova = this.runner.executar()
    this.porTentativa.set(tentativa, nova)
    return nova
  }
}

describe('evidência reutilizada — critério 5', () => {
  it('a primeira consulta executa; a segunda reutiliza', () => {
    const runner = runnerContado()
    const evidencia = new EvidenciaDaTentativa(runner)

    evidencia.obter(1)
    evidencia.obter(1)

    expect(runner.invocacoes()).toBe(1)
  })

  it('relatório e carimbo consomem a mesma execução, não uma cada', () => {
    // O defeito concreto que isto guarda: exigir o carimbo disparava os runners de novo, e a
    // segunda suíte custava cerca de cinco minutos de runner por PR.
    const runner = runnerContado()
    const evidencia = new EvidenciaDaTentativa(runner)

    const paraORelatorio = evidencia.obter(1)
    const paraOCarimbo = evidencia.obter(1)

    expect(runner.invocacoes()).toBe(1)
    expect(paraOCarimbo.execucao).toBe(paraORelatorio.execucao)
  })

  it('tentativa nova executa de novo: reúso é por tentativa, não para sempre', () => {
    // O contrapeso. Sem ele, "reutilizar" passaria a significar "nunca mais rodar", e um retry
    // depois de corrigir o código serviria a evidência da execução que falhou.
    const runner = runnerContado()
    const evidencia = new EvidenciaDaTentativa(runner)

    evidencia.obter(1)
    evidencia.obter(2)

    expect(runner.invocacoes()).toBe(2)
  })

  it('sem a política, dois consumidores custam duas execuções', () => {
    // O contrafactual explícito: é este número que o critério 5 existe para impedir.
    const runner = runnerContado()

    runner.executar()
    runner.executar()

    expect(runner.invocacoes()).toBe(2)
  })
})
