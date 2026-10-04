/**
 * O manifesto de hunks na integração (SPEC-Squads-04, critério 1; ADR-006 decisão 6).
 *
 * O manifesto lista cada hunk que os escritores produziram. Depois da integração, cada um cai em
 * exatamente um de três baldes: **preservado** (o efeito dele está no resultado), **descartado com
 * motivo** (o integrador o registrou) ou **perdido sem registro** — e este último reprova a
 * integração, qualquer que seja o resto (regra 1: faltou prova, o run para).
 *
 * ## Por que não é o instrumento da F00b
 *
 * O `prova/manifesto-hunks` mediu "a linha está no arquivo final", e isso basta para medir. Em
 * produção dá dois erros, os dois achados pela revisão: reprova um merge **limpo** quando a linha
 * removida existe também noutro ponto do arquivo (`return false` duas vezes), e aprova um hunk que
 * o integrador apagou quando a linha adicionada já existia em outro lugar. Aqui a conferência é
 * contra o **diff da base ao resultado** (`git diff -M -U0`), por arquivo, **contando ocorrências**:
 * cada linha que um hunk adiciona ou remove precisa existir, ainda não gasta, no diff do resultado.
 * Rename é seguido pelo caminho da base.
 *
 * O registro do integrador **explica** o que falta no resultado; não preserva nada. Um hunk só é
 * explicado se **todas** as linhas que faltam aparecem nos trechos descartados **daquele arquivo**,
 * com motivo: citar uma linha de três não justifica as outras duas, e um descarte feito num arquivo
 * não explica um hunk de outro.
 */

import type { DescarteDoIntegrador } from '@shared/domain/squad-conflito'
import { lerDiff, type HunkDoDiff } from './squad-diff'

export type { HunkDoDiff }

export interface DescarteDoArquivo extends DescarteDoIntegrador {
  /** O arquivo em conflito em que o integrador registrou o descarte. */
  readonly arquivo: string
}

export type HunkDescartado = HunkDoDiff & { readonly motivo: string }

export interface AuditoriaDeIntegracao {
  readonly preservados: readonly HunkDoDiff[]
  readonly descartadosComMotivo: readonly HunkDescartado[]
  readonly perdidosSemRegistro: readonly HunkDoDiff[]
  /** Os arquivos em que o resultado ficou com marcador de conflito que nenhum escritor escreveu. */
  readonly naoResolvidos: readonly string[]
}

export interface ResumoDaAuditoria {
  readonly total: number
  readonly preservados: number
  readonly descartadosComMotivo: number
  readonly perdidosSemRegistro: number
  readonly naoResolvidos: number
  /** Só `true` sem perda sem registro e sem conflito aberto: faltou prova, o run para. */
  readonly aprovada: boolean
}

/** `}` e linha em branco aparecem em qualquer arquivo; não provam nem perdem hunk nenhum. */
const ehTrivial = (linha: string): boolean => linha.trim().replace(/[\s{}()[\];,]/g, '') === ''
const compacto = (texto: string): string => texto.toLowerCase().replace(/\s+/g, '')
const ehMarcador = (linha: string): boolean => /^(<<<<<<<|\|\|\|\|\|\|\||>>>>>>>)/.test(linha)

/**
 * Os hunks que os escritores produziram, na ordem. O id é o **conteúdo** das linhas alteradas: o
 * mesmo hunk nos dois escritores (os dois adicionaram a mesma importação) é um só.
 */
export function manifestoDosEscritores(diffs: readonly string[]): readonly HunkDoDiff[] {
  const vistos = new Set<string>()
  const manifesto: HunkDoDiff[] = []
  for (const diff of diffs) {
    for (const arquivo of lerDiff(diff)) {
      for (const hunk of arquivo.hunks) {
        if (vistos.has(hunk.id)) continue
        vistos.add(hunk.id)
        manifesto.push(hunk)
      }
    }
  }
  return manifesto
}

type Contagem = Map<string, number>

const contar = (linhas: readonly string[], contagem: Contagem = new Map()): Contagem => {
  for (const l of linhas)
    if (!ehTrivial(l)) contagem.set(l.trimEnd(), (contagem.get(l.trimEnd()) ?? 0) + 1)
  return contagem
}

interface Reservas {
  readonly adicionadas: Contagem
  readonly removidas: Contagem
}

/** As linhas que o hunk exige e o resultado não tem (ainda não gastas por outro hunk). */
function faltas(hunk: HunkDoDiff, reserva: Reservas): readonly string[] {
  const falta = (necessarias: Contagem, disponiveis: Contagem): string[] =>
    [...necessarias].flatMap(([linha, n]) => (n > (disponiveis.get(linha) ?? 0) ? [linha] : []))
  return [
    ...falta(contar(hunk.adicionadas), reserva.adicionadas),
    ...falta(contar(hunk.removidas), reserva.removidas)
  ]
}

function gastar(hunk: HunkDoDiff, reserva: Reservas): void {
  const tira = (linhas: readonly string[], contagem: Contagem): void => {
    for (const [linha, n] of contar(linhas)) contagem.set(linha, (contagem.get(linha) ?? 0) - n)
  }
  tira(hunk.adicionadas, reserva.adicionadas)
  tira(hunk.removidas, reserva.removidas)
}

/** O que o resultado fez em cada arquivo, pelo caminho da base: o que cada hunk pode gastar. */
function reservasDoResultado(resultado: string): {
  readonly porBase: ReadonlyMap<string, Reservas>
  readonly caminhoFinal: ReadonlyMap<string, string>
  readonly marcadores: ReadonlyMap<string, readonly string[]>
} {
  const porBase = new Map<string, Reservas>()
  const caminhoFinal = new Map<string, string>()
  const marcadores = new Map<string, string[]>()
  for (const arquivo of lerDiff(resultado)) {
    const reserva = porBase.get(arquivo.base) ?? { adicionadas: new Map(), removidas: new Map() }
    porBase.set(arquivo.base, reserva)
    caminhoFinal.set(arquivo.base, arquivo.arquivo)
    for (const h of arquivo.hunks) {
      contar(h.adicionadas, reserva.adicionadas)
      contar(h.removidas, reserva.removidas)
      const soltos = h.adicionadas.filter(ehMarcador)
      if (soltos.length > 0)
        marcadores.set(arquivo.base, [...(marcadores.get(arquivo.base) ?? []), ...soltos])
    }
  }
  return { porBase, caminhoFinal, marcadores }
}

/** Os descartes do arquivo do hunk (pelo caminho novo, o da base ou o final do resultado). */
function descartesDoHunk(
  hunk: HunkDoDiff,
  descartes: readonly DescarteDoArquivo[],
  final: string | undefined
): readonly { trecho: string; motivo: string }[] {
  const nomes = new Set([hunk.arquivo, hunk.base, ...(final === undefined ? [] : [final])])
  return descartes
    .filter((d) => nomes.has(d.arquivo) && d.motivo.trim() !== '')
    .map((d) => ({ trecho: compacto(d.trecho), motivo: d.motivo }))
}

export function resumirAuditoria(auditoria: AuditoriaDeIntegracao): ResumoDaAuditoria {
  const preservados = auditoria.preservados.length
  const descartadosComMotivo = auditoria.descartadosComMotivo.length
  const perdidosSemRegistro = auditoria.perdidosSemRegistro.length
  const naoResolvidos = auditoria.naoResolvidos.length
  return {
    total: preservados + descartadosComMotivo + perdidosSemRegistro,
    preservados,
    descartadosComMotivo,
    perdidosSemRegistro,
    naoResolvidos,
    aprovada: perdidosSemRegistro === 0 && naoResolvidos === 0
  }
}

/**
 * Audita o resultado integrado contra o manifesto. `diffDoResultado` é o `git diff -M -U0` da base
 * até o **commit de integração** — o que ficou no commit, nunca o texto que o integrador diz ter
 * escrito.
 */
export function auditarComDescartes(
  manifesto: readonly HunkDoDiff[],
  diffDoResultado: string,
  descartes: readonly DescarteDoArquivo[]
): { readonly auditoria: AuditoriaDeIntegracao; readonly resumo: ResumoDaAuditoria } {
  const { porBase, caminhoFinal, marcadores } = reservasDoResultado(diffDoResultado)
  const vazio = (): Reservas => ({ adicionadas: new Map(), removidas: new Map() })

  const preservados: HunkDoDiff[] = []
  const descartadosComMotivo: HunkDescartado[] = []
  const perdidosSemRegistro: HunkDoDiff[] = []
  for (const hunk of manifesto) {
    const reserva = porBase.get(hunk.base) ?? vazio()
    const faltam = faltas(hunk, reserva)
    if (faltam.length === 0) {
      gastar(hunk, reserva)
      preservados.push(hunk)
      continue
    }
    const validos = descartesDoHunk(hunk, descartes, caminhoFinal.get(hunk.base))
    const cobertores = faltam.map((linha) =>
      validos.find((d) => d.trecho.includes(compacto(linha)))
    )
    if (cobertores.some((c) => c === undefined)) {
      perdidosSemRegistro.push(hunk)
      continue
    }
    const motivos = [...new Set(cobertores.map((c) => c?.motivo ?? ''))]
    descartadosComMotivo.push({ ...hunk, motivo: motivos.join('; ') })
  }

  // Marcador de conflito que ficou no resultado e que nenhum escritor escreveu: conflito aberto.
  const escritos = new Set(manifesto.flatMap((h) => h.adicionadas.map((l) => l.trimEnd())))
  const naoResolvidos = [...marcadores]
    .filter(([, soltos]) => soltos.some((l) => !escritos.has(l.trimEnd())))
    .map(([base]) => caminhoFinal.get(base) ?? base)

  const auditoria = { preservados, descartadosComMotivo, perdidosSemRegistro, naoResolvidos }
  return { auditoria, resumo: resumirAuditoria(auditoria) }
}

const plural = (n: number, singular: string, plurais: string): string =>
  `${n} ${n === 1 ? singular : plurais}`

/**
 * O manifesto em texto do kernel, para o revisor e o PI: as contagens e **cada descarte**, com
 * arquivo e motivo. "Descartar com motivo" é uma decisão do integrador; é aqui que ela passa por
 * revisão. `linhasNovas` são as linhas da resolução que nem os lados nem a base têm.
 */
export function textoDoManifesto(auditoria: AuditoriaDeIntegracao, linhasNovas: number): string {
  const resumo = resumirAuditoria(auditoria)
  const cabecalho = [
    `manifesto de hunks: ${plural(resumo.preservados, 'preservado', 'preservados')}, ` +
      `${plural(resumo.descartadosComMotivo, 'descartado', 'descartados')} com motivo, ` +
      `${plural(resumo.perdidosSemRegistro, 'perdido', 'perdidos')} sem registro.`,
    `a resolução do integrador introduziu ${plural(linhasNovas, 'linha', 'linhas')} que nem os lados nem a base têm.`
  ]
  const descartes = auditoria.descartadosComMotivo.map(
    (h) =>
      `- ${h.arquivo}: ${h.motivo.slice(0, 200)} (hunk ${h.id}: ${(h.adicionadas[0] ?? h.removidas[0] ?? '').trim().slice(0, 120)})`
  )
  return [...cabecalho, ...(descartes.length > 0 ? ['descartes:', ...descartes] : [])].join('\n')
}
