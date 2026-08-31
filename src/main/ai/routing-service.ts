/**
 * Roteamento e healthcheck de providers (SPEC-Providers-04, critérios 3, 4, 6 e 7).
 *
 * Junta as peças que moram separadas: a **decisão pura** (`selecionarProvider`), a
 * **disponibilidade medida** (healthcheck) e a **auditoria**. Roda no main; o renderer lê o
 * status e edita as rotas por IPC tipado, e nunca decide nada (critério 8).
 *
 * O que este serviço **não** faz: chamar provider. Ele responde "quem atende?" e registra a
 * resposta; quem disparar é o ponto único. É a mesma separação do `BudgetService` da F03, e
 * pela mesma razão — inverter faria o teste do critério 4 precisar de um adapter.
 */

import {
  AI_PROVIDERS,
  MODELO_PADRAO,
  ORIGEM_DO_PROVIDER,
  isRotaUnmetered,
  type AiProvider
} from '@shared/domain/ai'
import {
  TASK_TYPES,
  roteamentoPadrao,
  selecionarProvider,
  type ProviderRoute,
  type ProviderStatus,
  type RoutingPolicy,
  type SelecaoDeProvider,
  type TaskType
} from '@shared/domain/routing'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { RoutingRepository } from './routing-repository'

/** O escopo de quem pergunta — o mesmo par de `AiCallContext`. */
export interface RoutingScope {
  readonly userId: string
  readonly workspace: WorkspaceId
}

/**
 * O que responde "este provider está de pé?".
 *
 * Interface e não os adapters concretos: o healthcheck de cada provider é uma pergunta
 * diferente (HTTP GET no Ollama, `--version` no CLI, credencial presente nos cloud), e o
 * serviço não deve conhecer nenhuma delas. Injetar também é o que permite testar o fallback
 * sem servidor no ar.
 */
export interface SondaDeProvider {
  disponivel(provider: AiProvider): Promise<boolean>
}

/**
 * Quanto tempo um resultado de healthcheck vale.
 *
 * Existe porque a alternativa é sondar a cada chamada — e sondar o Ollama antes de cada
 * mensagem acrescentaria uma ida à rede no caminho crítico para responder uma pergunta cuja
 * resposta muda raramente. Curto o bastante para o usuário que acabou de subir o servidor não
 * ficar preso ao "offline" por muito tempo.
 */
export const VALIDADE_DO_HEALTHCHECK_MS = 30_000

interface Medicao {
  readonly disponivel: boolean
  readonly latenciaMs: number
  readonly medidoEm: number
}

export class RoutingService {
  private readonly cache = new Map<AiProvider, Medicao>()

  constructor(
    private readonly repo: RoutingRepository,
    private readonly sonda: SondaDeProvider,
    private readonly audit: AuditRepository,
    /** Injetável para que o teste controle a validade do cache sem esperar 30 segundos. */
    private readonly agora: () => number = () => Date.now()
  ) {}

  /** As rotas do escopo, ou as padrão quando nunca foram editadas. */
  rotas(scope: RoutingScope): RoutingPolicy {
    return this.repo.find(scope.userId, scope.workspace)
  }

  /**
   * Edita a rota de um tipo de tarefa. Ação de configuração: auditada como `routing-change`.
   */
  setRota(scope: RoutingScope, rota: ProviderRoute): RoutingPolicy {
    const anterior = this.repo.find(scope.userId, scope.workspace).rotas[rota.taskType]
    const atualizado = this.repo.save(scope.userId, scope.workspace, rota, new Date(this.agora()))

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'routing-change',
      payload: {
        taskType: rota.taskType,
        de: { preferencia: anterior.preferencia, preferirLocal: anterior.preferirLocal },
        para: { preferencia: rota.preferencia, preferirLocal: rota.preferirLocal }
      }
    })

    return atualizado
  }

  /**
   * Mede a disponibilidade de um provider, com cache curto (critério 6).
   *
   * A latência medida é a do **healthcheck**, não a da geração — é o que a tela mostra como
   * sinal de saúde, e medir a geração exigiria fazer uma chamada paga só para pintar um número.
   */
  private async medir(provider: AiProvider): Promise<Medicao> {
    const agora = this.agora()
    const cacheado = this.cache.get(provider)
    if (cacheado !== undefined && agora - cacheado.medidoEm < VALIDADE_DO_HEALTHCHECK_MS) {
      return cacheado
    }

    const inicio = agora
    const disponivel = await this.sonda.disponivel(provider)
    const medicao: Medicao = {
      disponivel,
      latenciaMs: this.agora() - inicio,
      medidoEm: this.agora()
    }

    this.cache.set(provider, medicao)
    return medicao
  }

  /** Força a próxima medição a ir à rede — o botão "verificar de novo" da tela. */
  invalidarCache(): void {
    this.cache.clear()
  }

  /** O que a tela de providers mostra: um status por provider (critérios 5 e 6). */
  async status(scope: RoutingScope): Promise<readonly ProviderStatus[]> {
    return await Promise.all(
      AI_PROVIDERS.map(async (provider) => {
        const medicao = await this.medir(provider)
        return {
          provider,
          estado: medicao.disponivel ? ('online' as const) : ('offline' as const),
          modelo: this.repo.modeloAtivo(scope.userId, scope.workspace, provider),
          origem: ORIGEM_DO_PROVIDER[provider],
          latenciaMs: medicao.latenciaMs,
          unmetered: isRotaUnmetered(provider)
        }
      })
    )
  }

  /**
   * Troca o modelo ativo de um provider (critério 5). Auditado como `routing-change`.
   *
   * Devolve `false` quando o repositório recusa o modelo (fora da tabela de preço) — e **não
   * audita** nesse caso: registrar uma troca que não aconteceu faria a auditoria mentir sobre
   * o estado do sistema.
   */
  setModelo(scope: RoutingScope, provider: AiProvider, modelo: string): boolean {
    const anterior = this.repo.modeloAtivo(scope.userId, scope.workspace, provider)
    const gravado = this.repo.saveModelo(
      scope.userId,
      scope.workspace,
      provider,
      modelo,
      new Date(this.agora())
    )

    if (!gravado) {
      log.ai.warn('Troca de modelo recusada: fora da tabela de preço', { provider, modelo })
      return false
    }

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'routing-change',
      payload: { provider, modeloDe: anterior, modeloPara: modelo }
    })

    return true
  }

  /**
   * Escolhe o provider para uma tarefa e **audita a decisão** (critérios 3, 4 e 7).
   *
   * Audita todos os desfechos, não só o fallback: "a rota nunca caiu" e "a rota nunca rodou"
   * são fatos diferentes — o mesmo argumento do gate de orçamento da F03.
   */
  async selecionar(
    scope: RoutingScope,
    taskType: TaskType
  ): Promise<SelecaoDeProvider & { readonly modelo?: string }> {
    const rota = this.repo.find(scope.userId, scope.workspace).rotas[taskType]

    // Sonda **só os candidatos da rota**, não os quatro providers: perguntar ao Gemini se está
    // de pé para atender uma rota que não o lista seria uma ida à rede sem consequência.
    const medicoes = await Promise.all(
      rota.preferencia.map(async (p) => [p, await this.medir(p)] as const)
    )
    const disponiveis = new Set(medicoes.filter(([, m]) => m.disponivel).map(([p]) => p))

    const selecao = selecionarProvider(rota, disponiveis)

    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspace,
      type: 'provider-selection',
      payload: {
        taskType,
        decisao: selecao.decisao,
        ...(selecao.decisao === 'escolhido'
          ? { provider: selecao.provider, motivo: selecao.motivo }
          : {}),
        pulados: selecao.pulados
      }
    })

    if (selecao.decisao === 'indisponivel') {
      log.ai.warn('Nenhum provider disponível para a tarefa', {
        workspace: scope.workspace,
        taskType,
        pulados: selecao.pulados
      })
      return selecao
    }

    if (selecao.motivo === 'fallback') {
      // `warn` e não `info`: cair para o segundo da lista é sintoma de que o preferido está
      // fora, e é isso que alguém investigando quer encontrar no log.
      log.ai.warn('Rota caiu para provider de fallback', {
        workspace: scope.workspace,
        taskType,
        provider: selecao.provider,
        pulados: selecao.pulados
      })
    }

    return {
      ...selecao,
      modelo: this.repo.modeloAtivo(scope.userId, scope.workspace, selecao.provider)
    }
  }
}

/**
 * A sonda concreta, montada sobre os adapters (critério 6).
 *
 * Cada provider responde a uma pergunta diferente, e é aqui que a diferença mora — o
 * `RoutingService` só sabe que existe uma resposta booleana:
 *
 * - **Ollama** e **Claude Code CLI** têm healthcheck próprio (HTTP local e `--version`), porque
 *   podem simplesmente não estar rodando na máquina.
 * - **Anthropic** e **Gemini** são serviços na nuvem: o que os torna indisponíveis para *este*
 *   usuário é a **credencial faltando**, não o serviço estar fora. Pingar a API para descobrir
 *   isso custaria uma requisição por checagem — e responderia a pergunta errada, porque um
 *   provider no ar sem chave configurada não atende igual.
 */
export class SondaDeAdapters implements SondaDeProvider {
  constructor(private readonly checagens: Readonly<Record<AiProvider, () => Promise<boolean>>>) {}

  async disponivel(provider: AiProvider): Promise<boolean> {
    try {
      return await this.checagens[provider]()
    } catch {
      // Sonda nunca lança: é chamada em laço pela tela, e um throw obrigaria cada chamador a
      // envolver em try. Falha ao medir é `false` — que é o comportamento seguro, porque um
      // provider que não sabemos se está de pé não deve ser escolhido.
      return false
    }
  }
}

/** Os cinco tipos, para a tela iterar sem redeclarar a lista. */
export const TIPOS_DE_TAREFA = TASK_TYPES

/** O roteamento padrão de um escopo — reexportado para o repositório e o teste. */
export { roteamentoPadrao, MODELO_PADRAO }
