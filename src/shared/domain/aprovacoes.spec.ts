/**
 * Gates, hashes e a matriz de invalidação (SPEC-Planejamento-06, § Testes).
 *
 * A spec pede nominalmente *"unitários de DAG, hash e matriz de invalidação; teste de revisão
 * cosmética/material"*. Os três critérios que estes testes protegem são todos sobre o que
 * **não** acontece:
 *
 *  - **Critério 5:** a mesma revisão não pede novo aceite — a comparação é do conjunto de
 *    hashes, não do instante.
 *  - **Invariante 4:** correção textual/STATUS/evidência/ADR **não** invalida; mudança
 *    semântica invalida só os dependentes.
 *  - **Critério 7:** nenhum gate é aprovado por delegação — e isso é garantido pelo tipo, não
 *    por uma checagem que alguém pode esquecer.
 */

import { describe, expect, it } from 'vitest'
import type { Approval, MudancaDeArtefato, RevisaoAprovada } from './aprovacoes'
import { DESCRICAO_DO_GATE, GATES, aprovacaoVigente, gatesInvalidados, isGate } from './aprovacoes'

function revisao(artefato: string, hash: string): RevisaoAprovada {
  return { artefato, hash }
}

function aprovacao(
  gate: Approval['gate'],
  revisoes: readonly RevisaoAprovada[],
  created_at = '2026-08-30T10:00:00.000Z'
): Approval {
  return {
    id: `ap-${gate}-${created_at}`,
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    gate,
    revisoes,
    identidade: 'pi@exemplo',
    autor: 'pi',
    created_at
  }
}

const PRD = revisao('docs/PRD.md', 'a'.repeat(64))
const ARQ = revisao('docs/ARCHITECTURE.md', 'b'.repeat(64))

describe('aprovacaoVigente — critério 5', () => {
  it('reconhece a mesma revisão e não pede novo aceite', () => {
    const ap = aprovacao('PROJECT_PACKAGE', [PRD, ARQ])

    expect(aprovacaoVigente([ap], 'PROJECT_PACKAGE', [PRD, ARQ])).toBe(ap)
  })

  /**
   * A ordem em que os artefatos foram registrados não é fato sobre a revisão. Comparar listas
   * ordenadas faria um pacote idêntico parecer novo.
   */
  it('é indiferente à ordem dos artefatos', () => {
    const ap = aprovacao('PROJECT_PACKAGE', [PRD, ARQ])

    expect(aprovacaoVigente([ap], 'PROJECT_PACKAGE', [ARQ, PRD])).toBe(ap)
  })

  it('não reconhece quando um hash mudou', () => {
    const ap = aprovacao('PROJECT_PACKAGE', [PRD, ARQ])
    const outro = revisao('docs/ARCHITECTURE.md', 'c'.repeat(64))

    expect(aprovacaoVigente([ap], 'PROJECT_PACKAGE', [PRD, outro])).toBeUndefined()
  })

  /** Aprovar quatro documentos não aprova o quinto que apareceu depois. */
  it('não reconhece quando um artefato foi acrescentado', () => {
    const ap = aprovacao('PROJECT_PACKAGE', [PRD])

    expect(aprovacaoVigente([ap], 'PROJECT_PACKAGE', [PRD, ARQ])).toBeUndefined()
  })

  /** O pacote deixou de conter o que o PI leu. */
  it('não reconhece quando um artefato sumiu', () => {
    const ap = aprovacao('PROJECT_PACKAGE', [PRD, ARQ])

    expect(aprovacaoVigente([ap], 'PROJECT_PACKAGE', [PRD])).toBeUndefined()
  })

  it('não confunde gates: a aprovação de um não vale para o outro', () => {
    const ap = aprovacao('MVP_ENTRY', [PRD])

    expect(aprovacaoVigente([ap], 'PROJECT_PACKAGE', [PRD])).toBeUndefined()
    expect(aprovacaoVigente([ap], 'MVP_ENTRY', [PRD])).toBe(ap)
  })

  it('devolve a mais recente quando o mesmo conteúdo foi aprovado duas vezes', () => {
    const antiga = aprovacao('PROJECT_PACKAGE', [PRD], '2026-08-29T10:00:00.000Z')
    const nova = aprovacao('PROJECT_PACKAGE', [PRD], '2026-08-30T10:00:00.000Z')

    expect(aprovacaoVigente([antiga, nova], 'PROJECT_PACKAGE', [PRD])).toBe(nova)
  })

  it('sem aprovação nenhuma, devolve undefined', () => {
    expect(aprovacaoVigente([], 'PROJECT_PACKAGE', [PRD])).toBeUndefined()
  })
})

describe('gatesInvalidados — a matriz de invalidação (invariante 4)', () => {
  const doPacote = aprovacao('PROJECT_PACKAGE', [PRD, ARQ])
  const doMvp = aprovacao('MVP_ENTRY', [revisao('mvp-1', 'd'.repeat(64))])

  function mudanca(
    artefato: string,
    natureza: MudancaDeArtefato['natureza'],
    hashNovo = 'z'.repeat(64)
  ): MudancaDeArtefato {
    return { artefato, hashNovo, natureza }
  }

  /**
   * A linha que define a invariante 4. Se corrigir um typo derrubasse o gate, o PI reaprovaria
   * por ruído — até parar de ler o que aprova.
   */
  it('mudança cosmética não invalida nada', () => {
    expect(gatesInvalidados([doPacote, doMvp], [mudanca('docs/PRD.md', 'cosmetica')])).toEqual([])
  })

  it('mudança semântica invalida o gate que depende do artefato', () => {
    expect(gatesInvalidados([doPacote, doMvp], [mudanca('docs/PRD.md', 'semantica')])).toEqual([
      'PROJECT_PACKAGE'
    ])
  })

  /** "Somente dependentes" é literal: o gate que não cita o artefato continua de pé. */
  it('não invalida o gate que não depende do artefato mudado', () => {
    const invalidados = gatesInvalidados([doPacote, doMvp], [mudanca('docs/PRD.md', 'semantica')])

    expect(invalidados).not.toContain('MVP_ENTRY')
  })

  it('mudança em artefato que ninguém aprovou não invalida nada', () => {
    expect(gatesInvalidados([doPacote], [mudanca('docs/OUTRO.md', 'semantica')])).toEqual([])
  })

  /**
   * Reescrever um arquivo com o mesmo conteúdo não é mudança — o critério 5 vale aqui também.
   */
  it('não invalida quando o hash novo é igual ao aprovado', () => {
    const invalidados = gatesInvalidados(
      [doPacote],
      [mudanca('docs/PRD.md', 'semantica', PRD.hash)]
    )

    expect(invalidados).toEqual([])
  })

  it('mistura de cosmética e semântica invalida só pela semântica', () => {
    const invalidados = gatesInvalidados(
      [doPacote, doMvp],
      [mudanca('docs/PRD.md', 'cosmetica'), mudanca('mvp-1', 'semantica')]
    )

    expect(invalidados).toEqual(['MVP_ENTRY'])
  })

  it('duas mudanças semânticas invalidam os dois gates', () => {
    const invalidados = gatesInvalidados(
      [doPacote, doMvp],
      [mudanca('docs/PRD.md', 'semantica'), mudanca('mvp-1', 'semantica')]
    )

    expect(invalidados).toEqual(['PROJECT_PACKAGE', 'MVP_ENTRY'])
  })

  it('sem mudança nenhuma, nada invalida', () => {
    expect(gatesInvalidados([doPacote, doMvp], [])).toEqual([])
  })
})

describe('contratos fechados', () => {
  it('todo gate tem descrição', () => {
    for (const gate of GATES) {
      expect(DESCRICAO_DO_GATE[gate]).toBeTruthy()
    }
  })

  it('isGate recusa o que não está no enum', () => {
    expect(isGate('PROJECT_PACKAGE')).toBe(true)
    expect(isGate('QUALQUER_GATE')).toBe(false)
    expect(isGate(null)).toBe(false)
  })

  /**
   * O critério 7 é garantido **pelo tipo**: `Approval.autor` é o literal `'pi'`, e não uma união
   * com `'agente'`. Um campo que aceitasse os dois exigiria que todo call site lembrasse de
   * checar; o tipo que só admite um não tem como esquecer.
   *
   * Este teste é a documentação executável disso — se alguém ampliar o tipo, o `@ts-expect-error`
   * deixa de ser erro e o teste falha, trazendo a discussão de volta.
   */
  it('Approval.autor não aceita delegação (critério 7)', () => {
    // @ts-expect-error — 'agente' não é um autor de aprovação válido.
    const invalido: Approval['autor'] = 'agente'
    expect(invalido).toBe('agente')
  })
})
