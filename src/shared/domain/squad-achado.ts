/**
 * O que é puro na revisão independente do Squad (SPEC-Squads-04): o parecer que o revisor devolve,
 * o achado estruturado, a assinatura que o deduplica, o ciclo de vida e o veredito.
 *
 * **O revisor propõe, o kernel decide.** O parecer é dado não confiável: a forma é lida de modo
 * estrito, a assinatura é do kernel (um campo livre serviria para esconder um achado repetido ou
 * fabricar um novo) e a evidência só vale se o kernel a reencontra no arquivo (regra 4 da F03).
 * Severidade segue `docs/REVIEW.md`; ausência de regra não autoriza inventar bloqueio (regra 3).
 *
 * Tudo aqui devolve **valores novos**: nenhuma função altera a lista que recebe.
 */

import { chavesExtras, ehRegistro, textoAte } from './squad-execucao'
import { normalizar as normalizarCaminho } from './squad-plano'

// ─── Vocabulário ────────────────────────────────────────────────────────────────────────────────

export const PARECER_DE_REVISAO = 'parecer-de-revisao@1'

/** `docs/REVIEW.md`: P0 e P1 bloqueiam; P2 e P3 registram. */
export const SEVERIDADES = ['P0', 'P1', 'P2', 'P3'] as const
export type Severidade = (typeof SEVERIDADES)[number]

const BLOQUEIAM: readonly Severidade[] = ['P0', 'P1']
export const bloqueia = (s: Severidade): boolean => BLOQUEIAM.includes(s)

/** A ordem de revisão do `REVIEW.md`, uma categoria por item. */
export const CATEGORIAS_DE_ACHADO = [
  'escopo',
  'corretude',
  'integridade',
  'fronteira',
  'teste',
  'arquitetura',
  'interface',
  'desempenho'
] as const
export type CategoriaDeAchado = (typeof CATEGORIAS_DE_ACHADO)[number]

export const PARECERES = ['PASS', 'FIX_REQUIRED', 'BLOCKED'] as const
export type Parecer = (typeof PARECERES)[number]

export const ESTADOS_DO_ACHADO = ['open', 'accepted', 'fixed', 'dismissed', 'superseded'] as const
export type EstadoDoAchado = (typeof ESTADOS_DO_ACHADO)[number]

// ─── Tipos ──────────────────────────────────────────────────────────────────────────────────────

/** O achado como o revisor o declara. Sem `assinatura` de propósito. */
export interface AchadoDeclarado {
  readonly categoria: CategoriaDeAchado
  readonly severidade: Severidade
  readonly titulo: string
  readonly arquivo: string
  /** O trecho de código que ancora o achado. O kernel o reencontra no arquivo ou descarta o achado. */
  readonly trecho: string
  readonly impacto: string
  readonly correcao: string
  /** Achado fora da SPEC é observação separada e não bloqueia a issue (regra 4). */
  readonly foraDaSpec: boolean
  /** Sem ela, a severidade já guardada não muda: elevar ou reduzir exige evidência e impacto. */
  readonly justificativaDeSeveridade?: string
}

export interface ContestacaoDeAchado {
  readonly assinatura: string
  readonly motivo: string
}

export interface ParecerDoRevisor {
  readonly schema: typeof PARECER_DE_REVISAO
  readonly parecer: Parecer
  readonly achados: readonly AchadoDeclarado[]
  readonly observacoes: readonly string[]
  readonly contestacoes: readonly ContestacaoDeAchado[]
}

export interface AchadoRegistrado extends AchadoDeclarado {
  readonly assinatura: string
  readonly estado: EstadoDoAchado
  readonly vistoPor: readonly string[]
  readonly contestadoPor: readonly string[]
  readonly deltaDaPrimeiraVista: string
  readonly deltaDaUltimaVista: string
  /** O delta em que o achado saiu de `open`/`accepted`: reabrir exige delta diferente deste. */
  readonly deltaDoFechamento?: string
  readonly motivoDoEstado?: string
  readonly reaberturas?: number
}

export type LeituraDoParecer =
  | { readonly ok: true; readonly parecer: ParecerDoRevisor }
  | { readonly ok: false; readonly motivo: string }

// ─── Leitura estrita ────────────────────────────────────────────────────────────────────────────

const CHAVES_DO_PARECER = ['schema', 'parecer', 'achados', 'observacoes', 'contestacoes'] as const
const CHAVES_DO_ACHADO = [
  'categoria',
  'severidade',
  'titulo',
  'arquivo',
  'trecho',
  'impacto',
  'correcao',
  'foraDaSpec',
  'justificativaDeSeveridade'
] as const
const CHAVES_DA_CONTESTACAO = ['assinatura', 'motivo'] as const

const MAX_ACHADOS = 50
const MAX_OBSERVACOES = 20
const MAX_CONTESTACOES = 50
const MAX_TITULO = 200
const MAX_TRECHO = 1000
const MAX_TEXTO = 1000
const MAX_ASSINATURA = 100
const MAX_MOTIVO_DA_RECUSA = 160

const ehPertencente = <T extends string>(lista: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (lista as readonly string[]).includes(v)

function lerAchado(bruto: unknown, i: number): { achado?: AchadoDeclarado; erro?: string } {
  if (!ehRegistro(bruto)) return { erro: `achado ${i} não é um objeto` }
  const extras = chavesExtras(bruto, CHAVES_DO_ACHADO)
  if (extras.length > 0) return { erro: `achado ${i}: chave ${extras[0]} não existe no esquema` }
  if (!ehPertencente(CATEGORIAS_DE_ACHADO, bruto.categoria)) {
    return { erro: `achado ${i}: categoria inválida` }
  }
  if (!ehPertencente(SEVERIDADES, bruto.severidade))
    return { erro: `achado ${i}: severidade inválida` }
  if (typeof bruto.foraDaSpec !== 'boolean') return { erro: `achado ${i}: foraDaSpec inválido` }

  const titulo = textoAte(bruto.titulo, MAX_TITULO, false)
  const trecho = textoAte(bruto.trecho, MAX_TRECHO, true)
  const impacto = textoAte(bruto.impacto, MAX_TEXTO, true)
  const correcao = textoAte(bruto.correcao, MAX_TEXTO, true)
  const arquivo = typeof bruto.arquivo === 'string' ? normalizarCaminho(bruto.arquivo) : undefined
  if (titulo === undefined) return { erro: `achado ${i}: título inválido` }
  if (arquivo === undefined) return { erro: `achado ${i}: arquivo inválido` }
  if (trecho === undefined) return { erro: `achado ${i}: trecho inválido` }
  if (impacto === undefined) return { erro: `achado ${i}: impacto inválido` }
  if (correcao === undefined) return { erro: `achado ${i}: correção inválida` }

  const base = {
    categoria: bruto.categoria,
    severidade: bruto.severidade,
    titulo,
    arquivo,
    trecho,
    impacto,
    correcao,
    foraDaSpec: bruto.foraDaSpec
  }
  if (bruto.justificativaDeSeveridade === undefined) return { achado: base }
  const justificativa = textoAte(bruto.justificativaDeSeveridade, MAX_TEXTO, true)
  if (justificativa === undefined) return { erro: `achado ${i}: justificativa inválida` }
  return { achado: { ...base, justificativaDeSeveridade: justificativa } }
}

function lerListaDeTextos(bruta: unknown, max: number, nome: string): string[] | string {
  if (!Array.isArray(bruta) || bruta.length > max) return `${nome} inválidas`
  const textos: string[] = []
  for (const item of bruta as unknown[]) {
    const texto = textoAte(item, MAX_TEXTO, true)
    if (texto === undefined) return `${nome} inválidas`
    textos.push(texto)
  }
  return textos
}

function lerContestacoes(bruta: unknown): ContestacaoDeAchado[] | string {
  if (!Array.isArray(bruta) || bruta.length > MAX_CONTESTACOES) return 'contestações inválidas'
  const lidas: ContestacaoDeAchado[] = []
  for (const item of bruta as unknown[]) {
    if (!ehRegistro(item) || chavesExtras(item, CHAVES_DA_CONTESTACAO).length > 0) {
      return 'contestação inválida'
    }
    const assinatura = textoAte(item.assinatura, MAX_ASSINATURA, false)
    const motivo = textoAte(item.motivo, MAX_TEXTO, true)
    if (assinatura === undefined || motivo === undefined) return 'contestação inválida'
    lidas.push({ assinatura, motivo })
  }
  return lidas
}

const recusa = (motivo: string): LeituraDoParecer => ({
  ok: false,
  motivo: motivo.slice(0, MAX_MOTIVO_DA_RECUSA)
})

/**
 * Lê o parecer que o agente devolveu. Qualquer desvio é recusa: **revisão sem parecer válido para
 * a integração** (regra 1). O motivo cita chave escolhida pelo agente e vai para a auditoria, então
 * tem teto.
 */
export function lerParecer(bruto: unknown): LeituraDoParecer {
  if (!ehRegistro(bruto)) return recusa('o parecer não é um objeto')
  const extras = chavesExtras(bruto, CHAVES_DO_PARECER)
  if (extras.length > 0) return recusa(`chave ${extras[0]} não existe no esquema do parecer`)
  if (bruto.schema !== PARECER_DE_REVISAO) return recusa('schema do parecer inválido')
  if (!ehPertencente(PARECERES, bruto.parecer)) return recusa('parecer fora do vocabulário')
  if (!Array.isArray(bruto.achados) || bruto.achados.length > MAX_ACHADOS) {
    return recusa('achados inválidos')
  }

  const achados: AchadoDeclarado[] = []
  for (const [i, item] of (bruto.achados as unknown[]).entries()) {
    const lido = lerAchado(item, i)
    if (lido.achado === undefined) return recusa(lido.erro ?? 'achado inválido')
    achados.push(lido.achado)
  }
  const observacoes = lerListaDeTextos(bruto.observacoes, MAX_OBSERVACOES, 'observações')
  if (typeof observacoes === 'string') return recusa(observacoes)
  const contestacoes = lerContestacoes(bruto.contestacoes)
  if (typeof contestacoes === 'string') return recusa(contestacoes)

  return {
    ok: true,
    parecer: {
      schema: PARECER_DE_REVISAO,
      parecer: bruto.parecer,
      achados,
      observacoes,
      contestacoes
    }
  }
}

// ─── Assinatura e evidência ─────────────────────────────────────────────────────────────────────

/** Sem espaço e sem caixa: o mesmo código reformatado é o mesmo código. */
const compacto = (texto: string): string => texto.toLowerCase().replace(/\s+/g, '')

/**
 * O texto canônico de que o kernel tira a assinatura (o hash mora no `main`). A impressão digital é
 * **categoria + arquivo + trecho**: o trecho ancora o problema, então o título reescrito, a
 * severidade e o impacto não criam um achado novo — e, ao contrário do número de linha, o trecho
 * sobrevive ao outro escritor inserir código acima. Dois problemas distintos na mesma linha e na
 * mesma categoria colapsam em um: o custo aceito pela deduplicação (`REVIEW.md`).
 */
export const textoDaAssinaturaDoAchado = (a: AchadoDeclarado): string =>
  JSON.stringify([a.categoria, a.arquivo, compacto(a.trecho)])

/**
 * O kernel reencontra o trecho no arquivo como ele está no resultado. Achado cujo trecho não está
 * lá não tem localização verificável: vira observação, nunca defeito confirmado (`REVIEW.md`).
 */
export function conferirEvidencia(
  achado: Pick<AchadoDeclarado, 'arquivo' | 'trecho'>,
  lerArquivo: (arquivo: string) => string | undefined
): boolean {
  const conteudo = lerArquivo(achado.arquivo)
  return conteudo !== undefined && compacto(conteudo).includes(compacto(achado.trecho))
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────────────────────────────

const TRANSICOES: Readonly<Record<EstadoDoAchado, readonly EstadoDoAchado[]>> = {
  open: ['accepted', 'fixed', 'dismissed', 'superseded'],
  accepted: ['fixed', 'dismissed', 'superseded'],
  // Reabrir é a única saída de um achado resolvido, e só com delta novo (ver `incorporarAchados`).
  fixed: ['open'],
  dismissed: ['open'],
  superseded: []
}

export const transicaoDoAchadoPermitida = (de: EstadoDoAchado, para: EstadoDoAchado): boolean =>
  TRANSICOES[de].includes(para)

const aberto = (a: AchadoRegistrado): boolean => a.estado === 'open' || a.estado === 'accepted'

function mudarEstado(
  achado: AchadoRegistrado,
  estado: EstadoDoAchado,
  extra: Partial<AchadoRegistrado> = {}
): AchadoRegistrado {
  return transicaoDoAchadoPermitida(achado.estado, estado)
    ? { ...achado, ...extra, estado }
    : achado
}

// ─── Deduplicação ───────────────────────────────────────────────────────────────────────────────

export interface AchadoDoRevisor {
  readonly revisor: string
  readonly achado: AchadoDeclarado
}

const semRepetir = (lista: readonly string[], novo: string): readonly string[] =>
  lista.includes(novo) ? lista : [...lista, novo]

function atualizarVisto(
  existente: AchadoRegistrado,
  { revisor, achado }: AchadoDoRevisor,
  delta: string
): AchadoRegistrado {
  const reabre = !aberto(existente) && existente.estado !== 'superseded'
  // O mesmo delta que fechou o achado não o reabre: reabrir exige delta material novo.
  if (!aberto(existente) && (!reabre || existente.deltaDoFechamento === delta)) return existente

  const base = reabre
    ? mudarEstado(existente, 'open', {
        reaberturas: (existente.reaberturas ?? 0) + 1,
        deltaDoFechamento: undefined,
        motivoDoEstado: undefined
      })
    : existente
  const comJustificativa =
    achado.justificativaDeSeveridade !== undefined && achado.severidade !== base.severidade
  return {
    ...base,
    severidade: comJustificativa ? achado.severidade : base.severidade,
    vistoPor: semRepetir(base.vistoPor, revisor),
    deltaDaUltimaVista: delta
  }
}

/**
 * Junta os achados novos aos já registrados, **uma assinatura por problema**. Mesmo problema no
 * mesmo delta, de revisores diferentes, é um registro com todos em `vistoPor`; achado resolvido
 * não reaparece como novo no delta que o resolveu.
 */
export function incorporarAchados(
  existentes: readonly AchadoRegistrado[],
  novos: readonly AchadoDoRevisor[],
  delta: string,
  assinar: (texto: string) => string
): readonly AchadoRegistrado[] {
  const lista = new Map(existentes.map((a) => [a.assinatura, a]))
  for (const novo of novos) {
    const assinatura = assinar(textoDaAssinaturaDoAchado(novo.achado))
    const atual = lista.get(assinatura)
    if (atual !== undefined) {
      lista.set(assinatura, atualizarVisto(atual, novo, delta))
      continue
    }
    lista.set(assinatura, {
      ...novo.achado,
      assinatura,
      estado: 'open',
      vistoPor: [novo.revisor],
      contestadoPor: [],
      deltaDaPrimeiraVista: delta,
      deltaDaUltimaVista: delta
    })
  }
  return [...lista.values()]
}

// ─── Revalidação, triagem e contestação ─────────────────────────────────────────────────────────

/**
 * Revalidação **objetiva**: o kernel relê o arquivo no resultado novo. Se o trecho que ancorava o
 * achado não está mais lá, o achado é `fixed` — sem pedir a um agente que diga que corrigiu.
 */
export function revalidar(
  achados: readonly AchadoRegistrado[],
  lerArquivo: (arquivo: string) => string | undefined,
  delta: string
): readonly AchadoRegistrado[] {
  return achados.map((a) =>
    aberto(a) && !conferirEvidencia(a, lerArquivo)
      ? mudarEstado(a, 'fixed', { deltaDoFechamento: delta, motivoDoEstado: 'trecho-removido' })
      : a
  )
}

/**
 * Só o achado bloqueante, dentro da SPEC e com evidência que o kernel confere vira correção
 * aceita — e **só escritores consomem correções aceitas** (regra 5). O resto fica registrado.
 */
export function decidirTriagem(
  achados: readonly AchadoRegistrado[],
  lerArquivo: (arquivo: string) => string | undefined
): readonly AchadoRegistrado[] {
  return achados.map((a) =>
    a.estado === 'open' &&
    bloqueia(a.severidade) &&
    !a.foraDaSpec &&
    conferirEvidencia(a, lerArquivo)
      ? mudarEstado(a, 'accepted')
      : a
  )
}

/**
 * Uma contestação **não muda o estado**: contestar sem evidência conclusiva não é resolvido por
 * voto nem pela autoridade do agente (critério 6). Ela só marca o conflito; a prova que o resolve
 * é a revalidação objetiva, ou a decisão do PI.
 */
export function contestar(
  achados: readonly AchadoRegistrado[],
  contestacoes: readonly {
    readonly revisor: string
    readonly assinatura: string
    readonly motivo: string
  }[]
): readonly AchadoRegistrado[] {
  return achados.map((a) => {
    const quem = contestacoes.filter((c) => c.assinatura === a.assinatura).map((c) => c.revisor)
    return quem.length === 0 || !aberto(a)
      ? a
      : { ...a, contestadoPor: quem.reduce(semRepetir, a.contestadoPor) }
  })
}

// ─── Veredito ───────────────────────────────────────────────────────────────────────────────────

export type VereditoDaRevisao =
  | { readonly resultado: 'PASS' | 'FIX_REQUIRED' }
  | {
      readonly resultado: 'BLOCKED'
      readonly motivo: 'conflito-entre-revisores' | 'revisao-sem-parecer'
    }

/**
 * O veredito é do kernel, derivado dos achados — não do `parecer` que o agente declarou. Sem
 * parecer válido o run para (regra 1); conflito de bloqueante aberto também (critério 6).
 */
export function veredito(
  achados: readonly AchadoRegistrado[],
  houveParecer: boolean
): VereditoDaRevisao {
  if (!houveParecer) return { resultado: 'BLOCKED', motivo: 'revisao-sem-parecer' }
  const bloqueantes = achados.filter((a) => aberto(a) && bloqueia(a.severidade) && !a.foraDaSpec)
  if (bloqueantes.some((a) => a.contestadoPor.length > 0)) {
    return { resultado: 'BLOCKED', motivo: 'conflito-entre-revisores' }
  }
  return { resultado: bloqueantes.length > 0 ? 'FIX_REQUIRED' : 'PASS' }
}
