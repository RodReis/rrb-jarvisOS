/**
 * O serviço do wizard orientado (SPEC-Planejamento-03).
 *
 * A ordem das etapas de `responder` é a garantia inteira:
 *
 *   1. **Projeto existe?** Não ⇒ `undefined`. Antes de tudo, porque é a checagem que não escreve.
 *   2. **Pergunta existe no catálogo?** Não ⇒ recusa. O renderer manda `perguntaId`, e aceitar
 *      um id desconhecido gravaria decisão sobre pergunta que ninguém fez.
 *   3. **A escolha é uma opção real da pergunta?** Não ⇒ recusa. Sem isto, o IPC aceitaria
 *      qualquer string como escolha, e o histórico registraria decisão impossível.
 *   4. **Delegação é permitida nesta pergunta?** Não ⇒ recusa — a regra mora no domínio
 *      (`decidirPorMim`), não no botão da tela.
 *   5. **Há contradição?** ⇒ **devolve sem gravar** (critério 5). É a única saída em que nada
 *      é escrito apesar de tudo estar válido: o PI precisa ver a decisão anterior e aceitar.
 *   6. **Grava** a decisão, audita e autosalva o rascunho.
 *
 * **A contradição não é corrigida aqui, e essa é a decisão central do serviço.** Seria mais
 * curto substituir a decisão dependente e seguir; é exatamente o que o critério 5 proíbe. O
 * serviço devolve `contradicoes` e espera o PI voltar com `aceitarSubstituicao`.
 *
 * **O que este serviço não faz:** não commita (marco documental é `ProjectService.concluirMarco`,
 * spec § Fluxo 6) e não chama modelo — a recomendação vem do catálogo, que é dado.
 */

import { randomUUID } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  Decision,
  EstadoDoWizard,
  Pergunta,
  Resposta,
  RespostaOutcome
} from '@shared/domain/wizard'
import {
  decidirPorMim,
  decisoesVigentes,
  detectarContradicoes,
  estadoDoWizard
} from '@shared/domain/wizard'
import { CATALOGO_DO_CONTEXTO, ETAPA_DO_CONTEXTO } from '@shared/domain/wizard-catalogo'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { DecisionRepository } from './decision-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'

interface WizardDeps {
  readonly decisions: DecisionRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly audit: AuditRepository
  readonly userId: () => string
  /** O catálogo é injetável para o teste; em produção é sempre o do contexto. */
  readonly catalogo?: readonly Pergunta[]
}

export class WizardService {
  private readonly decisions: DecisionRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly catalogo: readonly Pergunta[]

  constructor(deps: WizardDeps) {
    this.decisions = deps.decisions
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.audit = deps.audit
    this.userId = deps.userId
    this.catalogo = deps.catalogo ?? CATALOGO_DO_CONTEXTO
  }

  /**
   * O estado atual do wizard — pergunta pendente, conclusão ou bloqueio.
   *
   * Calculado do histórico gravado a cada chamada, e não guardado em campo: é o que faz a
   * retomada do critério 6 ser estrutural. Uma sessão fechada no meio reabre na mesma pergunta
   * porque a resposta vem do banco, não de estado que morreu com a janela.
   */
  estado(projectId: string): EstadoDoWizard | undefined {
    const userId = this.userId()
    if (!this.projects.findById(userId, projectId)) return undefined

    return estadoDoWizard(this.catalogo, this.decisions.listar(userId, projectId))
  }

  /** O histórico completo, incluindo as substituídas — é o resumo do critério 7. */
  historico(projectId: string): readonly Decision[] {
    return this.decisions.listar(this.userId(), projectId)
  }

  /**
   * Registra uma resposta do PI (ou a delegação ao agente).
   *
   * Devolve `contradicao-pendente` **sem gravar** quando a resposta invalida decisões já
   * tomadas e o PI ainda não aceitou a substituição.
   */
  responder(projectId: string, resposta: Resposta, workspaceId: WorkspaceId): RespostaOutcome {
    const userId = this.userId()
    if (!this.projects.findById(userId, projectId)) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const pergunta = this.catalogo.find((p) => p.id === resposta.perguntaId)
    if (!pergunta) {
      return {
        reason: 'pergunta-desconhecida',
        mensagem: 'Pergunta desconhecida; nada foi gravado.'
      }
    }

    const delegada = resposta.autor === 'agente'
    // A regra de delegabilidade vem do domínio, não do fato de a tela ter mostrado o botão:
    // um caminho novo (atalho, IPC direto) delegaria o que a spec não permite delegar.
    const decidida = delegada ? decidirPorMim(pergunta) : null
    if (delegada && decidida === null) {
      return {
        reason: 'nao-delegavel',
        mensagem: 'Esta decisão precisa do PI e não pode ser delegada.'
      }
    }

    const escolha = decidida?.escolha ?? resposta.escolha
    const texto = decidida ? null : resposta.texto
    if (!this.escolhaValida(pergunta, escolha, texto)) {
      return { reason: 'escolha-invalida', mensagem: 'Escolha inválida para esta pergunta.' }
    }

    const historico = this.decisions.listar(userId, projectId)
    const vigentes = decisoesVigentes(historico)
    const contradicoes = detectarContradicoes(this.catalogo, vigentes, pergunta.id)

    if (contradicoes.length > 0 && resposta.aceitarSubstituicao !== true) {
      return {
        reason: 'contradicao-pendente',
        contradicoes,
        mensagem: 'Esta resposta muda decisões já tomadas. Confirme a substituição.'
      }
    }

    const agora = new Date().toISOString()
    const anterior = vigentes[pergunta.id]
    const decisao = this.decisions.registrar({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      perguntaId: pergunta.id,
      etapa: pergunta.etapa,
      escolha,
      texto,
      recomendacao: pergunta.recomendada,
      justificativa: decidida?.justificativa ?? pergunta.justificativa,
      autor: decidida?.autor ?? 'pi',
      motivo: decidida
        ? 'delegada'
        : anterior !== undefined
          ? 'substituida'
          : texto !== null
            ? 'texto-livre'
            : 'escolhida',
      // Aponta para a decisão que esta trocou. É este elo que torna a substituição auditável —
      // e é por ele que `decisoesVigentes` sabe qual das duas vale.
      substituiu: anterior?.id ?? null,
      created_at: agora
    })

    // Decisão **é** auditada, ao contrário do autosave: um rascunho por tecla afogaria a
    // cadeia, mas uma escolha registrada é exatamente o que a trilha existe para guardar.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'planning-decision',
      payload: {
        projectId,
        perguntaId: pergunta.id,
        etapa: pergunta.etapa,
        autor: decisao.autor,
        motivo: decisao.motivo,
        escolha: decisao.escolha,
        recomendacao: decisao.recomendacao,
        substituiu: decisao.substituiu
      }
    })

    // As contradições só chegam aqui com aceite explícito; marcar as afetadas como pendentes
    // de revisão é o que faz o critério 4 recalcular **somente** o afetado.
    this.autosalvar(projectId, workspaceId, historico.concat(decisao))

    log.agent.info('Decisão de planejamento registrada', {
      projectId,
      perguntaId: pergunta.id,
      autor: decisao.autor
    })

    return {
      reason: 'registrada',
      decisao,
      estado: estadoDoWizard(this.catalogo, this.decisions.listar(userId, projectId)),
      mensagem: 'Decisão registrada.'
    }
  }

  /**
   * A escolha precisa ser uma opção real, ou texto livre numa pergunta que o aceita.
   *
   * Validar aqui, e não só na tela, é o que impede o IPC de gravar decisão impossível: o
   * renderer é fronteira não confiável (ADR: renderer nunca decide política).
   */
  private escolhaValida(pergunta: Pergunta, escolha: string | null, texto: string | null): boolean {
    if (escolha !== null) return pergunta.opcoes.some((o) => o.id === escolha)
    if (texto !== null) return pergunta.aceitaTextoLivre && texto.trim().length > 0
    return false
  }

  /**
   * Espelha as decisões vigentes no rascunho da sessão (autosave do critério "salvar antes de
   * avançar"). O `PlanningSession` continua sendo o estado de trabalho; a trilha é a `decision`.
   */
  private autosalvar(
    projectId: string,
    workspaceId: WorkspaceId,
    historico: readonly Decision[]
  ): void {
    const vigentes = decisoesVigentes(historico)
    const respostas = Object.fromEntries(
      Object.entries(vigentes).map(([perguntaId, d]) => [perguntaId, d.escolha ?? d.texto])
    )
    this.projectService.salvarRespostas(projectId, ETAPA_DO_CONTEXTO, respostas, workspaceId)
  }
}
