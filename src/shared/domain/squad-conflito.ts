/**
 * O que é puro no conflito de merge que o integrador resolve (SPEC-Squads-04, ADR-006 decisão 6).
 *
 * O Git junta o que é determinístico; sobra o **bloco em conflito**, no estilo diff3 (lado A, base,
 * lado B). O agente integrador devolve só o texto do bloco e o registro do que descartou — **nunca
 * escreve arquivo nem executa Git** (decisão do PI de 2026-10-03). Quem monta o arquivo é o kernel,
 * e a resposta do agente é dado não confiável: forma estrita, sem marcador de conflito, sem
 * caractere de controle.
 */

import { chavesExtras, ehRegistro } from './squad-execucao'
import { ehControleOuDirecao } from './squad-plano'

export interface BlocoEmConflito {
  readonly a: readonly string[]
  readonly base: readonly string[]
  readonly b: readonly string[]
  /** Faltou o `=======` entre os lados: o Git nunca emite isso, então o texto foi forjado. */
  readonly malformado?: true
}

export type ParteDoArquivo =
  | { readonly tipo: 'fixo'; readonly linhas: readonly string[] }
  | { readonly tipo: 'bloco'; readonly bloco: BlocoEmConflito }

const ABRE = '<<<<<<<'
const BASE = '|||||||'
const MEIO = '======='
const FECHA = '>>>>>>>'

/**
 * Quebra o arquivo em segmentos fixos e blocos em conflito. `=======` só delimita **dentro** de um
 * bloco, e só o primeiro depois do lado A (e da base): um segundo é texto (sublinhado de título em
 * Markdown). Bloco que nunca fecha não é bloco — o resto do arquivo fica como texto.
 *
 * **Isto lê texto, e o texto é do escritor.** Uma linha `>>>>>>>` dentro de um lado fecharia o
 * bloco antes da hora e deixaria o resto dos marcadores reais como texto fixo; por isso quem usa o
 * resultado confere `estruturaAmbigua` e para, em vez de confiar no que leu. Uma passada só: o
 * fecho de cada abertura é calculado de trás para a frente, e um arquivo cheio de `<<<<<<<` sem
 * fecho não custa tempo quadrático.
 */
export function lerBlocos(texto: string): readonly ParteDoArquivo[] {
  const linhas = texto.split('\n')
  const proximoFecho = new Array<number>(linhas.length).fill(-1)
  let ultimo = -1
  for (let i = linhas.length - 1; i >= 0; i--) {
    proximoFecho[i] = ultimo
    if ((linhas[i] ?? '').startsWith(FECHA)) ultimo = i
  }

  const partes: ParteDoArquivo[] = []
  let fixo: string[] = []
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] ?? ''
    const fecho = linha.startsWith(ABRE) ? (proximoFecho[i] ?? -1) : -1
    if (fecho === -1) {
      fixo.push(linha)
      continue
    }
    const lados: { a: string[]; base: string[]; b: string[] } = { a: [], base: [], b: [] }
    let alvo = lados.a
    let viuBase = false
    let viuMeio = false
    for (let j = i + 1; j < fecho; j++) {
      const interna = linhas[j] ?? ''
      if (!viuBase && !viuMeio && interna.startsWith(BASE)) {
        viuBase = true
        alvo = lados.base
      } else if (!viuMeio && interna.startsWith(MEIO)) {
        viuMeio = true
        alvo = lados.b
      } else alvo.push(interna)
    }
    const bloco: BlocoEmConflito = viuMeio ? lados : { ...lados, malformado: true }
    partes.push({ tipo: 'fixo', linhas: fixo }, { tipo: 'bloco', bloco })
    fixo = []
    i = fecho
  }
  partes.push({ tipo: 'fixo', linhas: fixo })
  return partes
}

const ehMarcadorForte = (linha: string): boolean =>
  linha.startsWith(ABRE) || linha.startsWith(BASE) || linha.startsWith(FECHA)

/**
 * A estrutura lida não é a que o Git emitiria: marcador solto no texto fixo, marcador dentro de um
 * lado, ou bloco sem `=======`. O conteúdo do escritor pode forjar isso — e o kernel não resolve
 * o que não sabe ler com certeza (regra 1: faltou prova, o run para).
 */
export function estruturaAmbigua(partes: readonly ParteDoArquivo[]): boolean {
  return partes.some((p) =>
    p.tipo === 'fixo'
      ? p.linhas.some(ehMarcadorForte)
      : p.bloco.malformado === true ||
        [...p.bloco.a, ...p.bloco.base, ...p.bloco.b].some(ehMarcadorForte)
  )
}

/** O texto final ainda tem marcador de conflito: não é resolução, é conflito com outra aparência. */
export const temMarcadorDeConflito = (texto: string): boolean => MARCADOR_NO_TEXTO.test(texto)

export const totalDeBlocos = (partes: readonly ParteDoArquivo[]): number =>
  partes.filter((p) => p.tipo === 'bloco').length

/** O contexto fixo de cada lado do bloco: o bastante para o integrador entender, sem o arquivo todo. */
export function contextoDoBloco(
  partes: readonly ParteDoArquivo[],
  indice: number,
  linhas: number
): { readonly antes: readonly string[]; readonly depois: readonly string[] } {
  const anterior = partes[indice - 1]
  const seguinte = partes[indice + 1]
  return {
    antes: anterior?.tipo === 'fixo' ? anterior.linhas.slice(-linhas) : [],
    depois: seguinte?.tipo === 'fixo' ? seguinte.linhas.slice(0, linhas) : []
  }
}

export interface DescarteDoIntegrador {
  readonly trecho: string
  readonly motivo: string
}

export interface ResolucaoDoBloco {
  readonly resolucao: string
  readonly descartes: readonly DescarteDoIntegrador[]
}

/**
 * As linhas que a resolução põe no arquivo. Resolução vazia remove o bloco (zero linhas, não uma
 * linha em branco), e um fim de linha no fim do texto não vira linha em branco.
 */
function linhasDaResolucao(resolucao: string, crlf: boolean): string[] {
  if (resolucao === '') return []
  const linhas = resolucao.replace(/\r?\n$/, '').split(/\r?\n/)
  return crlf ? linhas.map((l) => `${l}\r`) : linhas
}

/**
 * Monta o arquivo com a resolução de cada bloco, na ordem. `undefined` se faltar resolução: arquivo
 * com bloco sem resposta não existe (regra 1), e devolver o texto com marcador pareceria resolvido.
 */
export function montarArquivo(
  partes: readonly ParteDoArquivo[],
  resolucoes: readonly ResolucaoDoBloco[]
): string | undefined {
  if (resolucoes.length !== totalDeBlocos(partes)) return undefined
  const saida: string[] = []
  // O Git emite o conflito com o fim de linha do arquivo: com CRLF as linhas chegam com `\r`, e a
  // resolução que o agente devolve (com `\n`) entra no mesmo formato, sem fim de linha misto.
  const crlf = partes.some((p) =>
    p.tipo === 'fixo'
      ? p.linhas.some((l) => l.endsWith('\r'))
      : [...p.bloco.a, ...p.bloco.base, ...p.bloco.b].some((l) => l.endsWith('\r'))
  )
  let proxima = 0
  for (const parte of partes) {
    if (parte.tipo === 'fixo') {
      saida.push(...parte.linhas)
      continue
    }
    saida.push(...linhasDaResolucao(resolucoes[proxima]?.resolucao ?? '', crlf))
    proxima += 1
  }
  return saida.join('\n')
}

// ─── Leitura estrita da resposta do agente ──────────────────────────────────────────────────────

export type LeituraDaResolucao =
  | { readonly ok: true; readonly valor: ResolucaoDoBloco }
  | { readonly ok: false; readonly motivo: string }

const CHAVES_DA_RESOLUCAO = ['resolucao', 'descartes'] as const
const CHAVES_DO_DESCARTE = ['trecho', 'motivo'] as const
const MAX_RESOLUCAO = 100_000
const MAX_DESCARTES = 50
const MAX_TRECHO = 2_000
const MAX_MOTIVO = 500

const TABULACAO = 0x09
const QUEBRA_DE_LINHA = 0x0a
const RETORNO = 0x0d

/**
 * `|` é operador de regex: sem escapar, `|||||||` viraria alternativas vazias que casam tudo.
 * `=======` fica de fora: sozinho ele é texto legítimo (título em Markdown), e só os outros três
 * provam que o texto ainda é um conflito.
 */
const MARCADOR_NO_TEXTO = /^(<<<<<<<|\|\|\|\|\|\|\||>>>>>>>)/m

function temControle(texto: string): boolean {
  return Array.from(texto).some((ch) => {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === TABULACAO || cp === QUEBRA_DE_LINHA || cp === RETORNO) return false
    return ehControleOuDirecao(cp)
  })
}

const textoLimitado = (v: unknown, max: number, vazioPode: boolean): string | undefined => {
  if (typeof v !== 'string' || v.length > max || (!vazioPode && v.trim() === '')) return undefined
  return temControle(v) ? undefined : v
}

const recusa = (motivo: string): LeituraDaResolucao => ({ ok: false, motivo })

/**
 * Lê o JSON que o integrador devolveu para um bloco. A resolução **não pode** conter marcador de
 * conflito (o arquivo montado passaria por resolvido sem estar), e cada descarte traz o trecho e o
 * motivo — o que o manifesto usa para explicar um hunk que não está no resultado.
 */
export function lerResolucao(bruto: unknown): LeituraDaResolucao {
  if (!ehRegistro(bruto)) return recusa('a resolução não é um objeto')
  const extras = chavesExtras(bruto, CHAVES_DA_RESOLUCAO)
  if (extras.length > 0) return recusa('chave desconhecida no esquema da resolução')

  const resolucao = textoLimitado(bruto.resolucao, MAX_RESOLUCAO, true)
  if (resolucao === undefined) return recusa('resolução inválida')
  if (MARCADOR_NO_TEXTO.test(resolucao)) return recusa('marcador de conflito na resolução')
  if (!Array.isArray(bruto.descartes) || bruto.descartes.length > MAX_DESCARTES) {
    return recusa('descartes inválidos')
  }

  const descartes: DescarteDoIntegrador[] = []
  for (const item of bruto.descartes as unknown[]) {
    if (!ehRegistro(item) || chavesExtras(item, CHAVES_DO_DESCARTE).length > 0) {
      return recusa('descarte inválido')
    }
    const trecho = textoLimitado(item.trecho, MAX_TRECHO, false)
    const motivo = textoLimitado(item.motivo, MAX_MOTIVO, false)
    if (trecho === undefined || motivo === undefined) return recusa('descarte inválido')
    descartes.push({ trecho, motivo })
  }
  return { ok: true, valor: { resolucao, descartes } }
}

/**
 * O JSON Schema que o integrador recebe para a resolução de um bloco. Uma **ajuda**, não a barreira:
 * o CLI o aplica como `--json-schema` e o Ollama como `format`, e quem decide é `lerResolucao`.
 */
export function esquemaDaResolucao(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      resolucao: { type: 'string' },
      descartes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { trecho: { type: 'string' }, motivo: { type: 'string' } },
          required: ['trecho', 'motivo']
        }
      }
    },
    required: ['resolucao', 'descartes']
  }
}
