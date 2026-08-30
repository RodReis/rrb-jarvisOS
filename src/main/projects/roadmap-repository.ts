/**
 * Persistência do roadmap e das aprovações (SPEC-Planejamento-06).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, mesma divisão dos irmãos.
 *
 * **`approval` não tem `update` nem `delete`, e `mvp`/`slice` têm.** A diferença é o que cada um
 * é: uma aprovação é um **fato datado** (*"o PI aceitou este conteúdo neste instante"*), e
 * editá-la reescreveria a história; um MVP é um **item de plano**, e replanejar é o trabalho
 * normal do roadmap. Um `update` em `approval` faria o critério 4 depender de ninguém ter mexido
 * depois — e é justamente o que o hash existe para não depender.
 *
 * A única mutação de `mvp` é `promover`, que troca `proposto` → `na-fila`. Ela é separada de
 * `salvarRoadmap` de propósito: regravar o roadmap não pode promover nada, porque promover é o
 * gate `MVP_ENTRY` — um ato do PI (critério 3).
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { OrigemDaAfirmacao } from '@shared/domain/pacote-estrutural'
import type { Approval, Gate, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { EstadoDoMvp, Mvp, Roadmap, Slice } from '@shared/domain/roadmap'
import { log } from '../logging/logger'

interface MvpRow {
  readonly id: string
  readonly numero: number
  readonly titulo: string
  readonly tese: string
  readonly estado: string
  readonly depende_de: string
  readonly origem_tipo: string
  readonly origem_ref: string
  readonly origem_chave: string
}

interface SliceRow {
  readonly id: string
  readonly mvp_id: string
  readonly numero: number
  readonly titulo: string
  readonly spec_slug: string
  readonly detalhada: number
  readonly origem_tipo: string
  readonly origem_ref: string
  readonly origem_chave: string
}

interface ApprovalRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly gate: string
  readonly revisoes: string
  readonly identidade: string
  readonly created_at: string
}

/**
 * Reconstrói a origem a partir das três colunas.
 *
 * As colunas são genéricas (`origem_ref`, `origem_chave`) porque as duas variantes carregam
 * pares diferentes — `decisaoId`/`perguntaId` e `url`/`hashConteudo`. Seis colunas nomeadas
 * deixariam metade nula em toda linha, e a leitura teria de saber qual metade olhar de qualquer
 * forma.
 *
 * Tipo desconhecido vindo do banco vira `decisao`, **nunca** `evidencia`: uma linha corrompida
 * não pode ganhar por acidente a origem que afirma ter fonte externa verificável. Mesma postura
 * do `autor` desconhecido virando `agente` na M8-F03 — o default fecha para o lado que afirma
 * menos.
 */
function toOrigem(tipo: string, ref: string, chave: string): OrigemDaAfirmacao {
  return tipo === 'evidencia'
    ? { tipo: 'evidencia', url: ref, hashConteudo: chave }
    : { tipo: 'decisao', decisaoId: ref, perguntaId: chave }
}

/** As três colunas a gravar, a partir da origem. */
function daOrigem(origem: OrigemDaAfirmacao): readonly [string, string, string] {
  return origem.tipo === 'evidencia'
    ? ['evidencia', origem.url, origem.hashConteudo]
    : ['decisao', origem.decisaoId, origem.perguntaId]
}

/** Lê o JSON de dependências. Ilegível vira lista vazia — o `validarDag` acusa o que faltar. */
function parseDependencias(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d) => typeof d === 'string') : []
  } catch {
    log.db.warn('Dependências do MVP ilegíveis', { op: 'select', table: 'mvp' })
    return []
  }
}

function toMvp(row: MvpRow): Mvp {
  return {
    id: row.id,
    numero: row.numero,
    titulo: row.titulo,
    tese: row.tese,
    estado: row.estado as EstadoDoMvp,
    dependeDe: parseDependencias(row.depende_de),
    origem: toOrigem(row.origem_tipo, row.origem_ref, row.origem_chave)
  }
}

function toSlice(row: SliceRow): Slice {
  return {
    id: row.id,
    mvpId: row.mvp_id,
    numero: row.numero,
    titulo: row.titulo,
    specSlug: row.spec_slug,
    detalhada: row.detalhada === 1,
    origem: toOrigem(row.origem_tipo, row.origem_ref, row.origem_chave)
  }
}

function parseRevisoes(raw: string): readonly RevisaoAprovada[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RevisaoAprovada[]) : []
  } catch {
    log.db.warn('Revisões da aprovação ilegíveis', { op: 'select', table: 'approval' })
    return []
  }
}

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    gate: row.gate as Gate,
    revisoes: parseRevisoes(row.revisoes),
    identidade: row.identidade,
    // Literal, não lido do banco: não existe coluna `autor`, e a ausência é a garantia do
    // critério 7. Ler daqui abriria o caminho por onde uma linha diria 'agente'.
    autor: 'pi',
    created_at: row.created_at
  }
}

/** O escopo de toda operação. Repetido em todas as assinaturas, como nos repositórios irmãos. */
export interface EscopoDoRoadmap {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

export class RoadmapRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava o roadmap inteiro, numa transação.
   *
   * **Substitui**, não acumula: regerar o roadmap produz o roadmap, não um segundo conjunto de
   * MVPs ao lado do primeiro. Tudo ou nada porque metade dos MVPs gravados descreveria um DAG
   * que ninguém validou — e `validarDag` rodou sobre o conjunto completo.
   *
   * **O estado sobrevive à regravação.** Um MVP que já entrou na fila continua `na-fila` mesmo
   * quando o roadmap é recomposto: a promoção é o gate `MVP_ENTRY`, um ato do PI, e apagá-la ao
   * regerar faria o roadmap desfazer uma aprovação — exatamente o que o critério 3 impede.
   */
  salvarRoadmap(escopo: EscopoDoRoadmap, roadmap: Roadmap): Roadmap {
    const estados = new Map(this.listarMvps(escopo).map((m) => [m.numero, m.estado] as const))

    const apagarSlices = this.db.prepare('DELETE FROM slice WHERE user_id = ? AND project_id = ?')
    const apagarMvps = this.db.prepare('DELETE FROM mvp WHERE user_id = ? AND project_id = ?')

    const inserirMvp = this.db.prepare(
      `INSERT INTO mvp
         (id, user_id, workspace_id, project_id, numero, titulo, tese, estado, depende_de,
          origem_tipo, origem_ref, origem_chave, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const inserirSlice = this.db.prepare(
      `INSERT INTO slice
         (id, user_id, workspace_id, project_id, mvp_id, numero, titulo, spec_slug, detalhada,
          origem_tipo, origem_ref, origem_chave, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const agora = new Date().toISOString()

    this.db.transaction(() => {
      apagarSlices.run(escopo.userId, escopo.projectId)
      apagarMvps.run(escopo.userId, escopo.projectId)

      for (const mvp of roadmap.mvps) {
        const [tipo, ref, chave] = daOrigem(mvp.origem)
        inserirMvp.run(
          mvp.id,
          escopo.userId,
          escopo.workspaceId,
          escopo.projectId,
          mvp.numero,
          mvp.titulo,
          mvp.tese,
          // O estado anterior vence o do roadmap recomposto: promoção é ato do PI.
          estados.get(mvp.numero) ?? mvp.estado,
          JSON.stringify(mvp.dependeDe),
          tipo,
          ref,
          chave,
          agora
        )
      }

      for (const slice of roadmap.slices) {
        const [tipo, ref, chave] = daOrigem(slice.origem)
        inserirSlice.run(
          slice.id,
          escopo.userId,
          escopo.workspaceId,
          escopo.projectId,
          slice.mvpId,
          slice.numero,
          slice.titulo,
          slice.specSlug,
          slice.detalhada ? 1 : 0,
          tipo,
          ref,
          chave,
          agora
        )
      }
    })()

    log.db.info('Roadmap gravado', { op: 'insert', table: 'mvp' })
    return this.carregar(escopo)
  }

  /** O roadmap do projeto. */
  carregar(escopo: EscopoDoRoadmap): Roadmap {
    return { mvps: this.listarMvps(escopo), slices: this.listarSlices(escopo) }
  }

  private listarMvps(escopo: EscopoDoRoadmap): readonly Mvp[] {
    const rows = this.db
      .prepare('SELECT * FROM mvp WHERE user_id = ? AND project_id = ? ORDER BY numero')
      .all(escopo.userId, escopo.projectId) as MvpRow[]
    return rows.map(toMvp)
  }

  private listarSlices(escopo: EscopoDoRoadmap): readonly Slice[] {
    const rows = this.db
      .prepare('SELECT * FROM slice WHERE user_id = ? AND project_id = ? ORDER BY mvp_id, numero')
      .all(escopo.userId, escopo.projectId) as SliceRow[]
    return rows.map(toSlice)
  }

  /**
   * Promove o MVP para a fila — a única mutação de `mvp`, e ela é o gate `MVP_ENTRY`.
   *
   * Separada de `salvarRoadmap` de propósito: regravar o roadmap não pode promover nada, porque
   * promover é ato do PI (critério 3). Um `salvarRoadmap` que aceitasse `estado` do chamador
   * faria a geração aprovar o que ela mesma propôs.
   */
  promover(escopo: EscopoDoRoadmap, mvpId: string): boolean {
    const r = this.db
      .prepare(
        "UPDATE mvp SET estado = 'na-fila' WHERE user_id = ? AND project_id = ? AND id = ? AND estado = 'proposto'"
      )
      .run(escopo.userId, escopo.projectId, mvpId)
    return r.changes > 0
  }

  /** Marca a fatia como detalhada — a que ganhou SPEC executável. */
  marcarDetalhada(escopo: EscopoDoRoadmap, sliceId: string): boolean {
    const r = this.db
      .prepare('UPDATE slice SET detalhada = 1 WHERE user_id = ? AND project_id = ? AND id = ?')
      .run(escopo.userId, escopo.projectId, sliceId)
    return r.changes > 0
  }

  /** Registra a aprovação. Append-only: reaprovar insere outra linha. */
  registrarAprovacao(approval: Approval): Approval {
    this.db
      .prepare(
        `INSERT INTO approval
           (id, user_id, workspace_id, project_id, gate, revisoes, identidade, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        approval.id,
        approval.user_id,
        approval.workspace_id,
        approval.projectId,
        approval.gate,
        JSON.stringify(approval.revisoes),
        approval.identidade,
        approval.created_at
      )

    log.db.info('Aprovação registrada', { op: 'insert', table: 'approval' })
    return approval
  }

  /** As aprovações do projeto, da mais recente à mais antiga. */
  listarAprovacoes(escopo: EscopoDoRoadmap): readonly Approval[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM approval WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(escopo.userId, escopo.projectId) as ApprovalRow[]
    return rows.map(toApproval)
  }
}
