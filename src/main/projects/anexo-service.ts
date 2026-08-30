/**
 * Os anexos de design e a arquitetura que eles liberam (SPEC-Planejamento-05).
 *
 * Duas operações, e a ordem entre elas é a fatia inteira:
 *
 *   1. **`anexar`** — o ato. Copia o arquivo escolhido para dentro do projeto e hasheia **no
 *      instante**, gerando `AuditEvent`. É isto, e só isto, que faz um arquivo contar para o
 *      gate (critério 7). Não existe varredura de diretório neste serviço, de propósito: um
 *      arquivo largado na pasta por fora não tem instante definido, e o gate precisa ter esse
 *      instante preciso.
 *   2. **`gerarArquitetura`** — o que o gate libera. Recusa enquanto faltar anexo (critério 1),
 *      valida os protótipos, e só então compõe `ARCHITECTURE`, `DECISIONS`, `TESTING` e `REVIEW`.
 *
 * **A IA não aparece em lugar nenhum deste arquivo, e isso é a decisão.** A spec diz que *"a IA
 * analisa e propõe ajustes, mas não substitui o anexo"* — a análise que esta fatia entrega é a
 * validação estrutural dos protótipos (parser + render), que é verificável. Uma chamada de
 * modelo aqui produziria texto sem origem no `ARCHITECTURE.md`, que é exatamente o que a M8-F04
 * fechou ao decidir compor em vez de gerar.
 *
 * **O critério 3 é resolvido por ponteiro, não por proximidade temporal.** A arquitetura registra
 * o `pacoteEstruturalId` da revisão do PRD que assume; sem ele, "a mesma revisão" seria "o PRD
 * mais recente", e regerar o PRD faria a arquitetura passar a descrever um documento que ninguém
 * comparou com ela.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Anexo, AnexoOutcome, TipoDeAnexo } from '@shared/domain/anexos-de-design'
import {
  ARQUIVO_DESIGN_SYSTEM,
  DIRETORIO_DO_ANEXO,
  extensaoCompativel,
  pendenciasDoGate
} from '@shared/domain/anexos-de-design'
import type { AchadoDoPrototipo, ValidacaoDoPrototipo } from '@shared/domain/validacao-de-prototipo'
import {
  achadosQueImpedem,
  analisarPrototipo,
  jornadasCobertas
} from '@shared/domain/validacao-de-prototipo'
import type { ArquiteturaOutcome, PacoteArquitetura } from '@shared/domain/arquitetura'
import {
  ARQUIVO_DA_ARQUITETURA,
  DOCUMENTOS_DA_ARQUITETURA,
  PREAMBULO_DA_ARQUITETURA,
  SECOES_DA_ARQUITETURA,
  afirmacoesDaEvidencia,
  afirmacoesDaRevisao,
  afirmacoesDasDecisoes,
  afirmacoesDasQuestoes,
  afirmacoesDeTeste,
  afirmacoesDosFluxos
} from '@shared/domain/arquitetura'
import type { AfirmacaoDoPacote, DocumentoGerado } from '@shared/domain/pacote-estrutural'
import { renderizarDocumento } from '@shared/domain/pacote-compositor'
import type { Pergunta } from '@shared/domain/wizard'
import { decisoesVigentes } from '@shared/domain/wizard'
import { CATALOGO_DO_CONTEXTO } from '@shared/domain/wizard-catalogo'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { AnexoRepository } from './anexo-repository'
import type { DecisionRepository } from './decision-repository'
import type { PacoteRepository } from './pacote-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'
import { carregarPrototipo, lerHtml, referenciasDoHtml } from './prototipo-runner'

/** Teto de tamanho por anexo. Protótipo e design system são texto; asset é imagem de tela. */
const MAX_BYTES_DO_ANEXO = 25 * 1024 * 1024

interface AnexoDeps {
  readonly repository: AnexoRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly decisions: DecisionRepository
  readonly pacotes: PacoteRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly catalogo?: readonly Pergunta[]
  /**
   * Como um protótipo é carregado. Injetável **só** para o teste: em produção é sempre o
   * `BrowserWindow` oculto. Sem a costura, todo teste do serviço precisaria de Electron vivo, e
   * as regras do gate — que são o que a fatia decide — ficariam sem cobertura barata.
   */
  readonly carregar?: typeof carregarPrototipo
}

export class AnexoService {
  private readonly repository: AnexoRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly decisions: DecisionRepository
  private readonly pacotes: PacoteRepository
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly catalogo: readonly Pergunta[]
  private readonly carregar: typeof carregarPrototipo

  constructor(deps: AnexoDeps) {
    this.repository = deps.repository
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.decisions = deps.decisions
    this.pacotes = deps.pacotes
    this.audit = deps.audit
    this.userId = deps.userId
    this.catalogo = deps.catalogo ?? CATALOGO_DO_CONTEXTO
    this.carregar = deps.carregar ?? carregarPrototipo
  }

  /** Os anexos do projeto. */
  listar(projectId: string): readonly Anexo[] {
    return this.repository.listar(this.userId(), projectId)
  }

  /** O que ainda falta para o gate abrir — nomeado, não um booleano. */
  pendencias(projectId: string): readonly string[] {
    return pendenciasDoGate(this.listar(projectId))
  }

  /**
   * O ato de anexar: copia para o projeto e hasheia no instante.
   *
   * **O hash é do arquivo já copiado, não do original.** É a cópia que o projeto guarda e que a
   * arquitetura vai citar; hashear a origem descreveria um arquivo que o projeto não tem, e um
   * original alterado entre a leitura e a cópia passaria despercebido.
   */
  anexar(
    projectId: string,
    tipo: TipoDeAnexo,
    origem: string,
    workspaceId: WorkspaceId
  ): AnexoOutcome {
    const userId = this.userId()
    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    if (!extensaoCompativel(tipo, origem)) {
      return {
        reason: 'tipo-incompativel',
        mensagem: `O arquivo escolhido não tem extensão compatível com "${tipo}".`
      }
    }

    let bytes: number
    try {
      const info = statSync(origem)
      if (!info.isFile()) {
        return { reason: 'origem-ilegivel', mensagem: 'O caminho escolhido não é um arquivo.' }
      }
      if (info.size > MAX_BYTES_DO_ANEXO) {
        return {
          reason: 'origem-ilegivel',
          mensagem: `O arquivo excede o limite de ${Math.floor(MAX_BYTES_DO_ANEXO / 1024 / 1024)} MB.`
        }
      }
      bytes = info.size
    } catch {
      return { reason: 'origem-ilegivel', mensagem: 'O arquivo escolhido não pôde ser lido.' }
    }

    // O nome de destino: fixo para o design system (o gate procura *este* documento), o nome do
    // arquivo escolhido para os demais.
    const nomeDestino = tipo === 'design-system' ? ARQUIVO_DESIGN_SYSTEM : basename(origem)
    const relativo = `${DIRETORIO_DO_ANEXO[tipo]}/${nomeDestino}`
    const raiz = resolve(projeto.diretorio)
    const destino = resolve(join(raiz, relativo))

    // O destino é composto de constante + `basename`, então já não pode escapar. A checagem
    // permanece porque `basename` é a única parte que vem de fora, e a barreira custa uma linha.
    if (relative(raiz, destino).startsWith('..')) {
      return { reason: 'falha-de-copia', mensagem: 'Caminho de destino fora do projeto.' }
    }

    let hash: string
    try {
      mkdirSync(dirname(destino), { recursive: true })
      copyFileSync(origem, destino)
      hash = createHash('sha256').update(readFileSync(destino)).digest('hex')
    } catch (causa) {
      log.agent.error('Falha ao copiar o anexo de design', {
        stack: causa instanceof Error ? causa.stack : undefined
      })
      return { reason: 'falha-de-copia', mensagem: 'Não foi possível copiar o arquivo escolhido.' }
    }

    const anexo = this.repository.registrar({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      tipo,
      caminho: relativo,
      origem,
      hash,
      bytes,
      anexadoEm: new Date().toISOString()
    })

    // O evento carrega o hash e o caminho, **nunca o conteúdo** (ADR-004): a auditoria responde
    // "o que foi anexado, quando e com que hash?", e responder isso não exige repetir o arquivo.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'design-anexo',
      payload: { projectId, tipo, caminho: relativo, hash, bytes, fase: 'anexado' }
    })

    log.agent.info('Anexo de design registrado', { projectId, tipo, caminho: relativo })
    return { reason: 'anexado', anexo, mensagem: 'Anexo registrado.' }
  }

  /**
   * Desregistra o anexo. **Não apaga o arquivo do disco** — ver o repositório.
   */
  remover(projectId: string, caminho: string, workspaceId: WorkspaceId): boolean {
    const userId = this.userId()
    const removido = this.repository.remover(userId, projectId, caminho)
    if (removido) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'design-anexo',
        payload: { projectId, caminho, fase: 'removido' }
      })
    }
    return removido
  }

  /**
   * Valida os protótipos anexados — o que a spec § Validação pede.
   *
   * Pública porque a tela mostra os achados **antes** de o PI pedir a arquitetura: descobrir que
   * um asset está quebrado só na hora de gerar faria o PI ir e voltar sem necessidade.
   */
  async validar(projectId: string): Promise<readonly ValidacaoDoPrototipo[]> {
    const userId = this.userId()
    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) return []

    const anexos = this.repository.listar(userId, projectId)
    const prototipos = anexos.filter((a) => a.tipo === 'prototipo')
    if (prototipos.length === 0) return []

    const raiz = resolve(projeto.diretorio)
    const telasDoPrd = this.telasDoPrd(userId, projectId)
    const validacoes: ValidacaoDoPrototipo[] = []

    // Serial: cada protótipo é uma janela oculta por vez (ver `prototipo-runner`).
    for (const prototipo of prototipos) {
      const absoluto = resolve(join(raiz, prototipo.caminho))
      const referencias = referenciasDoHtml(lerHtml(absoluto), absoluto, raiz)
      const render = await this.carregar(absoluto)
      validacoes.push(analisarPrototipo(prototipo.caminho, referencias, render, telasDoPrd))
    }

    return validacoes
  }

  /**
   * Gera o pacote de arquitetura. A ordem das recusas é a garantia:
   *
   *   1. **Projeto existe?** A checagem que não escreve vem primeiro.
   *   2. **O gate abriu?** Não ⇒ recusa **nomeando o que falta** (critério 1). A arquitetura não
   *      é gerada antes dos anexos completos, e não há caminho aqui que a produza sem eles.
   *   3. **Há PRD?** Não ⇒ recusa. Sem revisão a que se referir, o critério 3 não teria como
   *      valer — e gerar assim mesmo produziria uma arquitetura ligada a nada.
   *   4. **Os protótipos abrem?** Achado `impede-arquitetura` ⇒ recusa **com as perguntas**
   *      (critério 2). Um protótipo que não carrega não delimita fluxo nenhum, e prosseguir
   *      escreveria uma arquitetura que promete o que ninguém viu.
   *   5. **Compõe, escreve, hasheia, persiste** e commita `arquitetura-aprovada`.
   */
  async gerarArquitetura(projectId: string, workspaceId: WorkspaceId): Promise<ArquiteturaOutcome> {
    const userId = this.userId()
    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const anexos = this.repository.listar(userId, projectId)
    const pendencias = pendenciasDoGate(anexos)
    if (pendencias.length > 0) {
      return {
        reason: 'anexos-pendentes',
        pendencias,
        mensagem: `Faltam anexos do design: ${pendencias.join(', ')}.`
      }
    }

    const [prd] = this.pacotes.listarPacotes(userId, projectId)
    if (prd === undefined) {
      return {
        reason: 'prd-ausente',
        mensagem: 'Gere o PRD antes da arquitetura: ela precisa citar a revisão que assume.'
      }
    }

    const validacoes = await this.validar(projectId)
    const impedem = achadosQueImpedem(validacoes)
    if (impedem.length > 0) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'design-anexo',
        payload: { projectId, fase: 'bloqueado', achados: impedem.length }
      })
      return {
        reason: 'prototipos-invalidos',
        achados: impedem,
        mensagem:
          'Os protótipos anexados têm problemas que impedem descrever os fluxos. Resolva-os e gere de novo.'
      }
    }

    const decisoes = decisoesVigentes(this.decisions.listar(userId, projectId))
    const superficie = decisoes.superficie
    const jornadas = jornadasCobertas(validacoes)
    const todosOsAchados = validacoes.flatMap((v) => v.achados)

    const documentos = [
      this.montarDocumento('ARCHITECTURE', projeto.nome, [
        ...afirmacoesDosFluxos(jornadas, superficie),
        ...afirmacoesDasDecisoes(this.catalogo, decisoes).map((a) => ({
          ...a,
          secao: 'Módulos e fronteiras'
        }))
      ]),
      this.montarDocumento('DECISIONS', projeto.nome, [
        ...afirmacoesDasDecisoes(this.catalogo, decisoes),
        ...afirmacoesDasQuestoes(todosOsAchados, superficie)
      ]),
      this.montarDocumento('TESTING', projeto.nome, [
        ...afirmacoesDeTeste(jornadas, superficie),
        ...afirmacoesDaEvidencia(anexos, superficie)
      ]),
      this.montarDocumento(
        'REVIEW',
        projeto.nome,
        afirmacoesDaRevisao(prd.documentos, todosOsAchados, superficie)
      )
    ]

    const escrita = this.escrever(projeto.diretorio, documentos)
    if (!escrita.ok) {
      return { reason: 'falha-de-escrita', mensagem: escrita.mensagem }
    }

    const pacote = this.repository.registrarArquitetura({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      pacoteEstruturalId: prd.id,
      documentos,
      anexos,
      hash: hashDaArquitetura(documentos, anexos),
      commitHash: null,
      created_at: new Date().toISOString()
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'design-anexo',
      payload: {
        projectId,
        fase: 'arquitetura-gerada',
        pacoteId: pacote.id,
        hash: pacote.hash,
        pacoteEstruturalId: prd.id,
        anexos: anexos.length,
        jornadas: jornadas.length
      }
    })

    // Dois marcos, e não um: `design-anexado` registra que os anexos entraram, e
    // `arquitetura-aprovada` que a revisão saiu. Sob um só, o histórico não distinguiria "o PI
    // anexou" de "a arquitetura foi composta", que são atos de autores diferentes.
    this.projectService.concluirMarco(projectId, 'design-anexado', workspaceId)
    const marco = this.projectService.concluirMarco(projectId, 'arquitetura-aprovada', workspaceId)
    if (marco?.commitado === true && marco.commitHash !== undefined) {
      this.repository.marcarCommit(userId, pacote.id, marco.commitHash)
    }

    log.agent.info('Pacote de arquitetura gerado', {
      projectId,
      commitado: marco?.commitado === true
    })

    return {
      reason: 'gerada',
      pacote: { ...pacote, commitHash: marco?.commitHash ?? null },
      // Os achados que **não** impedem seguem junto: eles entraram no `DECISIONS.md` como
      // questões em aberto, e o PI precisa saber que foram registrados.
      achados: todosOsAchados.filter((a) => a.severidade === 'pergunta'),
      mensagem:
        marco?.commitado === true
          ? 'Arquitetura gerada e commitada.'
          : 'Arquitetura gerada. O commit do marco falhou e pode ser retomado.'
    }
  }

  /** Os pacotes de arquitetura já gerados. */
  listarArquiteturas(projectId: string): readonly PacoteArquitetura[] {
    return this.repository.listarArquiteturas(this.userId(), projectId)
  }

  /**
   * As telas que o PRD menciona — o outro lado do critério 4.
   *
   * Saem das afirmações do PRD gerado, e não de um parser do arquivo: o pacote guarda as
   * afirmações com origem, e reler o `.md` do disco aceitaria como "tela do PRD" qualquer linha
   * que alguém tivesse editado à mão.
   */
  private telasDoPrd(userId: string, projectId: string): readonly string[] {
    const [prd] = this.pacotes.listarPacotes(userId, projectId)
    if (prd === undefined) return []
    return prd.documentos
      .find((d) => d.documento === 'PRD')
      ?.afirmacoes.filter((a) => a.secao === 'Escopo')
      .map((a) => a.texto) ?? []
  }

  private montarDocumento(
    documento: (typeof DOCUMENTOS_DA_ARQUITETURA)[number],
    nomeDoProjeto: string,
    afirmacoes: readonly AfirmacaoDoPacote[]
  ): DocumentoGerado {
    // `renderizarDocumento` é da M8-F04 e serve os dois pacotes: o formato do arquivo (título,
    // preâmbulo, seções, marca de origem por item) é o mesmo, e duplicá-lo faria os dois
    // pacotes divergirem na primeira mudança de formato.
    const conteudo = renderizarDocumento(
      documento,
      { nome: nomeDoProjeto, slug: '' },
      afirmacoes,
      SECOES_DA_ARQUITETURA[documento],
      PREAMBULO_DA_ARQUITETURA[documento]
    )
    return {
      documento,
      caminho: ARQUIVO_DA_ARQUITETURA[documento],
      conteudo,
      hash: createHash('sha256').update(conteudo, 'utf8').digest('hex'),
      afirmacoes
    }
  }

  /** Escreve os quatro arquivos. Caminhos constantes, como na M8-F04. */
  private escrever(
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
}

/**
 * O hash canônico da arquitetura: os quatro documentos **e os anexos**, na ordem.
 *
 * Os anexos entram porque é o critério 6 (*"o pacote registra hashes de todos os anexos e
 * saídas"*) e porque, sem eles, dois pacotes gerados sobre protótipos diferentes que produzissem
 * o mesmo texto colidiriam no `hash` UNIQUE — e o segundo seria devolvido como se fosse o
 * primeiro, apagando a diferença que os anexos fazem.
 */
export function hashDaArquitetura(
  documentos: readonly DocumentoGerado[],
  anexos: readonly Anexo[]
): string {
  const dosDocumentos = documentos.map((d) => `${d.documento}:${d.hash}`).join('|')
  const dosAnexos = [...anexos]
    .map((a) => `${a.caminho}:${a.hash}`)
    .sort()
    .join('|')
  return createHash('sha256').update(`${dosDocumentos}#${dosAnexos}`, 'utf8').digest('hex')
}

export type { AchadoDoPrototipo }
