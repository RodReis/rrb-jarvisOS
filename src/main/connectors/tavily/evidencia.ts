/**
 * O pacote de evidência: hash, deduplicação e verificação (SPEC-Conectores-06).
 *
 * Mora no main e não em `src/shared` pela mesma razão de `audit-chain.ts`: usa `node:crypto`, e
 * `shared` é compilado também para o renderer, que não tem Node. Os **tipos** (`EvidenceItem`)
 * ficam em `@shared/domain/tavily`, onde o renderer os consome; a criptografia fica aqui.
 *
 * O hash aqui é `createHash` puro, **sem chave** — e a diferença para o HMAC da cadeia de
 * auditoria é de propósito, não de descuido. A cadeia usa chave porque o que ela precisa provar é
 * *autenticidade*: que ninguém reescreveu o passado. A evidência precisa provar
 * *reprodutibilidade*: qualquer pessoa com o mesmo conteúdo tem de chegar ao mesmo hash e poder
 * conferir a citação. Um HMAC aqui tornaria a verificação dependente de um segredo nosso, o que
 * é o oposto de evidência verificável.
 *
 * **Escopo desta fatia** (decisão do PI de 2026-08-29): o consumidor real — a geração do
 * `LANDSCAPE.md` — é a M8-F04, que declara depender desta fatia. O que se entrega aqui é a
 * *capacidade verificável* que ela vai chamar: dado um conjunto de afirmações e um pacote de
 * evidência, dizer quais afirmações estão sustentadas e quais hashes ainda batem. Os critérios 1
 * e 6 da spec são provados sobre este verificador, não sobre um documento que ainda não existe.
 */

import { createHash } from 'node:crypto'
import type { EvidenceFailure, EvidenceItem, TavilyExtractData } from '@shared/domain/tavily'
import { dominioDe, normalizarUrl } from '@shared/domain/tavily'

/**
 * SHA-256 hexadecimal do conteúdo.
 *
 * O texto é normalizado antes: quebras de linha unificadas para `\n` e espaço em branco das
 * pontas removido. Sem isso, o mesmo documento baixado por dois caminhos (um servindo CRLF,
 * outro LF) produziria hashes diferentes e "a fonte mudou" dispararia por diferença que não
 * existe no conteúdo.
 */
export function hashDoConteudo(texto: string): string {
  return createHash('sha256').update(normalizarTexto(texto), 'utf8').digest('hex')
}

/** Normalização de texto para hash. Só o que não altera o conteúdo lido por uma pessoa. */
function normalizarTexto(texto: string): string {
  return texto.replace(/\r\n/g, '\n').trim()
}

/**
 * Um item extraído, antes de virar evidência — o que o adapter monta a partir da resposta crua.
 */
export interface ExtracaoCrua {
  readonly url: string
  readonly conteudo: string
  readonly titulo?: string
  readonly publicadoEm?: string
  readonly trecho?: string
}

/**
 * Monta um `EvidenceItem` a partir de uma extração crua.
 *
 * A URL entra duas vezes — canônica e original —, porque o critério 3 da F05 exige normalizar
 * sem perder o original, e as duas respondem perguntas diferentes: a canônica deduplica, a
 * original reproduz a chamada.
 */
export function montarEvidencia(
  crua: ExtracaoCrua,
  coletadoEm: string,
  requestId?: string
): EvidenceItem {
  const trecho = crua.trecho === undefined ? undefined : normalizarTexto(crua.trecho)

  return {
    url: normalizarUrl(crua.url),
    urlOriginal: crua.url,
    dominio: dominioDe(crua.url),
    coletadoEm,
    conteudo: crua.conteudo,
    hashConteudo: hashDoConteudo(crua.conteudo),
    ...(crua.titulo === undefined ? {} : { titulo: crua.titulo }),
    ...(crua.publicadoEm === undefined ? {} : { publicadoEm: crua.publicadoEm }),
    ...(trecho === undefined || trecho === ''
      ? {}
      : { trecho, hashTrecho: hashDoConteudo(trecho) }),
    ...(requestId === undefined ? {} : { requestId })
  }
}

/**
 * Agrupa evidências duplicadas — **por URL canônica e hash de conteúdo** (critério 4 da F06).
 *
 * Os dois juntos, e é aí que mora a regra: mesma URL com conteúdo **divergente** não é duplicata,
 * é a fonte tendo mudado entre as duas coletas, e fundi-las apagaria justamente o fato que o
 * hash existe para revelar. Deduplicar só por URL é o erro que o critério 4 nomeia.
 *
 * Mantém a **primeira** ocorrência. Arbitrário, mas estável: ordem de chegada é a ordem em que a
 * Tavily respondeu, e escolher "a mais longa" ou "a mais recente" seria inventar um critério de
 * qualidade que nada sustenta.
 */
export function deduplicar(itens: readonly EvidenceItem[]): {
  readonly unicos: readonly EvidenceItem[]
  readonly descartados: number
} {
  const vistos = new Set<string>()
  const unicos: EvidenceItem[] = []

  for (const item of itens) {
    const chave = `${item.url}\n${item.hashConteudo}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    unicos.push(item)
  }

  return { unicos, descartados: itens.length - unicos.length }
}

/**
 * Uma afirmação que depende de evidência — o que a M8-F04 vai submeter ao verificador.
 *
 * `fontes` são URLs (em qualquer forma; o verificador canoniza antes de comparar), e não índices
 * num array: um índice quebra silenciosamente quando o pacote é reordenado, e a afirmação passaria
 * a citar outra fonte sem que nada acusasse.
 */
export interface Afirmacao {
  readonly id: string
  readonly texto: string
  readonly fontes: readonly string[]
}

/** Por que uma afirmação não está sustentada. */
export type MotivoDeLacuna =
  /** A afirmação não cita fonte nenhuma. */
  | 'sem-fonte'
  /** Cita fonte que não está no pacote de evidência — snippet de busca não conta como evidência. */
  | 'fonte-sem-evidencia'

export interface LacunaDeEvidencia {
  readonly afirmacao: string
  readonly motivo: MotivoDeLacuna
  /** As URLs citadas que não têm evidência extraída. Vazia quando o motivo é `sem-fonte`. */
  readonly fontesAusentes: readonly string[]
}

/**
 * O veredito do verificador de evidência.
 *
 * `completo` é o que o critério 6 da F06 usa: o consumidor **não conclui** um Landscape
 * verificado quando ele é `false`. A decisão de bloquear é do consumidor; o fato de faltar
 * evidência é daqui.
 */
export interface VerificacaoDeEvidencia {
  readonly completo: boolean
  readonly lacunas: readonly LacunaDeEvidencia[]
  /** URLs que a extração tentou e não conseguiu — o critério 3 pede identificá-las. */
  readonly fontesAusentes: readonly EvidenceFailure[]
}

/**
 * Toda afirmação material tem evidência extraída? (critérios 1 e 6 da F06.)
 *
 * O que este verificador afirma é estreito de propósito: que cada afirmação cita ao menos uma
 * fonte **presente no pacote de evidência extraída**. Ele não julga se a evidência *sustenta
 * semanticamente* a afirmação — isso é leitura, não computação, e uma função que dissesse "sim"
 * a isso estaria mentindo sobre o que verificou.
 *
 * A comparação é por URL canônica: a afirmação pode citar a URL como a pessoa a copiou, com
 * `utm_` e barra final, e ainda casar com a evidência coletada.
 */
export function verificarEvidencia(
  afirmacoes: readonly Afirmacao[],
  pacote: TavilyExtractData
): VerificacaoDeEvidencia {
  const comEvidencia = new Set(pacote.evidencias.map((e) => e.url))
  const lacunas: LacunaDeEvidencia[] = []

  for (const afirmacao of afirmacoes) {
    if (afirmacao.fontes.length === 0) {
      lacunas.push({ afirmacao: afirmacao.id, motivo: 'sem-fonte', fontesAusentes: [] })
      continue
    }

    const ausentes = afirmacao.fontes.filter((f) => !comEvidencia.has(normalizarUrl(f)))

    // Ausente **só** quando nenhuma das fontes citadas tem evidência: uma afirmação apoiada em
    // três fontes, com duas extraídas, está sustentada — a terceira é reforço que faltou, não
    // uma lacuna que invalida o que as outras duas provam.
    if (ausentes.length === afirmacao.fontes.length) {
      lacunas.push({
        afirmacao: afirmacao.id,
        motivo: 'fonte-sem-evidencia',
        fontesAusentes: ausentes
      })
    }
  }

  return {
    completo: lacunas.length === 0,
    lacunas,
    fontesAusentes: pacote.falhas
  }
}

/**
 * O hash guardado ainda corresponde ao conteúdo atual? (critério 2 da F06.)
 *
 * É o que detecta que a fonte mudou entre revisões: recolhe-se o conteúdo de novo, recalcula-se
 * o hash, e a divergência é o alarme. Função separada de `verificarEvidencia` porque as duas
 * respondem coisas diferentes — uma pergunta "há evidência?", a outra "a evidência ainda vale?".
 */
export function conteudoMudou(item: EvidenceItem, conteudoAtual: string): boolean {
  return hashDoConteudo(conteudoAtual) !== item.hashConteudo
}

/**
 * O trecho citado confere com o conteúdo extraído?
 *
 * Duas conferências, e ambas precisam passar: o hash do trecho (prova que o texto citado é o que
 * foi hasheado) **e** a presença dele no conteúdo (prova que ele saiu de lá, e não de outro
 * lugar). Só o hash provaria que a citação não foi editada depois — não que ela algum dia
 * pertenceu àquela fonte.
 */
export function trechoConfere(item: EvidenceItem): boolean {
  if (item.trecho === undefined || item.hashTrecho === undefined) return true

  return (
    hashDoConteudo(item.trecho) === item.hashTrecho &&
    normalizarTexto(item.conteudo).includes(normalizarTexto(item.trecho))
  )
}
