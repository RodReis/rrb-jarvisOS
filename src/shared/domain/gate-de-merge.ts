/**
 * O gate que decide se o PR pode ser mergeado (SPEC-Entrega-05, critérios 2, 3, 4, 10, 11 e 12).
 *
 * A pergunta que ele responde: **a origem, agora, autoriza este merge?**
 *
 * Função pura sobre dado já normalizado — é o que permite provar as regras sem rede. Quem consulta
 * a origem é o `EntregaService`; aqui só se decide, e a decisão nunca é "verde por omissão".
 *
 * ## A ordem das checagens é deliberada
 *
 * 1. **Stale primeiro.** Head divergente invalida toda avaliação seguinte: os checks pertencem a
 *    outro commit, e avaliá-los daria "pode-mergear" para código que ninguém verificou.
 * 2. **P0/P1 antes do resto.** Bloqueio de revisão não depende de estado externo, e falhar cedo
 *    poupa a consulta que já não muda o desfecho.
 * 3. **Merge queue antes dos obrigatórios.** A pipeline não a contorna nem com os checks verdes.
 * 4. **Ausência de regra antes dos checks.** Sem check obrigatório na origem não há o que
 *    satisfazer, e a causa do bloqueio é outra: configurar, não investigar.
 */

import {
  checksAprovam,
  recusaDaEvidencia,
  type CheckNormalizado,
  type ExigenciaDeIdentidade
} from './github-automation'
import type { SnapshotDeRuleset } from './ruleset'

/** A severidade de um achado de revisão, na baseline do `REVIEW.md`. */
export type SeveridadeDeAchado = 'P0' | 'P1' | 'P2' | 'P3'

export interface EntradaDoGate {
  /** O commit que a pipeline verificou e pretende mergear. */
  readonly headShaEsperado: string
  /** O commit que o PR tem **na origem** agora. */
  readonly headShaNaOrigem: string
  readonly checks: readonly CheckNormalizado[]
  /** O conjunto obrigatório observado na origem (critério 11). */
  readonly snapshot: SnapshotDeRuleset
  /** Os achados de revisão ainda abertos. P0/P1 bloqueiam; P2/P3 registram. */
  readonly achadosAbertos: readonly { readonly severidade: SeveridadeDeAchado }[]
  /**
   * A identidade que a origem exige dos checks obrigatórios (SPEC-Pipeline-01, critério 11).
   *
   * Opcional: projeto que não declara emissor nem tentativa continua avaliado exatamente como
   * antes. A §2 proíbe endurecer proteção por iniciativa própria, e exigir identidade de quem
   * nunca a pediu seria endurecer.
   */
  readonly exigenciaDeIdentidade?: ExigenciaDeIdentidade
}

export type VeredictoDoGate =
  | { readonly reason: 'pode-mergear' }
  | { readonly reason: 'aguardando'; readonly pendentes: number; readonly mensagem: string }
  | { readonly reason: 'stale'; readonly mensagem: string }
  | { readonly reason: 'bloqueado-externo'; readonly acao: string; readonly mensagem: string }

export function avaliarGateDeMerge(entrada: EntradaDoGate): VeredictoDoGate {
  if (entrada.headShaNaOrigem !== entrada.headShaEsperado) {
    return {
      reason: 'stale',
      mensagem:
        `O head do pull request na origem é ${entrada.headShaNaOrigem}, e não o verificado ` +
        `(${entrada.headShaEsperado}). Reconciliar antes de mergear.`
    }
  }

  const bloqueantes = entrada.achadosAbertos.filter(
    (a) => a.severidade === 'P0' || a.severidade === 'P1'
  )
  if (bloqueantes.length > 0) {
    return {
      reason: 'bloqueado-externo',
      acao: 'Corrigir os achados P0/P1 e revalidar no mesmo pull request.',
      mensagem: `${bloqueantes.length} achado(s) P0/P1 em aberto impedem o merge.`
    }
  }

  if (entrada.snapshot.mergeQueueExigida) {
    return {
      reason: 'bloqueado-externo',
      acao: 'Mergear pela merge queue da origem; a pipeline não a contorna.',
      mensagem: `A branch ${entrada.snapshot.branch} exige merge queue, fora do escopo do MVP-009.`
    }
  }

  if (!entrada.snapshot.protegida || entrada.snapshot.contexts.length === 0) {
    return {
      reason: 'bloqueado-externo',
      acao: 'Configurar/liberar Actions e exigir os checks na proteção da branch-base.',
      mensagem:
        `A branch ${entrada.snapshot.branch} não exige check nenhum na origem. ` +
        'Ausência de regra não aprova: não há verde por omissão.'
    }
  }

  const doHead = entrada.checks.filter((c) => c.headSha === entrada.headShaEsperado)

  // Só `success` satisfaz um check **obrigatório**. `checksAprovam` trata `skipped` como não-falho,
  // o que continua certo para check opcional — mas um obrigatório que decidiu não rodar (`skipped`)
  // ou que terminou sem veredito (`neutral`) não verificou nada, e a regra da origem exige que ele
  // conclua com sucesso (critério 11).
  // `recusaDaEvidencia` acrescenta às três checagens de sempre (head, concluído, sucesso) as duas
  // do critério 11 da SPEC-Pipeline-01: emissor e tentativa. Sem exigência declarada ela decide
  // igual ao que decidia antes — o nome do check nunca foi identidade, e agora isso é verificável.
  const satisfeitos = new Set(
    doHead
      .filter(
        (c) =>
          recusaDaEvidencia(c, entrada.headShaEsperado, entrada.exigenciaDeIdentidade) === undefined
      )
      .map((c) => c.nome)
  )
  const faltando = entrada.snapshot.contexts.filter((nome) => !satisfeitos.has(nome))

  if (faltando.length > 0) {
    // Só é espera se **todos** os que faltam ainda podem terminar bem. Um obrigatório que já
    // falhou torna o desfecho conhecido, e esperar seria esperar por algo que não vem.
    const naoResolvidos = doHead.filter((c) => faltando.includes(c.nome))
    const emAndamento = naoResolvidos.filter((c) => c.status !== 'completed')
    const decididos = naoResolvidos.filter((c) => c.status === 'completed')

    if (emAndamento.length > 0 && decididos.length === 0) {
      return {
        reason: 'aguardando',
        pendentes: emAndamento.length,
        mensagem: `${emAndamento.length} check(s) obrigatório(s) ainda correndo no head verificado.`
      }
    }

    // A causa precisa nomear o que **de fato** recusou cada check. Um check verde recusado por
    // emissor não confiável ou por tentativa antiga sob a mensagem "não concluiu com sucesso"
    // manda o leitor investigar o log de um job que passou — o erro verdadeiro que esconde a
    // causa. Aqui a recusa é reportada com o nome dela.
    const porCausa = naoResolvidos.map((c) => ({
      nome: c.nome,
      recusa: recusaDaEvidencia(c, entrada.headShaEsperado, entrada.exigenciaDeIdentidade)
    }))
    const identidade = porCausa.filter(
      (p) => p.recusa === 'emissor-nao-confiavel' || p.recusa === 'tentativa-antiga'
    )

    if (identidade.length > 0) {
      return {
        reason: 'bloqueado-externo',
        acao:
          'Conferir o emissor e a tentativa dos checks obrigatórios: eles existem e estão ' +
          'verdes, mas não são a evidência que a origem exige.',
        mensagem:
          'Checks obrigatórios recusados por identidade no head verificado: ' +
          identidade.map((p) => `${p.nome} (${p.recusa})`).join(', ') +
          '.'
      }
    }

    return {
      reason: 'bloqueado-externo',
      acao: 'Investigar os checks obrigatórios que não concluíram com sucesso.',
      mensagem: `Checks obrigatórios sem sucesso no head verificado: ${faltando.join(', ')}.`
    }
  }

  // Os obrigatórios passaram, mas o head pode ter check não exigido ainda correndo. Mergear com
  // ele no ar descartaria um sinal que o repositório escolheu produzir.
  const agregado = checksAprovam(entrada.checks, entrada.headShaEsperado)
  if (agregado.pendentes > 0) {
    return {
      reason: 'aguardando',
      pendentes: agregado.pendentes,
      mensagem: `${agregado.pendentes} check(s) ainda correndo no head verificado.`
    }
  }

  return { reason: 'pode-mergear' }
}
