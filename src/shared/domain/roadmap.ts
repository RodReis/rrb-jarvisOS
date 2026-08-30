/**
 * O roadmap do projeto: MVPs, fatias e o DAG entre eles (SPEC-Planejamento-06).
 *
 * A pergunta que este arquivo responde: **em que ordem as coisas podem ser feitas, e o que ainda
 * não pode?**
 *
 * O DAG é a resposta, e o critério 1 exige que ele **não contenha ciclo nem dependência
 * ausente**. As duas checagens moram aqui, puras, porque são a definição de "roadmap válido" —
 * não um detalhe do serviço que o monta. Um ciclo não é erro de digitação: é um roadmap em que
 * nada pode começar, e detectá-lo depois de escrever os arquivos seria descobrir tarde.
 *
 * **`Mvp` e `Slice` compõem, não geram** (decisão do PI, 2026-08-30) — mesma postura da M8-F04.
 * Cada um carrega `origem` obrigatória, e as origens são as mesmas duas: `decisao` (o PI
 * respondeu no wizard) e `evidencia` (foi extraído de fonte externa). **Não existe origem
 * "modelo"**, e é isso que impede o roadmap de propor um MVP que ninguém decidiu.
 *
 * **O que este arquivo não faz:** não escreve `STATUS.md`, não calcula hash de arquivo, não
 * consulta banco. Só descreve a forma do roadmap e as regras puras sobre ele.
 */

import type { WorkspaceId } from './entities'
import type { OrigemDaAfirmacao } from './pacote-estrutural'

/**
 * O estado de um MVP na fila.
 *
 * `proposto` é o default e o critério 3: *"MVP futuro permanece proposta até entrar na fila"*.
 * A transição para `na-fila` é o gate `MVP_ENTRY` — um ato do PI, nunca consequência de gerar o
 * roadmap. Sem os dois estados, "planejado" e "aprovado para execução" seriam a mesma coisa, e
 * o critério 3 não teria como valer.
 */
export const ESTADOS_DO_MVP = ['proposto', 'na-fila', 'concluido'] as const

export type EstadoDoMvp = (typeof ESTADOS_DO_MVP)[number]

/**
 * Um MVP do roadmap do projeto gerado.
 *
 * `dependeDe` guarda ids de outros MVPs. Lista e não um único id porque um MVP pode depender de
 * dois — e achatar isso obrigaria a inventar uma ordem entre dependências que o PI não decidiu.
 */
export interface Mvp {
  readonly id: string
  readonly numero: number
  readonly titulo: string
  /** A tese: o que este MVP entrega. Composta, nunca gerada. */
  readonly tese: string
  readonly estado: EstadoDoMvp
  readonly dependeDe: readonly string[]
  readonly origem: OrigemDaAfirmacao
}

/**
 * Uma fatia de um MVP — a unidade executável.
 *
 * `specSlug` é o par que a invariante 1 protege: *"`STATUS.md` é a fonte única do par Fatia ↔
 * SPEC"*. Ele nasce aqui e é **escrito** no STATUS; nenhuma outra estrutura o guarda em paralelo,
 * porque duas fontes divergiriam no dia em que uma mudasse.
 */
export interface Slice {
  readonly id: string
  readonly mvpId: string
  readonly numero: number
  readonly titulo: string
  /** O slug da SPEC correspondente. Só a próxima fatia tem spec executável (§ Saídas). */
  readonly specSlug: string
  /** `true` só na próxima fatia da fila: é a única que ganha SPEC detalhada. */
  readonly detalhada: boolean
  readonly origem: OrigemDaAfirmacao
}

/** O roadmap inteiro: os MVPs, as fatias e a ordem topológica que o DAG permite. */
export interface Roadmap {
  readonly mvps: readonly Mvp[]
  readonly slices: readonly Slice[]
}

/**
 * Por que o DAG é inválido. Enum fechado: a tela decide o que mostrar a partir dele, e um
 * problema novo no roadmap é mudança de contrato.
 */
export const PROBLEMAS_DO_DAG = ['ciclo', 'dependencia-ausente', 'auto-dependencia'] as const

export type ProblemaDoDag = (typeof PROBLEMAS_DO_DAG)[number]

/**
 * Um problema encontrado no DAG, com **os ids envolvidos**.
 *
 * Os ids são obrigatórios porque "há um ciclo" não é acionável: o PI precisa saber *qual*
 * ciclo para desfazê-lo. É a mesma postura de `pendenciasDoPrd` — nomear em vez de sinalizar.
 */
export interface ProblemaEncontrado {
  readonly problema: ProblemaDoDag
  /** Os MVPs envolvidos. No ciclo, na ordem em que ele se fecha. */
  readonly envolvidos: readonly string[]
  readonly mensagem: string
}

/**
 * Valida o DAG: ciclo, dependência ausente e auto-dependência (critério 1).
 *
 * Devolve **todos** os problemas, não o primeiro: um roadmap com dois ciclos corrigido um de
 * cada vez faria o PI descobrir o segundo só na tentativa seguinte.
 *
 * A detecção de ciclo é DFS com marcação tri-estado (branco/cinza/preto) — encontrar um nó
 * *cinza* significa voltar a um ancestral do caminho atual, que é a definição de ciclo. Um
 * `visited` booleano simples não distinguiria "já visitei por outro caminho" de "está no caminho
 * atual", e reportaria ciclo onde há só um losango.
 */
export function validarDag(mvps: readonly Mvp[]): readonly ProblemaEncontrado[] {
  const problemas: ProblemaEncontrado[] = []
  const porId = new Map(mvps.map((m) => [m.id, m]))

  for (const mvp of mvps) {
    for (const dep of mvp.dependeDe) {
      if (dep === mvp.id) {
        problemas.push({
          problema: 'auto-dependencia',
          envolvidos: [mvp.id],
          mensagem: `"${mvp.titulo}" depende de si mesmo.`
        })
        continue
      }
      if (!porId.has(dep)) {
        problemas.push({
          problema: 'dependencia-ausente',
          envolvidos: [mvp.id, dep],
          mensagem: `"${mvp.titulo}" depende de "${dep}", que não existe no roadmap.`
        })
      }
    }
  }

  // Branco = não visitado; cinza = no caminho atual; preto = fechado.
  const cor = new Map<string, 'cinza' | 'preto'>()
  const caminho: string[] = []
  const ciclosVistos = new Set<string>()

  function visitar(id: string): void {
    const atual = cor.get(id)
    if (atual === 'preto') return
    if (atual === 'cinza') {
      // Fechou o ciclo: recorta o trecho do caminho a partir de onde este id entrou.
      const inicio = caminho.indexOf(id)
      const ciclo = [...caminho.slice(inicio), id]
      // Normaliza para não reportar o mesmo ciclo uma vez por ponto de entrada.
      const chave = [...ciclo].slice(0, -1).sort().join('>')
      if (!ciclosVistos.has(chave)) {
        ciclosVistos.add(chave)
        problemas.push({
          problema: 'ciclo',
          envolvidos: ciclo,
          mensagem: `Ciclo de dependência: ${ciclo.map((c) => porId.get(c)?.titulo ?? c).join(' → ')}.`
        })
      }
      return
    }

    cor.set(id, 'cinza')
    caminho.push(id)
    for (const dep of porId.get(id)?.dependeDe ?? []) {
      // Auto-dependência já foi reportada acima, com categoria própria. Deixá-la seguir aqui a
      // acusaria uma segunda vez como `ciclo` — o mesmo fato com dois nomes, e o PI procurando
      // dois problemas onde há um.
      if (dep !== id && porId.has(dep)) visitar(dep)
    }
    caminho.pop()
    cor.set(id, 'preto')
  }

  for (const mvp of mvps) visitar(mvp.id)

  return problemas
}

/**
 * A ordem em que os MVPs podem ser executados — ordenação topológica.
 *
 * Devolve `undefined` quando o DAG é inválido, em vez de uma ordem parcial: uma lista
 * incompleta pareceria uma resposta e o chamador seguiria com ela. Quem quer saber *por que*
 * chama `validarDag`.
 *
 * Empate é desfeito pelo `numero`, e não pela ordem de inserção: a numeração é do PI, e usar a
 * ordem do array faria a fila mudar por causa de como o roadmap foi montado.
 */
export function ordemDeExecucao(mvps: readonly Mvp[]): readonly string[] | undefined {
  if (validarDag(mvps).length > 0) return undefined

  const porId = new Map(mvps.map((m) => [m.id, m]))
  const pendentes = new Map(mvps.map((m) => [m.id, m.dependeDe.filter((d) => porId.has(d)).length]))
  const ordem: string[] = []

  while (ordem.length < mvps.length) {
    const prontos = mvps
      .filter((m) => pendentes.get(m.id) === 0)
      .sort((a, b) => a.numero - b.numero)

    // O DAG já foi validado, então isto não acontece — mas parar é melhor que laçar para sempre.
    if (prontos.length === 0) return undefined

    for (const pronto of prontos) {
      ordem.push(pronto.id)
      pendentes.delete(pronto.id)
      for (const m of mvps) {
        if (m.dependeDe.includes(pronto.id)) {
          pendentes.set(m.id, (pendentes.get(m.id) ?? 1) - 1)
        }
      }
    }
  }

  return ordem
}

/**
 * A próxima fatia a detalhar: a primeira não detalhada do primeiro MVP na fila.
 *
 * **Uma só**, e é a § Saídas literal: *"SPEC executável somente da próxima fatia"*. Detalhar o
 * roadmap inteiro produziria specs para fatias cujo contexto ainda vai mudar — e o custo não é
 * o texto desperdiçado, é o PI aprovando o que não vai valer.
 */
export function proximaFatia(roadmap: Roadmap): Slice | undefined {
  const ordem = ordemDeExecucao(roadmap.mvps)
  if (ordem === undefined) return undefined

  for (const mvpId of ordem) {
    const mvp = roadmap.mvps.find((m) => m.id === mvpId)
    if (mvp === undefined || mvp.estado === 'concluido') continue

    const fatia = roadmap.slices
      .filter((s) => s.mvpId === mvpId && !s.detalhada)
      .sort((a, b) => a.numero - b.numero)[0]

    if (fatia !== undefined) return fatia
  }

  return undefined
}

/** Type guard de fronteira: o IPC recebe `unknown`. */
export function isEstadoDoMvp(valor: unknown): valor is EstadoDoMvp {
  return typeof valor === 'string' && (ESTADOS_DO_MVP as readonly string[]).includes(valor)
}

/** O escopo de um projeto no roadmap gerado. Usado pelo repositório e pela tela. */
export interface RoadmapDoProjeto {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly roadmap: Roadmap
}
