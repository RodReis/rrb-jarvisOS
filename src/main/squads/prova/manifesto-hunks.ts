/**
 * Manifesto de hunks da M11-F00: prova que o integrador não perdeu código em silêncio.
 *
 * O manifesto lista cada hunk que os dois escritores produziram. Depois da integração, cada um
 * cai em exatamente um de três baldes: **preservado** (o efeito dele está no resultado),
 * **descartado com motivo** (o integrador registrou por que) ou **perdido sem registro** — e este
 * último reprova o integrador, qualquer que seja o resto (SPEC-Squads-00, regra 3).
 *
 * A identidade do hunk é o **conteúdo das linhas alteradas**, não a posição: o número da linha
 * muda quando o outro escritor insere acima, e uma identidade posicional diria "perdido" para
 * código que só se moveu.
 */

import { createHash } from 'node:crypto'

export interface Hunk {
  readonly id: string
  readonly arquivo: string
  readonly adicionadas: readonly string[]
  readonly removidas: readonly string[]
}

export interface Descarte {
  readonly hunk: string
  readonly motivo: string
}

export interface AuditoriaDeIntegracao {
  readonly preservados: readonly Hunk[]
  readonly descartadosComMotivo: readonly (Hunk & { readonly motivo: string })[]
  readonly perdidosSemRegistro: readonly Hunk[]
}

/** `}` e linha em branco aparecem em qualquer arquivo; sua presença não prova hunk nenhum. */
const ehTrivial = (linha: string): boolean => linha.trim().replace(/[\s{}()[\];,]/g, '') === ''

const idDoHunk = (arquivo: string, adicionadas: readonly string[], removidas: readonly string[]) =>
  createHash('sha256')
    .update(JSON.stringify([arquivo, removidas, adicionadas]))
    .digest('hex')
    .slice(0, 12)

/** Lê um diff unificado (`git diff`) e devolve os hunks com conteúdo alterado. */
export function extrairHunks(diff: string): readonly Hunk[] {
  const hunks: Hunk[] = []
  let arquivo: string | undefined
  let adicionadas: string[] = []
  let removidas: string[] = []

  const fecha = (): void => {
    if (arquivo !== undefined && (adicionadas.length > 0 || removidas.length > 0)) {
      hunks.push({ id: idDoHunk(arquivo, adicionadas, removidas), arquivo, adicionadas, removidas })
    }
    adicionadas = []
    removidas = []
  }

  for (const linha of diff.split(/\r?\n/)) {
    if (linha.startsWith('diff --git ')) {
      fecha()
      arquivo = linha.slice(linha.lastIndexOf(' b/') + 3)
    } else if (linha.startsWith('@@')) {
      fecha()
    } else if (linha.startsWith('+++') || linha.startsWith('---')) {
      continue
    } else if (linha.startsWith('+')) {
      adicionadas.push(linha.slice(1))
    } else if (linha.startsWith('-')) {
      removidas.push(linha.slice(1))
    }
  }
  fecha()
  return hunks
}

function preservado(hunk: Hunk, final: string | undefined): boolean {
  const linhas = new Set((final ?? '').split(/\r?\n/).map((l) => l.trimEnd()))
  const adicionadasOk = hunk.adicionadas
    .filter((l) => !ehTrivial(l))
    .every((l) => linhas.has(l.trimEnd()))
  const removidasOk = hunk.removidas
    .filter((l) => !ehTrivial(l))
    .every((l) => !linhas.has(l.trimEnd()))
  return adicionadasOk && removidasOk
}

/**
 * Classifica cada hunk do manifesto contra o conteúdo final dos arquivos.
 *
 * `lerFinal` devolve o arquivo como ficou após a integração (`undefined` se não existe). O
 * registro do integrador só **explica** um hunk que não está no resultado — não o preserva: um
 * hunk que está no resultado conta como preservado, tenha ou não entrada no registro.
 */
export function auditarIntegracao(
  manifesto: readonly Hunk[],
  lerFinal: (arquivo: string) => string | undefined,
  registro: readonly Descarte[]
): AuditoriaDeIntegracao {
  const motivoPorHunk = new Map(registro.map((d) => [d.hunk, d.motivo]))
  const preservados: Hunk[] = []
  const descartadosComMotivo: (Hunk & { motivo: string })[] = []
  const perdidosSemRegistro: Hunk[] = []

  for (const hunk of manifesto) {
    if (preservado(hunk, lerFinal(hunk.arquivo))) {
      preservados.push(hunk)
      continue
    }
    const motivo = motivoPorHunk.get(hunk.id)
    if (motivo !== undefined && motivo.trim() !== '') descartadosComMotivo.push({ ...hunk, motivo })
    else perdidosSemRegistro.push(hunk)
  }
  return { preservados, descartadosComMotivo, perdidosSemRegistro }
}
