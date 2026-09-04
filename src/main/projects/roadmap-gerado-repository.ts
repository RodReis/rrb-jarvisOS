/**
 * Persistência do roadmap gerado por IA (SPEC-Jornada-05).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, que conhece o contexto (gerou?
 * regenerou? o PI escolheu o MVP?). Mesma divisão do `ArquiteturaRepository` e do
 * `PrdRepository`.
 *
 * **Não existe `update` de conteúdo nem `delete`, e a ausência é o desenho** — a oitava vez que
 * esta postura aparece no projeto. Regenerar **insere** outra linha, e o `hash` UNIQUE reconhece
 * quando o conteúdo é o mesmo. O critério 6 é literal: *"regenerar após `MVP_ENTRY` preserva o
 * MVP aceito"*, e uma linha editável faria o hash descrever um conteúdo que talvez não seja o
 * que o PI leu.
 *
 * As duas escritas posteriores são `escolherMvp` e `marcarCommit`. Nenhuma toca conteúdo nem
 * hash: a primeira registra a escolha do PI no `MVP_ENTRY`, a segunda aponta a linha para a
 * revisão do Git.
 *
 * **Este repositório não substitui o `RoadmapRepository`.** Aquele guarda a projeção que o
 * `STATUS.md` e o MVP-009 leem (`mvp`, `slice`, `approval`); este guarda a revisão verificável
 * com as origens e a SPEC. Os dois são gravados na mesma operação pelo serviço, e é o hash que
 * os liga.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { MvpGerado, RoadmapRegistrado, SpecGerada } from '@shared/domain/roadmap-gerado'
import { log } from '../logging/logger'

interface RoadmapGeradoRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly pacote_estrutural_id: string
  readonly arquitetura_id: string
  readonly mvps: string
  readonly spec: string | null
  readonly mvp_escolhido: string | null
  readonly hash: string
  readonly commit_hash: string | null
  readonly context_pack_id: string | null
  readonly created_at: string
}

/**
 * Lê o JSON dos MVPs.
 *
 * **JSON ilegível vira lista vazia, e não exceção**, mesma postura dos repositórios irmãos: uma
 * linha corrompida não deve impedir o PI de reabrir o projeto. E, como lá, a lista vazia é
 * **visível** — um roadmap sem MVP nenhum aparece vazio na tela, e o que ele pede é regeneração,
 * não silêncio.
 */
function parseMvps(raw: string): readonly MvpGerado[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MvpGerado[]) : []
  } catch {
    log.db.warn('MVPs do roadmap ilegíveis; lista devolvida vazia', {
      op: 'select',
      table: 'project_roadmap'
    })
    return []
  }
}

/**
 * Lê o JSON da SPEC.
 *
 * `undefined` cobre os dois casos — coluna nula (antes do `MVP_ENTRY`) e JSON ilegível — e a
 * fusão é deliberada: nos dois a SPEC não está disponível, e o gate `SLICE_ENTRY` recusa por
 * ausência de objeto. Distinguir "nunca existiu" de "não pôde ser lida" mudaria o que o PI vê
 * sem mudar o que ele pode fazer.
 */
function parseSpec(raw: string | null): SpecGerada | undefined {
  if (raw === null) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as SpecGerada) : undefined
  } catch {
    log.db.warn('SPEC do roadmap ilegível', { op: 'select', table: 'project_roadmap' })
    return undefined
  }
}

function toRoadmap(row: RoadmapGeradoRow): RoadmapRegistrado {
  const spec = parseSpec(row.spec)

  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    pacoteEstruturalId: row.pacote_estrutural_id,
    arquiteturaId: row.arquitetura_id,
    mvps: parseMvps(row.mvps),
    ...(spec === undefined ? {} : { spec }),
    mvpEscolhido: row.mvp_escolhido,
    hash: row.hash,
    commitHash: row.commit_hash,
    contextPackId: row.context_pack_id,
    created_at: row.created_at
  }
}

export class RoadmapGeradoRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra a revisão. Conteúdo idêntico **é** a mesma revisão: o `hash` UNIQUE a reconhece, e
   * devolver a existente evita estourar quando regenerar não mudou nada.
   */
  registrar(roadmap: RoadmapRegistrado): RoadmapRegistrado {
    const existente = this.findByHash(roadmap.user_id, roadmap.hash)
    if (existente !== undefined) return existente

    this.db
      .prepare(
        `INSERT INTO project_roadmap
           (id, user_id, workspace_id, project_id, pacote_estrutural_id, arquitetura_id, mvps,
            spec, mvp_escolhido, hash, commit_hash, context_pack_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        roadmap.id,
        roadmap.user_id,
        roadmap.workspace_id,
        roadmap.projectId,
        roadmap.pacoteEstruturalId,
        roadmap.arquiteturaId,
        JSON.stringify(roadmap.mvps),
        roadmap.spec === undefined ? null : JSON.stringify(roadmap.spec),
        roadmap.mvpEscolhido,
        roadmap.hash,
        roadmap.commitHash,
        roadmap.contextPackId,
        roadmap.created_at
      )

    log.db.info('Roadmap gerado registrado', { op: 'insert', table: 'project_roadmap' })
    return roadmap
  }

  /** A revisão vigente: a mais recente. As anteriores continuam no banco. */
  vigente(userId: string, projectId: string): RoadmapRegistrado | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_roadmap
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`
      )
      .get(userId, projectId) as RoadmapGeradoRow | undefined

    return row ? toRoadmap(row) : undefined
  }

  findByHash(userId: string, hash: string): RoadmapRegistrado | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_roadmap WHERE user_id = ? AND hash = ?')
      .get(userId, hash) as RoadmapGeradoRow | undefined

    return row ? toRoadmap(row) : undefined
  }

  /** Todas as revisões do projeto, da mais recente à mais antiga. */
  listar(userId: string, projectId: string): readonly RoadmapRegistrado[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_roadmap
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC`
      )
      .all(userId, projectId) as RoadmapGeradoRow[]

    return rows.map(toRoadmap)
  }

  /**
   * Registra o MVP que o PI escolheu no `MVP_ENTRY` (critério 3).
   *
   * **Só grava quando ainda não há escolha** (`mvp_escolhido IS NULL`): trocar o MVP aceito por
   * outro não é escolher, é desfazer um aceite — e desfazer aceite não é ato que um clique
   * executa. Uma segunda escolha exige regenerar, que cria revisão nova.
   */
  escolherMvp(userId: string, roadmapId: string, mvpId: string): boolean {
    const r = this.db
      .prepare(
        'UPDATE project_roadmap SET mvp_escolhido = ? WHERE user_id = ? AND id = ? AND mvp_escolhido IS NULL'
      )
      .run(mvpId, userId, roadmapId)

    return r.changes > 0
  }

  /** Aponta a linha para a revisão do Git. **Não toca conteúdo nem hash.** */
  marcarCommit(userId: string, roadmapId: string, commitHash: string): boolean {
    const r = this.db
      .prepare('UPDATE project_roadmap SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, roadmapId)

    return r.changes > 0
  }
}
