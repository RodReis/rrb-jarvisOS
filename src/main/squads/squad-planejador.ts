/**
 * O ciclo do planejamento do Squad: propor, validar, replanejar, cair no modelo da fase
 * (SPEC-Squads-02, critérios 3, 4 e 6).
 *
 * A pergunta que este arquivo responde: **de onde vem o plano aceito, e o que ficou pelo caminho?**
 * O orquestrador propõe; `validarPlano` decide (ADR-006, decisão 2); este arquivo só conduz o
 * ciclo e **registra tudo que o validador recusou**, porque a proposta rejeitada é exatamente o
 * fato que não pode sumir.
 *
 * Quatro decisões governam o desenho:
 *
 *  - **O contexto de validação nasce do snapshot e não muda.** `ContextoDeValidacao` é montado uma
 *    vez, do snapshot do perfil, e é o mesmo em toda tentativa: replanejar não tem como relaxar um
 *    limite (critério 3), e o mesmo snapshot com as mesmas respostas dá a mesma decisão (4).
 *  - **O limite é o da M9-F04, por gerador** (PI, 2026-10-02): o local tem até três propostas; se
 *    esgotá-las, a fase tem as suas três. No pior caso são seis, e então o run para para o PI.
 *  - **Indisponibilidade não gasta tentativa de validação.** Ollama fora do ar não é uma proposta
 *    ruim; é ausência de proposta, e a fase começa a contar do um.
 *  - **A auditoria leva o hash da proposta, nunca o texto.** Texto de modelo é o veículo natural
 *    do prompt injection; guardá-lo na cadeia imutável de auditoria seria perpetuá-lo.
 *
 * Nunca há API paga como fallback: o gerador da fase é o que o snapshot resolveu pela rota de
 * assinatura, e o perfil inelegível (camada paga sem opt-in) não chama ninguém.
 */

import { createHash } from 'node:crypto'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import { isRotaUnmetered } from '@shared/domain/ai'
import type { ContextoDeValidacao, Decisao, Rejeicao, SquadPlan } from '@shared/domain/squad-plano'
import { proximaTentativaPermitida } from '@shared/domain/attempt'
import { ESQUEMA_DO_PLANO_JSON } from '@shared/domain/squad-plano-esquema'
import { lerPlano, validarPlano } from '@shared/domain/squad-plano'
import type { BaseDaValidacao, SpecParaOPrompt } from './squad-prompt'
import type { DestinoDeAuditoria, EscopoDaAuditoria, SnapshotDoSquad } from './squad-snapshot'
import { feedbackDaDecisao, montarPedido } from './squad-prompt'
import { canonico } from './squad-snapshot'

/** `num_ctx` quando o perfil não declara um: o que a M11-F00 mediu no hardware do PI. */
export const NUM_CTX_PADRAO = 8_192

/**
 * Temperatura e semente do orquestrador local: as da M11-F00 (`temperatura 0`, `semente 42`). O que
 * se mediu lá precisa ser o que roda aqui — um 58,8% medido em uma configuração não descreve outra.
 */
export const TEMPERATURA_DO_PLANO = 0
export const SEMENTE_DO_PLANO = 42

export type OrigemDoGerador = 'local' | 'fase'

export interface PedidoAoGerador {
  readonly system: string
  readonly prompt: string
  /** O JSON Schema já serializado, para `format` (Ollama) ou `--json-schema` (CLI). */
  readonly jsonSchema: string
  /** Só o gerador local recebe; a fase não tem janela a declarar. */
  readonly numCtx?: number
  readonly temperatura?: number
  readonly semente?: number
  /** A tentativa dentro deste gerador, a partir de 1. */
  readonly tentativa: number
}

export type RespostaDoGerador =
  | { readonly ok: true; readonly texto: string }
  | { readonly ok: false; readonly motivo: 'INDISPONIVEL' | 'FALHOU'; readonly detalhe: string }

/** A porta do modelo. O planejador não conhece Ollama nem CLI: conhece quem responde ao pedido. */
export interface GeradorDePlano {
  readonly origem: OrigemDoGerador
  readonly modelo: ModeloEscolhido
  propor(pedido: PedidoAoGerador): Promise<RespostaDoGerador>
}

export interface DependenciasDoPlanejador {
  readonly geradorLocal?: GeradorDePlano
  readonly geradorFase: GeradorDePlano
  readonly auditoria: DestinoDeAuditoria
  readonly escopo: EscopoDaAuditoria
}

export interface EntradaDoPlanejamento {
  readonly runId: string
  /** A revisão (hash) da SPEC em que o plano se apoia. */
  readonly specRevisao: string
  readonly spec: SpecParaOPrompt
  readonly snapshot: SnapshotDoSquad
  readonly base: BaseDaValidacao
}

export interface TentativaDePlano {
  readonly gerador: OrigemDoGerador
  readonly tentativa: number
  readonly resultado: 'aceita' | 'rejeitada' | 'indisponivel'
  /** SHA-256 do texto proposto; ausente quando o gerador nem respondeu. */
  readonly hashDaProposta?: string
  readonly rejeicoes: readonly Rejeicao[]
}

export type ResultadoDoPlanejamento =
  | {
      readonly ok: true
      readonly plano: SquadPlan
      readonly planoHash: string
      readonly gerador: OrigemDoGerador
      readonly historico: readonly TentativaDePlano[]
    }
  | {
      readonly ok: false
      readonly motivo:
        | 'PLANO_REJEITADO'
        | 'GERADOR_INDISPONIVEL'
        | 'PERFIL_INELEGIVEL'
        | 'GERADORES_FORA_DO_SNAPSHOT'
      readonly historico: readonly TentativaDePlano[]
    }

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')

/** Quantos pontos de partida (`{`) a varredura tenta: texto adversarial cheio de chaves não trava. */
const MAX_PONTOS_DE_PARTIDA = 200

/** Onde fecha o objeto que abre em `ini`, respeitando string e escape; `-1` se não fecha. */
function fimDoObjeto(texto: string, ini: number): number {
  let profundidade = 0
  let emString = false
  let escapado = false
  for (let i = ini; i < texto.length; i++) {
    const c = texto[i]
    if (emString) {
      if (escapado) escapado = false
      else if (c === '\\') escapado = true
      else if (c === '"') emString = false
      continue
    }
    if (c === '"') emString = true
    else if (c === '{') profundidade++
    else if (c === '}' && --profundidade === 0) return i
  }
  return -1
}

/** Os objetos de topo balanceados de um texto: o que sobra quando se tira a prosa em volta. */
function objetosBalanceados(texto: string): string[] {
  const achados: string[] = []
  let de = 0
  for (let tentativa = 0; tentativa < MAX_PONTOS_DE_PARTIDA; tentativa++) {
    const ini = texto.indexOf('{', de)
    if (ini < 0) break
    const fim = fimDoObjeto(texto, ini)
    if (fim < 0) {
      de = ini + 1
      continue
    }
    achados.push(texto.slice(ini, fim + 1))
    de = fim + 1
  }
  return achados
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Tira o JSON da resposta: o texto inteiro e cada objeto de topo balanceado dentro dele. Modelo
 * local de 8B embrulha a saída com frequência — com prosa, com cerca de código, com chaves soltas
 * e às vezes com mais de um bloco —, e isso não é motivo para perder a proposta. A cerca de código
 * não precisa de tratamento próprio: o objeto dentro dela é um objeto de topo como outro qualquer.
 *
 * `aceita` escolhe, entre os objetos legíveis, o que o chamador quer (o que `lerPlano` entende);
 * se nenhum serve, devolve o primeiro legível, para o validador dizer por que ele não serve. O
 * esquema estrito em `lerPlano` continua sendo a barreira.
 */
export function extrairJson(
  texto: string,
  aceita: (valor: Record<string, unknown>) => boolean = () => true
): Record<string, unknown> | undefined {
  const candidatos = [texto.trim(), ...objetosBalanceados(texto)]

  const lidos: Record<string, unknown>[] = []
  for (const candidato of candidatos) {
    try {
      const valor = JSON.parse(candidato) as unknown
      if (ehObjeto(valor)) lidos.push(valor)
    } catch {
      continue
    }
  }
  return lidos.find(aceita) ?? lidos[0]
}

/** O hash do plano aceito, ligado ao run, à revisão da SPEC e à revisão do perfil. */
export function hashDoPlanoAceito(
  plano: SquadPlan,
  vinculos: { runId: string; specRevisao: string; perfilRevisao: string }
): string {
  return sha256(canonico({ plano, ...vinculos }))
}

/**
 * O contexto de validação, **copiado e congelado**. Os arrays que o chamador passou continuam
 * sendo dele: se mudassem no meio do ciclo, a tentativa seguinte seria julgada por limites
 * diferentes — exatamente o que o replanejamento não pode fazer (critério 3).
 */
function contextoDe(entrada: EntradaDoPlanejamento): ContextoDeValidacao {
  const { snapshot, spec, base } = entrada
  const congelada = <T>(lista: readonly T[]): readonly T[] => Object.freeze([...lista])
  return Object.freeze({
    criteriosDaSpec: congelada(spec.criterios.map((c) => c.numero)),
    riscosDaSpec: congelada(spec.riscos ?? []),
    perfil: snapshot.perfil,
    resolucao: snapshot.resolucao,
    pathsPermitidos: congelada(base.pathsPermitidos),
    fontesPermitidas: congelada(base.fontesPermitidas),
    arquivosDaBase: congelada(base.arquivosDaBase),
    orcamentoUsd: base.orcamentoUsd
  })
}

type Auditar = (
  tipo: 'squad-plan-rejeitado' | 'squad-plan-fallback' | 'squad-plan-aceito',
  payload: Record<string, unknown>
) => void

interface Rodada {
  readonly desfecho: 'aceito' | 'esgotado' | 'indisponivel'
  readonly resultado?: Extract<ResultadoDoPlanejamento, { ok: true }>
}

interface Contexto {
  readonly entrada: EntradaDoPlanejamento
  readonly historico: TentativaDePlano[]
  readonly auditar: Auditar
}

/** Registra e audita o plano aceito, com o hash ligado ao run, à SPEC e ao perfil. */
function registrarAceite(
  c: Contexto,
  gerador: GeradorDePlano,
  tentativa: number,
  hashDaProposta: string,
  plano: SquadPlan
): Extract<ResultadoDoPlanejamento, { ok: true }> {
  const { entrada, historico } = c
  const planoHash = hashDoPlanoAceito(plano, {
    runId: entrada.runId,
    specRevisao: entrada.specRevisao,
    perfilRevisao: entrada.snapshot.revisao
  })
  historico.push({
    gerador: gerador.origem,
    tentativa,
    resultado: 'aceita',
    hashDaProposta,
    rejeicoes: []
  })
  c.auditar('squad-plan-aceito', {
    runId: entrada.runId,
    specRevisao: entrada.specRevisao,
    perfilRevisao: entrada.snapshot.revisao,
    planoHash,
    gerador: gerador.origem,
    modelo: gerador.modelo,
    tentativas: historico.length
  })
  return { ok: true, plano, planoHash, gerador: gerador.origem, historico }
}

/** Registra e audita a proposta rejeitada — por hash e motivos, nunca pelo texto. */
function registrarRejeicao(
  c: Contexto,
  origem: OrigemDoGerador,
  tentativa: number,
  hashDaProposta: string,
  decisao: Decisao
): void {
  c.historico.push({
    gerador: origem,
    tentativa,
    resultado: 'rejeitada',
    hashDaProposta,
    rejeicoes: decisao.rejeicoes
  })
  c.auditar('squad-plan-rejeitado', {
    runId: c.entrada.runId,
    tentativa,
    gerador: origem,
    hashDaProposta,
    motivos: decisao.rejeicoes.map((r) => ({ motivo: r.motivo, tarefa: r.tarefa })),
    classificacoes: decisao.tarefas.map((t) => ({ id: t.id, classificacao: t.classificacao }))
  })
}

async function rodarGerador(
  gerador: GeradorDePlano,
  c: Contexto,
  ctx: ContextoDeValidacao
): Promise<Rodada> {
  const numCtx = gerador.origem === 'local' ? numCtxDoPerfil(c.entrada.snapshot) : undefined
  let feedback: string | undefined

  for (let tentativa = 1; ; tentativa++) {
    const pedido = montarPedido(c.entrada, feedback)
    const resposta = await gerador.propor({
      ...pedido,
      jsonSchema: ESQUEMA_DO_PLANO_JSON,
      ...(numCtx === undefined
        ? {}
        : { numCtx, temperatura: TEMPERATURA_DO_PLANO, semente: SEMENTE_DO_PLANO }),
      tentativa
    })

    if (!resposta.ok) {
      c.historico.push({
        gerador: gerador.origem,
        tentativa,
        resultado: 'indisponivel',
        rejeicoes: []
      })
      return { desfecho: 'indisponivel' }
    }

    const hashDaProposta = sha256(resposta.texto)
    const bruto = extrairJson(resposta.texto, (v) => lerPlano(v).plano !== undefined)
    const decisao = validarPlano(bruto ?? 'JSON ilegível', ctx)

    if (decisao.aceito) {
      const plano = lerPlano(bruto).plano as SquadPlan
      return {
        desfecho: 'aceito',
        resultado: registrarAceite(c, gerador, tentativa, hashDaProposta, plano)
      }
    }

    registrarRejeicao(c, gerador.origem, tentativa, hashDaProposta, decisao)
    if (!proximaTentativaPermitida(tentativa)) return { desfecho: 'esgotado' }
    feedback = feedbackDaDecisao(decisao.rejeicoes)
  }
}

function numCtxDoPerfil(snapshot: SnapshotDoSquad): number {
  const origem = snapshot.perfil.camadas.orquestrador
  return origem.origem === 'modelo' && origem.numCtx !== undefined ? origem.numCtx : NUM_CTX_PADRAO
}

/**
 * Quem tenta, em que ordem. O local só entra se o snapshot o resolveu como configurado **e** há um
 * gerador local; do contrário a troca para a fase é decidida aqui e auditada antes de qualquer
 * chamada, com o motivo que a resolução registrou.
 */
function ordemDosGeradores(
  deps: DependenciasDoPlanejador,
  entrada: EntradaDoPlanejamento,
  auditar: Auditar
): readonly GeradorDePlano[] {
  const camada = entrada.snapshot.resolucao.camadas.orquestrador
  const querLocal = entrada.snapshot.perfil.camadas.orquestrador.origem === 'modelo'

  if (!querLocal) return [deps.geradorFase]
  if (camada.estado === 'configurado' && deps.geradorLocal !== undefined) {
    return [deps.geradorLocal, deps.geradorFase]
  }
  auditar('squad-plan-fallback', {
    runId: entrada.runId,
    de: 'local',
    para: 'fase',
    motivo: camada.motivo ?? 'GERADOR_LOCAL_AUSENTE'
  })
  return [deps.geradorFase]
}

const mesmoModelo = (a: ModeloEscolhido, b: ModeloEscolhido): boolean =>
  a.provider === b.provider && a.modelo === b.modelo

/**
 * Os geradores são os que o snapshot resolveu? O comentário do módulo promete que o fallback é o
 * modelo da fase pela rota de assinatura, e a promessa só vale se for conferida: um chamador que
 * monte `geradorFase` com um modelo `anthropic` chamaria a rota paga sem que nada reclamasse.
 *
 *  - o gerador da fase usa exatamente o `modeloDaFase` do snapshot;
 *  - o gerador local, quando o perfil o quer, usa exatamente o modelo que a resolução aprovou;
 *  - a reserva (a fase) não é rota paga sem o opt-in do projeto — é o caso que a resolução não
 *    enxerga quando o orquestrador é o local: ele está configurado, e a fase só entra depois.
 */
function geradoresConferem(deps: DependenciasDoPlanejador, snapshot: SnapshotDoSquad): boolean {
  const { optInApiPaga } = snapshot.ambiente
  const permitido = (g: GeradorDePlano): boolean =>
    isRotaUnmetered(g.modelo.provider) || optInApiPaga

  if (
    !mesmoModelo(deps.geradorFase.modelo, snapshot.modeloDaFase) ||
    !permitido(deps.geradorFase)
  ) {
    return false
  }
  const orquestrador = snapshot.resolucao.camadas.orquestrador
  const querLocal = snapshot.perfil.camadas.orquestrador.origem === 'modelo'
  if (!querLocal || deps.geradorLocal === undefined || orquestrador.estado !== 'configurado') {
    return true
  }
  return (
    orquestrador.modelo !== undefined && mesmoModelo(deps.geradorLocal.modelo, orquestrador.modelo)
  )
}

export async function planejarSquad(
  deps: DependenciasDoPlanejador,
  entrada: EntradaDoPlanejamento
): Promise<ResultadoDoPlanejamento> {
  const historico: TentativaDePlano[] = []
  // Elegibilidade já inclui o orquestrador (squad-resolucao); a checagem direta da camada fica
  // como defesa em profundidade para um snapshot que chegue adulterado como elegível.
  const { resolucao } = entrada.snapshot
  if (!resolucao.elegivel || resolucao.camadas.orquestrador.estado === 'indisponivel') {
    return { ok: false, motivo: 'PERFIL_INELEGIVEL', historico }
  }
  if (!geradoresConferem(deps, entrada.snapshot)) {
    return { ok: false, motivo: 'GERADORES_FORA_DO_SNAPSHOT', historico }
  }

  const auditar: Auditar = (type, payload) => {
    deps.auditoria.append({
      user_id: deps.escopo.userId,
      workspace_id: deps.escopo.workspaceId,
      type,
      payload
    })
  }
  const ctx = contextoDe(entrada)
  const geradores = ordemDosGeradores(deps, entrada, auditar)

  let ultimo: Rodada['desfecho'] = 'esgotado'
  for (const [i, gerador] of geradores.entries()) {
    const rodada = await rodarGerador(gerador, { entrada, historico, auditar }, ctx)
    if (rodada.resultado !== undefined) return rodada.resultado
    ultimo = rodada.desfecho

    const proximo = geradores[i + 1]
    if (proximo !== undefined) {
      auditar('squad-plan-fallback', {
        runId: entrada.runId,
        de: gerador.origem,
        para: proximo.origem,
        motivo: rodada.desfecho === 'indisponivel' ? 'GERADOR_INDISPONIVEL' : 'LIMITE_DE_TENTATIVAS'
      })
    }
  }

  const motivo = ultimo === 'indisponivel' ? 'GERADOR_INDISPONIVEL' : 'PLANO_REJEITADO'
  return { ok: false, motivo, historico }
}
