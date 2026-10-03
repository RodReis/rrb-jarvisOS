/**
 * O que é puro na execução das tarefas do Squad (SPEC-Squads-03): quem é cada escritor no pool,
 * os estados em que uma tarefa termina e a leitura estrita do resultado que o agente devolve.
 *
 * **Nada aqui confia no agente.** O resultado é dado não confiável até o schema e o consumidor o
 * validarem (regra 4), e a evidência que ele cita só vale se o kernel a reconhece — um arquivo
 * que não está no `ContextPack` não é prova de nada, é texto inventado com cara de citação.
 */

import { sanitizar } from './preflight'
import { ehControleOuDirecao } from './squad-plano'

// ─── O escritor no pool ─────────────────────────────────────────────────────────────────────────

/** Separa o run do escritor no id do item do pool. O escritor nunca tem `:`, o run pode ter. */
export const SEPARADOR_DO_ESCRITOR = ':'

/** O mesmo formato restrito que o validador do plano exige de `escritor`. */
const ESCRITOR_SEGURO = /^[A-Za-z0-9_-]{1,32}$/

/** O id do item do pool de um escritor: lease e fencing token próprios, um slot por escritor. */
export const idDoEscritor = (runId: string, escritor: string): string =>
  `${runId}${SEPARADOR_DO_ESCRITOR}${escritor}`

/** Lê o id de volta, pelo **último** separador. `undefined` se não é id de escritor. */
export function lerIdDoEscritor(id: string): { runId: string; escritor: string } | undefined {
  const corte = id.lastIndexOf(SEPARADOR_DO_ESCRITOR)
  if (corte <= 0) return undefined
  const escritor = id.slice(corte + 1)
  if (!ESCRITOR_SEGURO.test(escritor)) return undefined
  return { runId: id.slice(0, corte), escritor }
}

export const ehItemDeEscritor = (id: string): boolean => lerIdDoEscritor(id) !== undefined

/**
 * Os escritores do mesmo run são irmãos: dividem uma issue, não competem por ela. A prova de
 * independência do pool existe para dois **runs** do mesmo projeto; entre irmãos ela não faz
 * sentido — mas só vale quando **todos** os ativos do projeto são irmãos do item, porque um run
 * de fora, ativo no mesmo projeto, continua pedindo a prova.
 */
export function irmaosNoPool(itemId: string, ativosDoProjeto: readonly string[]): boolean {
  const meu = lerIdDoEscritor(itemId)
  if (meu === undefined) return false
  return ativosDoProjeto.every((a) => lerIdDoEscritor(a)?.runId === meu.runId)
}

/**
 * Os pares de escritores cujo nome, depois de sanitizado, é o mesmo — ou que a sanitização
 * esvazia. `a_b` e `a-b` são ids válidos e distintos para o validador do plano, mas viram o mesmo
 * nome de container e de branch; sem esta checagem o segundo escritor reusaria o ambiente do
 * primeiro, que é a reutilização indevida que a SPEC proíbe.
 */
export function escritoresColidemPorNome(
  escritores: readonly string[]
): readonly (readonly [string, string])[] {
  const colisoes: [string, string][] = []
  const vistos = new Map<string, string>()
  for (const e of escritores) {
    const nome = sanitizar(e)
    if (nome === '') {
      colisoes.push([e, e])
      continue
    }
    const anterior = vistos.get(nome)
    if (anterior === undefined) vistos.set(nome, e)
    else colisoes.push([anterior, e])
  }
  return colisoes
}

// ─── Estados da tarefa ──────────────────────────────────────────────────────────────────────────

/**
 * Os estados de uma tarefa. Os sete finais são **terminais e auditáveis** (critério 4): cada um
 * diz por que a tarefa terminou, e nenhum é "presumido sucesso".
 *
 *  - `concluida`: resultado válido com a evidência exigida.
 *  - `incompleta`: resultado válido, sem a evidência exigida (regra 2).
 *  - `invalida`: a saída não passou no schema.
 *  - `timeout`: estourou o tempo do plano.
 *  - `cancelada`: o kernel ou o PI cancelou.
 *  - `falhou`: o executor falhou ou o escritor saiu do escopo.
 *  - `recusada`: nem chegou a rodar (limite, validação ou sandbox).
 */
export const ESTADOS_DA_TAREFA = [
  'pendente',
  'em-execucao',
  'concluida',
  'incompleta',
  'invalida',
  'timeout',
  'cancelada',
  'falhou',
  'recusada'
] as const
export type EstadoDaTarefa = (typeof ESTADOS_DA_TAREFA)[number]

const TERMINAIS: readonly EstadoDaTarefa[] = [
  'concluida',
  'incompleta',
  'invalida',
  'timeout',
  'cancelada',
  'falhou',
  'recusada'
]

export const ehEstadoTerminal = (estado: EstadoDaTarefa): boolean => TERMINAIS.includes(estado)

const TRANSICOES: Readonly<Record<EstadoDaTarefa, readonly EstadoDaTarefa[]>> = {
  // Antes de rodar só cabe começar, ou terminar sem ter rodado.
  pendente: ['em-execucao', 'recusada', 'cancelada'],
  // Rodando, qualquer final menos a recusa, que é a decisão anterior ao início.
  'em-execucao': ['concluida', 'incompleta', 'invalida', 'timeout', 'cancelada', 'falhou'],
  concluida: [],
  incompleta: [],
  invalida: [],
  timeout: [],
  cancelada: [],
  falhou: [],
  recusada: []
}

export const transicaoDaTarefaPermitida = (de: EstadoDaTarefa, para: EstadoDaTarefa): boolean =>
  TRANSICOES[de].includes(para)

// ─── Resultado da tarefa ────────────────────────────────────────────────────────────────────────

export const TIPOS_DE_EVIDENCIA = ['arquivo', 'trecho', 'teste', 'documento'] as const
export type TipoDeEvidencia = (typeof TIPOS_DE_EVIDENCIA)[number]

export const CONFIANCAS = ['alta', 'media', 'baixa'] as const
export type Confianca = (typeof CONFIANCAS)[number]

/**
 * O tipo de evidência que cada schema aceita. Um parecer pode citar documentação; um achado de
 * código, não — achado sem arquivo ou trecho é opinião.
 */
export const EVIDENCIA_EXIGIDA = {
  'achados@1': ['arquivo', 'trecho'],
  'parecer@1': ['arquivo', 'trecho', 'documento'],
  'resultado-de-testes@1': ['arquivo', 'trecho']
} as const satisfies Readonly<Record<string, readonly TipoDeEvidencia[]>>

export type SchemaDeResultado = keyof typeof EVIDENCIA_EXIGIDA

export interface EvidenciaDoResultado {
  readonly tipo: TipoDeEvidencia
  readonly referencia: string
  readonly detalhe?: string
}

/**
 * O que o agente devolve. **Sem `assinatura`**: ela é a impressão digital que deduplica o mesmo
 * achado (SPEC-Squads-04) e quem a calcula é o kernel, depois de validar — uma assinatura que o
 * agente escrevesse seria um campo livre para esconder um achado repetido ou fabricar um novo.
 */
export interface ResultadoDaTarefa {
  readonly schema: string
  readonly conclusao: string
  readonly evidencia: readonly EvidenciaDoResultado[]
  readonly confianca: Confianca
  readonly lacunas: readonly string[]
}

export interface ContextoDeLeitura {
  /** O `schemaDeResultado` da tarefa no plano. */
  readonly schemaEsperado: string
  /** Os caminhos que estão no `ContextPack` da tarefa: a única evidência de arquivo que vale. */
  readonly fontesDoPack: ReadonlySet<string>
}

export type AvaliacaoDoResultado =
  | {
      readonly estado: 'concluida'
      readonly resultado: ResultadoDaTarefa
      readonly descartadas: readonly string[]
    }
  | {
      readonly estado: 'incompleta'
      readonly resultado: ResultadoDaTarefa
      readonly motivo: string
      readonly descartadas: readonly string[]
    }
  | { readonly estado: 'invalida'; readonly motivo: string }

const CHAVES_DO_RESULTADO = ['schema', 'conclusao', 'evidencia', 'confianca', 'lacunas'] as const
const CHAVES_DA_EVIDENCIA = ['tipo', 'referencia', 'detalhe'] as const

const MAX_CONCLUSAO = 4000
const MAX_EVIDENCIAS = 50
const MAX_REFERENCIA = 300
const MAX_DETALHE = 500
const MAX_LACUNAS = 20
const MAX_LACUNA = 500

type Registro = Record<string, unknown>

const ehRegistro = (v: unknown): v is Registro =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const chavesExtras = (o: Registro, permitidas: readonly string[]): string[] =>
  Object.keys(o).filter((k) => !permitidas.includes(k))

const TABULACAO = 0x09
const QUEBRA_DE_LINHA = 0x0a
const RETORNO = 0x0d

/** Controle e override de direção, menos os três que texto legítimo tem: tab, LF e CR. */
function temCaractereProibido(texto: string, permiteQuebra: boolean): boolean {
  return Array.from(texto).some((ch) => {
    const cp = ch.codePointAt(0) ?? 0
    if (permiteQuebra && (cp === TABULACAO || cp === QUEBRA_DE_LINHA || cp === RETORNO))
      return false
    return ehControleOuDirecao(cp)
  })
}

function textoAte(v: unknown, max: number, permiteQuebra: boolean): string | undefined {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) return undefined
  return temCaractereProibido(v, permiteQuebra) ? undefined : v
}

const ehTipoDeEvidencia = (v: unknown): v is TipoDeEvidencia =>
  typeof v === 'string' && (TIPOS_DE_EVIDENCIA as readonly string[]).includes(v)
const ehConfianca = (v: unknown): v is Confianca =>
  typeof v === 'string' && (CONFIANCAS as readonly string[]).includes(v)
const ehSchemaConhecido = (v: string): v is SchemaDeResultado => Object.hasOwn(EVIDENCIA_EXIGIDA, v)

function lerEvidencia(
  bruta: unknown,
  i: number
): { evidencia?: EvidenciaDoResultado; erro?: string } {
  if (!ehRegistro(bruta)) return { erro: `evidência ${i} não é um objeto` }
  const extras = chavesExtras(bruta, CHAVES_DA_EVIDENCIA)
  if (extras.length > 0) return { erro: `evidência ${i}: chave ${extras[0]} não existe no esquema` }
  if (!ehTipoDeEvidencia(bruta.tipo)) return { erro: `evidência ${i}: tipo inválido` }
  const referencia = textoAte(bruta.referencia, MAX_REFERENCIA, false)
  if (referencia === undefined) return { erro: `evidência ${i}: referência inválida` }
  if (bruta.detalhe === undefined) return { evidencia: { tipo: bruta.tipo, referencia } }
  const detalhe = textoAte(bruta.detalhe, MAX_DETALHE, true)
  if (detalhe === undefined) return { erro: `evidência ${i}: detalhe inválido` }
  return { evidencia: { tipo: bruta.tipo, referencia, detalhe } }
}

function lerLacunas(bruta: unknown): { lacunas?: readonly string[]; erro?: string } {
  if (!Array.isArray(bruta) || bruta.length > MAX_LACUNAS) return { erro: 'lacunas inválidas' }
  const lacunas: string[] = []
  for (const [i, item] of Array.from(bruta as unknown[]).entries()) {
    const texto = textoAte(item, MAX_LACUNA, true)
    if (texto === undefined) return { erro: `lacuna ${i} inválida` }
    lacunas.push(texto)
  }
  return { lacunas }
}

/** A leitura estrita, na ordem em que o agente a escreveu. `erro` é a primeira razão da recusa. */
function lerCampos(
  bruto: unknown,
  ctx: ContextoDeLeitura
): { resultado?: ResultadoDaTarefa; erro?: string } {
  if (!ehRegistro(bruto)) return { erro: 'o resultado não é um objeto' }
  const extras = chavesExtras(bruto, CHAVES_DO_RESULTADO)
  if (extras.length > 0) return { erro: `chave ${extras[0]} não existe no esquema do resultado` }

  if (bruto.schema !== ctx.schemaEsperado || !ehSchemaConhecido(ctx.schemaEsperado)) {
    return { erro: `schema ${String(bruto.schema)} não é o da tarefa (${ctx.schemaEsperado})` }
  }
  const conclusao = textoAte(bruto.conclusao, MAX_CONCLUSAO, true)
  if (conclusao === undefined) return { erro: 'conclusão inválida' }
  if (!ehConfianca(bruto.confianca)) return { erro: 'confiança inválida' }
  if (!Array.isArray(bruto.evidencia) || bruto.evidencia.length > MAX_EVIDENCIAS) {
    return { erro: 'evidência inválida' }
  }

  const evidencia: EvidenciaDoResultado[] = []
  for (const [i, item] of Array.from(bruto.evidencia as unknown[]).entries()) {
    const lida = lerEvidencia(item, i)
    if (lida.evidencia === undefined) return { erro: lida.erro }
    evidencia.push(lida.evidencia)
  }
  const lacunas = lerLacunas(bruto.lacunas)
  if (lacunas.lacunas === undefined) return { erro: lacunas.erro }

  return {
    resultado: {
      schema: ctx.schemaEsperado,
      conclusao,
      evidencia,
      confianca: bruto.confianca,
      lacunas: lacunas.lacunas
    }
  }
}

/**
 * Arquivo, trecho e documento citam um caminho: só vale o que está no `ContextPack` da tarefa.
 * `teste` e `documento` fora do pacote seriam texto livre do agente, que o kernel não consegue
 * conferir — evidência que qualquer resposta forja não é evidência.
 */
const CITA_CAMINHO: readonly TipoDeEvidencia[] = ['arquivo', 'trecho', 'documento']

/**
 * Avalia o que o agente devolveu. `invalida` quando a forma está errada; `incompleta` quando a
 * forma está certa mas **nenhuma evidência** sobrevive ao filtro (tipo que o schema não aceita, ou
 * arquivo que não está no pacote) — regra 2: resultado sem a evidência exigida não é sucesso.
 */
export function avaliarResultado(bruto: unknown, ctx: ContextoDeLeitura): AvaliacaoDoResultado {
  const lido = lerCampos(bruto, ctx)
  if (lido.resultado === undefined) return { estado: 'invalida', motivo: lido.erro ?? 'inválido' }

  const aceitos = EVIDENCIA_EXIGIDA[lido.resultado.schema as SchemaDeResultado] as readonly string[]
  const validas: EvidenciaDoResultado[] = []
  const descartadas: string[] = []
  for (const e of lido.resultado.evidencia) {
    const noPacote = !CITA_CAMINHO.includes(e.tipo) || ctx.fontesDoPack.has(e.referencia)
    if (aceitos.includes(e.tipo) && noPacote) validas.push(e)
    else descartadas.push(e.referencia)
  }

  const resultado = { ...lido.resultado, evidencia: validas }
  if (validas.length === 0) {
    return {
      estado: 'incompleta',
      resultado,
      motivo: `sem evidência válida (aceita: ${aceitos.join(', ')})`,
      descartadas
    }
  }
  return { estado: 'concluida', resultado, descartadas }
}

// ─── Assinatura ─────────────────────────────────────────────────────────────────────────────────

const normalizar = (texto: string): string => texto.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * O texto canônico de que o kernel tira a assinatura (o hash mora no `main`: o domínio não toca
 * `crypto`). O mesmo achado dito de outro jeito — espaço, caixa, ordem ou repetição da evidência —
 * dá o mesmo texto; a confiança e as lacunas ficam de fora, porque um achado dito com mais ou
 * menos certeza é o mesmo achado.
 */
export function textoDaAssinatura(resultado: ResultadoDaTarefa): string {
  const evidencias = [
    ...new Set(resultado.evidencia.map((e) => `${e.tipo}:${e.referencia}`))
  ].sort()
  return JSON.stringify([resultado.schema, normalizar(resultado.conclusao), evidencias])
}

// ─── Trechos de uma busca ───────────────────────────────────────────────────────────────────────

export interface FaixaDeLinhas {
  readonly de: number
  readonly ate: number
}

/** O contexto de cada lado de uma ocorrência: o bastante para entender o trecho, sem trazer o arquivo. */
export const LINHAS_DE_CONTEXTO_DA_BUSCA = 5

/** As linhas do texto, cada uma com o seu fim de linha. O resto sem quebra no fim também é linha. */
function linhasDoTexto(texto: string): string[] {
  return texto.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

export const totalDeLinhas = (texto: string): number => linhasDoTexto(texto).length

/**
 * As faixas que cobrem as ocorrências, cada uma com `contexto` linhas de cada lado. Faixas que se
 * tocam viram uma só: duas ocorrências a três linhas uma da outra são um trecho, não dois com
 * linhas repetidas. Ocorrência fora do arquivo é ignorada.
 */
export function faixasDaBusca(
  linhas: readonly number[],
  total: number,
  contexto: number = LINHAS_DE_CONTEXTO_DA_BUSCA
): readonly FaixaDeLinhas[] {
  const ordenadas = linhas.filter((l) => l >= 1 && l <= total).sort((a, b) => a - b)
  const faixas: { de: number; ate: number }[] = []
  for (const linha of ordenadas) {
    const de = Math.max(1, linha - contexto)
    const ate = Math.min(total, linha + contexto)
    const anterior = faixas[faixas.length - 1]
    if (anterior !== undefined && de <= anterior.ate + 1) anterior.ate = ate
    else faixas.push({ de, ate })
  }
  return faixas
}

/** O texto da faixa, com o fim de linha original. A faixa é limitada pelo tamanho do texto. */
export function recortarLinhas(texto: string, faixa: FaixaDeLinhas): string {
  return linhasDoTexto(texto)
    .slice(faixa.de - 1, faixa.ate)
    .join('')
}
