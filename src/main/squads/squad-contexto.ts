/**
 * O contexto de uma tarefa do Squad (SPEC-Squads-03, critério 3): só fontes justificadas, com hash.
 *
 * **O kernel monta, o agente não escolhe.** As fontes são as `entradas` que o plano validado
 * declarou para a tarefa, mais as buscas que o kernel pede — nunca um caminho sugerido pelo
 * agente sem passar pela mesma validação (regra 3). Tudo é lido de **uma revisão do Git**, pelo
 * oid: o conteúdo é o do SHA registrado, e o hash de cada item descreve o texto exato que vai
 * para o prompt (um trecho de busca tem o hash do trecho, não o do arquivo).
 *
 * O que não entra vira `descartada`, com o motivo, e não some em silêncio: quem lê o resultado
 * sabe que a tarefa pediu um arquivo que a revisão não tem.
 */

import type { AiProvider } from '@shared/domain/ai'
import type { ContextPack, ContextPackReason } from '@shared/domain/context-pack'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  LINHAS_DE_CONTEXTO_DA_BUSCA,
  faixasDaBusca,
  recortarLinhas,
  totalDeLinhas
} from '@shared/domain/squad-execucao'
import { normalizar, type TarefaDoPlano } from '@shared/domain/squad-plano'
import type { ContextService, FonteDaTarefa } from '../context/context-service'
import type { ArquivoNaRevisao, SquadGit } from './squad-git'

/** Quantas fontes uma tarefa leva: contexto mínimo, não o repositório em fatias. */
export const MAX_FONTES_DA_TAREFA = 40
/** O mesmo teto por arquivo do contexto documental. Arquivo maior não entra cortado ao meio. */
const TETO_POR_ARQUIVO_BYTES = 256 * 1024
const MAX_BUSCAS = 10

export interface BuscaDaTarefa {
  /** Texto literal. Nunca regex, nunca vindo do agente. */
  readonly termo: string
  /** O escopo da busca: a SPEC não permite varrer o repositório, só dentro destes caminhos. */
  readonly caminhos: readonly string[]
}

export type MotivoDeDescarte =
  | 'caminho-invalido'
  | 'inexistente-na-revisao'
  | 'grande-demais'
  | 'binario'
  | 'repetido'
  | 'limite-de-fontes'

export interface FonteDescartada {
  readonly caminho: string
  readonly motivo: MotivoDeDescarte
}

export interface PedidoDeContextoDaTarefaDoSquad {
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  /** O repositório do projeto, no host. */
  readonly repositorio: string
  /** O SHA de onde o contexto sai. Fixo: a mesma tarefa lê a mesma revisão. */
  readonly revisao: string
  readonly runId: string
  readonly tarefa: Pick<TarefaDoPlano, 'id' | 'entradas'>
  readonly rota: AiProvider
  readonly buscas?: readonly BuscaDaTarefa[]
  readonly regras?: readonly string[]
}

export type ResultadoDoContextoDaTarefa =
  | {
      readonly ok: true
      readonly pack: ContextPack
      /** Os textos que entraram, na ordem do pack: o que o prompt do worker vai carregar. */
      readonly fontes: readonly FonteDaTarefa[]
      readonly descartadas: readonly FonteDescartada[]
    }
  | {
      readonly ok: false
      readonly razao: ContextPackReason | 'revisao-indisponivel' | 'busca-invalida'
      readonly mensagem: string
      readonly caminhosComSegredo?: readonly string[]
    }

export interface DependenciasDoContextoDaTarefa {
  readonly git: Pick<SquadGit, 'listarNaRevisao' | 'lerNaRevisao' | 'buscarNaRevisao'>
  readonly contexto: Pick<ContextService, 'montarDaTarefa'>
}

/** O rótulo que entra no hash do pack: run, tarefa e a revisão do código de onde o contexto saiu. */
export const rotuloDaTarefa = (runId: string, tarefaId: string, revisao: string): string =>
  `squad:${runId}/${tarefaId}@${revisao.slice(0, 12)}`

export class ContextoDaTarefa {
  constructor(private readonly deps: DependenciasDoContextoDaTarefa) {}

  montar(pedido: PedidoDeContextoDaTarefaDoSquad): ResultadoDoContextoDaTarefa {
    const arvore = this.deps.git.listarNaRevisao(pedido.repositorio, pedido.revisao)
    if (!arvore.ok) {
      return { ok: false, razao: 'revisao-indisponivel', mensagem: arvore.motivo }
    }

    const buscas = pedido.buscas ?? []
    if (buscas.length > MAX_BUSCAS) {
      return { ok: false, razao: 'busca-invalida', mensagem: `mais de ${MAX_BUSCAS} buscas` }
    }

    const fontes: FonteDaTarefa[] = []
    const descartadas: FonteDescartada[] = []
    const inteiros = new Set<string>()

    this.lerExatos(pedido, arvore.valor, fontes, descartadas, inteiros)
    for (const busca of buscas) {
      const falha = this.lerBusca(pedido, busca, arvore.valor, fontes, descartadas, inteiros)
      if (falha !== undefined) return { ok: false, razao: 'busca-invalida', mensagem: falha }
    }

    const montado = this.deps.contexto.montarDaTarefa(
      {
        projectId: pedido.projectId,
        tarefa: rotuloDaTarefa(pedido.runId, pedido.tarefa.id, pedido.revisao),
        etapa: 'squad-tarefa',
        fontes,
        rota: pedido.rota,
        ...(pedido.regras === undefined ? {} : { regras: pedido.regras })
      },
      pedido.workspaceId
    )
    if (montado.pack === undefined) {
      return {
        ok: false,
        razao: montado.reason,
        mensagem: montado.mensagem,
        ...(montado.caminhosComSegredo === undefined
          ? {}
          : { caminhosComSegredo: montado.caminhosComSegredo })
      }
    }
    return { ok: true, pack: montado.pack, fontes, descartadas }
  }

  /** As `entradas` da tarefa: arquivos exatos, um a um, cada um provado na árvore da revisão. */
  private lerExatos(
    pedido: PedidoDeContextoDaTarefaDoSquad,
    arvore: ReadonlyMap<string, ArquivoNaRevisao>,
    fontes: FonteDaTarefa[],
    descartadas: FonteDescartada[],
    inteiros: Set<string>
  ): void {
    for (const bruto of pedido.tarefa.entradas) {
      const caminho = normalizar(bruto)
      if (caminho === undefined) {
        descartadas.push({ caminho: bruto, motivo: 'caminho-invalido' })
        continue
      }
      if (inteiros.has(caminho)) {
        descartadas.push({ caminho, motivo: 'repetido' })
        continue
      }
      const arquivo = arvore.get(caminho)
      if (arquivo === undefined) {
        descartadas.push({ caminho, motivo: 'inexistente-na-revisao' })
        continue
      }
      if (arquivo.bytes > TETO_POR_ARQUIVO_BYTES) {
        descartadas.push({ caminho, motivo: 'grande-demais' })
        continue
      }
      if (fontes.length >= MAX_FONTES_DA_TAREFA) {
        descartadas.push({ caminho, motivo: 'limite-de-fontes' })
        continue
      }
      const texto = this.deps.git.lerNaRevisao(pedido.repositorio, arquivo)
      if (!texto.ok) {
        descartadas.push({ caminho, motivo: 'binario' })
        continue
      }
      inteiros.add(caminho)
      fontes.push({
        caminho,
        texto: texto.valor,
        origem: 'explicito',
        motivo: `entrada da tarefa ${pedido.tarefa.id}`
      })
    }
  }

  /**
   * Uma busca literal dentro do escopo dela. Cada ocorrência vira um trecho com contexto, e trechos
   * que se tocam viram um só. O arquivo que já entrou inteiro não entra de novo em trecho.
   * Devolve a razão da falha quando a **busca** é inválida — erro do kernel, não do agente.
   */
  private lerBusca(
    pedido: PedidoDeContextoDaTarefaDoSquad,
    busca: BuscaDaTarefa,
    arvore: ReadonlyMap<string, ArquivoNaRevisao>,
    fontes: FonteDaTarefa[],
    descartadas: FonteDescartada[],
    inteiros: ReadonlySet<string>
  ): string | undefined {
    const escopo = busca.caminhos.map((c) => normalizar(c))
    if (escopo.some((c) => c === undefined)) {
      return 'escopo da busca inválido'
    }

    const achadas = this.deps.git.buscarNaRevisao(
      pedido.repositorio,
      pedido.revisao,
      busca.termo,
      escopo as string[]
    )
    if (!achadas.ok) return achadas.motivo

    const porArquivo = new Map<string, number[]>()
    for (const o of achadas.valor) {
      if (inteiros.has(o.caminho)) continue
      porArquivo.set(o.caminho, [...(porArquivo.get(o.caminho) ?? []), o.linha])
    }

    for (const [caminho, linhas] of porArquivo) {
      const arquivo = arvore.get(caminho)
      if (arquivo === undefined || arquivo.bytes > TETO_POR_ARQUIVO_BYTES) {
        descartadas.push({
          caminho,
          motivo: arquivo === undefined ? 'inexistente-na-revisao' : 'grande-demais'
        })
        continue
      }
      const texto = this.deps.git.lerNaRevisao(pedido.repositorio, arquivo)
      if (!texto.ok) {
        descartadas.push({ caminho, motivo: 'binario' })
        continue
      }
      const faixas = faixasDaBusca(linhas, totalDeLinhas(texto.valor), LINHAS_DE_CONTEXTO_DA_BUSCA)
      for (const faixa of faixas) {
        if (fontes.length >= MAX_FONTES_DA_TAREFA) {
          descartadas.push({ caminho, motivo: 'limite-de-fontes' })
          continue
        }
        fontes.push({
          caminho,
          texto: recortarLinhas(texto.valor, faixa),
          origem: 'busca-estrutural',
          motivo: `busca por "${busca.termo}"`,
          linhas: faixa
        })
      }
    }
    return undefined
  }
}
