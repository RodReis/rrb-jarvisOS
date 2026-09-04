/**
 * Os gates de aprovação do roadmap (SPEC-Planejamento-06, § gates; SPEC-Jornada-05).
 *
 * Este serviço registra o aceite: `MVP_ENTRY` e `SLICE_ENTRY` — com o conjunto exato de revisões
 * e a identidade do PI.
 *
 * **A composição saiu daqui** (decisão do PI de 2026-09-03, mesma da F04 com a arquitetura). Até
 * a M8-F06 este serviço também *montava* o roadmap das decisões do wizard e das jornadas
 * prototipadas; agora quem o propõe é o `RoadmapGeradoService`, com origem por MVP e validação da
 * saída. Dois caminhos para o mesmo `STATUS.md` produziriam dois roadmaps com garantias
 * diferentes, e só um deles passa pelo validador de origem.
 *
 * **Propor e aprovar continuam separados, e é o critério 3 e o critério 7 ao mesmo tempo.** A
 * geração propõe; o aceite é daqui. Se gerar promovesse o MVP para a fila, a geração estaria
 * aprovando o que ela mesma propôs; se aprovar aceitasse um autor qualquer, a delegação aprovaria
 * gate. Os dois erros têm a mesma forma — quem propõe decidindo que a proposta vale.
 *
 * **Sem sessão autenticada não há aprovação** (decisão cravada da spec). O gate falha fechado,
 * com `sem-identidade`, nunca "aprova como anônimo": uma aprovação sem identidade não responde
 * a pergunta que o critério 4 faz — *quem* aceitou.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Approval, AprovacaoOutcome, Gate, RevisaoAprovada } from '@shared/domain/aprovacoes'
import { aprovacaoVigente, gatesInvalidados } from '@shared/domain/aprovacoes'
import type { MudancaDeArtefato } from '@shared/domain/aprovacoes'
import type { Roadmap } from '@shared/domain/roadmap'
import type { RoadmapRegistrado } from '@shared/domain/roadmap-gerado'
import { specPodeSerAceita } from '@shared/domain/roadmap-gerado'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { AnexoService } from './anexo-service'
import type { PacoteRepository } from './pacote-repository'
import type { ProjectRepository } from './project-repository'
import type { EscopoDoRoadmap, RoadmapRepository } from './roadmap-repository'

interface RoadmapDeps {
  readonly repository: RoadmapRepository
  readonly projects: ProjectRepository
  readonly pacotes: PacoteRepository
  readonly anexos: AnexoService
  readonly audit: AuditRepository
  readonly userId: () => string
  /** A identidade do PI: o usuário autenticado. `undefined` ⇒ sem sessão ⇒ sem aprovação. */
  readonly identidade: () => string | undefined
  /**
   * A revisão gerada do roadmap — o que os gates `MVP_ENTRY` e `SLICE_ENTRY` aprovam
   * (SPEC-Jornada-05).
   *
   * Injetada, e não lida do repositório aqui, porque quem sabe qual revisão vale é o
   * `RoadmapGeradoService`: duplicar essa leitura criaria uma segunda resposta para a mesma
   * pergunta, e o gate poderia aprovar uma revisão diferente da que a tela mostrou.
   */
  readonly roadmapGerado: (projectId: string) => RoadmapRegistrado | undefined
}

export class RoadmapService {
  private readonly repository: RoadmapRepository
  private readonly projects: ProjectRepository
  private readonly pacotes: PacoteRepository
  private readonly anexos: AnexoService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly identidade: () => string | undefined
  private readonly roadmapGerado: (projectId: string) => RoadmapRegistrado | undefined

  constructor(deps: RoadmapDeps) {
    this.repository = deps.repository
    this.projects = deps.projects
    this.pacotes = deps.pacotes
    this.anexos = deps.anexos
    this.audit = deps.audit
    this.userId = deps.userId
    this.identidade = deps.identidade
    this.roadmapGerado = deps.roadmapGerado
  }

  /** O roadmap gravado do projeto. */
  carregar(projectId: string, workspaceId: WorkspaceId): Roadmap {
    return this.repository.carregar(this.escopo(projectId, workspaceId))
  }

  /** As aprovações registradas, da mais recente à mais antiga. */
  aprovacoes(projectId: string, workspaceId: WorkspaceId): readonly Approval[] {
    return this.repository.listarAprovacoes(this.escopo(projectId, workspaceId))
  }

  /**
   * As revisões que um gate aprova, hoje.
   *
   * É o que o critério 4 chama de *"hashes exatos"*, montado no instante da pergunta: o gate não
   * guarda uma lista fixa de artefatos, porque o que existe muda entre um projeto e outro.
   */
  revisoesDoGate(
    projectId: string,
    gate: Gate,
    workspaceId: WorkspaceId
  ): readonly RevisaoAprovada[] {
    const userId = this.userId()
    const escopo = this.escopo(projectId, workspaceId)

    if (gate === 'PROJECT_PACKAGE') {
      const [prd] = this.pacotes.listarPacotes(userId, projectId)
      const [arquitetura] = this.anexos.listarArquiteturas(projectId)
      const anexos = this.anexos.listar(projectId)

      return [
        ...(prd?.documentos ?? []).map((d) => ({ artefato: d.caminho, hash: d.hash })),
        ...(arquitetura?.documentos ?? []).map((d) => ({ artefato: d.caminho, hash: d.hash })),
        // Os anexos entram porque o gate os lista literalmente (§ Gates: "Design System,
        // protótipos"), e porque aprovar a arquitetura sem eles aprovaria um pacote cujo design
        // pode ter mudado depois.
        ...anexos.map((a) => ({ artefato: a.caminho, hash: a.hash }))
      ]
    }

    // Os dois gates do roadmap aprovam a **revisão gerada** (SPEC-Jornada-05), não a projeção:
    // é ali que moram as origens por MVP e as respostas das perguntas abertas, que é o que o PI
    // lê antes de aceitar. A projeção é o índice; a revisão é o conteúdo.
    const gerado = this.roadmapGerado(projectId)
    if (gerado === undefined) return []

    if (gate === 'MVP_ENTRY') {
      // Só o MVP **escolhido** entra: o gate aprova a entrada de um MVP na fila, e listar os
      // outros faria o aceite carregar hashes de propostas que ninguém escolheu — mudar uma
      // delas invalidaria um gate que não falava sobre ela.
      const escolhido = gerado.mvps.find((m) => m.id === gerado.mvpEscolhido)
      if (escolhido === undefined) return []

      // O hash é do conteúdo do MVP — título, tese, resultado, dependências e o checklist de
      // fatias. Mudar a tese ou tirar uma fatia é mudar o que foi aprovado; reordenar o array
      // não é, e por isso as dependências entram ordenadas.
      return [
        {
          artefato: escolhido.id,
          hash: hashDoTexto(
            [
              escolhido.titulo,
              escolhido.tese,
              escolhido.resultado,
              [...escolhido.dependeDe].sort().join(','),
              escolhido.fatias.map((f) => f.titulo).join(',')
            ].join('|')
          )
        }
      ]
    }

    // SLICE_ENTRY: a SPEC gerada, **com as respostas**.
    //
    // Enquanto houver pergunta aberta o gate não tem objeto: a lista vazia faz `aprovar` recusar
    // com `sem-revisoes`, que é o critério 4 — *"aceite recusado enquanto houver pergunta sem
    // resposta"*. E as respostas entram no hash porque responder **é** mudança da SPEC: um hash
    // cego a elas aprovaria um documento diferente do que o PI leu.
    const spec = gerado.spec
    if (spec === undefined || !specPodeSerAceita(spec)) return []

    const fatia = this.repository.carregar(escopo).slices.find((s) => s.id === spec.fatiaId)

    return [
      {
        artefato: fatia?.specSlug ?? spec.fatiaId,
        hash: hashDoTexto(
          JSON.stringify({
            titulo: spec.titulo,
            objetivo: spec.objetivo,
            fluxo: spec.fluxo,
            regras: spec.regras,
            criterios: spec.criteriosDeAceite,
            testes: spec.testes,
            respostas: spec.perguntas.map((pergunta) => `${pergunta.id}=${pergunta.resposta ?? ''}`)
          })
        )
      }
    ]
  }

  /**
   * Registra a aprovação de um gate.
   *
   * **Quatro recusas, e cada uma protege um critério distinto:**
   *  - sem projeto ⇒ nada a aprovar;
   *  - **sem identidade ⇒ falha fechado** (decisão cravada): uma aprovação sem quem a fez não
   *    responde o que o critério 4 pergunta;
   *  - sem revisões ⇒ o gate não tem objeto: aprovar o vazio registraria um aceite sobre nada;
   *  - **já aprovado ⇒ `ja-aprovado`** (critério 5): a mesma revisão não pede novo aceite, e
   *    insistir ensinaria o PI a clicar sem ler.
   */
  aprovar(projectId: string, gate: Gate, workspaceId: WorkspaceId): AprovacaoOutcome {
    const userId = this.userId()
    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const identidade = this.identidade()
    if (identidade === undefined || identidade.trim() === '') {
      return {
        reason: 'sem-identidade',
        mensagem: 'Entre na sua conta para aprovar: a aprovação registra quem aceitou.'
      }
    }

    const escopo = this.escopo(projectId, workspaceId)
    const revisoes = this.revisoesDoGate(projectId, gate, workspaceId)
    if (revisoes.length === 0) {
      return {
        reason: 'sem-revisoes',
        mensagem: 'Este gate ainda não tem o que aprovar.'
      }
    }

    const existentes = this.repository.listarAprovacoes(escopo)
    const vigente = aprovacaoVigente(existentes, gate, revisoes)
    if (vigente !== undefined) {
      return {
        reason: 'ja-aprovado',
        vigente,
        mensagem: 'Esta mesma revisão já foi aprovada. Nada mudou desde então.'
      }
    }

    const approval = this.repository.registrarAprovacao({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      gate,
      revisoes,
      identidade,
      autor: 'pi',
      created_at: new Date().toISOString()
    })

    // O evento carrega o gate, a contagem e a identidade — **nunca o conteúdo** (ADR-004).
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'approval',
      payload: { projectId, gate, revisoes: revisoes.length, identidade, fase: 'aprovado' }
    })

    // `MVP_ENTRY` promove **o MVP que o PI escolheu**, e não o primeiro da ordem topológica
    // (pergunta 1 da SPEC-Jornada-05, resolvida pelo PI em 2026-09-03). O automático da M8-F06
    // existia porque aquela spec não definia quem escolhia; agora define, e escolher pelo PI
    // seria decidir por ele justo no gate que existe para ele decidir.
    if (gate === 'MVP_ENTRY') {
      const escolhido = this.roadmapGerado(projectId)?.mvpEscolhido
      if (escolhido !== null && escolhido !== undefined) {
        this.repository.promover(escopo, escolhido)
      }
    }

    log.agent.info('Gate aprovado', { projectId, gate })
    return { reason: 'aprovado', approval, mensagem: 'Aprovado.' }
  }

  /**
   * O que uma mudança invalidaria — **antes** de ela ser aplicada (critério 6).
   *
   * Consulta pura: não grava nada, não muda nada. É o que a tela chama para mostrar ao PI o
   * custo de uma mudança antes de ele decidir fazê-la; mostrar depois seria informá-lo de um
   * estrago já feito.
   */
  simularMudanca(
    projectId: string,
    mudancas: readonly MudancaDeArtefato[],
    workspaceId: WorkspaceId
  ): readonly Gate[] {
    const escopo = this.escopo(projectId, workspaceId)
    return gatesInvalidados(this.repository.listarAprovacoes(escopo), mudancas)
  }

  private escopo(projectId: string, workspaceId: WorkspaceId): EscopoDoRoadmap {
    return { userId: this.userId(), workspaceId, projectId }
  }
}

/** O hash de um conteúdo composto. Nomeado porque aparece nos dois gates de roadmap. */
function hashDoTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}
