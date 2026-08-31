/**
 * A fila de execução: qual fatia pode rodar agora (SPEC-Entrega-02, critério 1).
 *
 * A pergunta que este arquivo responde: **desta fatia, todas as dependências já terminaram?**
 *
 * **De onde vem a dependência de uma fatia** (decisão do PI, 2026-08-30). `Slice` não tem
 * `dependeDe` e a tabela `slice` não tem coluna de dependência — a M8-F06 gera o roadmap sem
 * dependência entre fatias. Em vez de criar uma coluna que nasceria sempre vazia, a dependência
 * é **implícita** e tem duas partes:
 *
 *  1. **dentro do MVP**: toda fatia de `numero` menor precisa estar concluída — as fatias de um
 *     MVP são uma sequência, e é assim que este próprio repositório as executa (M9-F01 → F02);
 *  2. **entre MVPs**: todo MVP de que o MVP da fatia depende precisa estar `concluido` — e esse
 *     DAG já existe, validado por `validarDag` (M8-F06).
 *
 * A alternativa descartada era `slice.depende_de`: mais expressiva, mas nada a preencheria hoje,
 * e uma coluna vazia teria dado a impressão de que a dependência estava modelada quando não
 * estava.
 *
 * **O que este arquivo não faz:** não consulta banco, não sabe de aprovação (isso é do
 * serviço, que compara hashes), não decide quem pega o slot de WIP.
 */

import { validarDag, type Mvp, type Slice } from './roadmap'

/** O estado de um run já conhecido, para responder "esta fatia terminou?". */
export interface FatiaConcluida {
  readonly sliceId: string
}

/**
 * Uma dependência que ainda não terminou, com o motivo legível.
 *
 * O `sliceId`/`mvpId` é obrigatório pela mesma razão do `ProblemaEncontrado` do roadmap:
 * *"há dependência aberta"* não é acionável — o PI precisa saber **qual** para agir.
 */
export interface DependenciaAberta {
  readonly tipo: 'fatia-anterior' | 'mvp-dependente'
  /** O id do que falta: a fatia anterior ou o MVP não concluído. */
  readonly id: string
  readonly mensagem: string
}

/**
 * As dependências ainda abertas de uma fatia. Vazio significa desbloqueada.
 *
 * Devolve **todas**, não a primeira: destravar uma de cada vez faria o PI descobrir a segunda
 * só na tentativa seguinte — mesma postura de `validarDag`.
 *
 * **DAG inválido bloqueia tudo.** Com ciclo ou dependência ausente entre MVPs não existe ordem
 * de execução, e responder "desbloqueada" com base numa ordem que não existe seria autorizar
 * trabalho sobre um roadmap quebrado (critério 1).
 */
export function dependenciasAbertas(
  slice: Slice,
  mvps: readonly Mvp[],
  slices: readonly Slice[],
  concluidas: readonly FatiaConcluida[]
): readonly DependenciaAberta[] {
  const problemas = validarDag(mvps)
  if (problemas.length > 0) {
    return problemas.map((p) => ({
      tipo: 'mvp-dependente' as const,
      id: p.envolvidos[0] ?? '',
      mensagem: `O roadmap não tem ordem válida: ${p.mensagem}`
    }))
  }

  const feitas = new Set(concluidas.map((c) => c.sliceId))
  const abertas: DependenciaAberta[] = []

  // 1. As fatias anteriores do mesmo MVP, por `numero`.
  const anteriores = slices
    .filter((s) => s.mvpId === slice.mvpId && s.numero < slice.numero)
    .sort((a, b) => a.numero - b.numero)

  for (const anterior of anteriores) {
    if (!feitas.has(anterior.id)) {
      abertas.push({
        tipo: 'fatia-anterior',
        id: anterior.id,
        mensagem: `A fatia ${anterior.numero} ("${anterior.titulo}") ainda não foi concluída.`
      })
    }
  }

  // 2. Os MVPs de que o MVP desta fatia depende.
  const porId = new Map(mvps.map((m) => [m.id, m]))
  const meuMvp = porId.get(slice.mvpId)

  for (const depId of meuMvp?.dependeDe ?? []) {
    const dep = porId.get(depId)
    // Dependência ausente já foi reportada por `validarDag` acima; aqui o DAG é válido.
    if (dep !== undefined && dep.estado !== 'concluido') {
      abertas.push({
        tipo: 'mvp-dependente',
        id: dep.id,
        mensagem: `O MVP ${dep.numero} ("${dep.titulo}") ainda não foi concluído.`
      })
    }
  }

  return abertas
}

/** Atalho legível: a fatia está desbloqueada? Invariante 5 da CONVENTION §4. */
export function fatiaDesbloqueada(
  slice: Slice,
  mvps: readonly Mvp[],
  slices: readonly Slice[],
  concluidas: readonly FatiaConcluida[]
): boolean {
  return dependenciasAbertas(slice, mvps, slices, concluidas).length === 0
}
