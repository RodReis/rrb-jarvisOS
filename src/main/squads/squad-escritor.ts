/**
 * O executor de um escritor isolado (SPEC-Squads-03, critérios 1, 2, 4, 5 e 6).
 *
 * Um escritor ocupa **um slot do pool** (decisão 1 do PI), trabalha **no próprio worktree**, e o
 * **kernel** — não o agente — prova o que ele fez e o registra:
 *
 *  1. espera a vez no pool e recebe o fencing token (regra 5: nunca roda fora do pool);
 *  2. prepara o sandbox e adota o worktree, fixando o gitdir do host antes de o agente rodar;
 *  3. roda o agente, com prazo, cancelamento e heartbeat do slot — perder o lease aborta o agente;
 *  4. confere o token (o dono antigo não confirma progresso), lê o diff do worktree e o prova
 *     contra o write set: fora do escopo, link simbólico ou nome inválido reprova tudo;
 *  5. valida o resultado do agente — dado não confiável — e só então **commita**, pelo kernel;
 *  6. solta o slot, sempre: o próximo da fila não espera por quem falhou.
 *
 * Todo caminho termina num **estado terminal auditado**, e nenhum estado é presumido sucesso:
 * resultado sem evidência é `incompleta`, e sem commit não há `concluida`. O que não foi commitado
 * fica no worktree, que o resultado nomeia: limpar é da limpeza (`remover` não usa `--force`).
 */

import { createHash } from 'node:crypto'
import type { ContextPack } from '@shared/domain/context-pack'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import type { PathsPermitidos } from '@shared/domain/preflight'
import { avaliarEscopoDoEscritor } from '@shared/domain/squad-escopo'
import {
  avaliarResultado,
  idDoEscritor,
  lerIdDoEscritor,
  textoDaAssinatura,
  type EstadoDaTarefa,
  type ResultadoDaTarefa,
  type SchemaDeResultado
} from '@shared/domain/squad-execucao'
import { normalizar, type TarefaDoPlano } from '@shared/domain/squad-plano'
import { ehSchemaDeResultado } from '@shared/domain/squad-resultado-esquema'
import type { FonteDaTarefa } from '../context/context-service'
import type { AuditRepository } from '../storage/audit-repository'
import { extrairJsonFinal } from './squad-planejador'
import { recusaDaTentativa, recusaDoContexto, recusaDosLimites } from './squad-recusas'
import type { SquadGit, WorktreeDeEscritor } from './squad-git'
import type { GerenteDeSlots } from './squad-slots'
import { montarPromptDoEscritor } from './squad-worker-prompt'

const MS_POR_MINUTO = 60_000
/** O heartbeat bate três vezes por validade do lease: uma perdida ainda não derruba o dono. */
const BATIDAS_POR_VALIDADE = 3
const MAX_MOTIVO_AUDITADO = 160

// ─── Portas ─────────────────────────────────────────────────────────────────────────────────────

export interface PedidoDeSandbox {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly sliceId: string
  readonly escritor: string
  /** A tarefa que o sandbox atende: um escritor com duas tarefas tem dois ambientes, não um. */
  readonly tarefaId: string
  readonly tentativa: number
  readonly repositorio: string
  readonly baseSha: string
  readonly pathsPermitidos: PathsPermitidos
  /** O pack que autoriza as chamadas de modelo desta unidade: o proxy a roteia por ele. */
  readonly contextPackId: string
}

/** O ambiente isolado do escritor: um worktree próprio e, em produção, o container dele. */
export interface SandboxDoEscritor {
  /** Devolve o worktree **já adotado** (gitdir do host fixado), ou o motivo de não ter nascido. */
  preparar(
    pedido: PedidoDeSandbox
  ): Promise<{ ok: true; worktree: WorktreeDeEscritor } | { ok: false; motivo: string }>
  /** Derruba o que o escritor usou (o container). O worktree em disco não é tocado aqui. */
  encerrar(pedido: PedidoDeSandbox): Promise<void>
}

export interface PedidoAoAgente {
  readonly worktree: WorktreeDeEscritor
  readonly system: string
  readonly prompt: string
  readonly limites: TarefaDoPlano['limites']
  /** O modelo da camada da tarefa, resolvido pelo snapshot do Squad. */
  readonly modelo: ModeloEscolhido
  /** O sinal que o executor aborta ao estourar o prazo, ao cancelar ou ao perder o lease. */
  readonly signal: AbortSignal
}

/** O agente que edita arquivos no worktree. Devolve o texto final; o que ele fez, o kernel prova. */
export interface AgenteDoEscritor {
  executar(
    pedido: PedidoAoAgente
  ): Promise<{ ok: true; texto: string } | { ok: false; motivo: string }>
}

export interface DependenciasDoEscritor {
  readonly git: Pick<SquadGit, 'alteracoes' | 'commitar' | 'remover'>
  readonly slots: Pick<GerenteDeSlots, 'adquirir' | 'renovar' | 'confirmar' | 'liberar'>
  readonly sandbox: SandboxDoEscritor
  readonly agente: AgenteDoEscritor
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  readonly agora?: () => number
  /** Quanto tempo entre as batidas do heartbeat. Padrão: um terço da validade do lease. */
  readonly intervaloDoHeartbeatMs?: number
}

// ─── Pedido e resultado ─────────────────────────────────────────────────────────────────────────

export interface PedidoDoEscritor {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly sliceId: string
  readonly escritor: string
  readonly tarefa: Pick<
    TarefaDoPlano,
    | 'id'
    | 'papel'
    | 'capacidade'
    | 'camada'
    | 'escritor'
    | 'paths'
    | 'schemaDeResultado'
    | 'limites'
    | 'regraDeConclusao'
  >
  readonly objetivo: string
  readonly contexto: { readonly pack: ContextPack; readonly fontes: readonly FonteDaTarefa[] }
  /** O modelo da camada da tarefa, resolvido pelo snapshot do Squad. */
  readonly modelo: ModeloEscolhido
  readonly repositorio: string
  /** O SHA de onde o worktree nasce e contra o qual o diff é provado. */
  readonly baseSha: string
  /** A partir de 1. */
  readonly tentativa: number
  readonly signal?: AbortSignal
}

export interface ResultadoDoEscritor {
  readonly estado: Exclude<EstadoDaTarefa, 'pendente' | 'em-execucao'>
  readonly motivo?: string
  readonly resultado?: ResultadoDaTarefa
  readonly assinatura?: string
  readonly descartadas: readonly string[]
  /** Só em `concluida`: o commit do kernel. */
  readonly commitSha?: string
  /** O que o kernel provou dentro do write set. */
  readonly arquivos: readonly string[]
  readonly violacoes?: {
    readonly fugas: number
    readonly simbolicos: number
    readonly invalidos: number
  }
  /** O worktree que ficou no disco com trabalho não commitado — para a limpeza, nunca descartado. */
  readonly worktree?: string
  readonly escritor: string
  readonly packId: string
  readonly tentativa: number
  readonly duracaoMs: number
}

type Causa = 'timeout' | 'cancelada' | 'lease-perdido'
type Desfecho = Omit<ResultadoDoEscritor, 'escritor' | 'packId' | 'tentativa' | 'duracaoMs'>

const sha256 = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex')

export class ExecutorDeEscritor {
  private readonly agora: () => number
  private readonly intervaloMs: number

  constructor(private readonly deps: DependenciasDoEscritor) {
    this.agora = deps.agora ?? ((): number => Date.now())
    this.intervaloMs = deps.intervaloDoHeartbeatMs ?? VALIDADE_DO_LEASE_MS / BATIDAS_POR_VALIDADE
  }

  async executar(pedido: PedidoDoEscritor): Promise<ResultadoDoEscritor> {
    const inicio = this.agora()
    const finalizar = (d: Desfecho): ResultadoDoEscritor => ({
      ...d,
      escritor: pedido.escritor,
      packId: pedido.contexto.pack.id,
      tentativa: pedido.tentativa,
      duracaoMs: this.agora() - inicio
    })

    const escopo = escopoDoEscritor(pedido)
    const recusa = this.recusar(pedido, escopo)
    if (recusa !== undefined) {
      const r = finalizar({ estado: 'recusada', motivo: recusa, descartadas: [], arquivos: [] })
      this.auditar(pedido, 'fim', r)
      return r
    }
    if (pedido.signal?.aborted === true) {
      const r = finalizar({
        estado: 'cancelada',
        motivo: 'cancelada-antes-de-iniciar',
        descartadas: [],
        arquivos: []
      })
      this.auditar(pedido, 'fim', r)
      return r
    }

    this.auditar(pedido, 'inicio')
    let desfecho: Desfecho
    try {
      desfecho = await this.noSlot(pedido, escopo as PathsPermitidos)
    } catch (erro) {
      // O executor nunca lança: o que escapou até aqui é falha, e falha tem estado.
      desfecho = {
        estado: 'falhou',
        motivo: `erro inesperado: ${erro instanceof Error ? erro.name : 'desconhecido'}`,
        descartadas: [],
        arquivos: []
      }
    }
    const r = finalizar(desfecho)
    this.auditar(pedido, 'fim', r)
    return r
  }

  /** O que impede o escritor de nem entrar na fila. `undefined` quando ele pode seguir. */
  private recusar(
    pedido: PedidoDoEscritor,
    escopo: PathsPermitidos | undefined
  ): string | undefined {
    const { tarefa, contexto } = pedido
    // O integrador também escreve, mas o seu fluxo (manifesto de hunks) é da F04.
    if (tarefa.papel !== 'desenvolvedor') return 'papel-nao-suportado'
    if (!ehSchemaDeResultado(tarefa.schemaDeResultado)) return 'schema-desconhecido'
    const lido = lerIdDoEscritor(idDoEscritor(pedido.runId, pedido.escritor))
    if (lido?.escritor !== pedido.escritor) return 'escritor-invalido'
    if (tarefa.escritor !== pedido.escritor) return 'escritor-divergente'
    if (escopo === undefined) return 'escopo-invalido'

    const comum =
      recusaDaTentativa(pedido.tentativa) ??
      recusaDosLimites(tarefa.limites) ??
      recusaDoContexto(contexto.fontes.length, contexto.pack.itens.length)
    if (comum !== undefined) return comum

    const { system, prompt } = montarPromptDoEscritor({
      tarefa,
      objetivo: pedido.objetivo,
      fontes: contexto.fontes,
      paths: escopo.paths
    })
    const tokensDeEntrada = Math.ceil(Buffer.byteLength(system + prompt, 'utf8') / 4)
    return tokensDeEntrada > tarefa.limites.maxTokensEntrada
      ? 'contexto-acima-do-limite'
      : undefined
  }

  /** Da vez na fila até o slot solto: o slot é liberado **sempre**, qualquer que seja o desfecho. */
  private async noSlot(pedido: PedidoDoEscritor, escopo: PathsPermitidos): Promise<Desfecho> {
    const slot = await this.deps.slots.adquirir({
      projectId: pedido.projectId,
      workspaceId: pedido.workspaceId,
      runId: pedido.runId,
      escritor: pedido.escritor,
      ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
    })
    if (!slot.ok) {
      return slot.motivo === 'cancelada'
        ? { estado: 'cancelada', motivo: 'cancelada-na-fila', descartadas: [], arquivos: [] }
        : { estado: 'falhou', motivo: 'slot-indisponivel', descartadas: [], arquivos: [] }
    }

    const sandbox: PedidoDeSandbox = {
      runId: pedido.runId,
      projectId: pedido.projectId,
      workspaceId: pedido.workspaceId,
      sliceId: pedido.sliceId,
      escritor: pedido.escritor,
      tarefaId: pedido.tarefa.id,
      tentativa: pedido.tentativa,
      repositorio: pedido.repositorio,
      baseSha: pedido.baseSha,
      pathsPermitidos: escopo,
      contextPackId: pedido.contexto.pack.id
    }
    try {
      return await this.trabalhar(pedido, escopo, sandbox, slot.unidade, slot.fencingToken)
    } finally {
      await this.deps.sandbox.encerrar(sandbox).catch(() => undefined)
      this.deps.slots.liberar(pedido.projectId, pedido.workspaceId, slot.unidade, slot.fencingToken)
    }
  }

  private async trabalhar(
    pedido: PedidoDoEscritor,
    escopo: PathsPermitidos,
    sandbox: PedidoDeSandbox,
    unidade: string,
    fencingToken: number
  ): Promise<Desfecho> {
    const preparado = await this.deps.sandbox.preparar(sandbox)
    if (!preparado.ok) {
      return {
        estado: 'falhou',
        motivo: `sandbox-indisponivel: ${preparado.motivo}`.slice(0, MAX_MOTIVO_AUDITADO),
        descartadas: [],
        arquivos: []
      }
    }
    const worktree = preparado.worktree

    const execucao = await this.rodarAgente(pedido, escopo, worktree, unidade, fencingToken)
    if (execucao.causa !== undefined) {
      return {
        ...desfechoDaCausa(execucao.causa),
        descartadas: [],
        arquivos: [],
        worktree: worktree.worktree
      }
    }
    if (!execucao.saida.ok) {
      return {
        estado: 'falhou',
        motivo: execucao.saida.motivo.slice(0, MAX_MOTIVO_AUDITADO),
        descartadas: [],
        arquivos: [],
        worktree: worktree.worktree
      }
    }
    return this.provar(pedido, escopo, worktree, unidade, fencingToken, execucao.saida.texto)
  }

  /** Roda o agente com prazo, cancelamento e heartbeat; devolve o que o parou, se algo parou. */
  private async rodarAgente(
    pedido: PedidoDoEscritor,
    escopo: PathsPermitidos,
    worktree: WorktreeDeEscritor,
    unidade: string,
    fencingToken: number
  ): Promise<{ causa?: Causa; saida: Awaited<ReturnType<AgenteDoEscritor['executar']>> }> {
    const controle = new AbortController()
    let causa: Causa | undefined
    const parar = (por: Causa): void => {
      causa ??= por
      controle.abort()
    }
    const prazo = setTimeout(
      () => parar('timeout'),
      pedido.tarefa.limites.maxMinutos * MS_POR_MINUTO
    )
    const batida = setInterval(() => {
      // Perder o lease é perder o direito de escrever: o agente é abortado, e nada é commitado.
      // Não conseguir nem perguntar (banco indisponível) vale o mesmo: um `throw` dentro do
      // intervalo seria exceção não tratada no processo principal, e o agente seguiria sem dono.
      try {
        if (!this.deps.slots.renovar(unidade, fencingToken)) parar('lease-perdido')
      } catch {
        parar('lease-perdido')
      }
    }, this.intervaloMs)
    const aoCancelar = (): void => parar('cancelada')
    if (pedido.signal?.aborted === true) aoCancelar()
    else pedido.signal?.addEventListener('abort', aoCancelar)

    try {
      const { system, prompt } = montarPromptDoEscritor({
        tarefa: pedido.tarefa,
        objetivo: pedido.objetivo,
        fontes: pedido.contexto.fontes,
        paths: escopo.paths
      })
      const saida = await this.deps.agente.executar({
        worktree,
        system,
        prompt,
        limites: pedido.tarefa.limites,
        modelo: pedido.modelo,
        signal: controle.signal
      })
      return { ...(causa === undefined ? {} : { causa }), saida }
    } catch (erro) {
      return {
        ...(causa === undefined ? {} : { causa }),
        saida: { ok: false, motivo: `agente: ${erro instanceof Error ? erro.name : 'erro'}` }
      }
    } finally {
      clearTimeout(prazo)
      clearInterval(batida)
      pedido.signal?.removeEventListener('abort', aoCancelar)
    }
  }

  /** O agente terminou: confere o dono, prova o escopo, valida o resultado e só então commita. */
  private async provar(
    pedido: PedidoDoEscritor,
    escopo: PathsPermitidos,
    worktree: WorktreeDeEscritor,
    unidade: string,
    fencingToken: number,
    texto: string
  ): Promise<Desfecho> {
    const base = { descartadas: [] as string[], worktree: worktree.worktree }

    // O dono antigo — o que perdeu o lease enquanto trabalhava — não confirma progresso.
    if (!this.deps.slots.confirmar(unidade, fencingToken)) {
      return { ...base, estado: 'falhou', motivo: 'fencing-invalido', arquivos: [] }
    }

    const diff = this.deps.git.alteracoes(worktree)
    if (!diff.ok) {
      return {
        ...base,
        estado: 'falhou',
        motivo: `diff-indisponivel: ${diff.motivo}`.slice(0, MAX_MOTIVO_AUDITADO),
        arquivos: []
      }
    }
    const veredito = avaliarEscopoDoEscritor(diff.valor, escopo)
    if (!veredito.ok) {
      return {
        ...base,
        estado: 'falhou',
        motivo: 'escopo-violado',
        arquivos: [],
        violacoes: {
          fugas: veredito.fugas.length,
          simbolicos: veredito.simbolicos.length,
          invalidos: veredito.invalidos.length
        }
      }
    }
    if (veredito.dentro.length === 0) {
      return { ...base, estado: 'incompleta', motivo: 'sem-alteracoes', arquivos: [] }
    }

    return this.validarECommitar(pedido, worktree, veredito.dentro, texto, base)
  }

  private validarECommitar(
    pedido: PedidoDoEscritor,
    worktree: WorktreeDeEscritor,
    arquivos: readonly string[],
    texto: string,
    base: { descartadas: string[]; worktree: string }
  ): Desfecho {
    const schema = pedido.tarefa.schemaDeResultado as SchemaDeResultado
    const bruto = extrairJsonFinal(texto, (v) => 'conclusao' in v && 'schema' in v)
    if (bruto === undefined) {
      return { ...base, estado: 'invalida', motivo: 'saida-sem-json', arquivos }
    }
    // A evidência de arquivo vale para o que está no pacote **ou** no diff provado do escritor.
    const avaliado = avaliarResultado(bruto, {
      schemaEsperado: schema,
      fontesDoPack: new Set([...pedido.contexto.fontes.map((f) => f.caminho), ...arquivos])
    })
    if (avaliado.estado === 'invalida') {
      return { ...base, estado: 'invalida', motivo: avaliado.motivo, arquivos }
    }
    const assinatura = sha256(textoDaAssinatura(avaliado.resultado))
    const lido = {
      resultado: avaliado.resultado,
      assinatura,
      descartadas: [...avaliado.descartadas],
      arquivos,
      worktree: base.worktree
    }
    // Resultado sem a evidência exigida é incompleto: o trabalho fica no worktree, sem commit.
    if (avaliado.estado === 'incompleta') {
      return { ...lido, estado: 'incompleta', motivo: avaliado.motivo }
    }

    const commit = this.deps.git.commitar(
      worktree,
      `jarvis ${pedido.tarefa.id} (${pedido.escritor}) tentativa ${pedido.tentativa}`,
      arquivos
    )
    if (!commit.ok) {
      return {
        ...lido,
        estado: 'falhou',
        motivo: `commit-falhou: ${commit.motivo}`.slice(0, MAX_MOTIVO_AUDITADO)
      }
    }
    // Commitado, o worktree não guarda mais nada a salvar: tenta removê-lo, sem `--force`.
    const removido = this.deps.git.remover(worktree)
    return {
      ...lido,
      estado: 'concluida',
      commitSha: commit.valor,
      ...(removido.ok ? { worktree: undefined } : {})
    }
  }

  /** Ids, hashes, estado e contagens — nunca o texto do agente nem o conteúdo dos arquivos. */
  private auditar(
    pedido: PedidoDoEscritor,
    marco: 'inicio' | 'fim',
    r?: ResultadoDoEscritor
  ): void {
    const { tarefa, contexto } = pedido
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-tarefa',
      payload: {
        marco,
        runId: pedido.runId,
        tarefaId: tarefa.id,
        papel: tarefa.papel,
        escritor: pedido.escritor,
        capacidade: tarefa.capacidade,
        camada: tarefa.camada,
        tentativa: pedido.tentativa,
        packId: contexto.pack.id,
        packHash: contexto.pack.hash,
        baseSha: pedido.baseSha,
        schemaDeResultado: tarefa.schemaDeResultado,
        estado: r?.estado ?? 'em-execucao',
        ...(r === undefined
          ? {}
          : {
              ...(r.motivo === undefined ? {} : { motivo: r.motivo }),
              ...(r.assinatura === undefined ? {} : { assinatura: r.assinatura }),
              ...(r.commitSha === undefined ? {} : { commitSha: r.commitSha }),
              ...(r.violacoes === undefined ? {} : { violacoes: r.violacoes }),
              arquivos: r.arquivos.length,
              descartadas: r.descartadas.length,
              duracaoMs: r.duracaoMs
            })
      }
    })
  }
}

function desfechoDaCausa(causa: Causa): Pick<Desfecho, 'estado' | 'motivo'> {
  if (causa === 'timeout') return { estado: 'timeout', motivo: 'prazo-do-plano' }
  if (causa === 'cancelada') return { estado: 'cancelada', motivo: 'cancelada' }
  return { estado: 'falhou', motivo: 'lease-perdido' }
}

/** O write set do plano, normalizado. `undefined` se vazio ou se algum caminho não vale. */
function escopoDoEscritor(pedido: PedidoDoEscritor): PathsPermitidos | undefined {
  const paths = pedido.tarefa.paths.map((p) => normalizar(p))
  if (paths.length === 0 || paths.some((p) => p === undefined)) return undefined
  return {
    origem: 'derivada',
    paths: paths as string[],
    justificativa: `write set do escritor ${pedido.escritor} na tarefa ${pedido.tarefa.id}`
  }
}
