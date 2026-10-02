/**
 * O pool de execução: quantas fatias rodam ao mesmo tempo, e quem é a próxima (SPEC-Scheduler-01).
 *
 * A pergunta que este arquivo responde: **dado o que está ocupado e o que está esperando, quem
 * pode começar agora — e, para quem não pode, por quê?** É a V1 (`wip:global`, um slot) virando um
 * pool: capacidade configurável, limite por projeto, por executor e por classe de recurso, e uma
 * fila que alterna entre projetos sem deixar nenhum esperando para sempre.
 *
 * Cinco decisões governam o desenho:
 *
 *  - **Pura e determinística.** O mesmo estado dá a mesma decisão (regra 4): a ordem em que os
 *    itens chegam não importa, e o tempo entra como dado (`ultimoServidoEm`), nunca como leitura
 *    do relógio. É o que permite testar justiça com milhares de estados e reproduzir um bug.
 *  - **Capacidade livre não torna ninguém elegível** (regra 1). Os gates (aprovação do PI,
 *    dependências, prova de independência) chegam já resolvidos em `gatesAbertos`; este arquivo só
 *    reparte a *capacidade* entre quem já pode.
 *  - **O paralelismo é uma chave, e nasce desligada** (PI, 2026-10-02). O pool nasce com dois
 *    slots, mas até a M12-F03 entregar o isolamento — portas, container, assinatura — a capacidade
 *    efetiva é 1. Ligá-la é uma decisão explícita, não um efeito colateral de subir a configuração.
 *  - **Lease expirado ocupa o slot** até a reconciliação decidir (regra 3): a expiração pode ser
 *    máquina lenta, não processo morto, e dar o slot a outro run criaria dois executores no mesmo
 *    worktree.
 *  - **Quem espera sabe por quê.** Cada item fora do pool sai com um motivo estruturado (critério
 *    5) — limite global, do projeto, do executor, da classe, gate, precedência, prova de
 *    independência ou reconciliação pendente. Texto para a tela é problema de quem desenha a tela.
 *
 * Mora em `src/shared/domain`: pura, sem disco, sem relógio, verificável sem o Electron.
 */

/** Slots do pool, por padrão (SPEC-Scheduler-01, "Padrão V2: dois slots globais"). */
export const CAPACIDADE_GLOBAL_PADRAO = 2

/** Runs por projeto, por padrão. */
export const MAX_POR_PROJETO_PADRAO = 2

/**
 * O teto de slots que existem como recurso (`wip:slot:1` … `wip:slot:N`). Cada slot é um lease com
 * `UNIQUE` no banco, então a garantia de "nunca mais escritores que o limite" tem uma segunda
 * barreira fora do código: não existe recurso `wip:slot:9` para ser adquirido.
 */
export const CAPACIDADE_MAXIMA_DO_POOL = 8

/** O prefixo do recurso de cada slot. O `wip:global` da V1 deixa de existir como slot. */
export const PREFIXO_DO_SLOT = 'wip:slot:'

export const recursoDoSlot = (indice: number): string => `${PREFIXO_DO_SLOT}${indice}`
export const ehRecursoDeSlot = (recurso: string): boolean => recurso.startsWith(PREFIXO_DO_SLOT)

export interface ConfigDoPool {
  /** Slots do pool. */
  readonly capacidadeGlobal: number
  /** Runs simultâneos de um mesmo projeto. */
  readonly maxPorProjeto: number
  /**
   * Liga a execução em paralelo. **Desligada**, a capacidade efetiva é 1, qualquer que seja
   * `capacidadeGlobal`: a F03 (isolamento concorrente) é quem a liga.
   */
  readonly paralelismo: boolean
  /** Limite por executor (`claude-code`, `codex`): a mesma assinatura não aguenta N sessões. */
  readonly porExecutor: Readonly<Record<string, number>>
  /** Limite por classe de recurso (`docker`, `rede`): o que é escasso na máquina. */
  readonly porClasse: Readonly<Record<string, number>>
}

export const CONFIG_PADRAO: ConfigDoPool = {
  capacidadeGlobal: CAPACIDADE_GLOBAL_PADRAO,
  maxPorProjeto: MAX_POR_PROJETO_PADRAO,
  paralelismo: false,
  porExecutor: {},
  porClasse: {}
}

/** A capacidade que vale agora: com o paralelismo desligado, um slot, quantos houver configurados. */
export const capacidadeEfetiva = (config: ConfigDoPool): number =>
  config.paralelismo ? config.capacidadeGlobal : 1

/** O limite por projeto que vale agora, sempre dentro da capacidade efetiva. */
export const maxPorProjetoEfetivo = (config: ConfigDoPool): number =>
  Math.min(config.maxPorProjeto, capacidadeEfetiva(config))

export type ResultadoDaConfig =
  | { readonly ok: true; readonly config: ConfigDoPool }
  | { readonly ok: false; readonly erros: readonly string[] }

const ehInteiroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

const ehRegistro = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const CHAVE_DE_LIMITE = /^[A-Za-z0-9._-]{1,40}$/
const CHAVES_DA_CONFIG = [
  'capacidadeGlobal',
  'maxPorProjeto',
  'paralelismo',
  'porExecutor',
  'porClasse'
] as const

function validarLimites(bruto: unknown, nome: string, erros: string[]): Record<string, number> {
  if (bruto === undefined) return {}
  if (!ehRegistro(bruto)) {
    erros.push(`${nome} precisa ser um objeto`)
    return {}
  }
  const limites: Record<string, number> = {}
  for (const [chave, valor] of Object.entries(bruto)) {
    if (!CHAVE_DE_LIMITE.test(chave)) erros.push(`${nome}: chave ${chave} inválida`)
    else if (!ehInteiroEntre(valor, 1, CAPACIDADE_MAXIMA_DO_POOL)) {
      erros.push(`${nome}.${chave} precisa ser um inteiro entre 1 e ${CAPACIDADE_MAXIMA_DO_POOL}`)
    } else limites[chave] = valor
  }
  return limites
}

/**
 * Valida a configuração que veio de fora (IPC, banco). Devolve **todos** os erros, recusa chave
 * desconhecida e nunca lança. Nunca aceita capacidade 0 nem acima do teto: capacidade 0 pararia a
 * máquina inteira em silêncio, e acima do teto não há slot para ocupar.
 */
export function validarConfig(bruto: unknown): ResultadoDaConfig {
  if (!ehRegistro(bruto)) return { ok: false, erros: ['a configuração não é um objeto'] }

  const erros: string[] = []
  for (const chave of Object.keys(bruto)) {
    if (!(CHAVES_DA_CONFIG as readonly string[]).includes(chave)) {
      erros.push(`chave ${chave} não existe na configuração`)
    }
  }
  if (!ehInteiroEntre(bruto.capacidadeGlobal, 1, CAPACIDADE_MAXIMA_DO_POOL)) {
    erros.push(`capacidadeGlobal precisa ser um inteiro entre 1 e ${CAPACIDADE_MAXIMA_DO_POOL}`)
  }
  if (!ehInteiroEntre(bruto.maxPorProjeto, 1, CAPACIDADE_MAXIMA_DO_POOL)) {
    erros.push(`maxPorProjeto precisa ser um inteiro entre 1 e ${CAPACIDADE_MAXIMA_DO_POOL}`)
  }
  if (typeof bruto.paralelismo !== 'boolean') erros.push('paralelismo precisa ser booleano')

  const porExecutor = validarLimites(bruto.porExecutor, 'porExecutor', erros)
  const porClasse = validarLimites(bruto.porClasse, 'porClasse', erros)
  if (erros.length > 0) return { ok: false, erros }

  return {
    ok: true,
    config: {
      capacidadeGlobal: bruto.capacidadeGlobal as number,
      maxPorProjeto: bruto.maxPorProjeto as number,
      paralelismo: bruto.paralelismo as boolean,
      porExecutor,
      porClasse
    }
  }
}

/** Um run esperando por um slot. */
export interface ItemDaFila {
  readonly runId: string
  readonly projectId: string
  readonly sliceId: string
  /** A precedência explícita do roadmap: menor vai primeiro, dentro do projeto. */
  readonly prioridade: number
  /** Epoch ms de quando entrou na fila. A idade desempata; nunca fura a precedência. */
  readonly enfileiradoEm: number
  readonly executor?: string
  readonly classe?: string
  /** Os gates que ainda impedem o item (`aprovacao-do-pi`, `dependencia`, …). Vazio = elegível. */
  readonly gatesAbertos: readonly string[]
}

/** Um slot ocupado. `expirado` ainda ocupa: só a reconciliação o libera. */
export interface SlotOcupado {
  readonly runId: string
  readonly projectId: string
  readonly executor?: string
  readonly classe?: string
  readonly estado: 'vigente' | 'expirado'
}

export interface EstadoDoPool {
  readonly config: ConfigDoPool
  readonly itens: readonly ItemDaFila[]
  readonly ocupados: readonly SlotOcupado[]
  /** Quando cada projeto foi servido pela última vez. Ausente = nunca: tem a vez. */
  readonly ultimoServidoEm: Readonly<Record<string, number>>
}

export type MotivoDeEspera =
  | { readonly tipo: 'gate'; readonly gates: readonly string[] }
  | { readonly tipo: 'limite-global'; readonly ocupados: number; readonly limite: number }
  | { readonly tipo: 'paralelismo-desligado'; readonly ocupados: number }
  | { readonly tipo: 'limite-do-projeto'; readonly ocupados: number; readonly limite: number }
  | {
      readonly tipo: 'limite-do-executor'
      readonly executor: string
      readonly ocupados: number
      readonly limite: number
    }
  | {
      readonly tipo: 'limite-da-classe'
      readonly classe: string
      readonly ocupados: number
      readonly limite: number
    }
  | { readonly tipo: 'sem-prova-de-independencia' }
  | { readonly tipo: 'precedencia'; readonly aposRunId: string }
  | { readonly tipo: 'aguardando-reconciliacao'; readonly runIds: readonly string[] }

export interface ItemEmEspera {
  readonly runId: string
  /** Posição na ordem em que o pool atenderia, a partir de 1. */
  readonly posicao: number
  readonly motivo: MotivoDeEspera
}

export interface DecisaoDoPool {
  /** Quem adquire agora, na ordem. */
  readonly adquirir: readonly string[]
  /** Quem continua esperando, com o motivo. */
  readonly espera: readonly ItemEmEspera[]
  /** Os projetos servidos nesta decisão, para o chamador gravar `ultimoServidoEm`. */
  readonly servidos: readonly string[]
}

/**
 * Pode este item rodar **ao lado** dos que o projeto já tem ativos? É a prova de independência da
 * M12-F02. Até ela existir, o padrão é "não": o segundo run do mesmo projeto espera.
 */
export type ProvaDeIndependencia = (item: ItemDaFila, ativosDoProjeto: readonly string[]) => boolean

export const SEM_PROVA: ProvaDeIndependencia = () => false

const porPrecedencia = (a: ItemDaFila, b: ItemDaFila): number =>
  a.prioridade - b.prioridade ||
  a.enfileiradoEm - b.enfileiradoEm ||
  (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0)

const contar = (
  lista: readonly { readonly projectId: string; executor?: string; classe?: string }[]
): {
  global: number
  projeto: Map<string, number>
  executor: Map<string, number>
  classe: Map<string, number>
} => {
  const r = {
    global: lista.length,
    projeto: new Map<string, number>(),
    executor: new Map<string, number>(),
    classe: new Map<string, number>()
  }
  for (const s of lista) {
    r.projeto.set(s.projectId, (r.projeto.get(s.projectId) ?? 0) + 1)
    if (s.executor !== undefined) r.executor.set(s.executor, (r.executor.get(s.executor) ?? 0) + 1)
    if (s.classe !== undefined) r.classe.set(s.classe, (r.classe.get(s.classe) ?? 0) + 1)
  }
  return r
}

type Contagem = ReturnType<typeof contar>

/** Por que o item não cabe agora, ou `undefined` se cabe. A **primeira** causa, na ordem de peso. */
function bloqueio(
  item: ItemDaFila,
  c: Contagem,
  estado: EstadoDoPool,
  expirados: readonly string[],
  prova: ProvaDeIndependencia,
  ativosDoProjeto: readonly string[]
): MotivoDeEspera | undefined {
  const { config } = estado
  const limiteGlobal = capacidadeEfetiva(config)
  if (c.global >= limiteGlobal) {
    if (expirados.length > 0) return { tipo: 'aguardando-reconciliacao', runIds: expirados }
    return config.paralelismo
      ? { tipo: 'limite-global', ocupados: c.global, limite: limiteGlobal }
      : { tipo: 'paralelismo-desligado', ocupados: c.global }
  }

  const doProjeto = c.projeto.get(item.projectId) ?? 0
  const limiteDoProjeto = maxPorProjetoEfetivo(config)
  if (doProjeto >= limiteDoProjeto) {
    return { tipo: 'limite-do-projeto', ocupados: doProjeto, limite: limiteDoProjeto }
  }
  // Um segundo run do mesmo projeto só entra com prova de independência (M12-F02).
  if (doProjeto > 0 && !prova(item, ativosDoProjeto)) return { tipo: 'sem-prova-de-independencia' }

  if (item.executor !== undefined) {
    const limite = config.porExecutor[item.executor]
    const ocupados = c.executor.get(item.executor) ?? 0
    if (limite !== undefined && ocupados >= limite) {
      return { tipo: 'limite-do-executor', executor: item.executor, ocupados, limite }
    }
  }
  if (item.classe !== undefined) {
    const limite = config.porClasse[item.classe]
    const ocupados = c.classe.get(item.classe) ?? 0
    if (limite !== undefined && ocupados >= limite) {
      return { tipo: 'limite-da-classe', classe: item.classe, ocupados, limite }
    }
  }
  return undefined
}

/** Agrupa os itens elegíveis por projeto, cada grupo na ordem de precedência. */
function filasPorProjeto(itens: readonly ItemDaFila[]): Map<string, ItemDaFila[]> {
  const filas = new Map<string, ItemDaFila[]>()
  for (const item of [...itens].filter((i) => i.gatesAbertos.length === 0).sort(porPrecedencia)) {
    const fila = filas.get(item.projectId)
    if (fila === undefined) filas.set(item.projectId, [item])
    else fila.push(item)
  }
  return filas
}

/**
 * A vez de cada projeto: quem foi servido há mais tempo (ou nunca) vai primeiro, e quem já foi
 * servido **nesta** decisão vai depois dos demais. É isso que alterna entre projetos — e é o que
 * impede starvation: o projeto que acabou de ganhar um slot vai para o fim da fila de projetos.
 */
function chaveDaVez(
  projectId: string,
  cabeca: ItemDaFila,
  servidos: ReadonlySet<string>,
  ultimo: Readonly<Record<string, number>>
): readonly [number, number, number, string] {
  return [
    servidos.has(projectId) ? 1 : 0,
    ultimo[projectId] ?? Number.NEGATIVE_INFINITY,
    cabeca.enfileiradoEm,
    projectId
  ]
}

const compararChaves = (
  a: readonly [number, number, number, string],
  b: readonly [number, number, number, string]
): number =>
  a[0] - b[0] || (a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1) || a[2] - b[2] || (a[3] < b[3] ? -1 : 1)

/**
 * A ordem em que o pool atenderia os itens elegíveis se houvesse capacidade: alterna entre
 * projetos pela vez e respeita a precedência dentro de cada um. É a `posicao` de quem espera.
 */
function ordemDeAtendimento(
  filas: ReadonlyMap<string, readonly ItemDaFila[]>,
  ultimo: Readonly<Record<string, number>>
): readonly string[] {
  const indice = new Map<string, number>([...filas.keys()].map((p) => [p, 0]))
  const servidos = new Set<string>()
  const ordem: string[] = []
  for (;;) {
    const cabecas = [...filas.entries()]
      .filter(([p, fila]) => (indice.get(p) ?? 0) < fila.length)
      .map(([p, fila]) => ({ p, item: fila[indice.get(p) ?? 0] }))
    if (cabecas.length === 0) return ordem
    cabecas.sort((x, y) =>
      compararChaves(
        chaveDaVez(x.p, x.item, servidos, ultimo),
        chaveDaVez(y.p, y.item, servidos, ultimo)
      )
    )
    const { p, item } = cabecas[0]
    ordem.push(item.runId)
    indice.set(p, (indice.get(p) ?? 0) + 1)
    servidos.add(p)
  }
}

/** O item passa a ocupar um slot: atualiza as contagens que os limites consultam. */
function ocupar(
  contagem: Contagem,
  ativosPorProjeto: Map<string, string[]>,
  item: ItemDaFila
): void {
  const { projectId: p } = item
  contagem.global++
  contagem.projeto.set(p, (contagem.projeto.get(p) ?? 0) + 1)
  if (item.executor !== undefined) {
    contagem.executor.set(item.executor, (contagem.executor.get(item.executor) ?? 0) + 1)
  }
  if (item.classe !== undefined) {
    contagem.classe.set(item.classe, (contagem.classe.get(item.classe) ?? 0) + 1)
  }
  ativosPorProjeto.set(p, [...(ativosPorProjeto.get(p) ?? []), item.runId])
}

/**
 * Decide quem adquire agora e por que os demais esperam. Pura e determinística: a ordem de
 * `itens` e de `ocupados` não muda o resultado.
 *
 * Configuração reduzida **não** derruba run ativo (regra 2): se há mais ocupados que a capacidade,
 * ninguém novo entra até ficar abaixo do teto — e os ocupados continuam onde estão.
 */
export function decidirPool(
  estado: EstadoDoPool,
  prova: ProvaDeIndependencia = SEM_PROVA
): DecisaoDoPool {
  const filas = filasPorProjeto(estado.itens)
  const contagem = contar(estado.ocupados)
  const expirados = estado.ocupados
    .filter((o) => o.estado === 'expirado')
    .map((o) => o.runId)
    .sort()
  const ativosPorProjeto = new Map<string, string[]>()
  for (const o of estado.ocupados) {
    ativosPorProjeto.set(o.projectId, [...(ativosPorProjeto.get(o.projectId) ?? []), o.runId])
  }

  const adquirir: string[] = []
  const servidos = new Set<string>()
  const adquiridos = new Set<string>()
  const indice = new Map<string, number>([...filas.keys()].map((p) => [p, 0]))

  for (;;) {
    const admissiveis: { p: string; item: ItemDaFila }[] = []
    for (const [p, fila] of filas) {
      const item = fila[indice.get(p) ?? 0]
      if (item === undefined) continue
      const ativos = ativosPorProjeto.get(p) ?? []
      if (bloqueio(item, contagem, estado, expirados, prova, ativos) === undefined) {
        admissiveis.push({ p, item })
      }
    }
    if (admissiveis.length === 0) break

    admissiveis.sort((x, y) =>
      compararChaves(
        chaveDaVez(x.p, x.item, servidos, estado.ultimoServidoEm),
        chaveDaVez(y.p, y.item, servidos, estado.ultimoServidoEm)
      )
    )
    const { p, item } = admissiveis[0]
    adquirir.push(item.runId)
    adquiridos.add(item.runId)
    servidos.add(p)
    indice.set(p, (indice.get(p) ?? 0) + 1)
    ocupar(contagem, ativosPorProjeto, item)
  }

  return {
    adquirir,
    espera: explicarEspera(estado, filas, adquiridos, contagem, expirados, prova, ativosPorProjeto),
    servidos: [...servidos].sort()
  }
}

function explicarEspera(
  estado: EstadoDoPool,
  filas: ReadonlyMap<string, readonly ItemDaFila[]>,
  adquiridos: ReadonlySet<string>,
  contagem: Contagem,
  expirados: readonly string[],
  prova: ProvaDeIndependencia,
  ativosPorProjeto: ReadonlyMap<string, readonly string[]>
): readonly ItemEmEspera[] {
  const motivos = new Map<string, MotivoDeEspera>()

  for (const item of estado.itens) {
    if (item.gatesAbertos.length > 0)
      motivos.set(item.runId, { tipo: 'gate', gates: item.gatesAbertos })
  }
  for (const [p, fila] of filas) {
    const pendentes = fila.filter((i) => !adquiridos.has(i.runId))
    pendentes.forEach((item, i) => {
      motivos.set(
        item.runId,
        i === 0
          ? (bloqueio(item, contagem, estado, expirados, prova, ativosPorProjeto.get(p) ?? []) ?? {
              tipo: 'limite-global',
              ocupados: contagem.global,
              limite: capacidadeEfetiva(estado.config)
            })
          : { tipo: 'precedencia', aposRunId: pendentes[i - 1].runId }
      )
    })
  }

  const ordem = ordemDeAtendimento(filas, estado.ultimoServidoEm).filter(
    (id) => !adquiridos.has(id)
  )
  const bloqueados = estado.itens
    .filter((i) => i.gatesAbertos.length > 0)
    .sort(porPrecedencia)
    .map((i) => i.runId)

  return [...ordem, ...bloqueados].map((runId, i) => ({
    runId,
    posicao: i + 1,
    motivo: motivos.get(runId) as MotivoDeEspera
  }))
}

/** O fencing token de um lease confere com o que o dono apresenta? Só o token vigente confirma. */
export const tokenConfere = (tokenDoLease: number | undefined, apresentado: number): boolean =>
  tokenDoLease !== undefined && Number.isSafeInteger(apresentado) && tokenDoLease === apresentado
