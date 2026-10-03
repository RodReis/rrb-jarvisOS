/**
 * O manifesto de hunks na integração (SPEC-Squads-04, critério 1; ADR-006 decisão 6).
 *
 * **Quem audita é o mesmo código que a F00b mediu.** O `prova/manifesto-hunks` é o instrumento que
 * aprovou o integrador da fase (zero hunk perdido, seis casos): a produção o reusa em vez de
 * reescrevê-lo, e o que muda aqui é só o que a produção precisa a mais — ligar o que o integrador
 * *disse* que descartou ao hunk que ele *de fato* deixou de preservar.
 *
 * O registro do integrador **explica** o que falta no resultado; não preserva nada. Um hunk só é
 * explicado se **todas** as linhas que faltam aparecem nos trechos que o integrador descartou, com
 * motivo: citar uma linha de três não justifica as outras duas, e é essa a brecha que o
 * instrumento da primeira medição deixava.
 */

import type { DescarteDoIntegrador } from '@shared/domain/squad-conflito'
import {
  auditarIntegracao,
  extrairHunks,
  type AuditoriaDeIntegracao,
  type Descarte,
  type Hunk
} from './prova/manifesto-hunks'

export type { AuditoriaDeIntegracao, Hunk }

export interface ResumoDaAuditoria {
  readonly total: number
  readonly preservados: number
  readonly descartadosComMotivo: number
  readonly perdidosSemRegistro: number
  readonly naoResolvidos: number
  /** Só `true` sem perda sem registro e sem conflito aberto: faltou prova, o run para (regra 1). */
  readonly aprovada: boolean
}

/** `}` e linha em branco aparecem em qualquer arquivo; não provam nem perdem hunk nenhum. */
const ehTrivial = (linha: string): boolean => linha.trim().replace(/[\s{}()[\];,]/g, '') === ''
const compacto = (texto: string): string => texto.toLowerCase().replace(/\s+/g, '')

/**
 * Os hunks que os escritores produziram, na ordem. O id é o **conteúdo** das linhas alteradas: o
 * mesmo hunk nos dois escritores (os dois adicionaram a mesma importação) é um só.
 */
export function manifestoDosEscritores(diffs: readonly string[]): readonly Hunk[] {
  const vistos = new Set<string>()
  const manifesto: Hunk[] = []
  for (const diff of diffs) {
    for (const hunk of extrairHunks(diff)) {
      if (vistos.has(hunk.id)) continue
      vistos.add(hunk.id)
      manifesto.push(hunk)
    }
  }
  return manifesto
}

/** O que o hunk exige do resultado e o resultado não tem: adicionada ausente, removida presente. */
function violacoesDoHunk(hunk: Hunk, final: string): readonly string[] {
  const linhas = new Set(final.split(/\r?\n/).map((l) => l.trimEnd()))
  const faltam = hunk.adicionadas.filter((l) => !ehTrivial(l) && !linhas.has(l.trimEnd()))
  const sobram = hunk.removidas.filter((l) => !ehTrivial(l) && linhas.has(l.trimEnd()))
  return [...faltam, ...sobram]
}

/** O registro por hunk: só os hunks cujas violações o integrador cobriu, todas, com motivo. */
function registroPorHunk(
  perdidos: readonly Hunk[],
  lerArquivo: (arquivo: string) => string | undefined,
  descartes: readonly DescarteDoIntegrador[]
): readonly Descarte[] {
  const validos = descartes
    .filter((d) => d.motivo.trim() !== '')
    .map((d) => ({ trecho: compacto(d.trecho), motivo: d.motivo }))
  const registro: Descarte[] = []
  for (const hunk of perdidos) {
    const violacoes = violacoesDoHunk(hunk, lerArquivo(hunk.arquivo) ?? '')
    if (violacoes.length === 0) continue
    const cobertores = violacoes.map((v) => validos.find((d) => d.trecho.includes(compacto(v))))
    if (cobertores.some((c) => c === undefined)) continue
    const motivos = [...new Set(cobertores.map((c) => c?.motivo ?? ''))]
    registro.push({ hunk: hunk.id, motivo: motivos.join('; ') })
  }
  return registro
}

export function resumirAuditoria(auditoria: AuditoriaDeIntegracao): ResumoDaAuditoria {
  const preservados = auditoria.preservados.length
  const descartadosComMotivo = auditoria.descartadosComMotivo.length
  const perdidosSemRegistro = auditoria.perdidosSemRegistro.length
  const naoResolvidos = auditoria.naoResolvidos.length
  return {
    total: preservados + descartadosComMotivo + perdidosSemRegistro + naoResolvidos,
    preservados,
    descartadosComMotivo,
    perdidosSemRegistro,
    naoResolvidos,
    aprovada: perdidosSemRegistro === 0 && naoResolvidos === 0
  }
}

/**
 * Audita o resultado integrado contra o manifesto, usando o registro do integrador para explicar
 * (e só explicar) o que ele deixou de preservar. `lerArquivo` devolve o arquivo **como ficou no
 * commit de integração** — nunca o texto que o integrador diz que escreveu.
 */
export function auditarComDescartes(
  manifesto: readonly Hunk[],
  lerArquivo: (arquivo: string) => string | undefined,
  descartes: readonly DescarteDoIntegrador[]
): { readonly auditoria: AuditoriaDeIntegracao; readonly resumo: ResumoDaAuditoria } {
  const semRegistro = auditarIntegracao(manifesto, lerArquivo, [])
  const registro = registroPorHunk(semRegistro.perdidosSemRegistro, lerArquivo, descartes)
  const auditoria = auditarIntegracao(manifesto, lerArquivo, registro)
  return { auditoria, resumo: resumirAuditoria(auditoria) }
}
