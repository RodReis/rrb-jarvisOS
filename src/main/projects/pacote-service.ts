/**
 * A geração do pacote estrutural: PRD, Landscape e Convention (SPEC-Planejamento-04).
 *
 * A ordem das etapas é a garantia inteira, e cada uma existe por um motivo distinto:
 *
 *   1. **Projeto existe?** Não ⇒ recusa. Antes de tudo, porque é a checagem que não escreve.
 *   2. **As decisões que o PRD usa estão tomadas?** Não ⇒ recusa **nomeando as pendentes**. O
 *      critério 1 exige origem para todo requisito material; sem a decisão, a origem não existe
 *      e a única alternativa seria inventá-la.
 *   3. **A pesquisa do Landscape sai?** Falhou ⇒ `pesquisa-bloqueada`, com os cinco campos do
 *      `BloqueioExterno`. **Nunca preencher por memória do modelo** (critério 3) — e é aqui que
 *      isso deixa de ser promessa: não existe caminho neste serviço que produza afirmação de
 *      Landscape sem `EvidenceItem`, porque `afirmacoesDoLandscape` só aceita fontes extraídas.
 *   4. **A evidência sustenta as afirmações?** `verificarEvidencia().completo === false` ⇒
 *      bloqueia. O verificador é da M6-F06, escrito para esta fatia; a decisão de bloquear é
 *      desta, como o comentário de lá declara.
 *   5. **Compõe, escreve, hasheia e persiste.** Só aqui o disco é tocado.
 *   6. **Commita o marco `prd-aprovado`** — pelo `ProjectService`, que é o único gatilho de
 *      commit (M8-F01, spec § Fluxo 6). Falha de commit **não** perde o pacote.
 *
 * **A pesquisa passa pelo `ConnectorService`, nunca pelo `TavilyAdapter` direto.** O gate de
 * créditos vive dentro do `call()`, e instanciar o adapter aqui seria o segundo caminho sem gate
 * que o serviço de conectores existe para impedir — mesma razão pela qual o `GitRunner` recebe o
 * terminal controlado e não um cliente de Git.
 *
 * **Nenhuma chamada de IA acontece nesta fatia.** Os documentos são compostos das decisões e das
 * evidências (`pacote-compositor.ts`); não há texto gerado por modelo, e por isso não há
 * `ContextPack` a montar aqui. Quando houver geração, ela entra pelo ponto único com
 * `contextPackId`, como a M8-F02 exige — e a composição continua sendo o esqueleto.
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Pergunta } from '@shared/domain/wizard'
import { decisoesVigentes } from '@shared/domain/wizard'
import { CATALOGO_DO_CONTEXTO } from '@shared/domain/wizard-catalogo'
import type {
  AfirmacaoDoPacote,
  BloqueioExterno,
  DocumentoDoPacote,
  DocumentoGerado,
  PacoteEstrutural,
  PacoteOutcome
} from '@shared/domain/pacote-estrutural'
import {
  ARQUIVO_DO_DOCUMENTO,
  PERGUNTAS_DO_PRD,
  pendenciasDoPrd
} from '@shared/domain/pacote-estrutural'
import type { FonteDoLandscape } from '@shared/domain/pacote-compositor'
import {
  PREAMBULO_DO_DOCUMENTO,
  SECOES_DO_DOCUMENTO,
  afirmacoesDaConvention,
  afirmacoesDoLandscape,
  afirmacoesDoPrd,
  gatilhosDeRevisao,
  renderizarDocumento
} from '@shared/domain/pacote-compositor'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import type { TavilyExtractData, TavilySearchData } from '@shared/domain/tavily'
import { CONNECTOR_CONTRACT_VERSION } from '@shared/domain/connectors'
import { MAX_URLS_EXTRACT, TAVILY_OPERATIONS } from '@shared/domain/tavily'
import { verificarEvidencia, type Afirmacao } from '../connectors/tavily/evidencia'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { ConnectorService } from '../connectors/connector-service'
import type { DecisionRepository } from './decision-repository'
import type { PacoteRepository } from './pacote-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'

/** Quanto tempo a pesquisa tem. Nomeado porque aparece nas duas chamadas. */
const TIMEOUT_DA_PESQUISA_MS = 30_000

/**
 * Quantas fontes o Landscape busca. Modesto de propósito: cada URL extraída custa crédito, e o
 * teto real de gasto é o gate do `ConnectorService` — este número evita chegar nele à toa.
 */
const MAX_FONTES_DO_LANDSCAPE = 5

interface PacoteDeps {
  readonly repository: PacoteRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly decisions: DecisionRepository
  readonly connectors: ConnectorService
  readonly audit: AuditRepository
  readonly userId: () => string
  /** O catálogo é injetável para o teste; em produção é sempre o do contexto. */
  readonly catalogo?: readonly Pergunta[]
}

/** O pedido de geração. `consulta` é o que o Landscape vai pesquisar. */
export interface PedidoDePacote {
  readonly projectId: string
  /** O termo de pesquisa de mercado. Vazio ⇒ o Landscape sai sem cenário, e diz isso. */
  readonly consulta: string
}

export class PacoteService {
  private readonly repository: PacoteRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly decisions: DecisionRepository
  private readonly connectors: ConnectorService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly catalogo: readonly Pergunta[]

  constructor(deps: PacoteDeps) {
    this.repository = deps.repository
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.decisions = deps.decisions
    this.connectors = deps.connectors
    this.audit = deps.audit
    this.userId = deps.userId
    this.catalogo = deps.catalogo ?? CATALOGO_DO_CONTEXTO
  }

  /** Os pacotes já gerados, do mais recente ao mais antigo. */
  listar(projectId: string): readonly PacoteEstrutural[] {
    return this.repository.listarPacotes(this.userId(), projectId)
  }

  /** As evidências coletadas do projeto — a prova que sustenta o Landscape. */
  evidencias(projectId: string): ReturnType<PacoteRepository['listarEvidencias']> {
    return this.repository.listarEvidencias(this.userId(), projectId)
  }

  /**
   * Gera o pacote estrutural.
   *
   * Devolve `PacoteOutcome` **inclusive nas recusas**: "a pesquisa não saiu" não é falha
   * técnica, é o desfecho que o PI precisa ler com a ação de retomada junto.
   */
  async gerar(pedido: PedidoDePacote, workspaceId: WorkspaceId): Promise<PacoteOutcome> {
    const userId = this.userId()
    const projeto = this.projects.findById(userId, pedido.projectId)
    if (projeto === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    // (2) As decisões que o PRD usa. Sem elas não há origem, e sem origem não há requisito.
    const decisoes = decisoesVigentes(this.decisions.listar(userId, pedido.projectId))
    const pendencias = pendenciasDoPrd(Object.keys(decisoes))
    if (pendencias.length > 0) {
      return {
        reason: 'decisoes-incompletas',
        pendencias,
        mensagem: `Faltam decisões do planejamento: ${pendencias.join(', ')}.`
      }
    }

    // (3) A pesquisa do Landscape. Consulta vazia é decisão do chamador, não falha: o
    // Landscape sai sem cenário e **declara** a seção vazia, em vez de fingir cobertura.
    const pesquisa =
      pedido.consulta.trim() === ''
        ? { fontes: [] as readonly FonteDoLandscape[], bloqueio: undefined }
        : await this.pesquisar(pedido.consulta, pedido.projectId, workspaceId, userId)

    if (pesquisa.bloqueio !== undefined) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'pacote-estrutural',
        payload: {
          projectId: pedido.projectId,
          fase: 'bloqueado',
          causa: pesquisa.bloqueio.causa,
          tentativas: pesquisa.bloqueio.tentativas
        }
      })
      return {
        reason: 'pesquisa-bloqueada',
        bloqueio: pesquisa.bloqueio,
        mensagem: pesquisa.bloqueio.porQueNaoSeguir
      }
    }

    // (5) Compõe. Daqui em diante nada mais pode faltar: todo conteúdo já tem origem.
    const doPrd = afirmacoesDoPrd(this.catalogo, decisoes, PERGUNTAS_DO_PRD)
    const doLandscape = [
      ...afirmacoesDoLandscape(pesquisa.fontes),
      ...gatilhosDeRevisao(pesquisa.fontes)
    ]
    const daConvention = afirmacoesDaConvention(this.catalogo, decisoes)

    const documentos = [
      this.montarDocumento('PRD', projeto.nome, doPrd),
      this.montarDocumento('LANDSCAPE', projeto.nome, doLandscape),
      this.montarDocumento('CONVENTION', projeto.nome, daConvention)
    ]

    const escrita = this.escrever(projeto.diretorio, documentos)
    if (!escrita.ok) {
      return { reason: 'falha-de-escrita', mensagem: escrita.mensagem }
    }

    const agora = new Date().toISOString()
    const pacote = this.repository.registrarPacote({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId: pedido.projectId,
      documentos,
      hash: hashDoPacote(documentos),
      commitHash: null,
      created_at: agora
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'pacote-estrutural',
      payload: {
        projectId: pedido.projectId,
        fase: 'gerado',
        pacoteId: pacote.id,
        hash: pacote.hash,
        fontes: pesquisa.fontes.length,
        afirmacoes: documentos.reduce((n, d) => n + d.afirmacoes.length, 0)
      }
    })

    // (6) O marco vira commit pelo caminho único da M8-F01. Falha aqui **não** perde o pacote:
    // ele já está no banco e no disco, e a retomada é chamar de novo.
    const marco = this.projectService.concluirMarco(pedido.projectId, 'prd-aprovado', workspaceId)
    if (marco?.commitado === true && marco.commitHash !== undefined) {
      this.repository.marcarCommit(userId, pacote.id, marco.commitHash)
    }

    log.agent.info('Pacote estrutural gerado', {
      projectId: pedido.projectId,
      commitado: marco?.commitado === true
    })

    return {
      reason: 'gerado',
      pacote: { ...pacote, commitHash: marco?.commitHash ?? null },
      mensagem:
        marco?.commitado === true
          ? 'Pacote gerado e commitado.'
          : 'Pacote gerado. O commit do marco falhou e pode ser retomado.'
    }
  }

  /**
   * Busca e extrai as fontes do Landscape.
   *
   * **Search descobre, Extract confirma** (regra estrutural da M6-F05/F06): o snippet da busca
   * não sustenta afirmação, então nenhuma fonte entra no documento sem passar pela extração. Um
   * atalho que usasse o `trecho` do resultado de busca produziria um Landscape que *parece*
   * verificado e cita conteúdo que ninguém baixou.
   */
  private async pesquisar(
    consulta: string,
    projectId: string,
    workspaceId: WorkspaceId,
    userId: string
  ): Promise<{
    readonly fontes: readonly FonteDoLandscape[]
    readonly bloqueio?: BloqueioExterno
  }> {
    const busca = await this.connectors.call(
      this.pedidoTavily(TAVILY_OPERATIONS.search, userId, workspaceId, {
        query: consulta,
        maxResults: MAX_FONTES_DO_LANDSCAPE
      }),
      { userId, workspace: workspaceId }
    )

    if (!busca.ok) {
      return { fontes: [], bloqueio: bloqueioDoConector(busca, 'a busca de mercado', 1) }
    }

    const urls = (busca.data as TavilySearchData).fontes
      .map((f) => f.url)
      .slice(0, Math.min(MAX_FONTES_DO_LANDSCAPE, MAX_URLS_EXTRACT))

    if (urls.length === 0) {
      return {
        fontes: [],
        bloqueio: {
          causa: 'busca-sem-fontes',
          evidencia: `A consulta "${consulta}" não devolveu nenhuma fonte.`,
          tentativas: 1,
          porQueNaoSeguir:
            'Seguir exigiria descrever o cenário competitivo sem nenhuma fonte — o Landscape ficaria com afirmações sem evidência.',
          retomada: 'Refine o termo de pesquisa e gere o pacote novamente.'
        }
      }
    }

    const extracao = await this.connectors.call(
      this.pedidoTavily(TAVILY_OPERATIONS.extract, userId, workspaceId, { urls }),
      { userId, workspace: workspaceId }
    )

    if (!extracao.ok) {
      return { fontes: [], bloqueio: bloqueioDoConector(extracao, 'a extração das fontes', 2) }
    }

    const pacote = extracao.data as TavilyExtractData

    // (4) O verificador da M6-F06. Ele diz se cada afirmação cita fonte extraída; a decisão de
    // bloquear é desta fatia, como o comentário de lá declara explicitamente.
    const afirmacoes: readonly Afirmacao[] = pacote.evidencias.map((e, i) => ({
      id: `landscape-fonte-${i}`,
      texto: e.titulo ?? e.url,
      fontes: [e.url]
    }))
    const verificacao = verificarEvidencia(afirmacoes, pacote)

    if (!verificacao.completo) {
      return {
        fontes: [],
        bloqueio: {
          causa: 'evidencia-incompleta',
          evidencia: `Sem evidência extraída para ${verificacao.lacunas.length} afirmação(ões).`,
          tentativas: 2,
          porQueNaoSeguir:
            'Concluir o Landscape com afirmação sem evidência extraída contraria o critério 2 — e preencher a lacuna por memória do modelo é o que o critério 3 proíbe.',
          retomada: 'Tente novamente; se persistir, ajuste a consulta para fontes acessíveis.'
        }
      }
    }

    if (pacote.evidencias.length === 0) {
      return {
        fontes: [],
        bloqueio: {
          causa: 'extracao-sem-conteudo',
          evidencia: `Nenhuma das ${urls.length} URLs pôde ser extraída${pacote.falhas.length > 0 ? `: ${pacote.falhas.map((f) => f.url).join(', ')}` : '.'}`,
          tentativas: 2,
          porQueNaoSeguir:
            'Sem conteúdo extraído não há evidência, e o Landscape só afirma o que a fonte disse.',
          retomada: 'Verifique a conexão e gere o pacote novamente.'
        }
      }
    }

    // A evidência é persistida **antes** de virar documento: o arquivo cita hashes, e um
    // documento que aponta para prova não guardada é um documento com referência quebrada.
    const agora = new Date().toISOString()
    this.repository.registrarEvidencias(
      pacote.evidencias.map((item) => ({
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        item,
        created_at: agora
      }))
    )

    return {
      fontes: pacote.evidencias.map((e) => ({
        url: e.url,
        titulo: e.titulo ?? e.dominio,
        // O trecho citado, quando a extração o produziu; senão, o início do conteúdo. Nunca o
        // snippet da busca — aquele não passou por extração.
        trecho: (e.trecho ?? e.conteudo).slice(0, 400),
        hashConteudo: e.hashConteudo,
        coletadoEm: e.coletadoEm,
        publicadoEm: e.publicadoEm
      }))
    }
  }

  /** Monta o `ConnectorRequest` das duas operações — a forma é a mesma, muda a operação. */
  private pedidoTavily(
    operation: string,
    userId: string,
    workspaceId: WorkspaceId,
    input: unknown
  ): ConnectorRequest {
    return {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'tavily',
      operation,
      correlationId: randomUUID(),
      timeoutMs: TIMEOUT_DA_PESQUISA_MS,
      credential: { key: 'tavily', user_id: userId, workspace_id: workspaceId },
      input
    }
  }

  private montarDocumento(
    documento: DocumentoDoPacote,
    nomeDoProjeto: string,
    afirmacoes: readonly AfirmacaoDoPacote[]
  ): DocumentoGerado {
    const conteudo = renderizarDocumento(
      documento,
      { nome: nomeDoProjeto, slug: '' },
      afirmacoes,
      SECOES_DO_DOCUMENTO[documento],
      PREAMBULO_DO_DOCUMENTO[documento]
    )
    return {
      documento,
      caminho: ARQUIVO_DO_DOCUMENTO[documento],
      conteudo,
      hash: createHash('sha256').update(conteudo, 'utf8').digest('hex'),
      afirmacoes
    }
  }

  /**
   * Escreve os três arquivos sob o diretório do projeto.
   *
   * Os caminhos são **relativos e constantes** (`ARQUIVO_DO_DOCUMENTO`), nunca vindos do
   * chamador — não há como esta função escrever fora do projeto porque não há entrada que a
   * direcione. A checagem de contenção continua presente mesmo assim: constante hoje não é
   * constante para sempre, e a barreira custa uma linha.
   */
  private escrever(
    diretorio: string,
    documentos: readonly DocumentoGerado[]
  ): { readonly ok: boolean; readonly mensagem: string } {
    const raiz = resolve(diretorio)
    try {
      for (const doc of documentos) {
        const alvo = resolve(join(raiz, doc.caminho))
        if (!alvo.startsWith(raiz)) {
          return { ok: false, mensagem: 'Caminho de documento fora do projeto.' }
        }
        mkdirSync(dirname(alvo), { recursive: true })
        writeFileSync(alvo, doc.conteudo, 'utf8')
      }
      return { ok: true, mensagem: 'Documentos escritos.' }
    } catch (causa) {
      log.agent.error('Falha ao escrever o pacote estrutural', {
        stack: causa instanceof Error ? causa.stack : undefined
      })
      return { ok: false, mensagem: 'Não foi possível escrever os documentos no projeto.' }
    }
  }
}

/**
 * O hash canônico do pacote: os três documentos, na ordem, pelos seus hashes.
 *
 * Deriva dos hashes dos documentos e não do JSON inteiro porque é o **conteúdo** que define a
 * revisão — um `created_at` diferente não faz do mesmo texto outra revisão, e o invariante 2 do
 * `CONVENTION.md` §4 depende exatamente disso para não pedir aceite duas vezes pelo mesmo
 * conteúdo.
 */
export function hashDoPacote(documentos: readonly DocumentoGerado[]): string {
  const canonico = documentos.map((d) => `${d.documento}:${d.hash}`).join('|')
  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

/**
 * Traduz a recusa do conector no bloqueio com os cinco campos da `CONVENTION.md` §4.
 *
 * O `ConnectorError` cobre causa, evidência e ação; o que falta — **tentativas** e **por que
 * não seguir** — é composto aqui, porque só esta fatia sabe o que estava tentando fazer e por
 * que seguir sem isso seria incorreto.
 */
function bloqueioDoConector(
  erro: Extract<ConnectorOutcome, { ok: false }>,
  oQueTentava: string,
  tentativas: number
): BloqueioExterno {
  return {
    causa: erro.code,
    evidencia: erro.evidencia ?? erro.mensagem,
    tentativas,
    porQueNaoSeguir: `Não foi possível concluir ${oQueTentava}. Seguir exigiria escrever o cenário competitivo sem fonte extraída, e o critério 3 proíbe preencher por memória do modelo.`,
    retomada: erro.mensagem
  }
}
