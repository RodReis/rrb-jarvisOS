/**
 * Independência e locks no scheduler (SPEC-Scheduler-02).
 *
 * A pergunta que este serviço responde: **este run pode entrar ao lado dos que já rodam — e, se
 * ele precisar escrever em mais lugares, o novo lugar está livre?** O núcleo (`@shared/domain/
 * independencia`) compara conjuntos; este serviço descobre os conjuntos, grava as travas e registra
 * a prova que o scheduler usou.
 *
 * Quatro decisões governam o desenho:
 *
 *  - **O write set previsto vem de uma porta** (`fonte`), não de um campo novo: a F02 entrega a
 *    prova, as travas e a expansão; quem sabe o que cada fatia vai escrever (SPEC → derivada, o
 *    mesmo `PathsPermitidos` do preflight) é injetado. Fonte sem resposta é prova incompleta, e
 *    incompleta é sequencial (regra 1) — por isso ligar este serviço sem fonte real não paraleliza
 *    nada, e a F03 é quem liga o paralelismo.
 *  - **Quem já adquiriu é lido das travas, não da fonte.** A verdade de um ativo é o que ele
 *    travou, inclusive o que expandiu depois; a fonte só responde pelo que ainda não adquiriu.
 *  - **A prova decide e é registrada.** `prova` só lê (o `decidirPool` a chama muitas vezes e a
 *    vista também); o registro — fingerprint, razões e contra quem — acontece em `aoAdquirir`,
 *    dentro da transação do ciclo, para o que o scheduler *usou* ficar gravado.
 *  - **Expansão é check-then-lock numa transação** (critério 3). O chamador só escreve no novo
 *    path depois de receber `ok`; um conflito grava o pedido e não toca nas travas.
 *
 * O que este serviço **não** faz: não executa o run, não bloqueia o run que perdeu a disputa (isso
 * é do `PoolService`, que conhece a transição) e não libera lease — as travas saem quando o slot
 * do dono sai.
 */

import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import {
  CATALOGO_PADRAO,
  provarIndependencia,
  travasDoWriteSet,
  type CatalogoDeRecursos,
  type ConflitoDeTrava,
  type FatiaParaProva,
  type Razao,
  type TravasDoWriteSet
} from '@shared/domain/independencia'
import type { ItemDaFila, ProvaDeIndependencia, VeredictoDaProva } from '@shared/domain/pool'
import { lerIdDoEscritor } from '@shared/domain/squad-execucao'
import type { LockRepository } from './lock-repository'
import type { ItemPersistido, PoolRepository } from './pool-repository'

/** O teto de caminhos travados por um run, somando o write set inicial e as expansões. */
export const MAX_TRAVAS_POR_RUN = 300

/** O write set que a fatia do item pretende escrever, ou `undefined` se a fonte não sabe. */
export type FonteDeWriteSet = (item: ItemPersistido) => readonly string[] | undefined

/** O fecho de dependências da fatia do item (ids de fatia), ou `undefined` se o roadmap não sabe. */
export type FonteDeDependencias = (item: ItemPersistido) => readonly string[] | undefined

export interface IndependenciaDeps {
  /** Para a transação da expansão. É o mesmo banco dos repositórios. */
  readonly db: Database
  readonly locks: LockRepository
  readonly pool: PoolRepository
  readonly userId: () => string
  readonly fonte: FonteDeWriteSet
  readonly dependencias: FonteDeDependencias
  readonly catalogo?: CatalogoDeRecursos
  readonly agora?: () => number
}

export type ResultadoDaAdmissao =
  { readonly ok: true } | { readonly ok: false; readonly razoes: readonly Razao[] }

export type ResultadoDaExpansao =
  | { readonly ok: true; readonly travas: TravasDoWriteSet }
  | {
      readonly ok: false
      /**
       * `caminho-invalido`: o pedido não vale (ou passa do teto). `bloqueado`: o run já perdeu uma
       * disputa e não amplia mais nada — a retomada é uma continuação, não este slot. `limite-de-travas`:
       * o write set do run já tem o teto de caminhos travados.
       */
      readonly motivo: 'caminho-invalido' | 'bloqueado' | 'limite-de-travas'
    }
  | {
      readonly ok: false
      readonly motivo: 'conflito'
      readonly conflitos: readonly ConflitoDeTrava[]
    }

interface ProvaComFingerprint {
  readonly independente: boolean
  readonly razoes: readonly Razao[]
  readonly fingerprint: string
  readonly catalogoVersao: number
}

/**
 * Os ativos que não são irmãos do candidato. Os escritores de um mesmo run (`<runId>:<escritor>`)
 * compartilham a fatia e o pool os isenta da prova entre si; a prova não pode voltar a cobrá-la só
 * porque há um run de fora ativo ao lado (as travas entre irmãos continuam valendo).
 */
const foraDoGrupo = (runId: string, ativos: readonly string[]): readonly string[] => {
  const grupo = lerIdDoEscritor(runId)?.runId
  return grupo === undefined ? ativos : ativos.filter((a) => lerIdDoEscritor(a)?.runId !== grupo)
}

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')

export class IndependenciaService {
  /** A prova que o `decidirPool` consulta: só lê, sem efeito. */
  readonly prova: ProvaDeIndependencia

  private readonly catalogo: CatalogoDeRecursos
  private readonly agora: () => number

  constructor(private readonly deps: IndependenciaDeps) {
    this.catalogo = deps.catalogo ?? CATALOGO_PADRAO
    this.agora = deps.agora ?? ((): number => Date.now())
    this.prova = (item: ItemDaFila, ativos: readonly string[]): VeredictoDaProva => {
      const p = this.provar(item.runId, ativos)
      return { independente: p.independente, razoes: p.razoes, fingerprint: p.fingerprint }
    }
  }

  /** A prova do candidato contra os ativos, com o fingerprint da entrada. Pura: só lê. */
  private provar(runId: string, ativos: readonly string[]): ProvaComFingerprint {
    const calculada = provarIndependencia(
      this.fatiaDe(runId),
      foraDoGrupo(runId, ativos).map((a) => this.fatiaDe(a)),
      this.catalogo
    )
    return {
      independente: calculada.independente,
      razoes: calculada.razoes,
      fingerprint: sha256(calculada.entradaCanonica),
      catalogoVersao: calculada.versaoDoCatalogo
    }
  }

  /**
   * O run, como a prova o enxerga. Quem já adquiriu (tem escopo registrado) vale pelo que travou;
   * quem ainda não, pelo que a fonte diz. Run que o pool não conhece (lease V1 em voo) é
   * desconhecido em tudo — nunca independente de ninguém.
   */
  private fatiaDe(runId: string): FatiaParaProva {
    const item = this.deps.pool.buscarItem(runId)
    if (item === undefined) {
      return { runId, sliceId: runId, dependeDe: undefined, writeSet: undefined }
    }
    const escopo = this.deps.locks.escopo(runId)
    const writeSet =
      escopo === undefined
        ? this.deps.fonte(item)
        : escopo.conhecido
          ? this.deps.locks.travasDoRun(runId).caminhos
          : undefined
    return {
      runId,
      sliceId: item.sliceId,
      dependeDe: this.deps.dependencias(item),
      writeSet
    }
  }

  /**
   * O run vai ocupar um slot: registra o escopo, trava o write set e grava a prova usada. Roda
   * **dentro da transação do ciclo**, junto da aquisição do lease — um crash no meio desfaz tudo.
   *
   * `provar: false` é para os irmãos (escritores do mesmo run, que o pool já isenta da prova): eles
   * não precisam provar independência uns dos outros, mas as travas continuam valendo — um irmão
   * que travasse o lockfile do outro esperaria, em vez de colidir.
   */
  aoAdquirir(
    item: ItemPersistido,
    ativos: readonly string[],
    opcoes: { readonly provar: boolean },
    agora: number = this.agora()
  ): ResultadoDaAdmissao {
    const { locks } = this.deps
    const userId = item.userId
    const exigeProva = opcoes.provar && foraDoGrupo(item.runId, ativos).length > 0
    const prova = exigeProva ? this.provar(item.runId, ativos) : undefined
    // Defesa: o `decidirPool` já havia autorizado, mas o que vale é o estado de agora.
    if (prova !== undefined && !prova.independente) return { ok: false, razoes: prova.razoes }

    const ws = this.deps.fonte(item)
    const travas = ws === undefined ? undefined : travasDoWriteSet(ws, this.catalogo)
    const conhecido = travas !== undefined
    locks.registrarEscopo(
      userId,
      {
        runId: item.runId,
        projectId: item.projectId,
        conhecido,
        catalogoVersao: this.catalogo.versao
      },
      agora
    )

    if (travas !== undefined) {
      const r = locks.adquirir(userId, item.runId, item.projectId, travas, 'inicial', agora)
      if (!r.ok) {
        locks.soltar(item.runId)
        return { ok: false, razoes: razoesDosConflitos(item.runId, r.conflitos) }
      }
    }

    if (prova !== undefined) {
      locks.registrarProva(
        userId,
        {
          runId: item.runId,
          projectId: item.projectId,
          independente: true,
          fingerprint: prova.fingerprint,
          catalogoVersao: prova.catalogoVersao,
          razoes: prova.razoes,
          contra: [...foraDoGrupo(item.runId, ativos)].sort()
        },
        agora
      )
    }
    return { ok: true }
  }

  /**
   * O run quer escrever em mais lugares. Trava os caminhos novos **antes** de qualquer escrita:
   * livre → `ok` (e as provas que contavam com este run perdem a validade — mudança estrutural,
   * regra 4); conflito → nada é gravado além do pedido, e quem pediu perdeu a disputa.
   *
   * O run que ainda não tinha escopo registrado entra como desconhecido: expandir não prova o que o
   * run já escrevia antes.
   */
  expandir(
    item: ItemPersistido,
    caminhos: readonly string[],
    agora: number = this.agora()
  ): ResultadoDaExpansao {
    const novas = travasDoWriteSet(caminhos, this.catalogo)
    if (novas === undefined) return { ok: false, motivo: 'caminho-invalido' }

    const { locks } = this.deps
    const userId = item.userId
    return this.deps.db.transaction((): ResultadoDaExpansao => {
      // Quem perdeu a disputa não amplia mais: o `BLOCKED` é do estado do run, mas o pool não
      // depende de o chamador respeitá-lo — e a recusa não grava nada, para o pedido repetido não
      // virar uma linha de auditoria por tentativa.
      if (locks.perdeuDisputa(item.runId)) {
        return { ok: false, motivo: 'bloqueado' }
      }
      if (
        locks.travasDoRun(item.runId).caminhos.length + novas.caminhos.length >
        MAX_TRAVAS_POR_RUN
      ) {
        return { ok: false, motivo: 'limite-de-travas' }
      }
      if (locks.escopo(item.runId) === undefined) {
        locks.registrarEscopo(
          userId,
          {
            runId: item.runId,
            projectId: item.projectId,
            conhecido: false,
            catalogoVersao: this.catalogo.versao
          },
          agora
        )
      }
      const r = locks.adquirir(userId, item.runId, item.projectId, novas, 'expansao', agora)
      const pedido = { runId: item.runId, projectId: item.projectId, caminhos: novas.caminhos }
      if (!r.ok) {
        locks.registrarExpansao(
          userId,
          { ...pedido, resultado: 'conflito', conflitos: r.conflitos },
          agora
        )
        return { ok: false, motivo: 'conflito', conflitos: r.conflitos }
      }
      locks.registrarExpansao(userId, { ...pedido, resultado: 'adquirida', conflitos: [] }, agora)
      locks.invalidarProvas(userId, item.runId, agora)
      return { ok: true, travas: locks.travasDoRun(item.runId) }
    })()
  }

  /** O slot do run saiu (liberado, encerrado ou reconciliado): as travas saem com ele. */
  soltar(runId: string): number {
    return this.deps.locks.soltar(runId)
  }

  /** Solta o que sobrou de run sem slot — o crash entre remover o lease e soltar as travas. */
  varrerOrfaos(): readonly string[] {
    return this.deps.locks.varrerOrfaos(this.deps.userId())
  }
}

/** Conflitos de trava como razões da prova, para o motivo de espera explicar o fallback. */
export function razoesDosConflitos(
  runId: string,
  conflitos: readonly ConflitoDeTrava[]
): readonly Razao[] {
  return conflitos.map((k): Razao =>
    k.tipo === 'caminho'
      ? {
          tipo: 'sobreposicao-de-path',
          runId,
          contraRunId: k.comRunId,
          caminho: k.chave,
          contraCaminho: k.comChave
        }
      : { tipo: 'recurso-exclusivo', runId, contraRunId: k.comRunId, recurso: k.chave }
  )
}
