/**
 * O roadmap e os gates de aprovação (SPEC-Planejamento-06).
 *
 * Duas operações, e a fronteira entre elas é a fatia inteira:
 *
 *   1. **`gerar`** — compõe o roadmap das decisões e das jornadas, valida o DAG, escreve
 *      `STATUS.md`, `STATUS-ARQUIVO.md` e a SPEC da próxima fatia, e commita `roadmap-aprovado`.
 *      Gerar **não aprova nada**.
 *   2. **`aprovar`** — registra o gate com o conjunto exato de revisões e a identidade do PI.
 *
 * **A separação é o critério 3 e o critério 7 ao mesmo tempo.** Se gerar promovesse o MVP para a
 * fila, a geração estaria aprovando o que ela mesma propôs; se aprovar aceitasse um autor
 * qualquer, a delegação aprovaria gate. Os dois erros têm a mesma forma — quem propõe decidindo
 * que a proposta vale —, e a fronteira entre os métodos é o que os impede.
 *
 * **Sem sessão autenticada não há aprovação** (decisão cravada da spec). O gate falha fechado,
 * com `sem-identidade`, nunca "aprova como anônimo": uma aprovação sem identidade não responde
 * a pergunta que o critério 4 faz — *quem* aceitou.
 *
 * **Nenhuma chamada de IA nesta fatia.** O roadmap é composto (`roadmap-compositor.ts`), como o
 * pacote da M8-F04 e a arquitetura da M8-F05.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Approval, AprovacaoOutcome, Gate, RevisaoAprovada } from '@shared/domain/aprovacoes'
import { aprovacaoVigente, gatesInvalidados } from '@shared/domain/aprovacoes'
import type { MudancaDeArtefato } from '@shared/domain/aprovacoes'
import type { Roadmap, RoadmapOutcome, Slice } from '@shared/domain/roadmap'
import { ordemDeExecucao, proximaFatia, validarDag } from '@shared/domain/roadmap'
import {
  ARQUIVO_DO_ARQUIVO_HISTORICO,
  ARQUIVO_DO_STATUS,
  comporRoadmap,
  renderizarArquivoHistorico,
  renderizarSpec,
  renderizarStatus
} from '@shared/domain/roadmap-compositor'
import { jornadasCobertas } from '@shared/domain/validacao-de-prototipo'
import type { Pergunta } from '@shared/domain/wizard'
import { decisoesVigentes } from '@shared/domain/wizard'
import { CATALOGO_DO_CONTEXTO } from '@shared/domain/wizard-catalogo'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { AnexoService } from './anexo-service'
import type { DecisionRepository } from './decision-repository'
import type { PacoteRepository } from './pacote-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'
import type { EscopoDoRoadmap, RoadmapRepository } from './roadmap-repository'

interface RoadmapDeps {
  readonly repository: RoadmapRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly decisions: DecisionRepository
  readonly pacotes: PacoteRepository
  readonly anexos: AnexoService
  readonly audit: AuditRepository
  readonly userId: () => string
  /** A identidade do PI: o usuário autenticado. `undefined` ⇒ sem sessão ⇒ sem aprovação. */
  readonly identidade: () => string | undefined
  readonly catalogo?: readonly Pergunta[]
  /**
   * Como o roadmap é composto. Injetável **só** para o teste, e por um motivo concreto: o
   * compositor de produção só produz `[]` ou `['mvp-fundacao']` como dependência, então nunca
   * gera ciclo — e a guarda do critério 1 ficaria sem como ser exercitada.
   *
   * A guarda **não** é código morto: ela protege contra o compositor mudar (uma estratégia nova
   * de roadmap pode gerar dependências cruzadas) e contra um roadmap vindo do banco com linhas
   * corrompidas. O que falta é só o caminho para provocá-la em teste — e essa costura é ele.
   */
  readonly compor?: typeof comporRoadmap
}

export class RoadmapService {
  private readonly repository: RoadmapRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly decisions: DecisionRepository
  private readonly pacotes: PacoteRepository
  private readonly anexos: AnexoService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly identidade: () => string | undefined
  private readonly catalogo: readonly Pergunta[]
  private readonly compor: typeof comporRoadmap

  constructor(deps: RoadmapDeps) {
    this.repository = deps.repository
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.decisions = deps.decisions
    this.pacotes = deps.pacotes
    this.anexos = deps.anexos
    this.audit = deps.audit
    this.userId = deps.userId
    this.identidade = deps.identidade
    this.catalogo = deps.catalogo ?? CATALOGO_DO_CONTEXTO
    this.compor = deps.compor ?? comporRoadmap
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
   * Gera o roadmap: compõe, valida o DAG, escreve e commita.
   *
   * A ordem das recusas é a garantia:
   *   1. **Projeto existe?** A checagem que não escreve vem primeiro.
   *   2. **Há base para compor?** Sem decisão de escopo ou sem jornada, recusa — assumir uma
   *      estratégia seria escolher pelo PI, e inventar jornada seria prometer o que ninguém
   *      desenhou.
   *   3. **O DAG é válido?** Ciclo ou dependência ausente ⇒ recusa **antes de escrever**
   *      (critério 1). Descobrir depois seria descobrir tarde.
   *   4. **Escreve, persiste e commita `roadmap-aprovado`.**
   *
   * **A geração não promove nem aprova nada.** Os MVPs nascem `proposto` (critério 3) e a SPEC
   * nasce `rascunho`.
   */
  async gerar(projectId: string, workspaceId: WorkspaceId): Promise<RoadmapOutcome> {
    const userId = this.userId()
    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const decisoes = decisoesVigentes(this.decisions.listar(userId, projectId))
    // As jornadas vêm da validação dos protótipos (M8-F05): é o mesmo conjunto que a arquitetura
    // usou, e não uma segunda leitura que poderia divergir dela.
    const jornadas = jornadasCobertas(await this.anexos.validar(projectId))

    const roadmap = this.compor(this.catalogo, decisoes, jornadas)
    if (roadmap.mvps.length === 0) {
      return {
        reason: 'sem-base',
        mensagem:
          decisoes.escopo === undefined
            ? 'Responda a pergunta de escopo no planejamento: ela decide a forma do roadmap.'
            : 'Nenhuma jornada prototipada. Anexe protótipos antes de gerar o roadmap.'
      }
    }

    const problemas = validarDag(roadmap.mvps)
    if (problemas.length > 0) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'roadmap',
        payload: { projectId, fase: 'dag-invalido', problemas: problemas.length }
      })
      return {
        reason: 'dag-invalido',
        problemas: problemas.map((p) => ({ mensagem: p.mensagem })),
        mensagem: 'O roadmap composto tem dependências inválidas.'
      }
    }

    const escopo = this.escopo(projectId, workspaceId)
    const salvo = this.repository.salvarRoadmap(escopo, roadmap)
    const proxima = proximaFatia(salvo)

    const escrita = this.escrever(projeto.diretorio, projeto.nome, salvo, proxima)
    if (!escrita.ok) {
      return { reason: 'falha-de-escrita', mensagem: escrita.mensagem }
    }

    // A fatia detalhada é marcada **depois** da escrita: marcar antes deixaria uma fatia
    // "detalhada" cuja spec não existe no disco, se a escrita falhasse.
    if (proxima !== undefined) this.repository.marcarDetalhada(escopo, proxima.id)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'roadmap',
      payload: {
        projectId,
        fase: 'gerado',
        mvps: salvo.mvps.length,
        slices: salvo.slices.length,
        proxima: proxima?.specSlug ?? null
      }
    })

    const marco = this.projectService.concluirMarco(projectId, 'roadmap-aprovado', workspaceId)

    log.agent.info('Roadmap gerado', { projectId, mvps: salvo.mvps.length })

    return {
      reason: 'gerado',
      roadmap: this.repository.carregar(escopo),
      ...(proxima !== undefined ? { proxima } : {}),
      mensagem:
        marco?.commitado === true
          ? 'Roadmap gerado e commitado.'
          : 'Roadmap gerado. O commit do marco falhou e pode ser retomado.'
    }
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

    const roadmap = this.repository.carregar(escopo)

    if (gate === 'MVP_ENTRY') {
      // O hash de um MVP é do seu conteúdo composto — título, tese e dependências. Mudar a tese
      // é mudar o que foi aprovado; reordenar o array não é.
      return roadmap.mvps.map((m) => ({
        artefato: m.id,
        hash: hashDoTexto(`${m.titulo}|${m.tese}|${[...m.dependeDe].sort().join(',')}`)
      }))
    }

    // SLICE_ENTRY: só a fatia detalhada tem SPEC a aprovar.
    return roadmap.slices
      .filter((s) => s.detalhada)
      .map((s) => ({ artefato: s.specSlug, hash: hashDoTexto(`${s.titulo}|${s.specSlug}`) }))
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

    // `MVP_ENTRY` é o que promove: é aqui, e só aqui, que um MVP sai de `proposto` (critério 3).
    if (gate === 'MVP_ENTRY') {
      const roadmap = this.repository.carregar(escopo)
      const ordem = ordemDeExecucao(roadmap.mvps) ?? []
      const primeiro = ordem
        .map((id) => roadmap.mvps.find((m) => m.id === id))
        .find((m) => m?.estado === 'proposto')
      if (primeiro !== undefined) this.repository.promover(escopo, primeiro.id)
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

  /** Escreve o STATUS, o histórico e a SPEC da próxima fatia. Caminhos constantes ou derivados. */
  private escrever(
    diretorio: string,
    nomeDoProjeto: string,
    roadmap: Roadmap,
    proxima: Slice | undefined
  ): { readonly ok: boolean; readonly mensagem: string } {
    const raiz = resolve(diretorio)
    const hoje = new Date().toISOString().slice(0, 10)

    const arquivos: { caminho: string; conteudo: string }[] = [
      {
        caminho: ARQUIVO_DO_STATUS,
        conteudo: renderizarStatus(nomeDoProjeto, roadmap, proxima, hoje)
      },
      {
        caminho: ARQUIVO_DO_ARQUIVO_HISTORICO,
        conteudo: renderizarArquivoHistorico(nomeDoProjeto, [], hoje)
      }
    ]

    if (proxima !== undefined) {
      arquivos.push({
        caminho: proxima.specSlug,
        conteudo: renderizarSpec(
          proxima,
          roadmap.mvps.find((m) => m.id === proxima.mvpId),
          hoje
        )
      })
    }

    try {
      for (const arquivo of arquivos) {
        const alvo = resolve(join(raiz, arquivo.caminho))
        // O `specSlug` é derivado de `slugificar`, que já remove separadores de caminho — mas a
        // barreira permanece: derivado hoje não é constante para sempre.
        if (relative(raiz, alvo).startsWith('..')) {
          return { ok: false, mensagem: 'Caminho de documento fora do projeto.' }
        }
        mkdirSync(dirname(alvo), { recursive: true })
        writeFileSync(alvo, arquivo.conteudo, 'utf8')
      }
      return { ok: true, mensagem: 'Documentos escritos.' }
    } catch (causa) {
      log.agent.error('Falha ao escrever o roadmap', {
        stack: causa instanceof Error ? causa.stack : undefined
      })
      return { ok: false, mensagem: 'Não foi possível escrever os documentos no projeto.' }
    }
  }
}

/** O hash de um conteúdo composto. Nomeado porque aparece nos dois gates de roadmap. */
function hashDoTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}
