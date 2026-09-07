/**
 * O manifesto que decide se a evidência de um run pode gerar PASS (SPEC-Pipeline-01 §8).
 *
 * A pergunta que este arquivo responde: **os artefatos que chegaram são os que deviam chegar, e
 * vieram todos da mesma execução?**
 *
 * O `ExecutionLedger` já registra artefatos com hash, e `ledgerCompleto` já recusa hash vazio.
 * Mas ele responde "o que chegou está bem-formado?", nunca "chegou tudo?". São perguntas
 * diferentes, e a segunda é a que a §8 exige: *"artefato ausente … não pode gerar PASS"* e
 * *"worker encerrado sem relatório completo invalida a prova mesmo que o processo principal
 * retorne zero"*.
 *
 * É o mesmo desenho da Prova 0 do relatório de testes deste repositório (issue #232): sem uma
 * lista do que era **esperado**, a evidência incompleta concorda consigo mesma — as verificações
 * auditam o conteúdo do que chegou, e nada audita o que não chegou.
 *
 * ## O que separa este manifesto do `ci-workflow-adocao.ts`
 *
 * Aquele registra o que a pipeline **escreveu** no projeto-alvo, para decidir se pode reescrever.
 * Este registra o que a execução **deve produzir**, para decidir se a prova vale. Nomes parecidos,
 * perguntas opostas; fundi-los faria um objeto responder a duas coisas sem relação.
 *
 * **Função pura sobre hash já calculado.** `src/shared` compila para o renderer, onde `node:crypto`
 * não existe — quem calcula é o main, como no resto do domínio.
 */

import type { ArtefatoReferenciado } from './execution-ledger'

/** Um artefato que a execução se comprometeu a produzir. */
export interface ArtefatoEsperado {
  readonly nome: string
  /**
   * A categoria de validação que o produz.
   *
   * Semântica, não ferramenta: `regras`, `banco`, `tela` no jarvisOS; outro projeto declara as
   * suas. A §8 proíbe impor `reports/TESTS.md`, Vitest ou Electron a quem não os declara.
   */
  readonly categoria: string
  /**
   * Obrigatório por padrão.
   *
   * Opcional existe para o artefato que só nasce em certas condições — cobertura de um job que
   * não roda em todo PR, por exemplo. Ausência dele não invalida a prova; ausência de um
   * obrigatório invalida.
   */
  readonly obrigatorio?: boolean
}

/**
 * A identidade da execução que produziu a evidência.
 *
 * Todo artefato precisa carregá-la, e é isto que responde *"de outro run/head/perfil"* da §8.
 * Sem ela, dois artefatos de execuções diferentes somam-se num relatório que descreve uma
 * execução que nunca existiu.
 */
export interface IdentidadeDaExecucao {
  readonly runId: string
  /** O commit efetivamente testado. Distinto do head do PR quando o provedor sintetiza um merge. */
  readonly testedSha: string
  /** A revisão do perfil de CI vigente. Perfil diferente é outra definição de validação. */
  readonly revisaoDoPerfil: string
  /** A tentativa do CI. Artefato da tentativa 1 não prova a tentativa 2. */
  readonly tentativa: number
}

/** O manifesto: o que esperar, de qual execução. */
export interface ManifestoDeEvidencia {
  readonly identidade: IdentidadeDaExecucao
  readonly esperados: readonly ArtefatoEsperado[]
}

/** Um artefato que chegou, com a identidade da execução que o produziu. */
export interface ArtefatoRecebido extends ArtefatoReferenciado {
  readonly categoria: string
  readonly identidade: IdentidadeDaExecucao
  /**
   * O job que o produziu terminou bem?
   *
   * A §8 é explícita: artefato *"produzido por job falho não pode gerar PASS"*. Um job que falhou
   * no meio ainda deixa arquivo no disco, e esse arquivo descreve uma execução parcial.
   */
  readonly jobConcluiuBem: boolean
}

/** Por que a evidência não serve. */
export type ProblemaNaEvidencia =
  'artefato-ausente' | 'hash-vazio' | 'job-falho' | 'execucao-diferente' | 'artefato-inesperado'

export interface ProblemaDaEvidencia {
  readonly problema: ProblemaNaEvidencia
  /** O artefato envolvido; vazio quando o problema é a ausência de todos. */
  readonly artefato: string
  readonly mensagem: string
}

/** Duas identidades descrevem a mesma execução? */
function mesmaExecucao(a: IdentidadeDaExecucao, b: IdentidadeDaExecucao): boolean {
  return (
    a.runId === b.runId &&
    a.testedSha === b.testedSha &&
    a.revisaoDoPerfil === b.revisaoDoPerfil &&
    a.tentativa === b.tentativa
  )
}

/**
 * A evidência pode gerar PASS? (SPEC-Pipeline-01 §8)
 *
 * Devolve **todos** os problemas, como `validarPerfilDeCi` e `validarDag` — corrigir um de cada
 * vez faria descobrir o seguinte só na tentativa posterior. Lista vazia é o que autoriza o PASS.
 *
 * A ordem das checagens segue a de `avaliarGateDeMerge`: primeiro o que invalida tudo (nenhum
 * artefato chegou), depois o que invalida cada um.
 */
export function validarEvidencia(
  manifesto: ManifestoDeEvidencia,
  recebidos: readonly ArtefatoRecebido[]
): readonly ProblemaDaEvidencia[] {
  const problemas: ProblemaDaEvidencia[] = []
  const relatar = (problema: ProblemaNaEvidencia, artefato: string, mensagem: string): void => {
    problemas.push({ problema, artefato, mensagem })
  }

  // Só o que veio da execução declarada conta como prova dela. Feito antes de procurar os
  // ausentes: um artefato de outra execução **não** preenche a vaga de um esperado, e tratá-lo
  // como se preenchesse é exatamente a "mistura de execuções" que a §8 recusa.
  const daExecucao: ArtefatoRecebido[] = []
  for (const recebido of recebidos) {
    if (!mesmaExecucao(recebido.identidade, manifesto.identidade)) {
      relatar(
        'execucao-diferente',
        recebido.nome,
        `"${recebido.nome}" veio de outra execução (run ${recebido.identidade.runId}, ` +
          `tentativa ${recebido.identidade.tentativa}, tested ${recebido.identidade.testedSha.slice(0, 12)}), ` +
          `e não da declarada no manifesto (run ${manifesto.identidade.runId}, ` +
          `tentativa ${manifesto.identidade.tentativa}).`
      )
      continue
    }
    daExecucao.push(recebido)
  }

  for (const recebido of daExecucao) {
    if (recebido.hash.trim() === '') {
      relatar(
        'hash-vazio',
        recebido.nome,
        `"${recebido.nome}" chegou sem hash: uma referência sem hash não prova o conteúdo.`
      )
    }
    if (!recebido.jobConcluiuBem) {
      relatar(
        'job-falho',
        recebido.nome,
        `"${recebido.nome}" foi produzido por um job que não concluiu bem, e descreve uma ` +
          'execução parcial.'
      )
    }
    if (!manifesto.esperados.some((e) => e.nome === recebido.nome)) {
      // Não é "sobra inofensiva": um artefato que ninguém esperava pode ser resto de outra
      // execução no mesmo diretório, e somá-lo ao relatório descreveria algo que não aconteceu.
      relatar(
        'artefato-inesperado',
        recebido.nome,
        `"${recebido.nome}" não está no manifesto: a execução não se comprometeu a produzi-lo.`
      )
    }
  }

  const chegaram = new Set(daExecucao.map((r) => r.nome))
  for (const esperado of manifesto.esperados) {
    if (esperado.obrigatorio === false) continue
    if (chegaram.has(esperado.nome)) continue
    relatar(
      'artefato-ausente',
      esperado.nome,
      `"${esperado.nome}" (categoria ${esperado.categoria}) era esperado e não chegou. ` +
        'Processo principal com código zero não prova que o artefato foi escrito.'
    )
  }

  return problemas
}
