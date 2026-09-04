/**
 * Persistência do modelo por fase — no workspace e no projeto (SPEC-Fases-02, critérios 2 e 3).
 *
 * Camada fina, como o `RoutingRepository`: guarda e devolve. A resolução da herança é da função
 * pura `modeloDaFase` em `@shared/domain/modelo-da-fase`; a auditoria é do `PhaseModelService`.
 */

import type { Database } from 'better-sqlite3'
import type { AiProvider } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Fase } from '@shared/domain/fase'
import type {
  ModeloPorRota,
  PhaseModelPolicy,
  ProjectModelOverride,
  RotaComModelo
} from '@shared/domain/modelo-da-fase'
import { FASES, isFase } from '@shared/domain/fase'
import {
  POLITICA_DE_MODELO_PADRAO,
  isModeloEscolhido,
  isRotaComModelo,
  modelosDoCatalogo
} from '@shared/domain/modelo-da-fase'
import { log } from '../logging/logger'

interface ModeloRow {
  readonly fase: string
  readonly rota: string
  readonly provider: string
  readonly model: string
}

interface OverrideRow extends ModeloRow {
  readonly project_id: string
}

export class PhaseModelRepository {
  constructor(private readonly db: Database) {}

  /**
   * A política do escopo, com o **padrão preenchendo** o que nunca foi editado.
   *
   * Mescla por `(fase, rota)`, e não tudo-ou-nada: editar o combo do Planejamento não pode fazer
   * os outros cinco sumirem, e um `find` que devolvesse só o gravado deixaria a Construção sem
   * modelo depois da primeira edição — o que faria a geração cair no `MODELO_PADRAO` do provider
   * justamente na fase onde o PI mais quis escolher.
   */
  find(userId: string, workspaceId: WorkspaceId): PhaseModelPolicy {
    const linhas = this.db
      .prepare(
        `SELECT fase, rota, provider, model
           FROM phase_model_policy
          WHERE user_id = ? AND workspace_id = ?`
      )
      .all(userId, workspaceId) as ModeloRow[]

    // Cópia profunda do padrão: um spread raso deixaria os `ModeloPorRota` compartilhados com a
    // constante, e a primeira gravação mutaria o padrão do processo inteiro.
    const fases = Object.fromEntries(
      FASES.map((fase) => [fase, { ...POLITICA_DE_MODELO_PADRAO[fase] }])
    ) as Record<Fase, ModeloPorRota>

    for (const linha of linhas) {
      const par = { provider: linha.provider, modelo: linha.model }

      // Mesma validação da fronteira IPC, aplicada de novo na leitura: uma linha gravada quando
      // o catálogo tinha outro id degrada para o padrão em vez de propagar um modelo morto até
      // a chamada. `isModeloEscolhido` checa conteúdo, não só forma — é o que impede uma linha
      // `{ anthropic, claude-fable-5-1 }` de sobreviver a um downgrade do catálogo.
      if (!isFase(linha.fase) || !isRotaComModelo(linha.rota) || !isModeloEscolhido(par)) {
        log.db.warn('Modelo de fase ignorado por não casar com o contrato', {
          fase: linha.fase,
          rota: linha.rota
        })
        continue
      }

      fases[linha.fase] = { ...fases[linha.fase], [linha.rota]: par }
    }

    return { user_id: userId, workspace_id: workspaceId, fases }
  }

  /** Grava um combo do workspace e devolve a política resultante. */
  save(
    userId: string,
    workspaceId: WorkspaceId,
    fase: Fase,
    rota: RotaComModelo,
    provider: AiProvider,
    modelo: string,
    agora: Date
  ): PhaseModelPolicy {
    this.db
      .prepare(
        `INSERT INTO phase_model_policy
           (user_id, workspace_id, fase, rota, provider, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, fase, rota) DO UPDATE SET
           provider   = excluded.provider,
           model      = excluded.model,
           updated_at = excluded.updated_at`
      )
      .run(userId, workspaceId, fase, rota, provider, modelo, agora.toISOString())

    log.db.info('Modelo da fase gravado', { fase, rota, provider, modelo })

    return this.find(userId, workspaceId)
  }

  /**
   * O override de um projeto para `(fase, rota)`, ou `undefined` quando herda.
   *
   * `undefined` é o dado, não a ausência dele: é o que `modeloDaFase` recebe para saber que deve
   * herdar. Devolver o par do workspace aqui faria a herança acontecer em dois lugares.
   */
  override(
    userId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    fase: Fase,
    rota: RotaComModelo
  ): ProjectModelOverride | undefined {
    const linha = this.db
      .prepare(
        `SELECT project_id, fase, rota, provider, model
           FROM project_model_override
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND fase = ? AND rota = ?`
      )
      .get(userId, workspaceId, projectId, fase, rota) as OverrideRow | undefined

    if (linha === undefined) return undefined

    const par = { provider: linha.provider, modelo: linha.model }

    if (!isModeloEscolhido(par)) {
      log.db.warn('Override de projeto ignorado por não casar com o contrato', {
        projectId,
        fase,
        rota
      })
      return undefined
    }

    return {
      project_id: projectId,
      fase,
      rota,
      provider: par.provider,
      modelo: par.modelo
    }
  }

  /** Todos os overrides de um projeto — o que a tela do projeto lê para marcar o que divergiu. */
  overridesDoProjeto(
    userId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): readonly ProjectModelOverride[] {
    const linhas = this.db
      .prepare(
        `SELECT project_id, fase, rota, provider, model
           FROM project_model_override
          WHERE user_id = ? AND workspace_id = ? AND project_id = ?`
      )
      .all(userId, workspaceId, projectId) as OverrideRow[]

    const validos: ProjectModelOverride[] = []

    for (const linha of linhas) {
      const par = { provider: linha.provider, modelo: linha.model }
      if (!isFase(linha.fase) || !isRotaComModelo(linha.rota) || !isModeloEscolhido(par)) continue

      validos.push({
        project_id: projectId,
        fase: linha.fase,
        rota: linha.rota,
        provider: par.provider,
        modelo: par.modelo
      })
    }

    return validos
  }

  /** Grava o override do projeto. */
  saveOverride(
    userId: string,
    workspaceId: WorkspaceId,
    override: ProjectModelOverride,
    agora: Date
  ): void {
    this.db
      .prepare(
        `INSERT INTO project_model_override
           (user_id, workspace_id, project_id, fase, rota, provider, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, project_id, fase, rota) DO UPDATE SET
           provider   = excluded.provider,
           model      = excluded.model,
           updated_at = excluded.updated_at`
      )
      .run(
        userId,
        workspaceId,
        override.project_id,
        override.fase,
        override.rota,
        override.provider,
        override.modelo,
        agora.toISOString()
      )

    log.db.info('Override de modelo do projeto gravado', {
      projectId: override.project_id,
      fase: override.fase,
      rota: override.rota
    })
  }

  /**
   * Remove o override — "voltar ao padrão do workspace".
   *
   * Devolve se havia algo a remover, e é isso que o serviço usa para não auditar o que não
   * aconteceu: remover duas vezes registra uma mudança só.
   */
  removeOverride(
    userId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    fase: Fase,
    rota: RotaComModelo
  ): boolean {
    const efeito = this.db
      .prepare(
        `DELETE FROM project_model_override
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND fase = ? AND rota = ?`
      )
      .run(userId, workspaceId, projectId, fase, rota)

    return efeito.changes > 0
  }

  /**
   * Os modelos que o combo de uma rota lista — o catálogo do provider que a atende.
   *
   * Delega ao catálogo em vez de manter lista própria: catálogo e preço são o mesmo fato, e um
   * combo que oferecesse o que a fronteira recusa seria uma tela mentindo.
   */
  modelosDoProvider(provider: AiProvider): readonly string[] {
    return modelosDoCatalogo(provider)
  }
}
