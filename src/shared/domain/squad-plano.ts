/**
 * O `SquadPlan` e o validador determinístico (SPEC-Squads-02).
 *
 * A pergunta que este arquivo responde: **esta proposta do orquestrador cabe na SPEC, no perfil e
 * no orçamento?** O orquestrador — local ou da fase — *propõe*; quem decide é este validador, que
 * é função pura do plano e do contexto (ADR-006, decisão 2). Texto do agente nunca substitui
 * validação estrutural (regra 1): o plano é lido por um esquema **estrito**, e tudo que ele traz
 * além do esquema é recusado, não ignorado.
 *
 * Três decisões governam o desenho:
 *
 *  - **O plano não concede nada.** Permissão, camada, número de escritores e capacidades vêm do
 *    perfil (F01); o plano só escolhe *dentro* delas. É isso que faz o prompt injection não criar
 *    tarefa, permissão nem escritor (critério 5): um documento envenenado pode induzir o modelo a
 *    escrever qualquer coisa, e nada do que ele escrever amplia o que o perfil permite.
 *  - **`capacidade` é a disciplina que a tarefa exerce, e o papel limita quais** (PI, 2026-10-02):
 *    o registro da F01 não tem "implementação", então `CAPACIDADES_DO_PAPEL` declara o que cada
 *    papel exerce, e o desenvolvedor exerce `arquitetura` e `testes`.
 *  - **Todos os motivos, não só o primeiro.** O orquestrador recebe a lista inteira no
 *    replanejamento; devolver um motivo por vez transformaria o limite de tentativas em fila.
 *
 * Mora em `src/shared/domain`: pura, sem disco nem rede. Quem lista os arquivos da base e quem
 * calcula o hash do plano aceito é o `src/main`.
 */

import type { CapacidadeId } from './squad-capacidades'
import type { PerfilDeSquad } from './squad-perfil'
import type { ResolucaoDoPerfil } from './squad-resolucao'
import { calcularCustoUsd, isRotaUnmetered } from './ai'
import { REGISTRO_DE_CAPACIDADES, isCapacidadeId } from './squad-capacidades'
import { isCamada, limitesDoPerfil } from './squad-perfil'

export const PAPEIS = ['explorador', 'desenvolvedor', 'testador', 'revisor', 'integrador'] as const
export type Papel = (typeof PAPEIS)[number]

/** Os papéis que escrevem no worktree. Os demais só leem (ADR-006, decisão 5). */
export const PAPEIS_QUE_ESCREVEM: readonly Papel[] = ['desenvolvedor', 'integrador']

/** O que cada papel exerce (PI, 2026-10-02). Dado versionado: mudar é decisão, não refatoração. */
export const CAPACIDADES_DO_PAPEL: Readonly<Record<Papel, readonly CapacidadeId[]>> = {
  explorador: ['analise', 'pesquisa-documental'],
  desenvolvedor: ['arquitetura', 'testes'],
  testador: ['testes'],
  revisor: ['revisao-de-codigo', 'revisao-de-design'],
  integrador: ['analise', 'arquitetura']
}

export interface LimitesDaTarefa {
  readonly maxTurnos: number
  readonly maxMinutos: number
  readonly maxTokensEntrada: number
  readonly maxTokensSaida: number
}

export interface TarefaDoPlano {
  readonly id: string
  readonly papel: Papel
  /** String livre na leitura: `deploy` é uma capacidade que o modelo pode inventar, e o validador a recusa. */
  readonly capacidade: string
  readonly camada: string
  /** Só quem escreve tem dono; é o que o teto de escritores conta. */
  readonly escritor?: string
  /** Fontes de leitura mínimas da tarefa. */
  readonly entradas: readonly string[]
  readonly dependencias: readonly string[]
  /** O que a tarefa escreve. Vazio para quem só lê. */
  readonly paths: readonly string[]
  readonly schemaDeResultado: string
  readonly limites: LimitesDaTarefa
  /** Fundamento na SPEC: um critério de aceite (número) ou um risco declarado. */
  readonly fundamento: { readonly criterio?: number; readonly risco?: string }
  readonly regraDeConclusao: string
}

export interface SquadPlan {
  readonly tarefas: readonly TarefaDoPlano[]
}

/** O que o kernel sabe antes de o modelo falar. */
export interface ContextoDeValidacao {
  readonly criteriosDaSpec: readonly number[]
  readonly perfil: PerfilDeSquad
  readonly resolucao: ResolucaoDoPerfil
  /** Diretórios em que uma tarefa pode escrever. */
  readonly pathsPermitidos: readonly string[]
  /** Diretórios e arquivos que uma tarefa pode ler. */
  readonly fontesPermitidas: readonly string[]
  /** Os arquivos da base — para um path "novo" ser distinguido de um path inventado (Emenda E1). */
  readonly arquivosDaBase: readonly string[]
  /** Teto de custo do plano em USD. Rota de assinatura e local não entram na conta. */
  readonly orcamentoUsd: number
}

export type MotivoDeRejeicao =
  | 'SCHEMA'
  | 'ID_DUPLICADO'
  | 'DEPENDENCIA_INEXISTENTE'
  | 'CICLO'
  | 'CAPACIDADE_FORA_DO_PERFIL'
  | 'CAMADA_FORA_DO_PERFIL'
  | 'CAPACIDADE_FORA_DO_PAPEL'
  | 'CAPACIDADE_INDISPONIVEL'
  | 'SCHEMA_DE_RESULTADO_DIVERGENTE'
  | 'REVISOR_FORA_DA_CAMADA'
  | 'INTEGRADOR_FORA_DO_PERFIL'
  | 'ESCRITORES_EXCEDIDOS'
  | 'SEM_ESCRITOR'
  | 'ESCRITOR_SEM_PATH'
  | 'ESCRITOR_EM_PAPEL_DE_LEITURA'
  | 'PAPEL_DE_ESCRITA_SEM_ESCRITOR'
  | 'ESCRITORES_COLIDEM'
  | 'PATH_FORA_DO_ESCOPO'
  | 'FONTE_FORA_DO_ESCOPO'
  | 'PATH_INEXISTENTE'
  | 'SEM_FUNDAMENTO'
  | 'CRITERIO_INEXISTENTE'
  | 'NAO_COMPROVAVEL'
  | 'REDUNDANTE'
  | 'COBERTURA_INCOMPLETA'
  | 'LIMITE_INVALIDO'
  | 'TURNOS_EXCEDIDOS'
  | 'TEMPO_EXCEDIDO'
  | 'TOKENS_EXCEDIDOS'
  | 'ORCAMENTO_EXCEDIDO'

export interface Rejeicao {
  readonly motivo: MotivoDeRejeicao
  readonly tarefa?: string
  readonly detalhe: string
}

/** A classificação de cada proposta (SPEC-Squads-02, "Dentro"). */
export type ClassificacaoDaTarefa = 'valida' | 'redundante' | 'fora-de-escopo' | 'nao-comprovavel'

export interface Decisao {
  readonly aceito: boolean
  readonly rejeicoes: readonly Rejeicao[]
  readonly tarefas: readonly {
    readonly id: string
    readonly classificacao: ClassificacaoDaTarefa
  }[]
}

// ─── Leitura estrita ────────────────────────────────────────────────────────────────────────────

const CHAVES_DO_PLANO = ['tarefas'] as const
const CHAVES_DA_TAREFA = [
  'id',
  'papel',
  'capacidade',
  'camada',
  'escritor',
  'entradas',
  'dependencias',
  'paths',
  'schemaDeResultado',
  'limites',
  'fundamento',
  'regraDeConclusao'
] as const
const CHAVES_DOS_LIMITES = [
  'maxTurnos',
  'maxMinutos',
  'maxTokensEntrada',
  'maxTokensSaida'
] as const
const CHAVES_DO_FUNDAMENTO = ['criterio', 'risco'] as const

type Registro = Record<string, unknown>

const ehRegistro = (v: unknown): v is Registro =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const ehTexto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const ehListaDeTexto = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && Array.from(v as unknown[]).every((x) => typeof x === 'string')

const chavesExtras = (o: Registro, permitidas: readonly string[]): string[] =>
  Object.keys(o).filter((k) => !permitidas.includes(k))

/** Por que este campo não é o que o esquema pede, ou `undefined` se é. */
function problemaDoCampo(t: Registro): string | undefined {
  if (!ehTexto(t.id)) return 'id'
  if (!(PAPEIS as readonly unknown[]).includes(t.papel)) return 'papel'
  if (!ehTexto(t.capacidade)) return 'capacidade'
  if (!ehTexto(t.camada)) return 'camada'
  if (t.escritor !== undefined && t.escritor !== null && !ehTexto(t.escritor)) return 'escritor'
  for (const campo of ['entradas', 'dependencias', 'paths'] as const) {
    if (!ehListaDeTexto(t[campo])) return campo
  }
  if (typeof t.schemaDeResultado !== 'string') return 'schemaDeResultado'
  if (typeof t.regraDeConclusao !== 'string') return 'regraDeConclusao'
  return undefined
}

function problemaDosAninhados(t: Registro): string | undefined {
  const { limites, fundamento } = t
  if (!ehRegistro(limites) || chavesExtras(limites, CHAVES_DOS_LIMITES).length > 0) return 'limites'
  if (CHAVES_DOS_LIMITES.some((k) => typeof limites[k] !== 'number')) return 'limites'
  if (!ehRegistro(fundamento) || chavesExtras(fundamento, CHAVES_DO_FUNDAMENTO).length > 0) {
    return 'fundamento'
  }
  if (fundamento.criterio !== undefined && !Number.isInteger(fundamento.criterio))
    return 'fundamento'
  if (fundamento.risco !== undefined && typeof fundamento.risco !== 'string') return 'fundamento'
  return undefined
}

function lerTarefa(bruto: unknown, i: number): { tarefa?: TarefaDoPlano; erro?: string } {
  if (!ehRegistro(bruto)) return { erro: `tarefa ${i} não é um objeto` }
  const extras = chavesExtras(bruto, CHAVES_DA_TAREFA)
  if (extras.length > 0) return { erro: `tarefa ${i}: chave ${extras[0]} não existe no esquema` }

  const ruim = problemaDoCampo(bruto) ?? problemaDosAninhados(bruto)
  if (ruim !== undefined) return { erro: `tarefa ${i}: campo ${ruim} ausente ou inválido` }

  const t = bruto as unknown as Record<string, never>
  return {
    tarefa: {
      id: t.id,
      papel: t.papel,
      capacidade: t.capacidade,
      camada: t.camada,
      ...(typeof bruto.escritor === 'string' ? { escritor: bruto.escritor } : {}),
      entradas: Array.from(t.entradas as string[]),
      dependencias: Array.from(t.dependencias as string[]),
      paths: Array.from(t.paths as string[]),
      schemaDeResultado: t.schemaDeResultado,
      limites: { ...(bruto.limites as unknown as LimitesDaTarefa) },
      fundamento: { ...(bruto.fundamento as { criterio?: number; risco?: string }) },
      regraDeConclusao: t.regraDeConclusao
    }
  }
}

/**
 * Lê o plano com esquema estrito e o devolve **só com os campos do esquema**. Nunca lança: saída
 * de modelo local quebra com frequência, e isso é desfecho previsto, não exceção.
 */
export function lerPlano(bruto: unknown): { plano?: SquadPlan; erro?: string } {
  if (!ehRegistro(bruto)) return { erro: 'o plano não é um objeto' }
  const extras = chavesExtras(bruto, CHAVES_DO_PLANO)
  if (extras.length > 0) return { erro: `chave ${extras[0]} não existe no esquema do plano` }
  if (!Array.isArray(bruto.tarefas) || bruto.tarefas.length === 0) return { erro: 'sem tarefas' }

  const tarefas: TarefaDoPlano[] = []
  for (const [i, item] of Array.from(bruto.tarefas as unknown[]).entries()) {
    const lida = lerTarefa(item, i)
    if (lida.tarefa === undefined) return { erro: lida.erro ?? `tarefa ${i} inválida` }
    tarefas.push(lida.tarefa)
  }
  return { plano: { tarefas } }
}

// ─── Validação ──────────────────────────────────────────────────────────────────────────────────

type Coletor = (motivo: MotivoDeRejeicao, detalhe: string, tarefa?: string) => void

/** Normaliza `a\b/./c` e recusa o que sai da raiz: absoluto, `~` e `..`. `undefined` = inválido. */
function normalizar(caminho: string): string | undefined {
  const limpo = caminho.replace(/\\/g, '/')
  if (limpo.startsWith('/') || limpo.startsWith('~') || /^[A-Za-z]:/.test(limpo)) return undefined
  const partes = limpo.split('/').filter((p) => p !== '' && p !== '.')
  return partes.includes('..') || partes.length === 0 ? undefined : partes.join('/')
}

function dentroDoEscopo(caminho: string, permitidos: readonly string[]): boolean {
  const alvo = normalizar(caminho)
  if (alvo === undefined) return false
  return permitidos.some((p) => {
    const base = normalizar(p)
    return base !== undefined && (alvo === base || alvo.startsWith(`${base}/`))
  })
}

const extensaoDe = (caminho: string): string => {
  const nome = caminho.split('/').pop() ?? ''
  const ponto = nome.lastIndexOf('.')
  return ponto > 0 ? nome.slice(ponto) : ''
}

/**
 * O path existe na base, ou é arquivo novo com extensão que a base já tem (Emenda E1). Path
 * inventado — extensão de outra stack, sem extensão — não passa.
 */
function pathPlausivel(caminho: string, base: readonly string[]): boolean {
  const alvo = normalizar(caminho)
  if (alvo === undefined) return false
  if (base.some((f) => f === alvo || f.startsWith(`${alvo}/`))) return true
  const ext = extensaoDe(alvo)
  return ext !== '' && base.some((f) => extensaoDe(f) === ext)
}

function achaCiclo(tarefas: readonly TarefaDoPlano[]): string | undefined {
  const deps = new Map(tarefas.map((t) => [t.id, t.dependencias]))
  const estado = new Map<string, 'visitando' | 'feito'>()

  const visita = (id: string): string | undefined => {
    if (estado.get(id) === 'feito') return undefined
    if (estado.get(id) === 'visitando') return id
    estado.set(id, 'visitando')
    for (const d of deps.get(id) ?? []) {
      const achou = visita(d)
      if (achou !== undefined) return achou
    }
    estado.set(id, 'feito')
    return undefined
  }

  for (const t of tarefas) {
    const achou = visita(t.id)
    if (achou !== undefined) return achou
  }
  return undefined
}

function validarCapacidadeECamada(
  t: TarefaDoPlano,
  ctx: ContextoDeValidacao,
  rejeita: Coletor
): void {
  const noPerfil = ctx.perfil.capacidades.find((c) => c.id === t.capacidade)
  if (noPerfil === undefined || !isCapacidadeId(t.capacidade)) {
    rejeita('CAPACIDADE_FORA_DO_PERFIL', `capacidade ${t.capacidade} não está no perfil`, t.id)
    return
  }
  if (!CAPACIDADES_DO_PAPEL[t.papel].includes(t.capacidade)) {
    rejeita('CAPACIDADE_FORA_DO_PAPEL', `${t.papel} não exerce ${t.capacidade}`, t.id)
  }
  if (!isCamada(t.camada) || !noPerfil.camadas.includes(t.camada)) {
    rejeita('CAMADA_FORA_DO_PERFIL', `${t.capacidade} não roda em ${t.camada}`, t.id)
    return
  }
  const resolvida = ctx.resolucao.capacidades
    .find((c) => c.capacidade === t.capacidade)
    ?.porCamada.find((c) => c.camada === t.camada)
  if (resolvida?.estado === 'indisponivel') {
    rejeita(
      'CAPACIDADE_INDISPONIVEL',
      `${t.capacidade} em ${t.camada}: ${resolvida.motivo ?? '?'}`,
      t.id
    )
  }
  if (t.schemaDeResultado !== REGISTRO_DE_CAPACIDADES[t.capacidade].schemaDeResultado) {
    rejeita(
      'SCHEMA_DE_RESULTADO_DIVERGENTE',
      `esperado ${REGISTRO_DE_CAPACIDADES[t.capacidade].schemaDeResultado}`,
      t.id
    )
  }
}

function validarPapel(t: TarefaDoPlano, perfil: PerfilDeSquad, rejeita: Coletor): void {
  const escreve = PAPEIS_QUE_ESCREVEM.includes(t.papel)
  if (escreve && t.escritor === undefined) {
    rejeita('PAPEL_DE_ESCRITA_SEM_ESCRITOR', `${t.papel} precisa de um escritor dono`, t.id)
  }
  if (!escreve && (t.escritor !== undefined || t.paths.length > 0)) {
    rejeita('ESCRITOR_EM_PAPEL_DE_LEITURA', `${t.papel} só lê; sem escritor e sem paths`, t.id)
  }
  if (t.escritor !== undefined && t.paths.length === 0) {
    rejeita('ESCRITOR_SEM_PATH', `escritor ${t.escritor} sem path`, t.id)
  }
  if (t.papel === 'revisor' && t.camada !== perfil.revisor.camada) {
    rejeita('REVISOR_FORA_DA_CAMADA', `o revisor roda em ${perfil.revisor.camada}`, t.id)
  }
  if (t.papel === 'integrador' && t.camada !== perfil.integrador?.camada) {
    rejeita('INTEGRADOR_FORA_DO_PERFIL', 'o perfil não tem integrador nesta camada', t.id)
  }
}

function validarEscopo(t: TarefaDoPlano, ctx: ContextoDeValidacao, rejeita: Coletor): void {
  for (const p of t.paths) {
    if (!dentroDoEscopo(p, ctx.pathsPermitidos)) rejeita('PATH_FORA_DO_ESCOPO', p, t.id)
    else if (!pathPlausivel(p, ctx.arquivosDaBase)) rejeita('PATH_INEXISTENTE', p, t.id)
  }
  for (const e of t.entradas) {
    if (!dentroDoEscopo(e, ctx.fontesPermitidas)) rejeita('FONTE_FORA_DO_ESCOPO', e, t.id)
  }
}

function validarFundamento(t: TarefaDoPlano, ctx: ContextoDeValidacao, rejeita: Coletor): void {
  const { criterio, risco } = t.fundamento
  if (criterio === undefined && !ehTexto(risco))
    rejeita('SEM_FUNDAMENTO', 'sem critério nem risco', t.id)
  else if (criterio !== undefined && !ctx.criteriosDaSpec.includes(criterio)) {
    rejeita('CRITERIO_INEXISTENTE', `critério ${criterio} não existe na SPEC`, t.id)
  }
  if (!ehTexto(t.regraDeConclusao)) rejeita('NAO_COMPROVAVEL', 'sem regra de conclusão', t.id)
}

function validarLimites(t: TarefaDoPlano, perfil: PerfilDeSquad, rejeita: Coletor): void {
  const l = t.limites
  const teto = perfil.limites
  if (CHAVES_DOS_LIMITES.some((k) => !Number.isInteger(l[k]) || l[k] <= 0)) {
    rejeita('LIMITE_INVALIDO', 'turnos, minutos e tokens precisam ser inteiros positivos', t.id)
    return
  }
  if (l.maxTurnos > teto.maxTurnosPorTarefa)
    rejeita('TURNOS_EXCEDIDOS', `${l.maxTurnos} > ${teto.maxTurnosPorTarefa}`, t.id)
  if (l.maxMinutos > teto.maxMinutosPorTarefa)
    rejeita('TEMPO_EXCEDIDO', `${l.maxMinutos} > ${teto.maxMinutosPorTarefa}`, t.id)
  if (
    l.maxTokensEntrada > teto.maxTokensEntradaPorTarefa ||
    l.maxTokensSaida > teto.maxTokensSaidaPorTarefa
  ) {
    rejeita('TOKENS_EXCEDIDOS', 'tokens acima do perfil', t.id)
  }
}

function validarEscritores(
  tarefas: readonly TarefaDoPlano[],
  perfil: PerfilDeSquad,
  rejeita: Coletor
): void {
  const escritores = new Set(tarefas.flatMap((t) => (t.escritor === undefined ? [] : [t.escritor])))
  if (escritores.size === 0) rejeita('SEM_ESCRITOR', 'nenhuma tarefa tem escritor dono')
  if (escritores.size > perfil.escritores) {
    rejeita(
      'ESCRITORES_EXCEDIDOS',
      `${escritores.size} escritores; o perfil permite ${perfil.escritores}`
    )
  }
  // Dois donos no mesmo path é o conflito que o integrador existe para resolver; o planejador
  // não pode produzi-lo de propósito.
  const dono = new Map<string, string>()
  for (const t of tarefas) {
    if (t.escritor === undefined) continue
    for (const p of t.paths) {
      const atual = dono.get(p)
      if (atual !== undefined && atual !== t.escritor) {
        rejeita('ESCRITORES_COLIDEM', `${p} é de ${atual} e de ${t.escritor}`, t.id)
      }
      dono.set(p, t.escritor)
    }
  }
}

function validarGrafo(tarefas: readonly TarefaDoPlano[], rejeita: Coletor): void {
  const ids = new Set<string>()
  for (const t of tarefas) {
    if (ids.has(t.id)) rejeita('ID_DUPLICADO', `id ${t.id} repetido`, t.id)
    ids.add(t.id)
  }
  for (const t of tarefas) {
    for (const d of t.dependencias) {
      if (!ids.has(d)) rejeita('DEPENDENCIA_INEXISTENTE', `depende de ${d}`, t.id)
    }
  }
  const ciclo = achaCiclo(tarefas)
  if (ciclo !== undefined) rejeita('CICLO', `ciclo passando por ${ciclo}`)
}

function validarCoberturaERedundancia(
  tarefas: readonly TarefaDoPlano[],
  ctx: ContextoDeValidacao,
  rejeita: Coletor
): void {
  const vistas = new Set<string>()
  for (const t of tarefas) {
    if (t.fundamento.criterio === undefined) continue
    const chave = `${t.papel}|${t.fundamento.criterio}|${[...t.paths].sort().join(',')}`
    if (vistas.has(chave)) rejeita('REDUNDANTE', `repete ${chave}`, t.id)
    vistas.add(chave)
  }
  const cobertos = new Set(
    tarefas.flatMap((t) => (t.fundamento.criterio === undefined ? [] : [t.fundamento.criterio]))
  )
  const faltam = ctx.criteriosDaSpec.filter((c) => !cobertos.has(c))
  if (faltam.length > 0)
    rejeita('COBERTURA_INCOMPLETA', `critérios sem tarefa: ${faltam.join(', ')}`)
}

function validarOrcamento(
  tarefas: readonly TarefaDoPlano[],
  ctx: ContextoDeValidacao,
  rejeita: Coletor
): void {
  const { maxTarefas } = limitesDoPerfil(ctx.perfil, ctx.criteriosDaSpec.length)
  if (tarefas.length > maxTarefas) {
    rejeita('ORCAMENTO_EXCEDIDO', `${tarefas.length} tarefas; o teto é ${maxTarefas}`)
  }
  const total = tarefas.reduce((soma, t) => {
    const modelo = isCamada(t.camada) ? ctx.resolucao.camadas[t.camada].modelo : undefined
    if (modelo === undefined || isRotaUnmetered(modelo.provider)) return soma
    return (
      soma +
      calcularCustoUsd(modelo.provider, modelo.modelo, {
        tokensEntrada: t.limites.maxTokensEntrada,
        tokensSaida: t.limites.maxTokensSaida
      })
    )
  }, 0)
  if (total > ctx.orcamentoUsd) {
    rejeita(
      'ORCAMENTO_EXCEDIDO',
      `custo estimado US$ ${total.toFixed(4)} > US$ ${ctx.orcamentoUsd}`
    )
  }
}

/** Por motivo, a classe da proposta. A mais grave vence: fora de escopo, depois não comprovável. */
const CLASSE_DO_MOTIVO: Partial<Record<MotivoDeRejeicao, ClassificacaoDaTarefa>> = {
  PATH_FORA_DO_ESCOPO: 'fora-de-escopo',
  FONTE_FORA_DO_ESCOPO: 'fora-de-escopo',
  PATH_INEXISTENTE: 'fora-de-escopo',
  CAPACIDADE_FORA_DO_PERFIL: 'fora-de-escopo',
  CAMADA_FORA_DO_PERFIL: 'fora-de-escopo',
  CAPACIDADE_FORA_DO_PAPEL: 'fora-de-escopo',
  CRITERIO_INEXISTENTE: 'fora-de-escopo',
  INTEGRADOR_FORA_DO_PERFIL: 'fora-de-escopo',
  REVISOR_FORA_DA_CAMADA: 'fora-de-escopo',
  SEM_FUNDAMENTO: 'nao-comprovavel',
  NAO_COMPROVAVEL: 'nao-comprovavel',
  SCHEMA_DE_RESULTADO_DIVERGENTE: 'nao-comprovavel',
  LIMITE_INVALIDO: 'nao-comprovavel',
  REDUNDANTE: 'redundante'
}
const PRECEDENCIA: readonly ClassificacaoDaTarefa[] = [
  'fora-de-escopo',
  'nao-comprovavel',
  'redundante'
]

function classificar(
  tarefas: readonly TarefaDoPlano[],
  rejeicoes: readonly Rejeicao[]
): Decisao['tarefas'] {
  return tarefas.map((t) => {
    const classes = rejeicoes
      .filter((r) => r.tarefa === t.id)
      .map((r) => CLASSE_DO_MOTIVO[r.motivo])
    const classificacao = PRECEDENCIA.find((c) => classes.includes(c)) ?? 'valida'
    return { id: t.id, classificacao }
  })
}

/**
 * A decisão do kernel sobre uma proposta. Pura e determinística: mesmo plano e mesmo contexto,
 * mesma decisão (critério 4). Não altera nada do que recebe.
 */
export function validarPlano(bruto: unknown, ctx: ContextoDeValidacao): Decisao {
  const lido = lerPlano(bruto)
  if (lido.plano === undefined) {
    return {
      aceito: false,
      rejeicoes: [{ motivo: 'SCHEMA', detalhe: lido.erro ?? 'inválido' }],
      tarefas: []
    }
  }

  const { tarefas } = lido.plano
  const rejeicoes: Rejeicao[] = []
  const rejeita: Coletor = (motivo, detalhe, tarefa) => {
    rejeicoes.push({ motivo, detalhe, ...(tarefa === undefined ? {} : { tarefa }) })
  }

  validarGrafo(tarefas, rejeita)
  for (const t of tarefas) {
    validarCapacidadeECamada(t, ctx, rejeita)
    validarPapel(t, ctx.perfil, rejeita)
    validarEscopo(t, ctx, rejeita)
    validarFundamento(t, ctx, rejeita)
    validarLimites(t, ctx.perfil, rejeita)
  }
  validarEscritores(tarefas, ctx.perfil, rejeita)
  validarCoberturaERedundancia(tarefas, ctx, rejeita)
  validarOrcamento(tarefas, ctx, rejeita)

  return { aceito: rejeicoes.length === 0, rejeicoes, tarefas: classificar(tarefas, rejeicoes) }
}
