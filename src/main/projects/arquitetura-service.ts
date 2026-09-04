/**
 * A geração da arquitetura, das decisões, dos testes e da revisão por IA (SPEC-Jornada-04).
 *
 * A pergunta que este serviço responde: **como transformar o PRD aceito e os protótipos
 * desenhados em quatro documentos técnicos sem que o modelo prometa fluxo que ninguém desenhou?**
 *
 * A ordem das guardas é a garantia inteira, e cada passo existe por um motivo distinto:
 *
 *   1. **O gate de anexos abriu?** Não ⇒ recusa nomeando o que falta (critério 1). É o gate da
 *      M8-F05, **intacto**: a arquitetura não é gerada antes dos anexos completos, e não há
 *      caminho aqui que a produza sem eles. Vem antes da rota porque não custa chamada nenhuma.
 *   2. **Há PRD?** Não ⇒ recusa. Sem revisão a que se referir, o critério 3 não teria como valer
 *      — e gerar assim mesmo produziria uma arquitetura ligada a nada.
 *   3. **Os protótipos abrem?** A validação determinística da M8-F05 roda **antes da IA e não é
 *      substituída por ela** (decisão cravada pelo Cowork). Achado que impede ⇒ recusa com as
 *      perguntas: um protótipo que não carrega não delimita fluxo nenhum.
 *   4. **Rota autorizada?** Não ⇒ `bloqueado-sem-rota`, **antes de qualquer chamada** (critério
 *      7). Bloqueio é zero chamada e zero custo, e conferir depois já teria gasto.
 *   5. **Geração e validação.** Saída que não passa no validador não vira revisão; uma tentativa
 *      de correção com os problemas nomeados, e então bloqueia. É aqui que o critério 2 morde:
 *      fluxo sem âncora em protótipo reprova.
 *   6. **Análise de coerência** (critério 4). Falha na análise **não** vira "nenhum ajuste":
 *      ficaria liberando o gate por uma falha de infraestrutura. E nada dela toca os anexos.
 *   7. **Escreve, hasheia, persiste** — nas duas tabelas: `project_architecture` guarda o
 *      conteúdo verificável com as âncoras, e `pacote_arquitetura` guarda os documentos
 *      renderizados, porque é dali que o gate `PROJECT_PACKAGE` monta as revisões que o PI
 *      aprova. O hash é o mesmo, e é ele que liga as duas.
 *   8. **Commita o marco `arquitetura-aprovada`** pelo `ProjectService`, o único gatilho de
 *      commit (M8-F01). Falha de commit **não** perde a revisão.
 *
 * **Este serviço não anexa e não valida protótipo sozinho.** Ele pede as duas coisas ao
 * `AnexoService`, que continua dono delas. Duplicar a validação aqui criaria uma segunda resposta
 * para "este protótipo está bom?", e o gate mede a resposta de lá.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type { Anexo } from '@shared/domain/anexos-de-design'
import { pendenciasDoGate } from '@shared/domain/anexos-de-design'
import type { DocumentoDaArquitetura } from '@shared/domain/arquitetura'
import {
  ARQUIVO_DA_ARQUITETURA,
  DOCUMENTOS_DA_ARQUITETURA,
  SECOES_DA_ARQUITETURA
} from '@shared/domain/arquitetura'
import type {
  AfirmacaoDaArquitetura,
  AjusteProposto,
  ArquiteturaGeradaOutcome,
  ArquiteturaRegistrada,
  ConteudoDaArquitetura
} from '@shared/domain/arquitetura-gerada'
import {
  afirmacoesDoDocumentoDaArquitetura,
  cortarPropostoDaArquitetura,
  descartarAjuste,
  renderizarDocumentoDaArquitetura,
  validarArquitetura
} from '@shared/domain/arquitetura-gerada'
import type { JornadaParaOModelo, RequisitoParaOModelo } from '@shared/domain/arquitetura-schema'
import type { DecisaoDoRefinamento } from '@shared/domain/brief-schema'
import type { DocumentoGerado } from '@shared/domain/pacote-estrutural'
import type { PrdRegistrado } from '@shared/domain/prd'
import type { ValidacaoDoPrototipo } from '@shared/domain/validacao-de-prototipo'
import { achadosQueImpedem } from '@shared/domain/validacao-de-prototipo'
import type { EstadoDasRotas, ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { PROVIDER_DA_ROTA, escolherRota } from '@shared/domain/rota-de-geracao'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { AnexoRepository } from './anexo-repository'
import type { ArquiteturaRepository } from './arquitetura-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'

/**
 * Quantas vezes o serviço pede correção antes de desistir. **Uma**, mesma economia do
 * `PrdService`: cada tentativa é uma chamada paga, e um modelo que erra o schema duas vezes
 * seguidas não erra por acaso — insistir não conserta, só gasta.
 */
export const TENTATIVAS_DE_CORRECAO_DA_ARQUITETURA = 1

export interface ArquiteturaServiceDeps {
  readonly repository: ArquiteturaRepository
  readonly anexos: AnexoRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * O PRD **gerado e vigente** do projeto, ou `undefined` enquanto nenhum saiu.
   *
   * Injetado, e não lido do `PrdRepository` aqui, porque quem sabe qual revisão vale é o
   * `PrdService` — duplicar essa leitura criaria uma segunda resposta para a mesma pergunta.
   */
  readonly prdVigente: (projectId: string) => PrdRegistrado | undefined
  /**
   * A revisão do PRD que a arquitetura cita (`pacoteEstruturalId`, critério 3).
   *
   * Separada de `prdVigente` porque são duas tabelas: o conteúdo com origem vive em
   * `project_prd`, e o pacote que o gate `PROJECT_PACKAGE` lê vive em `pacote_estrutural`. O
   * ponteiro aponta para o segundo, como na M8-F05.
   */
  readonly pacoteEstruturalId: (projectId: string) => string | undefined
  /** A validação determinística dos protótipos — do `AnexoService`, que continua dona dela. */
  readonly validarPrototipos: (projectId: string) => Promise<readonly ValidacaoDoPrototipo[]>
  readonly decisoesDoRefinamento: (projectId: string) => readonly DecisaoDoRefinamento[]
  /** Monta o `ContextPack`; `undefined` quando a montagem falha. Ver `PrdServiceDeps`. */
  readonly montarContexto: (
    projectId: string,
    workspace: WorkspaceId,
    rota: AiProvider
  ) => string | undefined
  readonly estadoDasRotas: (
    projectId: string,
    workspace: WorkspaceId
  ) => EstadoDasRotas | Promise<EstadoDasRotas>
  /** Gera os quatro documentos. Recebe a rota **decidida**, nunca a escolhe. */
  readonly gerarDocumentos: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly requisitos: readonly RequisitoParaOModelo[]
    readonly jornadas: readonly JornadaParaOModelo[]
    readonly decisoes: readonly DecisaoDoRefinamento[]
    readonly correcao?: readonly string[]
  }) => Promise<{ readonly afirmacoes?: readonly AfirmacaoDaArquitetura[] }>
  /**
   * Analisa a coerência entre os protótipos e o PRD (critério 4).
   *
   * Devolve lista vazia quando está tudo coerente, e `undefined` quando a chamada falhou. A
   * distinção importa: sem ela, uma análise que não saiu pareceria "nenhum ajuste", e o PI
   * aceitaria o pacote achando que a IA leu os protótipos.
   */
  readonly analisarCoerencia: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly requisitos: readonly RequisitoParaOModelo[]
    readonly jornadas: readonly JornadaParaOModelo[]
  }) => Promise<{ readonly ajustes?: readonly AjusteProposto[] }>
}

/**
 * O hash canônico da revisão: as afirmações, os ajustes **e os anexos**.
 *
 * Os anexos entram pelo critério 5 (*"`PROJECT_PACKAGE` registra hashes de todos os anexos e
 * saídas"*) e porque, sem eles, duas arquiteturas geradas sobre protótipos diferentes que
 * produzissem o mesmo texto colidiriam no `hash` UNIQUE — e a segunda seria devolvida como se
 * fosse a primeira, apagando a diferença que os anexos fazem.
 *
 * Ordenado por id antes de serializar: a ordem em que o modelo listou as afirmações não é fato
 * sobre o conteúdo, e sem ordenar duas gerações idênticas produziriam hashes diferentes.
 */
export function hashDaArquiteturaGerada(
  afirmacoes: readonly AfirmacaoDaArquitetura[],
  ajustes: readonly AjusteProposto[],
  anexos: readonly Anexo[]
): string {
  const canonico = JSON.stringify({
    afirmacoes: [...afirmacoes].sort((a, b) => a.id.localeCompare(b.id)),
    ajustes: [...ajustes].sort((a, b) => a.id.localeCompare(b.id)),
    anexos: [...anexos].map((a) => `${a.caminho}:${a.hash}`).sort()
  })

  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

export class ArquiteturaService {
  private readonly repository: ArquiteturaRepository
  private readonly anexos: AnexoRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly deps: ArquiteturaServiceDeps

  constructor(deps: ArquiteturaServiceDeps) {
    this.repository = deps.repository
    this.anexos = deps.anexos
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.audit = deps.audit
    this.userId = deps.userId
    this.deps = deps
  }

  /** A revisão vigente, ou `undefined` enquanto nenhuma foi gerada. */
  carregar(projectId: string): ArquiteturaRegistrada | undefined {
    return this.repository.vigente(this.userId(), projectId)
  }

  /**
   * A rota que seria usada agora — sem gerar nada. Existe para a tela mostrar o bloqueio
   * **antes** do clique, mesma razão de `PrdService.rotaAtual`.
   */
  async rotaAtual(projectId: string, workspaceId: WorkspaceId): Promise<ResultadoDaRota> {
    return escolherRota(await this.deps.estadoDasRotas(projectId, workspaceId))
  }

  /**
   * Gera os quatro documentos a partir do PRD aceito e dos protótipos validados.
   *
   * A ordem das guardas é a garantia — ver o cabeçalho do arquivo.
   */
  async gerar(projectId: string, workspaceId: WorkspaceId): Promise<ArquiteturaGeradaOutcome> {
    const userId = this.userId()

    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    // (1) O gate da M8-F05, intacto. Antes de tudo que custa: nenhuma chamada acontece enquanto
    // faltar anexo, e a recusa **nomeia** o que falta em vez de dizer só que não pode.
    const anexos = this.anexos.listar(userId, projectId)
    const pendencias = pendenciasDoGate(anexos)
    if (pendencias.length > 0) {
      return {
        resultado: 'anexos-pendentes',
        pendencias,
        mensagem: `Faltam anexos do design: ${pendencias.join(', ')}.`
      }
    }

    // (2) A revisão do PRD que a arquitetura vai assumir.
    const prd = this.deps.prdVigente(projectId)
    const pacoteEstruturalId = this.deps.pacoteEstruturalId(projectId)
    if (prd === undefined || pacoteEstruturalId === undefined) {
      return {
        resultado: 'prd-ausente',
        mensagem: 'Gere o PRD antes da arquitetura: ela precisa citar a revisão que assume.'
      }
    }

    // (3) A validação determinística **antes da IA**, e ela é o que o gate mede. A leitura
    // semântica do modelo vem depois, e acrescenta — nunca substitui (decisão do Cowork).
    const validacoes = await this.deps.validarPrototipos(projectId)
    const impedem = achadosQueImpedem(validacoes)
    if (impedem.length > 0) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'design-anexo',
        payload: { projectId, fase: 'bloqueado', achados: impedem.length }
      })

      return {
        resultado: 'prototipos-invalidos',
        achados: impedem,
        mensagem:
          'Os protótipos anexados têm problemas que impedem descrever os fluxos. Resolva-os e gere de novo.'
      }
    }

    // (4) A rota, antes de qualquer chamada (critério 7).
    const rota = escolherRota(await this.deps.estadoDasRotas(projectId, workspaceId))

    if (rota.decisao === 'bloqueado') {
      // Auditado **antes** de qualquer chamada: o bloqueio é um fato registrado, não a ausência
      // de um.
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'arquitetura-generation',
        payload: { projectId, fase: 'bloqueado', motivo: rota.motivo }
      })

      log.agent.warn('Geração da arquitetura bloqueada por falta de rota', {
        projectId,
        motivo: rota.motivo
      })

      return {
        resultado: 'bloqueado-sem-rota',
        mensagem: 'A geração não aconteceu: nenhuma rota autorizada está disponível.',
        ...(rota.acao === undefined ? {} : { acao: rota.acao })
      }
    }

    const provider = PROVIDER_DA_ROTA[rota.decisao]

    const contextPackId = this.deps.montarContexto(projectId, workspaceId, provider)
    if (contextPackId === undefined) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'arquitetura-generation',
        payload: { projectId, fase: 'sem-contexto' }
      })

      return {
        resultado: 'sem-contexto',
        mensagem: 'O contexto do projeto não pôde ser montado; salve o prompt de novo e tente.'
      }
    }

    const requisitos: readonly RequisitoParaOModelo[] = prd.afirmacoes.map((a) => ({
      id: a.id,
      secao: a.secao,
      texto: a.texto
    }))
    const jornadas = this.jornadasComAncora(validacoes, anexos)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'arquitetura-generation',
      payload: {
        projectId,
        fase: 'inicio',
        rota: rota.decisao,
        provider,
        contextPackId,
        requisitos: requisitos.length,
        jornadas: jornadas.length
      }
    })

    let problemas: readonly string[] = []

    // (5) Uma tentativa de correção, não um laço: ver `TENTATIVAS_DE_CORRECAO_DA_ARQUITETURA`.
    for (let tentativa = 0; tentativa <= TENTATIVAS_DE_CORRECAO_DA_ARQUITETURA; tentativa += 1) {
      const resposta = await this.deps.gerarDocumentos({
        projectId,
        workspace: workspaceId,
        rota: provider,
        contextPackId,
        requisitos,
        jornadas,
        decisoes: this.deps.decisoesDoRefinamento(projectId),
        ...(problemas.length > 0 ? { correcao: problemas } : {})
      })

      if (resposta.afirmacoes === undefined) {
        problemas = ['A chamada ao modelo não devolveu saída.']
        continue
      }

      const candidato: ConteudoDaArquitetura = {
        projectId,
        afirmacoes: resposta.afirmacoes,
        ajustes: []
      }

      const validacao = validarArquitetura(candidato, {
        afirmacoesDoPrd: prd.afirmacoes.map((a) => a.id),
        anexos: anexos.map((a) => ({ caminho: a.caminho, hash: a.hash })),
        jornadas: jornadas.map((j) => j.jornada),
        secoes: SECOES_DA_ARQUITETURA
      })

      if (!validacao.valido) {
        problemas = validacao.problemas.map((p) => p.mensagem)

        this.audit.append({
          user_id: userId,
          workspace_id: workspaceId,
          type: 'arquitetura-generation',
          payload: {
            projectId,
            fase: 'saida-recusada',
            tentativa,
            problemas: problemas.length
          }
        })

        continue
      }

      // (6) A análise de coerência. Falha **não** vira "nenhum ajuste": ficaria liberando o gate
      // por uma falha de infraestrutura, que é o oposto do critério 4.
      const analise = await this.deps.analisarCoerencia({
        projectId,
        workspace: workspaceId,
        rota: provider,
        contextPackId,
        requisitos,
        jornadas
      })

      if (analise.ajustes === undefined) {
        problemas = ['A análise de coerência entre os protótipos e o PRD não devolveu saída.']
        continue
      }

      const conteudo: ConteudoDaArquitetura = { ...candidato, ajustes: analise.ajustes }

      return this.persistir(conteudo, {
        projeto,
        anexos,
        pacoteEstruturalId,
        workspaceId,
        userId,
        contextPackId,
        rota: rota.decisao,
        commitarMarco: true
      })
    }

    // Esgotou a tentativa de correção. Bloqueia com o problema nomeado, em vez de gravar o que o
    // validador recusou — gravar seria exatamente o que os critérios 2 e 3 impedem.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'arquitetura-generation',
      payload: { projectId, fase: 'desistiu', problemas: problemas.length }
    })

    log.agent.error('Saída do modelo recusada depois da correção', { projectId, problemas })

    return {
      resultado: 'saida-invalida',
      mensagem:
        'A saída do modelo não passou no validador, nem depois da correção. Nada foi gravado.',
      problemas
    }
  }

  /**
   * Corta um `proposto` do gate — item a item, mesma disciplina do PRD.
   *
   * **Grava revisão nova, não edita a atual.** A revisão que o PI leu continua no banco: se o
   * corte editasse a linha, o hash passaria a descrever conteúdo diferente do exibido, e o aceite
   * por revisão exata deixaria de significar algo (critério 6).
   */
  cortarProposto(
    projectId: string,
    afirmacaoId: string,
    workspaceId: WorkspaceId
  ): ArquiteturaRegistrada | undefined {
    return this.revisar(projectId, workspaceId, (atual) =>
      cortarPropostoDaArquitetura(atual, afirmacaoId)
    )
  }

  /**
   * Descarta um ajuste da análise de coerência (critério 4).
   *
   * **Descartar não toca o anexo.** É a única operação que o app faz com um ajuste: autorizar um
   * deles é um ato do PI sobre o protótipo — reabrir, redesenhar, reanexar —, e o histórico e a
   * autoria do arquivo permanecem intactos porque nada aqui escreve neles.
   */
  descartarAjuste(
    projectId: string,
    ajusteId: string,
    workspaceId: WorkspaceId
  ): ArquiteturaRegistrada | undefined {
    return this.revisar(projectId, workspaceId, (atual) => descartarAjuste(atual, ajusteId))
  }

  /**
   * O caminho comum do corte e do descarte: aplica a mudança e grava revisão nova.
   *
   * Mudança que não altera nada devolve a revisão como está — é o caso do id errado ou de uma
   * afirmação que não é `proposto`: o domínio já se recusa a cortá-la, e gravar uma revisão
   * idêntica pediria um aceite novo por um clique que não mudou o documento.
   */
  private revisar(
    projectId: string,
    workspaceId: WorkspaceId,
    mudar: (atual: ConteudoDaArquitetura) => ConteudoDaArquitetura
  ): ArquiteturaRegistrada | undefined {
    const userId = this.userId()
    const atual = this.repository.vigente(userId, projectId)
    if (atual === undefined) return undefined

    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) return atual

    const mudado = mudar(atual)
    if (
      mudado.afirmacoes.length === atual.afirmacoes.length &&
      mudado.ajustes.length === atual.ajustes.length
    ) {
      return atual
    }

    const desfecho = this.persistir(mudado, {
      projeto,
      anexos: atual.anexos,
      pacoteEstruturalId: atual.pacoteEstruturalId,
      workspaceId,
      userId,
      contextPackId: atual.contextPackId,
      rota: 'revisao',
      commitarMarco: false
    })

    return desfecho.arquitetura
  }

  /**
   * (7) e (8): renderiza, escreve, persiste nas duas tabelas e commita o marco.
   *
   * **As duas tabelas gravam a mesma revisão.** `project_architecture` guarda as afirmações com
   * as quatro origens e as âncoras — é o que a tela lê e o validador protege.
   * `pacote_arquitetura` guarda os documentos renderizados, porque é dali que o gate
   * `PROJECT_PACKAGE` monta as revisões que o PI aprova (critério 5). Gravar só numa das duas
   * quebraria ou a origem por afirmação, ou o gate do pacote.
   */
  private persistir(
    conteudo: ConteudoDaArquitetura,
    contexto: {
      readonly projeto: { readonly nome: string; readonly diretorio: string }
      readonly anexos: readonly Anexo[]
      readonly pacoteEstruturalId: string
      readonly workspaceId: WorkspaceId
      readonly userId: string
      readonly contextPackId: string | null
      readonly rota: string
      /**
       * Commitar o marco `arquitetura-aprovada`? **Só na geração.**
       *
       * O corte de um `proposto` grava revisão nova e reescreve os arquivos — o disco tem de
       * acompanhar a revisão vigente —, mas não é um marco: commitar a cada item cortado encheria
       * o histórico de revisões intermediárias que o PI nem terminou de revisar.
       */
      readonly commitarMarco: boolean
    }
  ): ArquiteturaGeradaOutcome {
    const { projeto, workspaceId, userId } = contexto

    const documentos = DOCUMENTOS_DA_ARQUITETURA.map((documento) =>
      this.montarDocumento(documento, projeto.nome, conteudo)
    )

    const escrita = escrever(projeto.diretorio, documentos)
    if (!escrita.ok) {
      return { resultado: 'falha-de-escrita', mensagem: escrita.mensagem }
    }

    const hash = hashDaArquiteturaGerada(conteudo.afirmacoes, conteudo.ajustes, contexto.anexos)

    // Mesmo conteúdo é a mesma revisão: devolve a existente em vez de estourar no UNIQUE, e
    // regenerar sem mudança não pede novo aceite.
    const jaExiste = this.repository.findByHash(userId, hash)
    if (jaExiste !== undefined) {
      return {
        resultado: 'gerada',
        arquitetura: jaExiste,
        mensagem: 'Os documentos gerados são idênticos aos anteriores; a revisão foi preservada.'
      }
    }

    const agora = new Date().toISOString()

    const registrada = this.repository.registrar({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId: conteudo.projectId,
      pacoteEstruturalId: contexto.pacoteEstruturalId,
      afirmacoes: conteudo.afirmacoes,
      ajustes: conteudo.ajustes,
      anexos: contexto.anexos,
      hash,
      commitHash: null,
      contextPackId: contexto.contextPackId,
      created_at: agora
    })

    // A revisão que o gate `PROJECT_PACKAGE` lê. Mesmo hash: é o que liga as duas tabelas sem uma
    // terceira coluna de ligação que poderia divergir.
    this.anexos.registrarArquitetura({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId: conteudo.projectId,
      pacoteEstruturalId: contexto.pacoteEstruturalId,
      documentos,
      anexos: contexto.anexos,
      hash,
      commitHash: null,
      created_at: agora
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'arquitetura-generation',
      payload: {
        projectId: conteudo.projectId,
        fase: 'gerada',
        rota: contexto.rota,
        hash,
        pacoteEstruturalId: contexto.pacoteEstruturalId,
        afirmacoes: conteudo.afirmacoes.length,
        ajustes: conteudo.ajustes.length,
        anexos: contexto.anexos.length
      }
    })

    // (8) O marco vira commit pelo caminho único da M8-F01. Falha aqui **não** perde a revisão:
    // ela já está no banco e no disco, e a retomada é gerar de novo.
    const marco = contexto.commitarMarco
      ? this.projectService.concluirMarco(conteudo.projectId, 'arquitetura-aprovada', workspaceId)
      : undefined

    if (marco?.commitado === true && marco.commitHash !== undefined) {
      this.repository.marcarCommit(userId, registrada.id, marco.commitHash)
    }

    log.agent.info('Arquitetura, decisões, testes e revisão gerados', {
      projectId: conteudo.projectId,
      afirmacoes: conteudo.afirmacoes.length,
      commitado: marco?.commitado === true
    })

    return {
      resultado: 'gerada',
      arquitetura: { ...registrada, commitHash: marco?.commitHash ?? null },
      mensagem: mensagemDoDesfecho(contexto.commitarMarco, marco?.commitado === true)
    }
  }

  /**
   * As jornadas dos protótipos, cada uma com o anexo e o hash que a sustentam.
   *
   * **É o que torna a âncora possível.** `jornadasCobertas` devolve só os textos; o modelo
   * precisa saber em qual arquivo cada tela está, e o validador precisa conferir o hash daquele
   * arquivo. Casar a validação com o anexo aqui, uma vez, evita que as duas pontas façam a
   * correspondência por conta própria e discordem.
   */
  private jornadasComAncora(
    validacoes: readonly ValidacaoDoPrototipo[],
    anexos: readonly Anexo[]
  ): readonly JornadaParaOModelo[] {
    const hashPorCaminho = new Map(anexos.map((a) => [a.caminho, a.hash]))
    const vistas = new Set<string>()
    const jornadas: JornadaParaOModelo[] = []

    for (const validacao of validacoes) {
      const hash = hashPorCaminho.get(validacao.prototipo)
      // Sem hash o protótipo não está entre os anexos do gate, e uma âncora para ele seria
      // recusada pelo validador. Deixá-lo fora do pedido é a mesma decisão em outro ponto.
      if (hash === undefined) continue

      for (const jornada of validacao.jornadasCobertas) {
        // A mesma tela em dois protótipos é uma jornada só para o modelo: repetir a entrada
        // faria o pedido sugerir que existem duas, e a âncora escolheria uma ao acaso.
        if (vistas.has(jornada)) continue
        vistas.add(jornada)
        jornadas.push({ jornada, anexo: validacao.prototipo, hash })
      }
    }

    return jornadas
  }

  private montarDocumento(
    documento: DocumentoDaArquitetura,
    nomeDoProjeto: string,
    conteudo: ConteudoDaArquitetura
  ): DocumentoGerado {
    const afirmacoes = afirmacoesDoDocumentoDaArquitetura(conteudo, documento)
    const texto = renderizarDocumentoDaArquitetura(
      documento,
      nomeDoProjeto,
      afirmacoes,
      SECOES_DA_ARQUITETURA[documento]
    )

    return {
      documento,
      caminho: ARQUIVO_DA_ARQUITETURA[documento],
      conteudo: texto,
      hash: createHash('sha256').update(texto, 'utf8').digest('hex'),
      // Os documentos do `pacote_arquitetura` carregam `AfirmacaoDoPacote`, que só admite duas
      // origens. A lista fica vazia aqui **de propósito**, mesma escolha do `PrdService`: a
      // origem por afirmação vive em `project_architecture`, com as quatro origens e a âncora, e
      // converter para o tipo antigo perderia justo o hash do protótipo.
      afirmacoes: []
    }
  }
}

/**
 * A mensagem do desfecho bem-sucedido.
 *
 * Três casos, e o terceiro é a razão de a função existir: quando o marco nem foi tentado (corte
 * de um `proposto`), dizer "o commit falhou" seria relatar uma falha que não houve — e mandaria o
 * PI procurar um problema no Git que não existe.
 */
function mensagemDoDesfecho(tentouCommitar: boolean, commitado: boolean): string {
  if (!tentouCommitar) return 'Revisão atualizada.'

  return commitado
    ? 'Arquitetura gerada e commitada.'
    : 'Arquitetura gerada. O commit do marco falhou e pode ser retomado.'
}

/**
 * Escreve os quatro arquivos sob o diretório do projeto.
 *
 * Os caminhos são **relativos e constantes** (`ARQUIVO_DA_ARQUITETURA`), nunca vindos do chamador
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
      if (relative(raiz, alvo).startsWith('..')) {
        return { ok: false, mensagem: 'Caminho de documento fora do projeto.' }
      }
      mkdirSync(dirname(alvo), { recursive: true })
      writeFileSync(alvo, doc.conteudo, 'utf8')
    }

    return { ok: true, mensagem: 'Documentos escritos.' }
  } catch (causa) {
    log.agent.error('Falha ao escrever o pacote de arquitetura', {
      stack: causa instanceof Error ? causa.stack : undefined
    })
    return { ok: false, mensagem: 'Não foi possível escrever os documentos no projeto.' }
  }
}
