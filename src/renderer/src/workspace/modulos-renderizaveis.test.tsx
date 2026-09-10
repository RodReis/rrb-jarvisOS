import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MODULOS_RENDERIZAVEIS } from './modulos-renderizaveis'

describe('registro renderizável dos módulos (SPEC-Voz-05, critério 11)', () => {
  it('todo item visível registra a própria tela', () => {
    expect(MODULOS_RENDERIZAVEIS.every((modulo) => modulo.renderizar !== undefined)).toBe(true)
  })

  /*
   * **A guarda do critério 11**, e não a afirmação de que o registro está preenchido.
   *
   * O teste acima passa com o defeito presente: ele mede o registro, e o item literal mora no
   * AppShell. Foi assim que `rotaAtiva === 'settings' || rotaAtiva === 'voz'` conviveu com um
   * teste verde — a tela vinha do caso especial, e o registro seguia completo ao lado.
   *
   * O que o critério proíbe é o AppShell **decidir conteúdo pela rota escrita à mão**: é isso que
   * faz a fatia seguinte precisar editá-lo para acender a própria tela, que é justamente o que a
   * SPEC-Shell-01 tirou do caminho. Ler o fonte é o único jeito de prender a ausência de uma
   * linha; nenhuma renderização distingue "veio do registro" de "veio de um `||` que casou".
   *
   * Contrafactual: reintroduzir qualquer `rotaAtiva === '<rota>'` no AppShell reprova aqui.
   * Comparar rota com rota (`modulo.rota === rotaAtiva`) continua livre — é o que a projeção faz.
   */
  it('o AppShell não escolhe conteúdo comparando a rota com um literal', () => {
    const appShell = readFileSync(
      fileURLToPath(new URL('../app/AppShell.tsx', import.meta.url)),
      'utf8'
    )

    const decisoesPorRotaLiteral = appShell.match(/rotaAtiva\s*[!=]==\s*['"`]/g) ?? []

    expect(decisoesPorRotaLiteral).toEqual([])
  })
})
