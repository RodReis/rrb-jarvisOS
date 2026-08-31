/**
 * Montagem do `ContextPack` — o que acontece **antes** de qualquer geração
 * (SPEC-Planejamento-02, critérios 1 a 7).
 *
 * A ordem das checagens é a garantia inteira, e cada uma existe por um motivo distinto:
 *
 *   1. **Projeto conhecido?** Fora ⇒ recusa. É a checagem que não lê nada.
 *   2. **Cada arquivo está dentro do projeto?** Fora ⇒ ignorado. O pack não é um caminho para
 *      ler o disco: o que ele monta vive sob o diretório do projeto, e só.
 *   3. **Algum item carrega segredo?** ⇒ recusa **do pack inteiro** (critério 7). Não redige,
 *      não remove o item: recusa. Um pack com o segredo removido ensinaria que existe uma forma
 *      segura de anexar um `.env`.
 *   4. **Leitura ampla sem exceção registrada?** ⇒ recusa (critério 3).
 *   5. **Passou do teto de tokens sem motivo de expansão?** ⇒ recusa (critério 6).
 *   6. **Só então** o pack é hasheado e gravado.
 *
 * A recusa vem antes da gravação em todos os caminhos, e é por isso que um pack recusado não
 * deixa linha no banco: não há manifesto parcial a limpar porque não houve manifesto.
 *
 * **O que este serviço não faz: chamar provider.** Ele monta o manifesto e responde "pode
 * gerar?"; quem gera é o `AiCallService`, que recebe o `contextPackId` e recusa sem ele. Inverter
 * — o montador disparando a chamada — colocaria a geração atrás de um serviço cujo teste
 * passaria a precisar de um adapter.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  MAX_TOKENS_PADRAO,
  MODELO_PADRAO,
  calcularCustoUsd,
  isRotaUnmetered,
  type AiProvider
} from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  TETO_DE_TOKENS_PADRAO,
  bytesDeLeituraAmpla,
  exigeExcecao,
  falhasParaOContexto,
  tokensDosItens,
  type ContextItem,
  type ContextPack,
  type ContextPackOutcome,
  type ContextPackReason,
  type ExcecaoDeLeituraAmpla,
  type OrcamentoDaEtapa,
  type OrigemDeContexto
} from '@shared/domain/context-pack'
import type { PathsPermitidos } from '@shared/domain/preflight'
import { detectarSegredo } from '@shared/domain/segredos'
import {
  resolverCapacidades,
  type CapacidadeResolvida,
  type SkillDisponivel
} from '@shared/domain/skills'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { ProjectRepository } from '../projects/project-repository'
import type { ContextRepository } from './context-repository'

/** Um candidato a item, como o chamador o pede: caminho relativo, origem e motivo. */
export interface CandidatoDeContexto {
  /** Relativo à raiz do projeto. Absoluto é recusado — ver `resolverDentroDoProjeto`. */
  readonly caminho: string
  readonly origem: OrigemDeContexto
  readonly motivo: string
  /** Faixa de linhas, quando só um trecho entra (o resultado de uma busca estrutural). */
  readonly linhas?: { readonly de: number; readonly ate: number }
}

/** O pedido de montagem, como o IPC o entrega. */
export interface PedidoDeContexto {
  readonly projectId: string
  readonly tarefa: string
  readonly etapa: string
  readonly candidatos: readonly CandidatoDeContexto[]
  readonly regras?: readonly string[]
  readonly resumoAnterior?: string
  /** A rota por onde a geração sairá. Decide se o orçamento é em USD ou em uso. */
  readonly rota: AiProvider
  readonly excecaoDeLeituraAmpla?: ExcecaoDeLeituraAmpla
  /** Teto de tokens desta etapa. Ausente = `TETO_DE_TOKENS_PADRAO`. */
  readonly tetoDeTokens?: number
  /** Obrigatório para o teto expandido valer (critério 6: expansão atribuída a uma causa). */
  readonly motivoDaExpansao?: string
  /** O pack que este expande, quando é retomada. */
  readonly packAnterior?: string
  /**
   * O escopo de arquivos do run (SPEC-Entrega-03, critério 13). Só a pipeline preenche — uma
   * geração avulsa não tem run, e exigir o campo aqui quebraria todo chamador do MVP-008.
   */
  readonly pathsPermitidos?: PathsPermitidos
}

interface ContextServiceDeps {
  readonly repository: ContextRepository
  readonly projects: ProjectRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * As skills instaladas no ambiente. Função e não lista fixa porque o ambiente muda entre
   * execuções — e porque **nenhuma skill é dependência de build** (decisão cravada na spec):
   * elas são consultadas em runtime, nunca importadas.
   */
  readonly skills: () => readonly SkillDisponivel[]
}

/** Teto de bytes por arquivo lido. Arquivo maior entra truncado, com o truncamento no motivo. */
const TETO_POR_ARQUIVO_BYTES = 256 * 1024

/**
 * Hash canônico do manifesto (critério 2).
 *
 * Canônico quer dizer **ordem estável e campos explícitos**: `JSON.stringify` de um objeto
 * montado ad hoc dependeria da ordem de inserção das chaves, e dois packs idênticos hasheariam
 * diferente por causa de uma reordenação de código. Aqui a sequência é a do array, escrita à
 * mão, e é ela que faz "mesmo conteúdo ⇒ mesmo hash" ser verdade entre versões do app.
 *
 * `createHash` sem chave, como na evidência da SPEC-Conectores-06 e ao contrário do HMAC da
 * cadeia de auditoria: o que o hash prova aqui é **reprodutibilidade**, não autenticidade — e
 * um segredo nosso tornaria a verificação impossível para quem auditasse de fora.
 */
export function hashDoPack(entrada: Omit<ContextPack, 'id' | 'hash' | 'created_at'>): string {
  const canonico = [
    entrada.user_id,
    entrada.workspace_id,
    entrada.projectId,
    entrada.tarefa,
    entrada.rota,
    entrada.packAnterior ?? '',
    entrada.resumoAnterior ?? '',
    entrada.orcamento.etapa,
    String(entrada.orcamento.tetoDeTokens),
    String(entrada.orcamento.tokensEstimados),
    // `null` e `0` são estados diferentes (não-monetário versus custo zero), e o texto tem de
    // distingui-los: sem isto, uma rota de assinatura e uma chamada grátis hasheariam igual.
    entrada.orcamento.estimadoUsd === null ? 'unmetered' : entrada.orcamento.estimadoUsd.toFixed(8),
    entrada.orcamento.motivoDaExpansao ?? '',
    entrada.excecaoDeLeituraAmpla === undefined
      ? ''
      : `${entrada.excecaoDeLeituraAmpla.motivo}|${entrada.excecaoDeLeituraAmpla.tetoDeBytes}`,
    ...entrada.regras,
    ...entrada.falhasAbertas.map((falha) => `${falha.fingerprint}:${falha.ocorrencias}`),
    ...entrada.itens.map(
      (item) =>
        `${item.caminho}|${item.hash}|${item.origem}|${item.bytes}|${item.linhas?.de ?? ''}-${item.linhas?.ate ?? ''}`
    ),
    // O escopo entra no canônico, e isso é load-bearing (SPEC-Entrega-03, critério 13). Fora
    // dele, dois packs idênticos em conteúdo mas com **allowlists diferentes** colidiriam no
    // hash, e `findByHash` devolveria o pack antigo — o run seguinte herdaria silenciosamente o
    // escopo de outro. O `?? ''` no fim preserva o hash dos packs já persistidos, que não têm o
    // campo: ausência continua hasheando como ausência.
    entrada.pathsPermitidos === undefined
      ? ''
      : `${entrada.pathsPermitidos.origem}|${entrada.pathsPermitidos.paths.join(',')}`
  ].join('\n')

  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

/**
 * Fingerprint de uma falha (critério 4).
 *
 * Derivado do **conteúdo normalizado**, nunca de um id gerado: dois relatórios da mesma falha
 * em execuções diferentes têm de colidir, senão a falha resolvida volta como descoberta nova.
 * A normalização remove o que muda entre execuções e não muda a falha — timestamps, números de
 * linha absolutos de stack, ids aleatórios, caixa e espaço.
 */
export function fingerprintDaFalha(etapa: string, mensagem: string): string {
  const normalizada = mensagem
    .toLowerCase()
    // Timestamps ISO e horários: o mesmo erro em dois momentos é o mesmo erro.
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '<ts>')
    // UUIDs e hashes longos: identificam a execução, não a falha.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b[0-9a-f]{32,}\b/g, '<hash>')
    // Números soltos: contagem de linha, porta, pid. `foo:12` e `foo:47` são a mesma falha.
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()

  return createHash('sha256').update(`${etapa}\n${normalizada}`, 'utf8').digest('hex').slice(0, 32)
}

export class ContextService {
  private readonly repository: ContextRepository
  private readonly projects: ProjectRepository
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly skills: () => readonly SkillDisponivel[]

  constructor(deps: ContextServiceDeps) {
    this.repository = deps.repository
    this.projects = deps.projects
    this.audit = deps.audit
    this.userId = deps.userId
    this.skills = deps.skills
  }

  /**
   * Como o fluxo atende cada capacidade nesta execução (critério 5).
   *
   * Devolve **sempre** a lista completa — com skill ou sem. É esta função que torna "ausência
   * de skill não remove o gate" estrutural em vez de convenção: não existe caminho em que uma
   * capacidade volte vazia, então não existe `if` onde o gate pudesse sumir.
   */
  capacidades(): readonly CapacidadeResolvida[] {
    return resolverCapacidades(this.skills())
  }

  /**
   * Monta o pack. Devolve **sempre** um desfecho — inclusive nas recusas, que não são exceção:
   * "este arquivo tem segredo" é resposta legítima que a tela mostra, não falha técnica.
   */
  montar(pedido: PedidoDeContexto, workspaceId: WorkspaceId): ContextPackOutcome {
    const userId = this.userId()
    const project = this.projects.findById(userId, pedido.projectId)

    if (project === undefined || project.workspace_id !== workspaceId) {
      return this.recusar(userId, workspaceId, 'projeto-desconhecido', pedido, {
        mensagem: 'Projeto não encontrado neste espaço. Abra o projeto antes de montar o contexto.'
      })
    }

    const itens: ContextItem[] = []
    const comSegredo: string[] = []

    for (const candidato of pedido.candidatos) {
      const absoluto = this.resolverDentroDoProjeto(project.diretorio, candidato.caminho)
      if (absoluto === undefined) {
        // Fora do diretório do projeto. Ignorado em silêncio para a lista, mas **auditado**: um
        // pedido que tenta sair do projeto é o fato interessante, não o item que faltou.
        log.agent.warn('Candidato a contexto fora do diretório do projeto foi ignorado', {
          projectId: project.id,
          caminho: candidato.caminho
        })
        continue
      }

      const conteudo = this.ler(absoluto)
      if (conteudo === undefined) continue

      // (3) Segredo (critério 7). O achado guarda o caminho, nunca o trecho casado.
      if (detectarSegredo(candidato.caminho, conteudo) !== undefined) {
        comSegredo.push(candidato.caminho)
        continue
      }

      itens.push({
        caminho: candidato.caminho,
        hash: createHash('sha256').update(conteudo, 'utf8').digest('hex'),
        origem: candidato.origem,
        bytes: Buffer.byteLength(conteudo, 'utf8'),
        ...(candidato.linhas === undefined ? {} : { linhas: candidato.linhas }),
        motivo: candidato.motivo
      })
    }

    if (comSegredo.length > 0) {
      // Recusa do **pack inteiro**, não do item. Montar sem os arquivos acusados entregaria um
      // contexto silenciosamente diferente do pedido, e quem pediu não saberia o que faltou.
      return this.recusar(userId, workspaceId, 'segredo-no-contexto', pedido, {
        mensagem:
          comSegredo.length === 1
            ? `O arquivo "${comSegredo[0]}" parece conter credencial e não entra no contexto. Remova-o da seleção.`
            : `${comSegredo.length} arquivos selecionados parecem conter credencial e não entram no contexto. Remova-os da seleção.`,
        caminhosComSegredo: comSegredo,
        detalhe: { caminhosComSegredo: comSegredo }
      })
    }

    if (itens.length === 0) {
      return this.recusar(userId, workspaceId, 'contexto-vazio', pedido, {
        mensagem: 'Nenhum arquivo legível foi selecionado. Escolha ao menos um antes de gerar.'
      })
    }

    // (4) Leitura ampla exige exceção registrada (critério 3).
    if (exigeExcecao(itens)) {
      const excecao = pedido.excecaoDeLeituraAmpla
      if (excecao === undefined) {
        return this.recusar(userId, workspaceId, 'leitura-ampla-sem-excecao', pedido, {
          mensagem:
            'Leitura ampla do repositório exige uma exceção registrada com motivo e teto. Refine a seleção ou registre a exceção.'
        })
      }

      const bytes = bytesDeLeituraAmpla(itens)
      if (bytes > excecao.tetoDeBytes) {
        return this.recusar(userId, workspaceId, 'teto-da-excecao-excedido', pedido, {
          mensagem: `A leitura ampla soma ${bytes} bytes e a exceção autorizou ${excecao.tetoDeBytes}. Refine a seleção ou registre outra exceção.`,
          detalhe: { bytes, tetoDeBytes: excecao.tetoDeBytes }
        })
      }
    }

    // (5) Orçamento da etapa (critérios 1a e 6).
    const orcamento = this.orcamentoDaEtapa(pedido, itens)
    if (orcamento.tokensEstimados > orcamento.tetoDeTokens) {
      return this.recusar(userId, workspaceId, 'teto-de-tokens-excedido', pedido, {
        mensagem: `O contexto estima ${orcamento.tokensEstimados} tokens e o teto da etapa é ${orcamento.tetoDeTokens}. Reduza a seleção ou registre o motivo da expansão.`,
        detalhe: {
          tokensEstimados: orcamento.tokensEstimados,
          tetoDeTokens: orcamento.tetoDeTokens
        }
      })
    }

    const falhasAbertas = falhasParaOContexto(this.repository.listFalhas(userId, project.id))

    const semHash: Omit<ContextPack, 'id' | 'hash' | 'created_at'> = {
      user_id: userId,
      workspace_id: workspaceId,
      projectId: project.id,
      tarefa: pedido.tarefa,
      itens,
      regras: pedido.regras ?? [],
      falhasAbertas,
      ...(pedido.resumoAnterior === undefined ? {} : { resumoAnterior: pedido.resumoAnterior }),
      orcamento,
      ...(pedido.excecaoDeLeituraAmpla === undefined || !exigeExcecao(itens)
        ? {}
        : { excecaoDeLeituraAmpla: pedido.excecaoDeLeituraAmpla }),
      rota: pedido.rota,
      ...(pedido.packAnterior === undefined ? {} : { packAnterior: pedido.packAnterior }),
      ...(pedido.pathsPermitidos === undefined ? {} : { pathsPermitidos: pedido.pathsPermitidos })
    }

    const hash = hashDoPack(semHash)

    // **Mesmo conteúdo canônico ⇒ mesmo pack.** Remontar um contexto idêntico não produz
    // manifesto novo: produz o que já existe. É o invariante 2 do CONVENTION §4 valendo aqui
    // (mesma revisão aprovada não pede aceite novo), e é por isso que `hash` é UNIQUE no
    // storage — a igualdade é afirmação do modelo, não coincidência a tolerar. Gravar uma
    // segunda linha faria duas identidades para o mesmo envio, e "qual pack esta geração usou?"
    // passaria a ter duas respostas certas.
    const existente = this.repository.findByHash(userId, hash)
    if (existente !== undefined) {
      log.agent.info('ContextPack idêntico já existia; reaproveitado', {
        packId: existente.id,
        projectId: project.id
      })
      return {
        reason: 'montado',
        pack: existente,
        mensagem: `Contexto idêntico ao anterior: ${existente.itens.length} ${existente.itens.length === 1 ? 'arquivo' : 'arquivos'}, ${existente.orcamento.tokensEstimados} tokens estimados.`
      }
    }

    const pack: ContextPack = {
      id: randomUUID(),
      ...semHash,
      hash,
      created_at: new Date().toISOString()
    }

    this.repository.save(pack)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'context-pack',
      // Caminhos e hashes — **nunca o conteúdo**. A auditoria responde "o que foi enviado?", e
      // responder isso não exige repetir o que foi enviado (ADR-004).
      payload: {
        reason: 'montado',
        packId: pack.id,
        projectId: project.id,
        hash: pack.hash,
        itens: itens.length,
        tokensEstimados: orcamento.tokensEstimados,
        tetoDeTokens: orcamento.tetoDeTokens,
        unmetered: orcamento.unmetered,
        estimadoUsd: orcamento.estimadoUsd,
        rota: pack.rota,
        leituraAmpla: exigeExcecao(itens),
        capacidades: this.capacidades().map((c) => `${c.capacidade}:${c.meio}`)
      }
    })

    log.agent.info('ContextPack montado', {
      packId: pack.id,
      projectId: project.id,
      itens: itens.length,
      tokensEstimados: orcamento.tokensEstimados,
      rota: pack.rota
    })

    return {
      reason: 'montado',
      pack,
      mensagem: `Contexto montado com ${itens.length} ${itens.length === 1 ? 'arquivo' : 'arquivos'} e ${orcamento.tokensEstimados} tokens estimados.`
    }
  }

  /** O pack pelo id — é por aqui que o gate do `AiCallService` confirma que ele existe. */
  buscar(packId: string): ContextPack | undefined {
    return this.repository.findById(this.userId(), packId)
  }

  /** Os packs de um projeto, do mais recente ao mais antigo. É o que a tela lista. */
  listar(projectId: string): readonly ContextPack[] {
    return this.repository.listByProject(this.userId(), projectId)
  }

  /** As falhas do projeto — abertas e resolvidas. A tela mostra as duas; o pack, só as abertas. */
  listarFalhas(projectId: string): ReturnType<ContextRepository['listFalhas']> {
    return this.repository.listFalhas(this.userId(), projectId)
  }

  /**
   * Registra uma falha, deduplicando pelo fingerprint (critério 4).
   *
   * O mesmo relato duas vezes **incrementa** o contador em vez de criar segunda linha — é o
   * storage que garante isso (`ON CONFLICT`), não este método, e é por isso que dois chamadores
   * concorrentes não conseguem produzir a falha duplicada.
   */
  registrarFalha(
    projectId: string,
    workspaceId: WorkspaceId,
    etapa: string,
    mensagem: string
  ): ReturnType<ContextRepository['registrarFalha']> {
    const userId = this.userId()
    const agora = new Date().toISOString()
    const fingerprint = fingerprintDaFalha(etapa, mensagem)

    const falha = this.repository.registrarFalha({
      fingerprint,
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      resumo: mensagem,
      primeiraEm: agora,
      ultimaEm: agora
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'context-failure',
      payload: {
        reason: falha.ocorrencias > 1 ? 'reincidente' : 'nova',
        projectId,
        fingerprint,
        ocorrencias: falha.ocorrencias,
        etapa
      }
    })

    return falha
  }

  /** Marca a falha como resolvida — a partir daqui ela não volta ao contexto (critério 4). */
  resolverFalha(projectId: string, workspaceId: WorkspaceId, fingerprint: string): boolean {
    const userId = this.userId()
    const resolvida = this.repository.resolverFalha(userId, projectId, fingerprint)

    if (resolvida) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'context-failure',
        payload: { reason: 'resolvida', projectId, fingerprint }
      })
    }

    return resolvida
  }

  /**
   * O orçamento desta etapa (critério 1a).
   *
   * **A rota decide o que é medido.** Na rota de assinatura `estimadoUsd` é `null` — não zero:
   * zero afirmaria "custou nada", `null` diz "não se converte em USD", que é o fato. Converter
   * uso do MAX em dólar estimado seria número inventado, e a `BudgetPolicy` barraria com base
   * nele (emenda do PI de 2026-08-29).
   *
   * O teto de **tokens** vale nas duas rotas, e é de propósito: contexto grande custa em
   * qualidade e em janela mesmo quando não custa em dinheiro. Um teto que só existisse na rota
   * paga deixaria a rota de assinatura sem nenhum limite — e o critério 1 fala de orçamento em
   * toda geração, não em toda geração cobrada.
   */
  private orcamentoDaEtapa(
    pedido: PedidoDeContexto,
    itens: readonly ContextItem[]
  ): OrcamentoDaEtapa {
    const unmetered = isRotaUnmetered(pedido.rota)
    const tokensDoContexto = tokensDosItens(itens)
    // O teto de saída entra na conta pelo mesmo motivo de `estimarCustoUsd`: o pior caso é o
    // que precisa caber. Contar só a entrada deixaria passar a chamada que estoura na resposta.
    const tokensEstimados = tokensDoContexto + MAX_TOKENS_PADRAO

    // O teto expandido só vale **com motivo** (critério 6: expansão atribuída a uma causa).
    // Sem motivo, o pedido de expansão é ignorado e o padrão prevalece — que faz a recusa
    // acontecer, em vez de deixar o teto crescer sem explicação.
    const expandido =
      pedido.tetoDeTokens !== undefined &&
      pedido.motivoDaExpansao !== undefined &&
      pedido.motivoDaExpansao.trim().length > 0

    return {
      etapa: pedido.etapa,
      unmetered,
      tetoDeTokens: expandido ? (pedido.tetoDeTokens as number) : TETO_DE_TOKENS_PADRAO,
      tokensEstimados,
      // `calcularCustoUsd` e não `estimarCustoUsd`: a estimativa da F03 recebe o **texto** e
      // conta os tokens dele, e aqui os tokens já estão contados a partir dos bytes medidos —
      // passar por `estimarCustoUsd` exigiria fabricar uma string do tamanho certo só para ela
      // ser medida de novo. O modelo é o padrão da rota; o ativo é resolvido pelo roteamento no
      // momento da chamada, e este número é cota superior para o gate, não fatura.
      estimadoUsd: unmetered
        ? null
        : calcularCustoUsd(pedido.rota, MODELO_PADRAO[pedido.rota], {
            tokensEntrada: tokensDoContexto,
            tokensSaida: MAX_TOKENS_PADRAO
          }),
      ...(expandido ? { motivoDaExpansao: pedido.motivoDaExpansao } : {})
    }
  }

  /**
   * Resolve o caminho candidato **dentro** do diretório do projeto, ou `undefined`.
   *
   * Relativo obrigatório e contenção verificada depois do `resolve`: é o mesmo raciocínio do
   * anti-escape da allowlist. Um `../../.ssh/id_rsa` some no `resolve` como caminho textual
   * legítimo, e só a comparação com a raiz do projeto o barra. Aceitar caminho absoluto faria
   * o pack virar um leitor de disco arbitrário — que é o oposto do que "contexto restrito"
   * significa.
   */
  private resolverDentroDoProjeto(raiz: string, caminho: string): string | undefined {
    if (isAbsolute(caminho)) return undefined

    const absoluto = resolve(raiz, caminho)
    const relativo = relative(raiz, absoluto)

    if (relativo.startsWith('..') || isAbsolute(relativo)) return undefined
    return absoluto
  }

  /**
   * Lê o arquivo, truncando no teto. `undefined` quando não dá para ler.
   *
   * Truncar em vez de recusar: um arquivo grande selecionado por engano não deve derrubar a
   * montagem inteira, e o `bytes` do item registra exatamente quanto entrou — de modo que o
   * manifesto continua descrevendo o que foi enviado, não o que existia no disco.
   */
  private ler(absoluto: string): string | undefined {
    try {
      const info = statSync(absoluto)
      if (!info.isFile()) return undefined

      const conteudo = readFileSync(absoluto, 'utf8')
      return conteudo.length > TETO_POR_ARQUIVO_BYTES
        ? conteudo.slice(0, TETO_POR_ARQUIVO_BYTES)
        : conteudo
    } catch {
      // Arquivo apagado entre a seleção e a montagem, ou sem permissão. Desfecho normal:
      // o item não entra, e o manifesto registra o que entrou.
      return undefined
    }
  }

  /** Recusa auditada. **Toda** recusa audita — a tentativa barrada é o fato interessante. */
  private recusar(
    userId: string,
    workspaceId: WorkspaceId,
    reason: ContextPackReason,
    pedido: PedidoDeContexto,
    extra: {
      readonly mensagem: string
      readonly caminhosComSegredo?: readonly string[]
      readonly detalhe?: Readonly<Record<string, unknown>>
    }
  ): ContextPackOutcome {
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'context-pack',
      payload: {
        reason,
        projectId: pedido.projectId,
        etapa: pedido.etapa,
        rota: pedido.rota,
        ...(extra.detalhe ?? {})
      }
    })

    log.agent.warn('Montagem de ContextPack recusada', {
      reason,
      projectId: pedido.projectId,
      etapa: pedido.etapa
    })

    return {
      reason,
      mensagem: extra.mensagem,
      ...(extra.caminhosComSegredo === undefined
        ? {}
        : { caminhosComSegredo: extra.caminhosComSegredo })
    }
  }
}
