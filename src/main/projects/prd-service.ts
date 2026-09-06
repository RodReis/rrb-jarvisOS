/**
 * A geração do PRD, do Landscape e da Convention por IA (SPEC-Jornada-03).
 *
 * A pergunta que este serviço responde: **como transformar o brief aceito em três documentos
 * estruturais sem que o modelo invente requisito nem fabrique fonte?**
 *
 * A ordem das guardas é a garantia inteira, e cada passo existe por um motivo distinto:
 *
 *   1. **Brief aceito?** Não ⇒ recusa. Os documentos derivam dele; sem a revisão aceita não há
 *      âncora para a origem `brief`, e toda afirmação viraria `proposto`.
 *   2. **Rota autorizada?** Não ⇒ `bloqueado-sem-rota`, **antes de qualquer chamada**. Bloqueio
 *      é zero chamada e zero custo, e conferir depois já teria gasto — mesma primeira linha do
 *      `BriefService`.
 *   3. **Pesquisa** (só quando o PI confirmou o termo). Search descobre, Extract confirma
 *      (M6-F05/F06). Falhou ⇒ o Landscape fica pendente com os cinco campos do `BloqueioExterno`
 *      — e **o PRD e a Convention seguem** (decisão do PI, 2026-09-03). É a inversão explícita
 *      da M8-F04, onde a pesquisa bloqueava o pacote inteiro.
 *   4. **Geração e validação.** Saída que não passa no validador não vira revisão; uma tentativa
 *      de correção com os problemas nomeados, e então bloqueia.
 *   5. **Contradições viram perguntas** (critério 6). Nenhuma é resolvida sem resposta do PI, e
 *      enquanto houver uma, o gate não libera o aceite.
 *   6. **Escreve, hasheia, persiste** — nas duas tabelas: `project_prd` guarda o conteúdo
 *      verificável, e `pacote_estrutural` guarda a revisão que a M8-F05 cita ao amarrar a
 *      arquitetura ao PRD. O hash é o mesmo, e é ele que liga as duas.
 *   7. **Commita o marco `prd-aprovado`** pelo `ProjectService`, o único gatilho de commit
 *      (M8-F01). Falha de commit **não** perde a revisão.
 *
 * **A pesquisa passa pelo `ConnectorService`, nunca pelo `TavilyAdapter` direto** — o gate de
 * créditos vive dentro do `call()`, e instanciar o adapter aqui seria o segundo caminho sem gate
 * que o serviço de conectores existe para impedir. Mesma fronteira que o `PacoteService` respeita.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type { BriefRegistrado } from '@shared/domain/brief'
import type { DecisaoDoRefinamento } from '@shared/domain/brief-schema'
import type {
  BloqueioExterno,
  DocumentoDoPacote,
  DocumentoGerado
} from '@shared/domain/pacote-estrutural'
import { ARQUIVO_DO_DOCUMENTO, DOCUMENTOS_DO_PACOTE } from '@shared/domain/pacote-estrutural'
import type {
  AfirmacaoDoPrd,
  ConteudoDoPrd,
  ContradicaoDoPrd,
  PrdOutcome,
  PrdRegistrado
} from '@shared/domain/prd'
import {
  ETAPA_DA_CONTRADICAO,
  afirmacoesDoDocumento,
  cortarPropostoDoPrd,
  renderizarDocumentoDoPrd,
  validarPrd
} from '@shared/domain/prd'
import { validarContratoDaPergunta } from '@shared/domain/pergunta-gerada'
import type { Decision, Resposta, RespostaOutcome, VistaDoWizard } from '@shared/domain/wizard'
import { decisoesVigentes, estadoDoWizard, montarDecisao } from '@shared/domain/wizard'
import type { EstadoDaEtapa, EtapaDaGeracao } from '@shared/domain/geracao'
import type { FonteParaOModelo } from '@shared/domain/prd-schema'
import type { EstadoDasRotas, ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { PROVIDER_DA_ROTA, escolherRota, providerDaRota } from '@shared/domain/rota-de-geracao'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import { CONNECTOR_CONTRACT_VERSION } from '@shared/domain/connectors'
import type { TavilyExtractData, TavilySearchData } from '@shared/domain/tavily'
import { MAX_URLS_EXTRACT, TAVILY_OPERATIONS } from '@shared/domain/tavily'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { ConnectorService } from '../connectors/connector-service'
import type { DecisionRepository } from './decision-repository'
import type { PrdRepository } from './prd-repository'
import type { PacoteRepository } from './pacote-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'

/** Quanto tempo a pesquisa tem. Nomeado porque aparece nas duas chamadas. */
const TIMEOUT_DA_PESQUISA_MS = 30_000

/**
 * Quantas fontes o Landscape busca. Modesto de propósito, como na M8-F04: cada URL extraída
 * custa crédito, e o teto real de gasto é o gate do `ConnectorService`.
 */
const MAX_FONTES_DO_LANDSCAPE = 5

/**
 * Quantas vezes o serviço pede correção antes de desistir. **Uma**, mesma economia do
 * `BriefService`: cada tentativa é uma chamada paga, e um modelo que erra o schema duas vezes
 * seguidas não erra por acaso — insistir não conserta, só gasta.
 */
export const TENTATIVAS_DE_CORRECAO = 1

/** Quantos caracteres do trecho extraído entram no pedido ao modelo. */
const TAMANHO_DO_TRECHO = 400

/** O pedido de geração. `termo` vazio significa "gerar sem pesquisa" (critérios 3 e 4). */
export interface PedidoDoPrd {
  readonly projectId: string
  /**
   * O termo de mercado que o PI **confirmou**. Vazio ⇒ nenhuma chamada à Tavily acontece, e o
   * Landscape sai declarando a lacuna. A pesquisa não roda sem confirmação (critério 3): quem
   * confirma é a tela, chamando com o termo; quem propõe é `proporTermo`.
   */
  readonly termo: string
}

export interface PrdServiceDeps {
  readonly repository: PrdRepository
  readonly pacotes: PacoteRepository
  /**
   * Onde a resposta a uma contradição é gravada (emenda E1). O **mesmo** repositório das
   * decisões do refinamento e do wizard: a resposta é uma `Decision` como qualquer outra, com
   * `etapa: 'prd'`, e uma tabela própria faria a trilha do projeto ter dois lugares para
   * "quem decidiu o quê".
   */
  readonly decisions: DecisionRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly connectors: ConnectorService
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * O brief **aceito** do projeto, ou `undefined` enquanto o gate do brief não passou.
   *
   * Injetado, e não lido do `BriefRepository` aqui, porque quem sabe se o brief foi aceito é a
   * jornada — a etapa `brief-aceito` só é ultrapassada pelo evento correspondente, e duplicar
   * essa leitura criaria uma segunda resposta para a mesma pergunta.
   */
  readonly briefAceito: (projectId: string, workspace: WorkspaceId) => BriefRegistrado | undefined
  readonly decisoesDoRefinamento: (projectId: string) => readonly DecisaoDoRefinamento[]
  /** Monta o `ContextPack`; `undefined` quando a montagem falha. Ver `BriefServiceDeps`. */
  readonly montarContexto: (
    projectId: string,
    workspace: WorkspaceId,
    rota: AiProvider
  ) => string | undefined
  readonly estadoDasRotas: (
    projectId: string,
    workspace: WorkspaceId
  ) => EstadoDasRotas | Promise<EstadoDasRotas>
  /** Propõe o termo de pesquisa a partir do brief (critério 3). */
  readonly gerarTermo: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly afirmacoesDoBrief: readonly string[]
  }) => Promise<{ readonly termo?: string }>
  /** Gera os três documentos. Recebe a rota **decidida**, nunca a escolhe. */
  readonly gerarDocumentos: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly afirmacoesDoBrief: readonly { readonly id: string; readonly texto: string }[]
    readonly decisoes: readonly DecisaoDoRefinamento[]
    readonly fontes: readonly FonteParaOModelo[]
    readonly landscapeBloqueado: boolean
    readonly correcao?: readonly string[]
  }) => Promise<{ readonly afirmacoes?: readonly AfirmacaoDoPrd[] }>
  /**
   * Procura contradições entre as afirmações (critério 6).
   *
   * Devolve lista vazia quando não há, e `undefined` quando a chamada falhou. A distinção
   * importa: sem ela, uma detecção que não saiu pareceria "nenhuma contradição", e o gate
   * liberaria o aceite por uma falha de infraestrutura.
   */
  readonly detectarContradicoes: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly afirmacoes: readonly { readonly id: string; readonly texto: string }[]
  }) => Promise<{ readonly contradicoes?: readonly ContradicaoDoPrd[] }>
  /**
   * Anuncia o andamento da geração (SPEC-Jornada-03 § Geração).
   *
   * **Opcional, e falhar aqui não interrompe nada** — mesma ordem de prioridade do console: o
   * pacote é o produto, o progresso é evidência. Uma tela fechada, um canal caído ou um erro no
   * publish não podem custar a geração que o PI já pagou.
   *
   * Fica fora do `ColetorDaGeracao` porque as etapas daqui **atravessam várias chamadas** ao
   * modelo, e o coletor vive dentro de uma. Um trace por etapa diria quanto durou cada chamada;
   * o que a barra precisa saber é em que ponto do pacote o serviço está.
   */
  readonly anunciarEtapa?: (
    projectId: string,
    etapa: EtapaDaGeracao,
    estado: EstadoDaEtapa,
    resumo?: string
  ) => void
}

/**
 * O hash canônico da revisão. É por ele que o aceite é por revisão exata e que regenerar sem
 * mudança não cria linha nova.
 *
 * Ordenado por id antes de serializar: a ordem em que o modelo listou as afirmações não é fato
 * sobre o conteúdo, e sem ordenar duas gerações idênticas produziriam hashes diferentes.
 */
export function hashDoPrd(
  afirmacoes: readonly AfirmacaoDoPrd[],
  contradicoes: readonly ContradicaoDoPrd[],
  bloqueio?: BloqueioExterno
): string {
  const canonico = JSON.stringify({
    afirmacoes: [...afirmacoes].sort((a, b) => a.id.localeCompare(b.id)),
    // Sem o id: ele é sorteado a cada geração (emenda E1), e entrar no hash faria duas gerações
    // idênticas virarem duas revisões — o oposto da invariante 2 da CONVENTION §4.
    contradicoes: contradicoes
      .map(({ id: _id, ...resto }) => resto)
      .sort((a, b) => a.enunciado.localeCompare(b.enunciado)),
    bloqueio: bloqueio ?? null
  })

  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

export class PrdService {
  private readonly repository: PrdRepository
  private readonly pacotes: PacoteRepository
  private readonly decisions: DecisionRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly connectors: ConnectorService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly deps: PrdServiceDeps

  constructor(deps: PrdServiceDeps) {
    this.repository = deps.repository
    this.pacotes = deps.pacotes
    this.decisions = deps.decisions
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.connectors = deps.connectors
    this.audit = deps.audit
    this.userId = deps.userId
    this.deps = deps
  }

  /** A revisão vigente, ou `undefined` enquanto nenhuma foi gerada. */
  carregar(projectId: string): PrdRegistrado | undefined {
    return this.repository.vigente(this.userId(), projectId)
  }

  /**
   * A rota que seria usada agora — sem gerar nada. Existe para a tela mostrar o bloqueio
   * **antes** do clique, mesma razão de `BriefService.rotaAtual`.
   */
  async rotaAtual(projectId: string, workspaceId: WorkspaceId): Promise<ResultadoDaRota> {
    return escolherRota(await this.deps.estadoDasRotas(projectId, workspaceId))
  }

  /**
   * Propõe o termo de pesquisa a partir do brief aceito (critério 3, decisão 2 do PI).
   *
   * Devolve `undefined` quando não há brief aceito, quando a rota está bloqueada ou quando a
   * chamada falhou. Em todos os casos a tela cai no campo vazio e o PI escreve o dele — a
   * proposta é uma conveniência, e falhar nela não pode impedir a pesquisa.
   *
   * **Não pesquisa nada.** Propor o termo e usá-lo são atos separados justamente porque a
   * pesquisa não roda sem confirmação: fundi-los faria a chamada à Tavily acontecer antes de o
   * PI ver o que seria buscado.
   */
  async proporTermo(projectId: string, workspaceId: WorkspaceId): Promise<string | undefined> {
    const userId = this.userId()
    const brief = this.deps.briefAceito(projectId, workspaceId)
    if (brief === undefined) return undefined

    const rota = escolherRota(await this.deps.estadoDasRotas(projectId, workspaceId))
    if (rota.decisao === 'bloqueado') return undefined

    const provider = providerDaRota(rota) ?? PROVIDER_DA_ROTA[rota.decisao]
    const contextPackId = this.deps.montarContexto(projectId, workspaceId, provider)
    if (contextPackId === undefined) return undefined

    const { termo } = await this.deps.gerarTermo({
      projectId,
      workspace: workspaceId,
      rota: provider,
      contextPackId,
      afirmacoesDoBrief: brief.afirmacoes.map((a) => a.texto)
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'prd-generation',
      payload: { projectId, fase: 'termo-proposto', proposto: termo !== undefined }
    })

    return termo
  }

  /**
   * Gera os três documentos a partir do brief aceito.
   *
   * A ordem das guardas é a garantia — ver o cabeçalho do arquivo. O que vale repetir aqui é a
   * assimetria da decisão do PI de 2026-09-03: **falha de pesquisa não bloqueia a geração**. Só
   * o Landscape fica pendente, e o bloqueio viaja junto da revisão até o gate.
   */
  /**
   * Anuncia uma etapa, e **nunca deixa isso derrubar a geração**.
   *
   * O `try` não é zelo defensivo genérico: `anunciarEtapa` termina num `webContents.send`, e uma
   * janela destruída entre o início da geração e este ponto lança de dentro do Electron. Sem o
   * bloqueio, fechar a janela durante a geração mataria o pacote que estava quase pronto — e o
   * PI perderia a chamada que já pagou por causa da barra de progresso dela.
   */
  private anunciar(
    projectId: string,
    etapa: EtapaDaGeracao,
    estado: EstadoDaEtapa,
    resumo?: string
  ): void {
    try {
      this.deps.anunciarEtapa?.(projectId, etapa, estado, resumo)
    } catch (erro) {
      log.agent.warn('Falha ao anunciar a etapa da geração', { projectId, etapa, estado, erro })
    }
  }

  async gerar(pedido: PedidoDoPrd, workspaceId: WorkspaceId): Promise<PrdOutcome> {
    const userId = this.userId()

    const projeto = this.projects.findById(userId, pedido.projectId)
    if (projeto === undefined) {
      return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const brief = this.deps.briefAceito(pedido.projectId, workspaceId)
    if (brief === undefined) {
      return {
        resultado: 'brief-nao-aceito',
        mensagem: 'Aceite o brief antes de gerar o PRD: ele é a origem de todo requisito.'
      }
    }

    const rota = escolherRota(await this.deps.estadoDasRotas(pedido.projectId, workspaceId))

    if (rota.decisao === 'bloqueado') {
      // Auditado **antes** de qualquer chamada: o bloqueio é um fato registrado, não a ausência
      // de um. Mesma prova que o critério 6 da F02 pede.
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'prd-generation',
        payload: { projectId: pedido.projectId, fase: 'bloqueado', motivo: rota.motivo }
      })

      log.agent.warn('Geração do PRD bloqueada por falta de rota', {
        projectId: pedido.projectId,
        motivo: rota.motivo
      })

      return {
        resultado: 'bloqueado-sem-rota',
        mensagem: 'A geração não aconteceu: nenhuma rota autorizada está disponível.',
        ...(rota.acao === undefined ? {} : { acao: rota.acao })
      }
    }

    const provider = providerDaRota(rota) ?? PROVIDER_DA_ROTA[rota.decisao]

    const contextPackId = this.deps.montarContexto(pedido.projectId, workspaceId, provider)
    if (contextPackId === undefined) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'prd-generation',
        payload: { projectId: pedido.projectId, fase: 'sem-contexto' }
      })

      return {
        resultado: 'sem-contexto',
        mensagem: 'O contexto do projeto não pôde ser montado; salve o prompt de novo e tente.'
      }
    }

    // (3) A pesquisa. Termo vazio é decisão do PI, não falha: nenhuma chamada acontece, e o
    // Landscape declara a lacuna (critérios 3 e 4).
    this.anunciar(pedido.projectId, 'pesquisa', 'iniciada')

    const pesquisa =
      pedido.termo.trim() === ''
        ? {
            fontes: [] as readonly FonteParaOModelo[],
            urls: [] as readonly string[],
            bloqueio: bloqueioSemTermo()
          }
        : await this.pesquisar(pedido.termo, pedido.projectId, workspaceId, userId)

    /*
     * A pesquisa **conclui mesmo bloqueada**, e o resumo diz por quê.
     *
     * Marcar `falhou` aqui seria mentir sobre o que aconteceu: sem termo, o PI escolheu não
     * pesquisar, e essa escolha é um desfecho normal — o Landscape declara a lacuna e o resto
     * do pacote segue (decisão do PI, 2026-09-03). Uma etapa vermelha faria a tela anunciar um
     * defeito onde houve uma decisão.
     */
    this.anunciar(
      pedido.projectId,
      'pesquisa',
      'concluida',
      pesquisa.bloqueio === undefined
        ? `${pesquisa.fontes.length} ${pesquisa.fontes.length === 1 ? 'fonte extraída' : 'fontes extraídas'}.`
        : 'Sem fontes: o Landscape vai declarar a lacuna.'
    )

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'prd-generation',
      payload: {
        projectId: pedido.projectId,
        fase: 'inicio',
        rota: rota.decisao,
        provider,
        contextPackId,
        fontes: pesquisa.fontes.length,
        landscapeBloqueado: pesquisa.bloqueio !== undefined
      }
    })

    const ancoras = brief.afirmacoes.map((a) => ({ id: a.id, texto: a.texto }))
    let problemas: readonly string[] = []

    // (4) Uma tentativa de correção, não um laço: ver `TENTATIVAS_DE_CORRECAO`.
    for (let tentativa = 0; tentativa <= TENTATIVAS_DE_CORRECAO; tentativa += 1) {
      this.anunciar(pedido.projectId, 'documentos', 'iniciada')

      const resposta = await this.deps.gerarDocumentos({
        projectId: pedido.projectId,
        workspace: workspaceId,
        rota: provider,
        contextPackId,
        afirmacoesDoBrief: ancoras,
        // As decisões do refinamento **e** as respostas às contradições (emenda E1), pelo mesmo
        // campo: para o modelo as duas são "o dono do projeto decidiu", citáveis como `decisao`.
        decisoes: [
          ...this.deps.decisoesDoRefinamento(pedido.projectId),
          ...this.decisoesDasContradicoes(pedido.projectId, userId)
        ],
        fontes: pesquisa.fontes,
        landscapeBloqueado: pesquisa.bloqueio !== undefined,
        ...(problemas.length > 0 ? { correcao: problemas } : {})
      })

      if (resposta.afirmacoes === undefined) {
        problemas = ['A chamada ao modelo não devolveu saída.']
        this.anunciar(pedido.projectId, 'documentos', 'falhou', problemas[0])
        continue
      }

      this.anunciar(
        pedido.projectId,
        'documentos',
        'concluida',
        `${resposta.afirmacoes.length} ${resposta.afirmacoes.length === 1 ? 'afirmação escrita' : 'afirmações escritas'} nos três documentos.`
      )
      this.anunciar(pedido.projectId, 'validacao', 'iniciada')

      const candidato: ConteudoDoPrd = {
        projectId: pedido.projectId,
        afirmacoes: resposta.afirmacoes,
        contradicoes: [],
        ...(pesquisa.bloqueio === undefined ? {} : { bloqueioDoLandscape: pesquisa.bloqueio })
      }

      const validacao = validarPrd(candidato, {
        afirmacoesDoBrief: brief.afirmacoes.map((a) => a.id),
        urlsComEvidencia: pesquisa.urls
      })

      if (!validacao.valido) {
        problemas = validacao.problemas.map((p) => p.mensagem)

        this.anunciar(
          pedido.projectId,
          'validacao',
          'falhou',
          `${problemas.length} ${problemas.length === 1 ? 'problema encontrado' : 'problemas encontrados'} na saída do modelo.`
        )

        this.audit.append({
          user_id: userId,
          workspace_id: workspaceId,
          type: 'prd-generation',
          payload: {
            projectId: pedido.projectId,
            fase: 'saida-recusada',
            tentativa,
            problemas: problemas.length
          }
        })

        continue
      }

      // (5) As contradições. Falha na detecção **não** vira "nenhuma contradição": ficaria
      // liberando o aceite por uma falha de infraestrutura, que é o oposto do critério 6.
      this.anunciar(pedido.projectId, 'validacao', 'concluida', 'A saída passou no validador.')
      this.anunciar(pedido.projectId, 'contradicoes', 'iniciada')

      const deteccao = await this.deps.detectarContradicoes({
        projectId: pedido.projectId,
        workspace: workspaceId,
        rota: provider,
        contextPackId,
        afirmacoes: [...ancoras, ...candidato.afirmacoes.map((a) => ({ id: a.id, texto: a.texto }))]
      })

      if (deteccao.contradicoes === undefined) {
        problemas = ['A detecção de contradições não devolveu saída.']
        this.anunciar(pedido.projectId, 'contradicoes', 'falhou', problemas[0])
        continue
      }

      // O id é do serviço, não do modelo (emenda E1): "c-1" colidiria entre revisões, e a
      // decisão do PI passaria a apontar para a contradição errada. O contrato da M8-F03 vale
      // sobre a pergunta inteira, e pergunta que o fere **não chega ao PI**: a etapa falha, pelo
      // mesmo caminho da detecção que não saiu — fail closed, nunca "nenhuma contradição".
      const contradicoesDaRevisao = deteccao.contradicoes.map((c) => ({
        ...c,
        id: randomUUID(),
        etapa: ETAPA_DA_CONTRADICAO
      }))
      const recusadas = contradicoesDaRevisao.flatMap((c) =>
        validarContratoDaPergunta(c).problemas.map((p) => p.mensagem)
      )

      if (recusadas.length > 0) {
        problemas = recusadas
        this.anunciar(
          pedido.projectId,
          'contradicoes',
          'falhou',
          `${recusadas.length} ${recusadas.length === 1 ? 'problema' : 'problemas'} no contrato das perguntas.`
        )
        continue
      }

      const achadas = contradicoesDaRevisao.length
      this.anunciar(
        pedido.projectId,
        'contradicoes',
        'concluida',
        achadas === 0
          ? 'Nenhuma contradição entre as afirmações.'
          : `${achadas} ${achadas === 1 ? 'contradição encontrada' : 'contradições encontradas'} — o aceite fica travado até você decidir.`
      )

      const conteudo: ConteudoDoPrd = { ...candidato, contradicoes: contradicoesDaRevisao }

      this.anunciar(pedido.projectId, 'gravacao', 'iniciada')

      const gravado = this.persistir(conteudo, {
        projeto,
        brief,
        workspaceId,
        userId,
        contextPackId,
        rota: rota.decisao,
        commitarMarco: true
      })

      /*
       * O anúncio segue o desfecho **real** da gravação, não o fato de ela ter sido tentada.
       * `persistir` devolve `falha-de-escrita` sem lançar, e anunciar `concluida` aqui deixaria
       * a barra em 100% sobre um pacote que não foi para o disco — exatamente o fechamento
       * frágil que a barra existe para não produzir.
       */
      this.anunciar(
        pedido.projectId,
        'gravacao',
        gravado.resultado === 'gerado' ? 'concluida' : 'falhou',
        gravado.resultado === 'gerado' ? 'Os três documentos foram gravados.' : gravado.mensagem
      )

      return gravado
    }

    // Esgotou a tentativa de correção. Bloqueia com o problema nomeado, em vez de gravar o que
    // o validador recusou — gravar seria exatamente o que os critérios 1 e 2 impedem.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'prd-generation',
      payload: { projectId: pedido.projectId, fase: 'desistiu', problemas: problemas.length }
    })

    log.agent.error('Saída do modelo recusada depois da correção', {
      projectId: pedido.projectId,
      problemas
    })

    return {
      resultado: 'saida-invalida',
      mensagem:
        'A saída do modelo não passou no validador, nem depois da correção. Nada foi gravado.',
      problemas
    }
  }

  /**
   * Corta um `proposto` do gate — item a item, mesma disciplina do brief.
   *
   * **Grava revisão nova, não edita a atual.** A revisão que o PI leu continua no banco: se o
   * corte editasse a linha, o hash passaria a descrever conteúdo diferente do exibido, e o
   * aceite por revisão exata deixaria de significar algo (critério 7).
   *
   * Corte que não muda nada devolve a revisão como está. É o caso do id errado ou de uma
   * afirmação que não é `proposto`: o domínio já se recusa a cortá-la.
   */
  cortarProposto(
    projectId: string,
    afirmacaoId: string,
    workspaceId: WorkspaceId
  ): PrdRegistrado | undefined {
    const userId = this.userId()
    const atual = this.repository.vigente(userId, projectId)
    if (atual === undefined) return undefined

    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) return atual

    const cortado = cortarPropostoDoPrd(atual, afirmacaoId)
    if (cortado.afirmacoes.length === atual.afirmacoes.length) return atual

    const desfecho = this.persistir(cortado, {
      projeto,
      brief: { hash: atual.briefHash },
      workspaceId,
      userId,
      contextPackId: atual.contextPackId,
      rota: 'corte',
      commitarMarco: false
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'prd-generation',
      payload: { projectId, fase: 'proposto-cortado', afirmacaoId }
    })

    return desfecho.prd
  }

  /**
   * A vista do pop-up das contradições (emenda E1): a próxima pergunta ou a conclusão, mais o
   * histórico **desta revisão**.
   *
   * Calculada do banco a cada chamada, como o refinamento: fechar o pop-up no meio e reabrir
   * volta à contradição pendente porque a resposta vem das decisões gravadas.
   */
  contradicoes(projectId: string): VistaDoWizard | undefined {
    const userId = this.userId()
    const vigente = this.repository.vigente(userId, projectId)
    if (vigente === undefined) return undefined

    const historico = this.historicoDasContradicoes(vigente.contradicoes, userId, projectId)
    return { estado: estadoDoWizard(vigente.contradicoes, historico), historico }
  }

  /**
   * Registra a resposta do PI (ou a delegação) a uma contradição da revisão vigente.
   *
   * A pergunta tem de ser da revisão **vigente**: responder a uma contradição de revisão antiga
   * gravaria decisão sobre um conflito que já não existe no que o PI está lendo.
   */
  responderContradicao(
    projectId: string,
    resposta: Resposta,
    workspaceId: WorkspaceId
  ): RespostaOutcome {
    const userId = this.userId()
    if (this.projects.findById(userId, projectId) === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const vigente = this.repository.vigente(userId, projectId)
    const pergunta = vigente?.contradicoes.find((c) => c.id === resposta.perguntaId)
    if (vigente === undefined || pergunta === undefined) {
      return {
        reason: 'pergunta-desconhecida',
        mensagem: 'Esta contradição não é da revisão vigente; nada foi gravado.'
      }
    }

    const historico = this.historicoDasContradicoes(vigente.contradicoes, userId, projectId)
    const montada = montarDecisao({
      pergunta,
      resposta,
      anterior: decisoesVigentes(historico)[pergunta.id],
      escopo: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        created_at: new Date().toISOString()
      }
    })
    if ('recusa' in montada) return { reason: montada.recusa, mensagem: montada.mensagem }

    const decisao = montada.decisao
    this.decisions.registrar(decisao)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'planning-decision',
      payload: {
        projectId,
        perguntaId: pergunta.id,
        etapa: decisao.etapa,
        autor: decisao.autor,
        motivo: decisao.motivo,
        escolha: decisao.escolha,
        recomendacao: decisao.recomendacao,
        substituiu: decisao.substituiu
      }
    })

    log.agent.info('Decisão sobre contradição do PRD registrada', {
      projectId,
      perguntaId: pergunta.id,
      autor: decisao.autor
    })

    const atualizado = this.historicoDasContradicoes(vigente.contradicoes, userId, projectId)
    return {
      reason: 'registrada',
      decisao,
      estado: estadoDoWizard(vigente.contradicoes, atualizado),
      mensagem: 'Decisão registrada.'
    }
  }

  /** As decisões que pertencem a estas contradições — e só elas. */
  private historicoDasContradicoes(
    contradicoes: readonly ContradicaoDoPrd[],
    userId: string,
    projectId: string
  ): readonly Decision[] {
    const ids = new Set(contradicoes.map((c) => c.id))
    return this.decisions
      .listar(userId, projectId)
      .filter((d) => d.etapa === ETAPA_DA_CONTRADICAO && ids.has(d.perguntaId))
  }

  /**
   * As respostas às contradições no formato que o pedido de geração cita (emenda E1).
   *
   * Varre **todas** as revisões, e não só a vigente: a decisão foi tomada sobre a contradição de
   * uma revisão, e a geração seguinte — que é quem precisa dela — cria outra. O rótulo, não o
   * id da opção: o modelo precisa do conteúdo (mesma regra de `decisoesParaOBrief`).
   */
  private decisoesDasContradicoes(
    projectId: string,
    userId: string
  ): readonly DecisaoDoRefinamento[] {
    const catalogo = this.repository.listar(userId, projectId).flatMap((r) => r.contradicoes)
    const vigentes = decisoesVigentes(
      this.decisions.listar(userId, projectId).filter((d) => d.etapa === ETAPA_DA_CONTRADICAO)
    )

    return Object.values(vigentes).flatMap((decisao) => {
      const pergunta = catalogo.find((c) => c.id === decisao.perguntaId)
      if (pergunta === undefined) return []

      const rotulo =
        decisao.escolha === null
          ? decisao.texto
          : (pergunta.opcoes.find((o) => o.id === decisao.escolha)?.rotulo ?? decisao.escolha)

      return rotulo === null
        ? []
        : [{ id: decisao.id, pergunta: pergunta.enunciado, resposta: rotulo }]
    })
  }

  /**
   * (6) e (7): renderiza, escreve, persiste nas duas tabelas e commita o marco.
   *
   * **As duas tabelas gravam a mesma revisão.** `project_prd` guarda as afirmações com as
   * quatro origens — é o que a tela lê e o validador protege. `pacote_estrutural` guarda os
   * documentos renderizados, porque é ali que a M8-F05 procura a revisão do PRD que a
   * arquitetura assume (`pacoteEstruturalId`). Gravar só numa das duas quebraria ou a origem por
   * afirmação, ou o gate de anexos da fatia seguinte.
   */
  private persistir(
    conteudo: ConteudoDoPrd,
    contexto: {
      readonly projeto: { readonly nome: string; readonly diretorio: string }
      readonly brief: { readonly hash: string }
      readonly workspaceId: WorkspaceId
      readonly userId: string
      readonly contextPackId: string | null
      readonly rota: string
      /**
       * Commitar o marco `prd-aprovado`? **Só na geração.**
       *
       * O corte de um `proposto` grava revisão nova e reescreve os arquivos — o disco tem de
       * acompanhar a revisão vigente —, mas não é um marco: commitar a cada item cortado encheria
       * o histórico de revisões intermediárias que o PI nem terminou de revisar. O marco é da
       * geração, e o aceite é do PI.
       */
      readonly commitarMarco: boolean
    }
  ): PrdOutcome {
    const { projeto, workspaceId, userId } = contexto

    const documentos = DOCUMENTOS_DO_PACOTE.map((documento) =>
      this.montarDocumento(documento, projeto.nome, conteudo)
    )

    const escrita = escrever(projeto.diretorio, documentos)
    if (!escrita.ok) {
      return { resultado: 'falha-de-escrita', mensagem: escrita.mensagem }
    }

    const hash = hashDoPrd(conteudo.afirmacoes, conteudo.contradicoes, conteudo.bloqueioDoLandscape)

    // Mesmo conteúdo é a mesma revisão: devolve a existente em vez de estourar no UNIQUE, e
    // regenerar sem mudança não pede novo aceite (invariante 2 da CONVENTION §4).
    const jaExiste = this.repository.findByHash(userId, hash)
    if (jaExiste !== undefined) {
      return {
        resultado: 'gerado',
        prd: jaExiste,
        mensagem: 'Os documentos gerados são idênticos aos anteriores; a revisão foi preservada.'
      }
    }

    const agora = new Date().toISOString()

    const registrado = this.repository.registrar({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId: conteudo.projectId,
      briefHash: contexto.brief.hash,
      afirmacoes: conteudo.afirmacoes,
      contradicoes: conteudo.contradicoes,
      ...(conteudo.bloqueioDoLandscape === undefined
        ? {}
        : { bloqueioDoLandscape: conteudo.bloqueioDoLandscape }),
      hash,
      commitHash: null,
      contextPackId: contexto.contextPackId,
      created_at: agora
    })

    // A revisão que a M8-F05 cita. Mesmo hash: é o que liga as duas tabelas sem uma terceira
    // coluna de ligação que poderia divergir.
    this.pacotes.registrarPacote({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId: conteudo.projectId,
      documentos,
      hash,
      commitHash: null,
      created_at: agora
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'prd-generation',
      payload: {
        projectId: conteudo.projectId,
        fase: 'gerado',
        rota: contexto.rota,
        hash,
        afirmacoes: conteudo.afirmacoes.length,
        contradicoes: conteudo.contradicoes.length,
        landscapeBloqueado: conteudo.bloqueioDoLandscape !== undefined
      }
    })

    // (7) O marco vira commit pelo caminho único da M8-F01. Falha aqui **não** perde a revisão:
    // ela já está no banco e no disco, e a retomada é gerar de novo (critério 8).
    const marco = contexto.commitarMarco
      ? this.projectService.concluirMarco(conteudo.projectId, 'prd-aprovado', workspaceId)
      : undefined

    if (marco?.commitado === true && marco.commitHash !== undefined) {
      this.repository.marcarCommit(userId, registrado.id, marco.commitHash)
    }

    log.agent.info('PRD, Landscape e Convention gerados', {
      projectId: conteudo.projectId,
      afirmacoes: conteudo.afirmacoes.length,
      commitado: marco?.commitado === true
    })

    return {
      resultado: 'gerado',
      prd: { ...registrado, commitHash: marco?.commitHash ?? null },
      mensagem: mensagemDoDesfecho(contexto.commitarMarco, marco?.commitado === true)
    }
  }

  private montarDocumento(
    documento: DocumentoDoPacote,
    nomeDoProjeto: string,
    conteudo: ConteudoDoPrd
  ): DocumentoGerado {
    const afirmacoes = afirmacoesDoDocumento(conteudo, documento)
    const texto = renderizarDocumentoDoPrd(
      documento,
      nomeDoProjeto,
      afirmacoes,
      documento === 'LANDSCAPE' ? conteudo.bloqueioDoLandscape : undefined
    )

    return {
      documento,
      caminho: ARQUIVO_DO_DOCUMENTO[documento],
      conteudo: texto,
      hash: createHash('sha256').update(texto, 'utf8').digest('hex'),
      // Os documentos do `pacote_estrutural` carregam `AfirmacaoDoPacote`, que só admite duas
      // origens. A lista fica vazia aqui **de propósito**: a origem por afirmação vive em
      // `project_prd`, com as quatro origens, e converter para o tipo antigo perderia `fontes` —
      // a lista vazia é honesta, uma conversão com perda seria uma mentira estruturada.
      afirmacoes: []
    }
  }

  /**
   * Busca e extrai as fontes do Landscape.
   *
   * **Search descobre, Extract confirma** (regra estrutural da M6-F05/F06): o snippet da busca
   * não sustenta afirmação, e um atalho que o usasse produziria um Landscape que *parece*
   * verificado citando conteúdo que ninguém baixou.
   *
   * Devolve bloqueio em vez de estourar em toda falha: aqui, "a pesquisa não saiu" é um desfecho
   * previsto que segue para a geração, não uma exceção que a interrompe.
   */
  private async pesquisar(
    termo: string,
    projectId: string,
    workspaceId: WorkspaceId,
    userId: string
  ): Promise<{
    readonly fontes: readonly FonteParaOModelo[]
    readonly urls: readonly string[]
    readonly bloqueio?: BloqueioExterno
  }> {
    const busca = await this.connectors.call(
      this.pedidoTavily(TAVILY_OPERATIONS.search, userId, workspaceId, {
        query: termo,
        maxResults: MAX_FONTES_DO_LANDSCAPE
      }),
      { userId, workspace: workspaceId }
    )

    if (!busca.ok) {
      return { fontes: [], urls: [], bloqueio: bloqueioDoConector(busca, 'a busca de mercado', 1) }
    }

    // `ok` não garante forma: o conector pode responder com sucesso e um payload que não é o
    // desta operação. Ler `.fontes` direto derrubaria a geração inteira por uma resposta
    // estranha — e o desfecho certo aqui é o mesmo de "não achei fonte", que já existe abaixo.
    const encontradas = (busca.data as TavilySearchData | undefined)?.fontes ?? []

    const urls = encontradas
      .map((f) => f.url)
      .slice(0, Math.min(MAX_FONTES_DO_LANDSCAPE, MAX_URLS_EXTRACT))

    if (urls.length === 0) {
      return {
        fontes: [],
        urls: [],
        bloqueio: {
          causa: 'busca-sem-fontes',
          evidencia: `O termo "${termo}" não devolveu nenhuma fonte.`,
          tentativas: 1,
          porQueNaoSeguir:
            'Seguir exigiria descrever o cenário competitivo sem nenhuma fonte, e o Landscape só afirma sobre terceiros o que uma fonte extraída sustenta.',
          retomada: 'Ajuste o termo de pesquisa e gere de novo.'
        }
      }
    }

    const extracao = await this.connectors.call(
      this.pedidoTavily(TAVILY_OPERATIONS.extract, userId, workspaceId, { urls }),
      { userId, workspace: workspaceId }
    )

    if (!extracao.ok) {
      return {
        fontes: [],
        urls: [],
        bloqueio: bloqueioDoConector(extracao, 'a extração das fontes', 2)
      }
    }

    const pacote = extracao.data as TavilyExtractData | undefined
    const evidencias = pacote?.evidencias ?? []
    const falhas = pacote?.falhas ?? []

    if (evidencias.length === 0) {
      return {
        fontes: [],
        urls: [],
        bloqueio: {
          causa: 'extracao-sem-conteudo',
          evidencia: `Nenhuma das ${urls.length} URLs pôde ser extraída${falhas.length > 0 ? `: ${falhas.map((f) => f.url).join(', ')}` : '.'}`,
          tentativas: 2,
          porQueNaoSeguir:
            'Sem conteúdo extraído não há evidência, e o Landscape só afirma o que a fonte disse.',
          retomada: 'Verifique a conexão e gere de novo.'
        }
      }
    }

    // A evidência é persistida **antes** de virar documento: o arquivo cita URLs, e um documento
    // que aponta para prova não guardada é um documento com referência quebrada.
    const agora = new Date().toISOString()
    this.pacotes.registrarEvidencias(
      evidencias.map((item) => ({
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        item,
        created_at: agora
      }))
    )

    return {
      // As URLs canônicas são o conjunto que o validador confere: uma afirmação que cita fora
      // dele é fonte fabricada, e a saída inteira é recusada.
      urls: evidencias.map((e) => e.url),
      fontes: evidencias.map((e) => ({
        url: e.url,
        titulo: e.titulo ?? e.dominio,
        // O trecho extraído, nunca o snippet da busca — aquele não passou por extração.
        trecho: (e.trecho ?? e.conteudo).slice(0, TAMANHO_DO_TRECHO)
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
}

/**
 * A mensagem do desfecho bem-sucedido.
 *
 * Três casos, e o terceiro é a razão de a função existir: quando o marco nem foi tentado (corte
 * de um `proposto`), dizer "o commit falhou" seria relatar uma falha que não houve — e mandaria
 * o PI procurar um problema no Git que não existe.
 */
function mensagemDoDesfecho(tentouCommitar: boolean, commitado: boolean): string {
  if (!tentouCommitar) return 'Revisão atualizada.'

  return commitado
    ? 'Documentos gerados e commitados.'
    : 'Documentos gerados. O commit do marco falhou e pode ser retomado.'
}

/**
 * O bloqueio de "o PI escolheu não pesquisar".
 *
 * É um bloqueio de verdade, com os cinco campos, e não uma ausência silenciosa: o Landscape
 * ficou incompleto, e o critério 4 pede que isso seja **declarado e visível**. A diferença para
 * os outros é a retomada — aqui basta confirmar um termo, sem nada a consertar.
 */
function bloqueioSemTermo(): BloqueioExterno {
  return {
    causa: 'sem-termo-de-pesquisa',
    evidencia: 'Nenhum termo de pesquisa foi confirmado, então nenhuma busca foi feita.',
    tentativas: 0,
    porQueNaoSeguir:
      'O Landscape descreve terceiros, e toda afirmação sobre terceiro exige fonte extraída. Sem pesquisa não há fonte, e escrever o cenário assim seria preencher por memória do modelo.',
    retomada: 'Confirme um termo de pesquisa e gere de novo; o PRD e a Convention já estão prontos.'
  }
}

/**
 * Traduz a recusa do conector no bloqueio com os cinco campos da `CONVENTION.md` §4.
 *
 * O `ConnectorError` cobre causa, evidência e ação; **tentativas** e **por que não seguir** são
 * compostos aqui, porque só esta fatia sabe o que estava tentando fazer.
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
    porQueNaoSeguir: `Não foi possível concluir ${oQueTentava}. Seguir exigiria escrever o cenário competitivo sem fonte extraída, e o Landscape só afirma sobre terceiros o que uma fonte sustenta.`,
    retomada: erro.mensagem
  }
}

/**
 * Escreve os três arquivos sob o diretório do projeto.
 *
 * Os caminhos são **relativos e constantes** (`ARQUIVO_DO_DOCUMENTO`), nunca vindos do chamador
 * — não há como esta função escrever fora do projeto porque não há entrada que a direcione. A
 * checagem de contenção continua presente: constante hoje não é constante para sempre.
 */
function escrever(
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
    log.agent.error('Falha ao escrever os documentos gerados', {
      stack: causa instanceof Error ? causa.stack : undefined
    })
    return { ok: false, mensagem: 'Não foi possível escrever os documentos no projeto.' }
  }
}
