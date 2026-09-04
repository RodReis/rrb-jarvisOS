/**
 * O modelo de cada fase, editável e auditado (SPEC-Fases-02, critérios 2, 3 e 5).
 *
 * A pergunta que este serviço responde para a jornada: **qual par `{ provider, modelo }` atende
 * esta geração?** — resolvendo a herança (override do projeto vence o workspace) por trás de uma
 * chamada só, e registrando toda edição do PI.
 *
 * A auditoria segue a régua do `RoutingService`: **operação recusada não é auditada**. Registrar
 * uma troca que não aconteceu faria a auditoria mentir sobre o estado do sistema — e é
 * justamente a auditoria que o critério 5 manda encadear e verificar.
 */

import type { AiProvider } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Fase } from '@shared/domain/fase'
import type {
  ModeloEscolhido,
  PhaseModelPolicy,
  ProjectModelOverride,
  RotaComModelo
} from '@shared/domain/modelo-da-fase'
import { modeloDaFase, modeloExisteNoCatalogo } from '@shared/domain/modelo-da-fase'
import type { AuditRepository } from '../storage/audit-repository'
import type { PhaseModelRepository } from './phase-model-repository'
import { log } from '../logging/logger'

/** O escopo de toda operação. Espelha `RoutingScope` (F04): camelCase na fronteira do serviço. */
export interface PhaseModelScope {
  readonly userId: string
  readonly workspace: WorkspaceId
}

export class PhaseModelService {
  constructor(
    private readonly repo: PhaseModelRepository,
    private readonly audit: AuditRepository,
    /** Injetável para o teste fixar o `updated_at` sem depender do relógio da máquina. */
    private readonly agora: () => number = () => Date.now()
  ) {}

  /** A política do workspace, com o padrão preenchendo o que nunca foi editado. */
  politica(scope: PhaseModelScope): PhaseModelPolicy {
    return this.repo.find(scope.userId, scope.workspace)
  }

  /** Os overrides de um projeto — o que a tela marca como divergente do workspace. */
  overrides(scope: PhaseModelScope, projectId: string): readonly ProjectModelOverride[] {
    return this.repo.overridesDoProjeto(scope.userId, scope.workspace, projectId)
  }

  /**
   * **O que a jornada chama**: o par que atende esta geração.
   *
   * `projectId` presente = considera o override; ausente = só o workspace. Um `projectId`
   * opcional aqui, e não dois métodos, porque a alternativa seria o chamador escolher entre
   * "com override" e "sem" — e o call site que escolhesse errado geraria pelo modelo que o PI
   * trocou para outra coisa, sem erro nenhum aparecer.
   */
  resolver(
    scope: PhaseModelScope,
    fase: Fase,
    rota: RotaComModelo,
    projectId?: string
  ): ModeloEscolhido {
    const politica = this.repo.find(scope.userId, scope.workspace)
    const override =
      projectId === undefined
        ? undefined
        : this.repo.override(scope.userId, scope.workspace, projectId, fase, rota)

    return modeloDaFase(fase, rota, override, politica)
  }

  /**
   * Troca o modelo de uma fase no workspace.
   *
   * Devolve `undefined` quando o par não existe no catálogo daquele provider — e **não audita**
   * nesse caso. É a segunda barreira: a fronteira IPC já recusou, e esta existe para o dia em
   * que um segundo call site chamar o serviço direto.
   */
  setModeloDaFase(
    scope: PhaseModelScope,
    fase: Fase,
    rota: RotaComModelo,
    provider: AiProvider,
    modelo: string
  ): PhaseModelPolicy | undefined {
    if (!modeloExisteNoCatalogo(provider, modelo)) {
      log.ai.warn('Troca de modelo da fase recusada: fora do catálogo do provider', {
        fase,
        rota,
        provider,
        modelo
      })
      return undefined
    }

    const anterior = modeloDaFase(fase, rota, undefined, this.repo.find(scope.userId, scope.workspace))

    const politica = this.repo.save(
      scope.userId,
      scope.workspace,
      fase,
      rota,
      provider,
      modelo,
      new Date(this.agora())
    )

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'phase-model-change',
      payload: {
        escopo: 'workspace',
        fase,
        rota,
        de: { provider: anterior.provider, modelo: anterior.modelo },
        para: { provider, modelo }
      }
    })

    return politica
  }

  /**
   * Grava o override de um projeto.
   *
   * O `de` do evento é o que **valia antes para este projeto** — o override anterior, ou o
   * workspace quando não havia. Auditar o padrão do workspace como `de` quando já existia um
   * override faria o registro descrever uma troca que não foi a que aconteceu.
   */
  setOverrideDoProjeto(
    scope: PhaseModelScope,
    override: ProjectModelOverride
  ): ProjectModelOverride | undefined {
    if (!modeloExisteNoCatalogo(override.provider, override.modelo)) {
      log.ai.warn('Override de modelo recusado: fora do catálogo do provider', {
        projectId: override.project_id,
        provider: override.provider,
        modelo: override.modelo
      })
      return undefined
    }

    const anterior = this.resolver(scope, override.fase, override.rota, override.project_id)

    this.repo.saveOverride(scope.userId, scope.workspace, override, new Date(this.agora()))

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'phase-model-change',
      payload: {
        escopo: 'projeto',
        projectId: override.project_id,
        fase: override.fase,
        rota: override.rota,
        de: { provider: anterior.provider, modelo: anterior.modelo },
        para: { provider: override.provider, modelo: override.modelo }
      }
    })

    return override
  }

  /**
   * Remove o override — "voltar ao padrão do workspace".
   *
   * `false` quando não havia override, e **sem auditar**: remover duas vezes é uma mudança só, e
   * a segunda não aconteceu.
   */
  removerOverride(
    scope: PhaseModelScope,
    projectId: string,
    fase: Fase,
    rota: RotaComModelo
  ): boolean {
    const anterior = this.repo.override(scope.userId, scope.workspace, projectId, fase, rota)

    if (anterior === undefined) return false

    this.repo.removeOverride(scope.userId, scope.workspace, projectId, fase, rota)

    const doWorkspace = modeloDaFase(
      fase,
      rota,
      undefined,
      this.repo.find(scope.userId, scope.workspace)
    )

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'phase-model-change',
      payload: {
        escopo: 'projeto',
        projectId,
        fase,
        rota,
        de: { provider: anterior.provider, modelo: anterior.modelo },
        para: { provider: doWorkspace.provider, modelo: doWorkspace.modelo },
        // O que distingue "voltou a herdar" de "escolheu o mesmo par do workspace" — dois
        // estados diferentes que sem esta marca teriam payload idêntico.
        herda: true
      }
    })

    return true
  }
}
