/**
 * Validador mínimo do `SquadPlan` — a forma da M11-F00 (SPEC-Squads-00, regra 1).
 *
 * **Não é o validador da F02.** É o recorte que a prova precisa para dizer "aceito" ou
 * "rejeitado" com motivo, e é **congelado por hash antes da medição** (`congelar.mjs`): mexer
 * nele para fazer um modelo passar é o que a SPEC proíbe. Pura e determinística — o mesmo plano
 * e o mesmo contexto produzem a mesma decisão (critério 4).
 *
 * Nunca lança: plano malformado é desfecho previsto (saída de modelo local de 8B quebra com
 * frequência), e vira rejeição `SCHEMA` com o motivo, não exceção.
 */

export const PAPEIS = ['explorador', 'desenvolvedor', 'testador', 'revisor', 'integrador'] as const
export const CAMADAS = ['local', 'fase', 'premium'] as const

export type Papel = (typeof PAPEIS)[number]
export type Camada = (typeof CAMADAS)[number]

export interface TarefaDoPlano {
  readonly id: string
  readonly papel: Papel
  readonly capacidade: string
  readonly camada: Camada
  /** Só quem escreve tem dono; é o que o teto de escritores conta. */
  readonly escritor?: string
  readonly dependencias: readonly string[]
  readonly paths: readonly string[]
  /** Fundamento na SPEC: um critério de aceite (número) ou um risco declarado. */
  readonly fundamento: { readonly criterio?: number; readonly risco?: string }
  readonly regraDeConclusao: string
}

export interface SquadPlan {
  readonly tarefas: readonly TarefaDoPlano[]
}

/** O que o kernel sabe antes de o modelo falar: SPEC, perfil e orçamento da fatia. */
export interface ContextoDeValidacao {
  readonly criteriosDaSpec: readonly number[]
  readonly capacidadesPermitidas: readonly string[]
  readonly camadasPermitidas: readonly Camada[]
  readonly pathsPermitidos: readonly string[]
  readonly maxEscritores: number
  readonly maxTarefas: number
}

export type MotivoDeRejeicao =
  | 'SCHEMA'
  | 'ID_DUPLICADO'
  | 'DEPENDENCIA_INEXISTENTE'
  | 'CICLO'
  | 'CAPACIDADE_NAO_PERMITIDA'
  | 'CAMADA_NAO_PERMITIDA'
  | 'ESCRITORES_EXCEDIDOS'
  | 'ESCRITOR_SEM_PATH'
  | 'ESCRITORES_COLIDEM'
  | 'PATH_FORA_DO_ESCOPO'
  | 'SEM_FUNDAMENTO'
  | 'CRITERIO_INEXISTENTE'
  | 'NAO_COMPROVAVEL'
  | 'REDUNDANTE'
  | 'COBERTURA_INCOMPLETA'
  | 'ORCAMENTO_EXCEDIDO'

export interface Rejeicao {
  readonly motivo: MotivoDeRejeicao
  readonly tarefa?: string
  readonly detalhe: string
}

export interface Decisao {
  readonly aceito: boolean
  readonly rejeicoes: readonly Rejeicao[]
}

const ehTexto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const ehListaDeTexto = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Valida a forma e devolve o plano tipado, ou o porquê de não ser um plano. */
export function lerPlano(bruto: unknown): { plano?: SquadPlan; erro?: string } {
  if (typeof bruto !== 'object' || bruto === null) return { erro: 'o plano não é um objeto' }
  const tarefas = (bruto as { tarefas?: unknown }).tarefas
  if (!Array.isArray(tarefas) || tarefas.length === 0) return { erro: 'sem tarefas' }

  for (const [i, t] of tarefas.entries()) {
    const r = t as Record<string, unknown> | null
    const campo = (nome: string): string => `tarefa ${i}: campo ${nome} ausente ou inválido`
    if (typeof r !== 'object' || r === null) return { erro: `tarefa ${i} não é um objeto` }
    if (!ehTexto(r.id)) return { erro: campo('id') }
    if (!PAPEIS.includes(r.papel as Papel)) return { erro: campo('papel') }
    if (!ehTexto(r.capacidade)) return { erro: campo('capacidade') }
    if (!CAMADAS.includes(r.camada as Camada)) return { erro: campo('camada') }
    if (r.escritor !== undefined && r.escritor !== null && !ehTexto(r.escritor))
      return { erro: campo('escritor') }
    if (!ehListaDeTexto(r.dependencias)) return { erro: campo('dependencias') }
    if (!ehListaDeTexto(r.paths)) return { erro: campo('paths') }
    if (typeof r.fundamento !== 'object' || r.fundamento === null)
      return { erro: campo('fundamento') }
    if (typeof r.regraDeConclusao !== 'string') return { erro: campo('regraDeConclusao') }
  }

  const normalizadas = (tarefas as TarefaDoPlano[]).map((t) => ({
    ...t,
    escritor: t.escritor ?? undefined
  }))
  return { plano: { tarefas: normalizadas } }
}

/** Há ciclo se alguma tarefa se alcança seguindo as dependências (DFS com pilha de visita). */
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

const dentroDoEscopo = (path: string, permitidos: readonly string[]): boolean =>
  permitidos.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))

export function validarPlano(bruto: unknown, ctx: ContextoDeValidacao): Decisao {
  const lido = lerPlano(bruto)
  if (lido.plano === undefined) {
    return { aceito: false, rejeicoes: [{ motivo: 'SCHEMA', detalhe: lido.erro ?? 'inválido' }] }
  }

  const { tarefas } = lido.plano
  const rejeicoes: Rejeicao[] = []
  const rejeita = (motivo: MotivoDeRejeicao, detalhe: string, tarefa?: string): void => {
    rejeicoes.push({ motivo, detalhe, ...(tarefa === undefined ? {} : { tarefa }) })
  }

  if (tarefas.length > ctx.maxTarefas)
    rejeita('ORCAMENTO_EXCEDIDO', `${tarefas.length} tarefas; o teto é ${ctx.maxTarefas}`)

  const ids = new Set<string>()
  for (const t of tarefas) {
    if (ids.has(t.id)) rejeita('ID_DUPLICADO', `id ${t.id} repetido`, t.id)
    ids.add(t.id)
  }

  for (const t of tarefas) {
    for (const d of t.dependencias)
      if (!ids.has(d)) rejeita('DEPENDENCIA_INEXISTENTE', `depende de ${d}`, t.id)

    if (!ctx.capacidadesPermitidas.includes(t.capacidade))
      rejeita('CAPACIDADE_NAO_PERMITIDA', `capacidade ${t.capacidade}`, t.id)
    if (!ctx.camadasPermitidas.includes(t.camada))
      rejeita('CAMADA_NAO_PERMITIDA', `camada ${t.camada}`, t.id)

    for (const p of t.paths)
      if (!dentroDoEscopo(p, ctx.pathsPermitidos)) rejeita('PATH_FORA_DO_ESCOPO', p, t.id)

    if (t.escritor !== undefined && t.paths.length === 0)
      rejeita('ESCRITOR_SEM_PATH', `escritor ${t.escritor} sem path`, t.id)

    const { criterio, risco } = t.fundamento
    if (criterio === undefined && !ehTexto(risco))
      rejeita('SEM_FUNDAMENTO', 'sem critério nem risco', t.id)
    else if (criterio !== undefined && !ctx.criteriosDaSpec.includes(criterio))
      rejeita('CRITERIO_INEXISTENTE', `critério ${criterio} não existe na SPEC`, t.id)

    if (!ehTexto(t.regraDeConclusao)) rejeita('NAO_COMPROVAVEL', 'sem regra de conclusão', t.id)
  }

  const escritores = new Set(tarefas.flatMap((t) => (t.escritor === undefined ? [] : [t.escritor])))
  if (escritores.size > ctx.maxEscritores)
    rejeita('ESCRITORES_EXCEDIDOS', `${escritores.size} escritores; o teto é ${ctx.maxEscritores}`)

  // Dois donos diferentes no mesmo path = o conflito que o integrador existe para resolver;
  // o planejador não pode produzi-lo de propósito.
  const dono = new Map<string, string>()
  for (const t of tarefas) {
    if (t.escritor === undefined) continue
    for (const p of t.paths) {
      const atual = dono.get(p)
      if (atual !== undefined && atual !== t.escritor)
        rejeita('ESCRITORES_COLIDEM', `${p} é de ${atual} e de ${t.escritor}`, t.id)
      dono.set(p, t.escritor)
    }
  }

  // Redundante: mesmo papel, mesmo critério e mesmos paths — a segunda não acrescenta nada.
  const vistas = new Set<string>()
  for (const t of tarefas) {
    if (t.fundamento.criterio === undefined) continue
    const chave = `${t.papel}|${t.fundamento.criterio}|${[...t.paths].sort().join(',')}`
    if (vistas.has(chave)) rejeita('REDUNDANTE', `repete ${chave}`, t.id)
    vistas.add(chave)
  }

  const ciclo = achaCiclo(tarefas)
  if (ciclo !== undefined) rejeita('CICLO', `ciclo passando por ${ciclo}`)

  const cobertos = new Set(
    tarefas.flatMap((t) => (t.fundamento.criterio === undefined ? [] : [t.fundamento.criterio]))
  )
  const faltam = ctx.criteriosDaSpec.filter((c) => !cobertos.has(c))
  if (faltam.length > 0)
    rejeita('COBERTURA_INCOMPLETA', `critérios sem tarefa: ${faltam.join(', ')}`)

  return { aceito: rejeicoes.length === 0, rejeicoes }
}
