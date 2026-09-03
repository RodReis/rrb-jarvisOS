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
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
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
import { analisarPrototipo } from '@shared/domain/validacao-de-prototipo'
import type { PacoteArquitetura } from '@shared/domain/arquitetura'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { AnexoRepository } from './anexo-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'
import { carregarPrototipo, lerHtml, referenciasDoHtml } from './prototipo-runner'

/** Teto de tamanho por anexo. Protótipo e design system são texto; asset é imagem de tela. */
const MAX_BYTES_DO_ANEXO = 25 * 1024 * 1024

interface AnexoDeps {
  readonly repository: AnexoRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly audit: AuditRepository
  readonly userId: () => string
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
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly carregar: typeof carregarPrototipo

  constructor(deps: AnexoDeps) {
    this.repository = deps.repository
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.audit = deps.audit
    this.userId = deps.userId
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

    // O marco `design-anexado` sai **aqui**, no ato: é neste instante que o arquivo do PI entra
    // no repositório, e é isto que o marco registra. Deixá-lo para a geração da arquitetura
    // commitaria o design junto da revisão que ele deveria ter precedido — e o histórico não
    // distinguiria "o PI anexou" de "a arquitetura foi composta", que são atos de autores
    // diferentes.
    //
    // Um anexo por marco é deliberado: cada ato é um commit, e agrupá-los exigiria saber quando
    // o PI terminou de anexar — coisa que só ele sabe. Commit sem nada a commitar falha sem
    // perder o anexo, que já está no banco e no disco (mesma postura da M8-F01).
    this.projectService.concluirMarco(projectId, 'design-anexado', workspaceId)

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

  /** Os pacotes de arquitetura já gerados. */
  listarArquiteturas(projectId: string): readonly PacoteArquitetura[] {
    return this.repository.listarArquiteturas(this.userId(), projectId)
  }

  /**
   * As telas que o PRD menciona — hoje, **nenhuma**, e a lista vazia é a resposta correta.
   *
   * A intenção era comparar "o PRD cita uma tela que ninguém prototipou" de forma literal, por
   * texto. Isso foi desligado na M8-F05 porque produzia achado falso em todo projeto: o PRD
   * composto não tinha telas nomeadas, e comparar os headings do protótipo com decisões do
   * wizard é categoria errada.
   *
   * **A comparação voltou na SPEC-Jornada-04, e por outro caminho.** Ela agora é semântica e
   * roda no `ArquiteturaService`: a IA lê os requisitos e as telas e devolve `AjusteProposto` —
   * tela sem requisito, requisito sem tela, estado ausente —, que o PI autoriza item a item e
   * que **nunca** altera o anexo. Aqui fica só a validação determinística, que é o que o gate
   * mede; a leitura semântica acrescenta e não substitui.
   *
   * A assinatura fica: quem quiser reativar a comparação literal acrescenta a fonte aqui, não a
   * comparação inteira.
   */
  private telasDoPrd(_userId: string, _projectId: string): readonly string[] {
    return []
  }

}

export type { AchadoDoPrototipo }
