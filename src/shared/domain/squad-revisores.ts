/**
 * Quem revisa (SPEC-Squads-04): revisores **distintos dos escritores e do integrador**, e de
 * **executor cruzado quando há um elegível**.
 *
 * "Distinto" é identidade, não modelo: um revisor com o mesmo id de quem escreveu estaria
 * corrigindo a própria lição. "Cruzado" é o provider: o viés de um modelo sobre o código que ele
 * mesmo escreveu não se corrige pedindo ao mesmo modelo que olhe de novo.
 */

import type { ModeloEscolhido } from './modelo-da-fase'

export interface RevisorCandidato {
  readonly id: string
  readonly modelo: ModeloEscolhido
  /** Obrigatório com modelo local: a janela de contexto que o Ollama recebe. */
  readonly numCtx?: number
}

/** Um escritor ou o integrador: quem fez o trabalho que será revisado. */
export interface ParticipanteDoTrabalho {
  readonly id: string
  readonly modelo: ModeloEscolhido
}

export type EscolhaDeRevisores =
  | {
      readonly ok: true
      readonly revisores: readonly RevisorCandidato[]
      /** `true` quando algum revisor escolhido é de um provider que ninguém do trabalho usou. */
      readonly cruzado: boolean
    }
  | { readonly ok: false; readonly motivo: 'sem-revisor-elegivel' }

export const MAX_REVISORES_PADRAO = 2

export function escolherRevisores(
  candidatos: readonly RevisorCandidato[],
  participantes: readonly ParticipanteDoTrabalho[],
  max: number = MAX_REVISORES_PADRAO
): EscolhaDeRevisores {
  const ids = new Set(participantes.map((p) => p.id))
  const providers = new Set(participantes.map((p) => p.modelo.provider))
  const vistos = new Set<string>()
  const elegiveis = candidatos.filter((c) => {
    if (ids.has(c.id) || vistos.has(c.id)) return false
    vistos.add(c.id)
    return true
  })
  if (elegiveis.length === 0 || max < 1) return { ok: false, motivo: 'sem-revisor-elegivel' }

  const cruza = (c: RevisorCandidato): boolean => !providers.has(c.modelo.provider)
  // `sort` é estável: dentro de cada grupo vale a ordem dos candidatos.
  const ordenados = [...elegiveis].sort((a, b) => Number(cruza(b)) - Number(cruza(a)))
  const revisores = ordenados.slice(0, max)
  return { ok: true, revisores, cruzado: revisores.some(cruza) }
}
